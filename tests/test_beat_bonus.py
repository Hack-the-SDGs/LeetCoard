"""Tests for the beat-% bonus scoring feature."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.scoring import compute_beat_bonus
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import BonusTier, Contest, Difficulty, Participant, Problem
from app.domain.state import ContestEngine

# ---------------------------------------------------------------------------
# Pure-function tests — compute_beat_bonus
# ---------------------------------------------------------------------------

TIERS = [
    BonusTier(min_beat_pct=95.0, bonus_pts=3),
    BonusTier(min_beat_pct=80.0, bonus_pts=2),
    BonusTier(min_beat_pct=60.0, bonus_pts=1),
]

START = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)


def test_no_tiers_returns_zero():
    assert compute_beat_bonus(98.0, []) == 0


def test_none_beat_pct_returns_zero():
    assert compute_beat_bonus(None, TIERS) == 0


def test_highest_qualifying_tier_wins():
    assert compute_beat_bonus(98.0, TIERS) == 3
    assert compute_beat_bonus(85.0, TIERS) == 2
    assert compute_beat_bonus(65.0, TIERS) == 1


def test_below_all_thresholds_returns_zero():
    assert compute_beat_bonus(59.9, TIERS) == 0


def test_exact_threshold_qualifies():
    assert compute_beat_bonus(95.0, TIERS) == 3
    assert compute_beat_bonus(80.0, TIERS) == 2
    assert compute_beat_bonus(60.0, TIERS) == 1


def test_single_tier():
    tiers = [BonusTier(min_beat_pct=50.0, bonus_pts=5)]
    assert compute_beat_bonus(50.0, tiers) == 5
    assert compute_beat_bonus(49.9, tiers) == 0


# ---------------------------------------------------------------------------
# Integration tests — bonus flows through ingest_submissions
# ---------------------------------------------------------------------------

def _make_engine(tmp_path: Path) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    return ContestEngine(store, Broadcaster(), settings)


def _open_problem(slug: str, difficulty: Difficulty, points: int, order: int,
                  tiers: list[BonusTier]) -> Problem:
    return Problem(
        title_slug=slug,
        difficulty=difficulty,
        points=points,
        order=order,
        beat_bonus_tiers=tiers,
        is_open=True,
        opened_at=START,
    )


def _seed(engine: ContestEngine, *, problems: list[Problem] | None = None) -> None:
    engine._store._contest = Contest(
        problems=problems
        if problems is not None
        else [
            _open_problem("two-sum", Difficulty.easy, 1, 0, TIERS),
            _open_problem("3sum", Difficulty.medium, 3, 1, TIERS),
        ],
        participants={
            "alice": Participant(username="alice", nickname="陳小明", group_id=1),
        },
    )


def _sub(sub_id: int, slug: str, status: str, t: datetime, *, beat_pct: float | None = None) -> dict:
    raw: dict = {
        "id": str(sub_id),
        "statusDisplay": status,
        "titleSlug": slug,
        "timestamp": int(t.timestamp()),
    }
    if beat_pct is not None:
        raw["runtimePercentile"] = beat_pct
    return raw


@pytest.mark.asyncio
async def test_bonus_added_to_score(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(1, "two-sum", "Accepted", START + timedelta(minutes=5), beat_pct=97.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3  # base 1 + tier-3 bonus

    evt = engine.contest.events[0]
    assert evt.is_scoring
    assert evt.bonus_delta == 3
    assert evt.points_delta == 4
    assert evt.beat_pct == 97.0


@pytest.mark.asyncio
async def test_no_beat_pct_field_gives_no_bonus(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(2, "two-sum", "Accepted", START + timedelta(minutes=5))],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1  # no bonus

    evt = engine.contest.events[0]
    assert evt.bonus_delta == 0
    assert evt.beat_pct is None
    # A solver with no runtime data still gets a submission link for the board.
    assert alice.problem_best_submission_id["two-sum"] == "2"
    assert "two-sum" not in alice.problem_best_beat_pct


@pytest.mark.asyncio
async def test_below_threshold_gives_no_bonus(tmp_path: Path):
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(3, "two-sum", "Accepted", START + timedelta(minutes=5), beat_pct=30.0)],
    )
    assert engine.contest.participants["alice"].score == 1
    assert engine.contest.events[0].bonus_delta == 0


@pytest.mark.asyncio
async def test_re_ac_with_same_beat_pct_no_upgrade(tmp_path: Path):
    """Second AC with same/worse beat % does not trigger an upgrade."""
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(4, "two-sum", "Accepted", START + timedelta(minutes=5), beat_pct=99.0)],
    )
    await engine.ingest_submissions(
        "alice",
        [_sub(5, "two-sum", "Accepted", START + timedelta(minutes=10), beat_pct=99.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3  # only first AC scored

    second_evt = next(e for e in engine.contest.events if e.submission_id == "5")
    assert not second_evt.is_scoring
    assert second_evt.bonus_delta == 0
    assert second_evt.beat_pct == 99.0  # still recorded for display


@pytest.mark.asyncio
async def test_re_ac_with_better_beat_pct_upgrades_bonus(tmp_path: Path):
    """Re-AC with higher beat % adds the bonus delta to the score."""
    engine = _make_engine(tmp_path)
    _seed(engine)

    # First AC at beat 65 → bonus 1
    await engine.ingest_submissions(
        "alice",
        [_sub(10, "two-sum", "Accepted", START + timedelta(minutes=2), beat_pct=65.0)],
    )
    assert engine.contest.participants["alice"].score == 1 + 1

    # Re-AC at beat 85 → bonus tier 2 → upgrade by +1
    await engine.ingest_submissions(
        "alice",
        [_sub(11, "two-sum", "Accepted", START + timedelta(minutes=5), beat_pct=85.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 2  # base + new bonus
    assert alice.problem_bonus_pts["two-sum"] == 2

    upgrade_evt = next(e for e in engine.contest.events if e.submission_id == "11")
    assert upgrade_evt.is_scoring
    assert upgrade_evt.bonus_delta == 1  # delta only
    assert upgrade_evt.points_delta == 1
    assert upgrade_evt.beat_pct == 85.0
    assert "→" in (upgrade_evt.note or "")

    # Re-AC at beat 99 → bonus tier 3 → another +1 upgrade
    await engine.ingest_submissions(
        "alice",
        [_sub(12, "two-sum", "Accepted", START + timedelta(minutes=8), beat_pct=99.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3
    assert alice.problem_bonus_pts["two-sum"] == 3


@pytest.mark.asyncio
async def test_there_is_no_attempt_limit_on_bonus_upgrades(tmp_path: Path):
    """Practice mode removed the old 3-AC cap: a student can keep resubmitting
    to shave runtime, and the fifth attempt upgrades just like the second."""
    engine = _make_engine(tmp_path)
    _seed(engine)

    beats = [10.0, 20.0, 30.0, 40.0]  # four ACs, all below the lowest tier
    for i, beat in enumerate(beats):
        await engine.ingest_submissions(
            "alice",
            [_sub(100 + i, "two-sum", "Accepted", START + timedelta(minutes=i + 1), beat_pct=beat)],
        )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1  # base only so far
    assert alice.problem_bonus_pts["two-sum"] == 0

    # Fifth AC finally clears the top tier — it must still count.
    await engine.ingest_submissions(
        "alice",
        [_sub(104, "two-sum", "Accepted", START + timedelta(minutes=6), beat_pct=99.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3
    assert alice.problem_bonus_pts["two-sum"] == 3

    evt = next(e for e in engine.contest.events if e.submission_id == "104")
    assert evt.is_scoring is True
    assert evt.bonus_delta == 3


@pytest.mark.asyncio
async def test_best_runtime_is_tracked_even_when_the_tier_does_not_move(tmp_path: Path):
    """The percentile track on the board reads `problem_best_beat_pct`, so an
    improvement inside the same tier still has to move the marker."""
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(20, "two-sum", "Accepted", START + timedelta(minutes=1), beat_pct=96.0)],
    )
    await engine.ingest_submissions(
        "alice",
        [_sub(21, "two-sum", "Accepted", START + timedelta(minutes=2), beat_pct=99.5)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 3  # same tier, no extra points
    assert alice.problem_best_beat_pct["two-sum"] == 99.5
    assert alice.problem_best_submission_id["two-sum"] == "21"

    # A worse re-run must not drag the recorded best back down.
    await engine.ingest_submissions(
        "alice",
        [_sub(22, "two-sum", "Accepted", START + timedelta(minutes=3), beat_pct=51.0)],
    )
    alice = engine.contest.participants["alice"]
    assert alice.problem_best_beat_pct["two-sum"] == 99.5
    assert alice.problem_best_submission_id["two-sum"] == "21"


@pytest.mark.asyncio
async def test_retuning_the_tiers_reprices_solves_that_already_happened(tmp_path: Path):
    """Recompute reads the stored best beat %, so changing the bonus table
    mid-session realigns everyone instead of splitting the room into people
    scored under the old table and the new one."""
    engine = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(30, "two-sum", "Accepted", START + timedelta(minutes=1), beat_pct=97.0)],
    )
    assert engine.contest.participants["alice"].score == 1 + 3

    await engine.set_problems([
        Problem(
            title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0,
            beat_bonus_tiers=[BonusTier(min_beat_pct=95.0, bonus_pts=10)],
        ),
    ])
    alice = engine.contest.participants["alice"]
    assert alice.score == 1 + 10
    assert alice.problem_bonus_pts["two-sum"] == 10


@pytest.mark.asyncio
async def test_different_problems_use_own_tiers(tmp_path: Path):
    """Each problem's bonus tiers are independent."""
    engine = _make_engine(tmp_path)
    _seed(engine, problems=[
        _open_problem("two-sum", Difficulty.easy, 1, 0,
                      [BonusTier(min_beat_pct=90.0, bonus_pts=2)]),
        _open_problem("3sum", Difficulty.medium, 3, 1, []),  # no bonus for this problem
    ])

    t = START + timedelta(minutes=5)
    await engine.ingest_submissions("alice", [
        {"id": "1", "statusDisplay": "Accepted", "titleSlug": "two-sum",
         "timestamp": int(t.timestamp()), "runtimePercentile": 95.0},
        {"id": "2", "statusDisplay": "Accepted", "titleSlug": "3sum",
         "timestamp": int(t.timestamp()), "runtimePercentile": 95.0},
    ])
    alice = engine.contest.participants["alice"]
    assert alice.score == (1 + 2) + 3  # two-sum: base+bonus; 3sum: base only

    evts = {e.title_slug: e for e in engine.contest.events if e.is_scoring}
    assert evts["two-sum"].bonus_delta == 2
    assert evts["3sum"].bonus_delta == 0
