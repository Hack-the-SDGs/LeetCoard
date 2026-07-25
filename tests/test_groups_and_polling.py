"""Team standings and the attention-following polling schedule."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import Contest, Difficulty, Group, Participant, Problem
from app.domain.state import ContestEngine
from app.workers.polling import backoff_delay, rate_limit_scale

START = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)


def _make_engine(tmp_path: Path) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    return ContestEngine(store, Broadcaster(), settings)


def _seed(engine: ContestEngine, participants: dict[str, Participant]) -> None:
    engine._store._contest = Contest(
        problems=[
            Problem(
                title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0,
                is_open=True, opened_at=START,
            ),
        ],
        participants=participants,
    )


def _member(name: str, group_id: int | None, score: int, reached: datetime | None) -> Participant:
    return Participant(
        username=name, nickname=name.upper(), group_id=group_id,
        score=score, reached_current_score_at=reached,
    )


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

def test_six_teams_exist_by_default(tmp_path: Path):
    engine = _make_engine(tmp_path)
    assert [g.id for g in engine.contest.groups] == [1, 2, 3, 4, 5, 6]
    assert all(g.color.startswith("#") for g in engine.contest.groups)
    assert len({g.color for g in engine.contest.groups}) == 6


def test_team_score_is_the_sum_of_its_members(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {
        "a": _member("a", 1, 10, START),
        "b": _member("b", 1, 15, START + timedelta(minutes=1)),
        "c": _member("c", 2, 20, START),
    })
    rows = {r["group_id"]: r for r in engine._group_leaderboard()}
    assert rows[1]["score"] == 25
    assert rows[1]["member_count"] == 2
    assert rows[2]["score"] == 20
    assert rows[1]["rank"] == 1
    assert rows[2]["rank"] == 2


def test_unassigned_students_count_towards_no_team(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {
        "a": _member("a", 1, 10, START),
        "loner": _member("loner", None, 999, START),
    })
    rows = {r["group_id"]: r for r in engine._group_leaderboard()}
    assert rows[1]["score"] == 10
    assert sum(r["score"] for r in rows.values()) == 10
    assert sum(r["member_count"] for r in rows.values()) == 1


def test_tied_teams_break_by_who_got_there_first(tmp_path: Path):
    engine = _make_engine(tmp_path)
    early = START + timedelta(minutes=5)
    late = START + timedelta(minutes=9)
    _seed(engine, {
        "a": _member("a", 1, 10, late),
        "b": _member("b", 2, 10, early),
    })
    rows = {r["group_id"]: r for r in engine._group_leaderboard()}
    assert rows[2]["rank"] == 1
    assert rows[1]["rank"] == 2


def test_empty_teams_still_appear_so_the_header_keeps_six_slots(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {"a": _member("a", 1, 10, START)})
    rows = engine._group_leaderboard()
    assert len(rows) == 6
    assert [r["rank"] for r in rows] == [1, 2, 3, 4, 5, 6]


@pytest.mark.asyncio
async def test_renaming_and_recolouring_teams(tmp_path: Path):
    engine = _make_engine(tmp_path)
    await engine.set_groups([Group(id=1, name="紅隊", color="#FF0000")])
    group = engine.contest.groups[0]
    assert group.name == "紅隊"
    assert group.color == "#FF0000"
    assert engine.contest.groups[1].name == "第二組"  # untouched


@pytest.mark.asyncio
async def test_renaming_an_unknown_team_is_rejected(tmp_path: Path):
    engine = _make_engine(tmp_path)
    with pytest.raises(ValueError):
        await engine.set_groups([Group(id=6, name="ok", color="#FFFFFF"),
                                 Group.model_construct(id=99, name="ghost", color="#000000")])


@pytest.mark.asyncio
async def test_moving_a_student_moves_their_points(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {"a": _member("a", 1, 12, START)})

    await engine.set_participant_group("a", 3)
    rows = {r["group_id"]: r for r in engine._group_leaderboard()}
    assert rows[1]["score"] == 0
    assert rows[3]["score"] == 12

    await engine.set_participant_group("a", None)
    rows = {r["group_id"]: r for r in engine._group_leaderboard()}
    assert all(r["score"] == 0 for r in rows.values())


@pytest.mark.asyncio
async def test_import_without_a_group_column_keeps_the_existing_assignment(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {"a": _member("a", 4, 0, None)})

    created, updated, errors, _ = await engine.upsert_participants([("a", "陳小明", None)])
    assert (created, updated, errors) == (0, 1, [])
    assert engine.contest.participants["a"].group_id == 4
    assert engine.contest.participants["a"].nickname == "陳小明"


@pytest.mark.asyncio
async def test_import_rejects_a_team_that_does_not_exist(tmp_path: Path):
    engine = _make_engine(tmp_path)
    created, updated, errors, _ = await engine.upsert_participants([("zed", "小明", 9)])
    assert created == 0 and updated == 0
    assert errors and "9" in errors[0]
    assert "zed" not in engine.contest.participants


@pytest.mark.asyncio
async def test_reset_keeps_team_assignments(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine, {"a": _member("a", 5, 30, START)})
    await engine.set_groups([Group(id=5, name="紫隊", color="#7B72D6")])

    await engine.reset_contest(keep_config=True)
    participant = engine.contest.participants["a"]
    assert participant.group_id == 5
    assert participant.score == 0
    assert engine.contest.groups[4].name == "紫隊"


# ---------------------------------------------------------------------------
# Polling schedule
# ---------------------------------------------------------------------------

def test_idle_students_back_off_and_busy_ones_stay_at_the_floor():
    assert backoff_delay(0, 5.0, 60.0) == 5.0
    assert backoff_delay(1, 5.0, 60.0) == 10.0
    assert backoff_delay(2, 5.0, 60.0) == 20.0
    assert backoff_delay(3, 5.0, 60.0) == 40.0
    assert backoff_delay(4, 5.0, 60.0) == 60.0  # clamped
    assert backoff_delay(50, 5.0, 60.0) == 60.0  # never runs away


def test_rate_scale_is_one_when_the_fleet_fits_under_the_ceiling():
    delays = {f"u{i}": 20.0 for i in range(70)}  # 70 / 20s = 3.5 rps
    assert rate_limit_scale(delays, 6.0) == 1.0


def test_rate_scale_stretches_delays_when_everyone_is_active():
    """70 active students at a 5 s floor would be 14 rps — exactly the number
    the adaptive schedule exists to avoid."""
    delays = {f"u{i}": 5.0 for i in range(70)}
    scale = rate_limit_scale(delays, 6.0)
    assert scale == pytest.approx(14.0 / 6.0)

    scaled = {u: d * scale for u, d in delays.items()}
    achieved_rps = sum(1.0 / d for d in scaled.values())
    assert achieved_rps == pytest.approx(6.0)


def test_rate_scale_survives_an_empty_fleet_and_a_disabled_ceiling():
    assert rate_limit_scale({}, 6.0) == 1.0
    assert rate_limit_scale({"a": 5.0}, 0.0) == 1.0
