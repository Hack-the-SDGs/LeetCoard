"""A submission polled while the judge is still running must not burn its id.

It used to: the row was recorded as seen, so the same submission coming back as
"Accepted" seconds later was skipped as a duplicate and never scored. The
student saw nothing on the board until they submitted a second time, and
whether it happened at all was down to where the poll landed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import Contest, Difficulty, Participant, Problem, Window
from app.domain.state import ContestEngine, _is_pending

START = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)


def _engine(tmp_path: Path) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    engine = ContestEngine(
        ContestStore(settings.state_file, settings.state_backup_file),
        Broadcaster(),
        settings,
    )
    engine._store._contest = Contest(
        problems=[
            Problem(
                title_slug="two-sum",
                difficulty=Difficulty.easy,
                points=10,
                order=0,
                is_open=True,
                windows=[Window(opened_at=START)],
            )
        ],
        participants={"alice": Participant(username="alice", nickname="陳小明", group_id=1)},
    )
    return engine


@pytest.mark.parametrize(
    "row",
    [
        {"statusDisplay": "Pending"},
        {"statusDisplay": "Judging"},
        {"statusDisplay": "Accepted", "isPending": "Pending"},
    ],
)
def test_unjudged_rows_are_pending(row):
    assert _is_pending(row)


@pytest.mark.parametrize(
    "row",
    [
        {"statusDisplay": "Accepted", "isPending": "Not Pending"},
        {"statusDisplay": "Wrong Answer"},
        {"statusDisplay": "Accepted"},
    ],
)
def test_judged_rows_are_not_pending(row):
    assert not _is_pending(row)


@pytest.mark.asyncio
async def test_ac_still_scores_after_the_poll_that_caught_it_judging(tmp_path):
    engine = _engine(tmp_path)
    pending = {
        "id": "555",
        "statusDisplay": "Pending",
        "isPending": "Pending",
        "titleSlug": "two-sum",
        "timestamp": int(START.timestamp()),
    }
    await engine.ingest_submissions("alice", [pending])
    assert engine.contest.participants["alice"].score == 0
    # and, critically, the id was not remembered
    assert "555" not in engine.contest.seen_submission_ids

    judged = dict(pending, statusDisplay="Accepted", isPending="Not Pending")
    await engine.ingest_submissions("alice", [judged])
    assert engine.contest.participants["alice"].score == 10


@pytest.mark.asyncio
async def test_a_judged_submission_is_still_only_scored_once(tmp_path):
    engine = _engine(tmp_path)
    row = {
        "id": "556",
        "statusDisplay": "Accepted",
        "isPending": "Not Pending",
        "titleSlug": "two-sum",
        "timestamp": int(START.timestamp()),
    }
    await engine.ingest_submissions("alice", [row])
    await engine.ingest_submissions("alice", [row])
    assert engine.contest.participants["alice"].score == 10
