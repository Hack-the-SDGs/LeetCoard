"""Regressions for holes two adversarial reviews found.

Each of these was reachable by a student on the classroom network, or by the
single most likely roster edit there is.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import Contest, Participant
from app.domain.roster import load_roster_file
from app.domain.state import ContestEngine
from app.main import create_app

BIG = 3 * 1024 * 1024  # comfortably over the 2 MB cap


def _make_engine(tmp_path: Path, participants: dict[str, Participant]) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    store._contest = Contest(participants=participants)
    return ContestEngine(store, Broadcaster(), settings)


# ---- body size cap ----------------------------------------------------------

def test_declared_oversize_body_is_rejected():
    with TestClient(create_app()) as client:
        r = client.put(
            "/api/admin/participants/bulk",
            content=b"x" * BIG,
            headers={"Content-Type": "application/json"},
        )

    assert r.status_code == 413


def test_chunked_body_cannot_slip_past_the_cap():
    """Without a Content-Length there is nothing to check up front, so the cap
    has to be enforced on the bytes themselves. Otherwise an unauthenticated
    caller makes the process allocate whatever it likes."""

    def chunks():
        for _ in range(3):
            yield b"x" * (BIG // 3)

    with TestClient(create_app()) as client:
        r = client.put(
            "/api/admin/participants/bulk",
            content=chunks(),  # httpx omits Content-Length and streams
            headers={"Content-Type": "application/json"},
        )

    assert r.status_code == 413


def test_a_normal_sized_body_still_gets_through_to_auth():
    with TestClient(create_app()) as client:
        r = client.put("/api/admin/participants/bulk", json={"text": "1,陳小明,alice"})

    assert r.status_code == 401  # rejected for the token, not for the size


def test_the_api_schema_is_not_browsable():
    with TestClient(create_app()) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


# ---- roster robustness ------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        "1,陳小明,alice\n".encode("big5"),  # saved out of Excel on a zh-TW machine
        "1,陳小明,alice\n".encode("utf-16"),
        b"1,\xff\xfe broken,alice\n",
    ],
)
async def test_an_unreadable_roster_leaves_the_board_running(tmp_path, content):
    engine = _make_engine(tmp_path, {"a": Participant(username="a", nickname="甲")})
    path = tmp_path / "roster.txt"
    path.write_bytes(content)

    await load_roster_file(engine, path)  # must not raise

    assert set(engine.contest.participants) == {"a"}


@pytest.mark.asyncio
async def test_an_enormous_line_does_not_take_the_server_down(tmp_path):
    engine = _make_engine(tmp_path, {"a": Participant(username="a", nickname="甲")})
    path = tmp_path / "roster.txt"
    path.write_text("1,陳小明," + "x" * 200_000 + "\n", encoding="utf-8")

    await load_roster_file(engine, path)

    assert "a" in engine.contest.participants


# ---- handle capitalisation --------------------------------------------------

@pytest.mark.asyncio
async def test_fixing_a_handles_capitalisation_keeps_the_student_and_their_score(tmp_path):
    person = Participant(username="Alice", nickname="陳小明", group_id=1, score=42)
    person.solved_problems.add("two-sum")
    engine = _make_engine(tmp_path, {"Alice": person})

    created, updated, errors, _ = await engine.upsert_participants([("alice", "陳小明", 1)])

    assert (created, updated, errors) == (0, 1, [])
    assert set(engine.contest.participants) == {"alice"}
    kept = engine.contest.participants["alice"]
    assert kept.username == "alice"
    assert kept.score == 42
    assert kept.solved_problems == {"two-sum"}


@pytest.mark.asyncio
async def test_a_recased_handle_is_not_then_pruned_as_stale(tmp_path):
    engine = _make_engine(tmp_path, {"Alice": Participant(username="Alice", nickname="陳小明")})
    path = tmp_path / "roster.txt"
    path.write_text("1,陳小明,alice\n", encoding="utf-8")

    await load_roster_file(engine, path)

    assert set(engine.contest.participants) == {"alice"}
