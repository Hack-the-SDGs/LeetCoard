"""Scoring, ranking, problem-window and persistence tests.

These exist so we can break the implementation freely without breaking the
contract. The contract changed shape when the global session clock went away:
each problem now carries its own open window, and that window is the only thing
that decides whether an accepted submission scores.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import (
    Contest,
    Difficulty,
    Participant,
    Problem,
)
from app.domain.state import ContestEngine

START = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)


def _make_engine(tmp_path: Path) -> tuple[ContestEngine, ContestStore]:
    settings = Settings(
        admin_token="t",
        leetcode_sessions="",
        data_dir=tmp_path,
        post_end_grace_sec=90,
    )
    store = ContestStore(settings.state_file, settings.state_backup_file)
    bc = Broadcaster()
    engine = ContestEngine(store, bc, settings)
    return engine, store


def _problem(slug: str, difficulty: Difficulty, points: int, order: int, *,
             opened_at: datetime | None = START,
             closed_at: datetime | None = None) -> Problem:
    return Problem(
        title_slug=slug,
        difficulty=difficulty,
        points=points,
        order=order,
        is_open=opened_at is not None and closed_at is None,
        opened_at=opened_at,
        closed_at=closed_at,
    )


def _seed(engine: ContestEngine, *, problems: list[Problem] | None = None) -> None:
    engine._store._contest = Contest(
        problems=problems
        if problems is not None
        else [
            _problem("two-sum", Difficulty.easy, 1, 0),
            _problem("valid-parentheses", Difficulty.easy, 1, 1),
            _problem("3sum", Difficulty.medium, 3, 2),
            _problem("trapping-rain-water", Difficulty.hard, 5, 3),
        ],
        participants={
            "alice": Participant(username="alice", nickname="陳小明", group_id=1),
            "bob": Participant(username="bob", nickname="王小華", group_id=2),
            "carol": Participant(username="carol", nickname="李大十", group_id=2),
        },
    )


def _sub(sub_id: int, slug: str, status: str, t: datetime) -> dict:
    return {
        "id": str(sub_id),
        "statusDisplay": status,
        "titleSlug": slug,
        "timestamp": int(t.timestamp()),
    }


# ---------------------------------------------------------------------------
# Problem.accepts — the whole scoring gate, as a pure function
# ---------------------------------------------------------------------------

def test_window_rejects_submissions_from_before_the_problem_opened():
    problem = _problem("two-sum", Difficulty.easy, 1, 0)
    assert not problem.accepts(START - timedelta(seconds=1))
    assert problem.accepts(START)
    assert problem.accepts(START + timedelta(hours=3))


def test_window_rejects_submissions_after_close_but_keeps_the_edge():
    closed = START + timedelta(minutes=10)
    problem = _problem("two-sum", Difficulty.easy, 1, 0, closed_at=closed)
    assert problem.accepts(closed - timedelta(seconds=1))
    assert problem.accepts(closed)
    assert not problem.accepts(closed + timedelta(seconds=1))


def test_never_opened_problem_accepts_nothing():
    problem = _problem("two-sum", Difficulty.easy, 1, 0, opened_at=None)
    assert not problem.was_opened
    assert not problem.accepts(START)


def test_reopened_window_excludes_the_closed_gap():
    """Opening restarts the window, so an AC made while the problem was shut
    can never be back-credited when the teacher opens it again."""
    reopened = START + timedelta(minutes=20)
    problem = _problem("two-sum", Difficulty.easy, 1, 0, opened_at=reopened)
    assert not problem.accepts(START + timedelta(minutes=15))  # during the gap
    assert problem.accepts(reopened + timedelta(minutes=1))


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_first_ac_scores_and_duplicates_dont(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [
            _sub(1, "two-sum", "Wrong Answer", START + timedelta(minutes=1)),
            _sub(2, "two-sum", "Accepted", START + timedelta(minutes=2)),
            _sub(3, "two-sum", "Accepted", START + timedelta(minutes=3)),
        ],
    )
    alice = engine.contest.participants["alice"]
    assert alice.score == 1
    assert alice.solved_problems == {"two-sum"}
    scoring_events = [e for e in engine.contest.events if e.is_scoring]
    assert len(scoring_events) == 1
    assert scoring_events[0].submission_id == "2"


@pytest.mark.asyncio
async def test_ac_outside_the_problem_window_is_not_scored(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[
        _problem("two-sum", Difficulty.easy, 1, 0, closed_at=START + timedelta(minutes=10)),
    ])

    await engine.ingest_submissions(
        "alice",
        [
            _sub(10, "two-sum", "Accepted", START - timedelta(minutes=5)),           # before open
            _sub(11, "two-sum", "Accepted", START + timedelta(minutes=15)),          # after close
        ],
    )
    assert engine.contest.participants["alice"].score == 0
    assert all(not e.is_scoring for e in engine.contest.events)
    assert all(e.note == "problem closed" for e in engine.contest.events)


@pytest.mark.asyncio
async def test_ac_just_before_close_still_scores_when_the_poll_arrives_late(tmp_path: Path):
    """The teacher closes a problem at 10:10 and the poll that discovers a
    10:09:30 submission only lands at 10:10:20. It must still count."""
    engine, _ = _make_engine(tmp_path)
    closed = START + timedelta(minutes=10)
    _seed(engine, problems=[_problem("3sum", Difficulty.medium, 3, 0, closed_at=closed)])

    await engine.ingest_submissions(
        "carol", [_sub(20, "3sum", "Accepted", closed - timedelta(seconds=30))]
    )
    assert engine.contest.participants["carol"].score == 3


@pytest.mark.asyncio
async def test_submission_to_an_unconfigured_problem_is_ignored_entirely(tmp_path: Path):
    """Students grinding other LeetCode problems must not reach the feed —
    with no session clock left to gate them, 70 students would drown it."""
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice",
        [_sub(30, "longest-palindrome", "Accepted", START + timedelta(minutes=5))],
    )
    assert engine.contest.participants["alice"].score == 0
    assert engine.contest.events == []
    assert "30" in engine.contest.seen_submission_ids  # still deduped


@pytest.mark.asyncio
async def test_ranking_tiebreak_by_first_reach_time(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice", [_sub(40, "two-sum", "Accepted", START + timedelta(minutes=10))]
    )
    await engine.ingest_submissions(
        "bob", [_sub(41, "two-sum", "Accepted", START + timedelta(minutes=5))]
    )
    leaderboard = engine._leaderboard_snapshot()
    rank_by_user = {row["username"]: row["rank"] for row in leaderboard}
    assert rank_by_user["bob"] < rank_by_user["alice"]
    assert rank_by_user["carol"] >= rank_by_user["alice"]


@pytest.mark.asyncio
async def test_dedupe_across_polls(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    sub = _sub(50, "valid-parentheses", "Accepted", START + timedelta(minutes=4))
    await engine.ingest_submissions("alice", [sub])
    await engine.ingest_submissions("alice", [sub, sub])  # same poll again
    assert engine.contest.participants["alice"].score == 1
    assert sum(1 for e in engine.contest.events if e.submission_id == "50") == 1


# ---------------------------------------------------------------------------
# Live problem edits
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_saving_the_problem_list_never_disturbs_a_live_window(tmp_path: Path):
    """The teacher fixes a typo mid-session. Everything that survives the save
    must keep its window, or saving would silently close the live problem."""
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[_problem("two-sum", Difficulty.easy, 1, 0)])

    await engine.set_problems([
        Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=2, order=0,
                title="Two Sum"),
    ])
    problem = engine.contest.problems[0]
    assert problem.is_open is True
    assert problem.opened_at == START
    assert problem.closed_at is None
    assert problem.title == "Two Sum"
    assert problem.points == 2


@pytest.mark.asyncio
async def test_deleting_a_solved_problem_takes_its_points_back(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions("alice", [
        _sub(60, "two-sum", "Accepted", START + timedelta(minutes=1)),
        _sub(61, "3sum", "Accepted", START + timedelta(minutes=2)),
    ])
    assert engine.contest.participants["alice"].score == 4

    await engine.set_problems([
        Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=1, order=0),
    ])
    alice = engine.contest.participants["alice"]
    assert alice.score == 1
    assert alice.solved_problems == {"two-sum"}
    assert "3sum" not in alice.problem_first_ac_at
    assert "3sum" not in alice.problem_best_beat_pct


@pytest.mark.asyncio
async def test_changing_points_realigns_everyone_who_already_solved_it(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice", [_sub(70, "two-sum", "Accepted", START + timedelta(minutes=1))]
    )
    assert engine.contest.participants["alice"].score == 1

    await engine.set_problems([
        Problem(title_slug="two-sum", difficulty=Difficulty.easy, points=9, order=0),
    ])
    assert engine.contest.participants["alice"].score == 9


@pytest.mark.asyncio
async def test_reopening_stamps_a_fresh_window(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[_problem("two-sum", Difficulty.easy, 1, 0)])

    await engine.set_problem_open("two-sum", False)
    problem = engine.contest.problems[0]
    assert problem.is_open is False
    assert problem.closed_at is not None

    await engine.set_problem_open("two-sum", True)
    problem = engine.contest.problems[0]
    assert problem.is_open is True
    assert problem.closed_at is None
    assert problem.opened_at > START


@pytest.mark.asyncio
async def test_toggling_an_unknown_problem_raises(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)
    with pytest.raises(KeyError):
        await engine.set_problem_open("no-such-problem", True)


@pytest.mark.asyncio
async def test_public_board_only_shows_problems_that_have_been_opened(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[
        _problem("two-sum", Difficulty.easy, 1, 0),
        _problem("3sum", Difficulty.medium, 3, 1, opened_at=None),
    ])

    public = engine.snapshot_dict("public")["problems"]
    admin = engine.snapshot_dict("admin")["problems"]
    assert [p["title_slug"] for p in public] == ["two-sum"]
    assert [p["title_slug"] for p in admin] == ["two-sum", "3sum"]


@pytest.mark.asyncio
async def test_a_closed_problem_stays_on_the_public_board(tmp_path: Path):
    """Closing is how the teacher moves on, not how work disappears."""
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[_problem("two-sum", Difficulty.easy, 1, 0)])
    await engine.set_problem_open("two-sum", False)

    public = engine.snapshot_dict("public")["problems"]
    assert [p["title_slug"] for p in public] == ["two-sum"]
    assert public[0]["is_open"] is False


# ---------------------------------------------------------------------------
# Polling window + reset
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_polling_follows_the_problem_switches(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine, problems=[_problem("two-sum", Difficulty.easy, 1, 0, opened_at=None)])
    assert engine.is_polling_window() is False

    await engine.set_problem_open("two-sum", True)
    assert engine.is_polling_window() is True

    await engine.set_problem_open("two-sum", False)
    assert engine.is_polling_window() is True  # inside the grace period

    engine.contest.problems[0].closed_at = datetime.now(timezone.utc) - timedelta(seconds=120)
    assert engine.is_polling_window() is False  # grace expired


@pytest.mark.asyncio
async def test_reset_clears_scores_and_closes_every_window(tmp_path: Path):
    engine, _ = _make_engine(tmp_path)
    _seed(engine)
    await engine.ingest_submissions(
        "alice", [_sub(80, "two-sum", "Accepted", START + timedelta(minutes=1))]
    )
    assert engine.contest.participants["alice"].score == 1

    await engine.reset_contest(keep_config=True)

    alice = engine.contest.participants["alice"]
    assert alice.score == 0
    assert alice.solved_problems == set()
    assert engine.contest.events == []
    assert engine.contest.seen_submission_ids == set()
    assert len(engine.contest.problems) == 4
    assert all(
        p.is_open is False and p.opened_at is None and p.closed_at is None
        for p in engine.contest.problems
    )
    assert engine.is_polling_window() is False


@pytest.mark.asyncio
async def test_persistence_roundtrip(tmp_path: Path):
    engine, store = _make_engine(tmp_path)
    _seed(engine)

    await engine.ingest_submissions(
        "alice", [_sub(90, "trapping-rain-water", "Accepted", START + timedelta(minutes=20))]
    )
    await store.flush_now()
    assert store._path.exists()

    # New process simulation
    cfg = Settings(admin_token="t", data_dir=tmp_path)
    store2 = ContestStore(cfg.state_file, cfg.state_backup_file)
    store2.load_sync()
    assert store2.contest.participants["alice"].score == 5
    assert "trapping-rain-water" in store2.contest.participants["alice"].solved_problems
    assert store2.contest.problems[0].opened_at == START
