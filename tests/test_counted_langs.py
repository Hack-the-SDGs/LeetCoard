"""The language filter: only ACs written in a counted language score."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import Contest, Difficulty, Participant, Problem, Window
from app.domain.state import ContestEngine
from app.main import create_app
from app.workers.polling import PollingWorker

from .conftest import TEST_ADMIN_TOKEN

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
                points=5,
                order=0,
                is_open=True,
                windows=[Window(opened_at=START)],
            )
        ],
        participants={"alice": Participant(username="alice", nickname="陳小明", group_id=1)},
    )
    return engine


def _sub(sub_id: int, lang: str | None, minutes: int) -> dict:
    sub = {
        "id": str(sub_id),
        "statusDisplay": "Accepted",
        "titleSlug": "two-sum",
        "timestamp": int((START + timedelta(minutes=minutes)).timestamp()),
    }
    if lang is not None:
        sub["lang"] = lang
    return sub


def test_default_counts_python3_only(tmp_path: Path):
    assert _engine(tmp_path).contest.counted_langs == ["python3"]


@pytest.mark.asyncio
async def test_uncounted_language_is_recorded_but_scores_nothing(tmp_path: Path):
    engine = _engine(tmp_path)

    await engine.ingest_submissions("alice", [_sub(1, "cpp", 1)])

    alice = engine.contest.participants["alice"]
    assert alice.score == 0
    assert alice.solved_problems == set()
    event = engine.contest.events[-1]
    assert event.is_accepted and not event.is_scoring
    assert event.note == "lang cpp not counted"


@pytest.mark.asyncio
async def test_counted_language_scores(tmp_path: Path):
    engine = _engine(tmp_path)

    await engine.ingest_submissions("alice", [_sub(1, "PYTHON3", 1)])  # case-insensitive

    assert engine.contest.participants["alice"].score == 5


@pytest.mark.asyncio
async def test_missing_language_still_scores(tmp_path: Path):
    """Upstream dropping the field must not silently zero out the whole class."""
    engine = _engine(tmp_path)

    await engine.ingest_submissions("alice", [_sub(1, None, 1)])

    assert engine.contest.participants["alice"].score == 5


@pytest.mark.asyncio
async def test_empty_filter_counts_every_language(tmp_path: Path):
    engine = _engine(tmp_path)
    assert await engine.set_counted_langs([]) == []

    await engine.ingest_submissions("alice", [_sub(1, "rust", 1)])

    assert engine.contest.participants["alice"].score == 5


@pytest.mark.asyncio
async def test_setter_normalises_and_drops_unknown_slugs(tmp_path: Path):
    engine = _engine(tmp_path)

    stored = await engine.set_counted_langs([" CPP ", "python3", "brainfuck", "cpp"])

    assert stored == ["python3", "cpp"]  # deduped, canonical order, unknown gone
    assert engine.contest.counted_langs == stored


@pytest.mark.asyncio
async def test_filter_reaches_disk_immediately(tmp_path: Path):
    """Set on a quiet board, it still has to survive the next restart —
    otherwise the console shows a filter the engine forgot."""
    engine = _engine(tmp_path)
    store = engine._store
    await store.flush_now()  # nothing pending

    await engine.set_counted_langs(["java"])

    reloaded = ContestStore(store._path, store._backup)
    reloaded.load_sync()
    assert reloaded.contest.counted_langs == ["java"]


@pytest.mark.asyncio
async def test_filter_survives_a_score_reset(tmp_path: Path):
    engine = _engine(tmp_path)
    await engine.set_counted_langs(["java"])

    await engine.reset_contest(keep_config=True)

    assert engine.contest.counted_langs == ["java"]


@pytest.mark.asyncio
async def test_beat_pct_is_not_fetched_for_a_language_that_cannot_score(tmp_path: Path):
    """The beat-% lookup is the one call that spends the teacher's own session,
    so it must not run for a submission the scoring path will discard."""
    engine = _engine(tmp_path)
    asked: list[str] = []

    class _Client:
        async def get_submission_runtime_percentile(self, submission_id: str):
            asked.append(submission_id)
            return 99.0

    worker = PollingWorker(engine, _Client(), Settings(admin_token="t", data_dir=tmp_path))
    subs = [_sub(1, "cpp", 1), _sub(2, "python3", 2)]

    await worker._enrich_runtime_percentile(subs)

    assert asked == ["2"]
    assert "runtimePercentile" not in subs[0]
    assert subs[1]["runtimePercentile"] == 99.0


def test_route_needs_the_admin_token_and_rejects_unknown_slugs():
    auth = {"Authorization": f"Bearer {TEST_ADMIN_TOKEN}"}
    with TestClient(create_app()) as client:
        assert client.get("/api/admin/counted-langs").status_code == 401

        state = client.get("/api/admin/counted-langs", headers=auth).json()
        assert state["counted"] == ["python3"]
        assert {"slug": "cpp", "label": "C++"} in state["choices"]

        saved = client.put("/api/admin/counted-langs", headers=auth, json={"langs": ["cpp", "python3"]})
        assert saved.json()["counted"] == ["python3", "cpp"]

        rejected = client.put("/api/admin/counted-langs", headers=auth, json={"langs": ["cobol"]})
        assert rejected.status_code == 400
