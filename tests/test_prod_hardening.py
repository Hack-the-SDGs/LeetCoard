"""Regressions for what a pre-production adversarial review found.

Each of these was live on the way to the deploy: a guard that never fired, the
admin token in a URL, and a stream anybody could open as many times as they
liked.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core import auth
from app.core.sse import Broadcaster
from app.main import RedactQuerySecrets, _require_real_admin_token, create_app

from .conftest import TEST_ADMIN_TOKEN

AUTH = {"Authorization": f"Bearer {TEST_ADMIN_TOKEN}"}


# ---- the startup guard ------------------------------------------------------

@pytest.mark.parametrize(
    "token",
    [
        "change-me",  # the only value the old equality check caught
        "dev-token-please-change",  # what was actually in .env
        "change-me-to-a-long-random-string",  # what .env.example suggested
        "hunter2",
        "",
    ],
)
def test_a_placeholder_admin_token_stops_the_boot(token):
    """The old guard compared against one literal, and none of the placeholders
    in circulation were that literal — so it never fired for any of them."""
    with pytest.raises(RuntimeError, match="ADMIN_TOKEN"):
        _require_real_admin_token(token)


def test_a_real_admin_token_boots():
    _require_real_admin_token("Zx9-qP7mK2vR4tL8nW1cY6bH3jF5dS0aG")


# ---- SSE tickets ------------------------------------------------------------

def test_the_admin_token_no_longer_opens_the_stream_from_a_url():
    """It used to. Which put a credential that never expires into uvicorn's
    access log, the browser's history and every proxy in between."""
    with TestClient(create_app()) as client:
        assert client.get(f"/api/admin/stream?token={TEST_ADMIN_TOKEN}").status_code == 401
        assert client.get("/api/admin/stream").status_code == 401


def test_minting_a_ticket_needs_the_token():
    with TestClient(create_app()) as client:
        assert client.post("/api/admin/sse-ticket").status_code == 401


def test_a_ticket_is_good_exactly_once():
    """Checked against the dependency rather than over HTTP: opening the real
    stream from TestClient never returns, because the stream never ends."""
    ticket = auth.mint_sse_ticket()

    asyncio.run(auth.require_sse_ticket(ticket))  # first use passes

    # Replaying what leaked into a log has to be worthless.
    with pytest.raises(HTTPException) as spent:
        asyncio.run(auth.require_sse_ticket(ticket))
    assert spent.value.status_code == 401


def test_an_expired_ticket_is_refused():
    ticket = auth.mint_sse_ticket()
    auth._tickets[ticket] -= auth._TICKET_TTL_SEC + 1  # age it past the TTL

    with pytest.raises(HTTPException):
        asyncio.run(auth.require_sse_ticket(ticket))


def test_a_forged_ticket_is_refused_over_http():
    with TestClient(create_app()) as client:
        assert client.get("/api/admin/stream?ticket=guessed").status_code == 401


# ---- access log -------------------------------------------------------------

def test_the_access_log_does_not_keep_query_string_credentials():
    """uvicorn logs the full request target, and the public stream still has to
    carry the view password there — EventSource cannot send a header."""
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("1.2.3.4:5", "GET", "/api/stream?view=gdg2026&x=1", "1.1", 200),
        exc_info=None,
    )

    assert RedactQuerySecrets().filter(record) is True
    logged = record.getMessage()
    assert "gdg2026" not in logged
    assert "view=<redacted>" in logged
    assert "x=1" in logged  # only the secret, not the whole query


# ---- stream capacity --------------------------------------------------------

def test_the_stream_is_refused_once_the_subscriber_cap_is_reached(monkeypatch):
    """Each subscriber costs a queue and a buffered snapshot, so connections
    nobody is reading are how one laptop takes the projector board down."""
    monkeypatch.setattr("app.core.sse.MAX_SUBSCRIBERS", 0)
    with TestClient(create_app()) as client:
        assert client.get("/api/stream").status_code == 503


# ---- fan-out cost -----------------------------------------------------------

def test_an_event_is_serialised_once_not_once_per_subscriber():
    """The board payload is ~200 KB at classroom size. Encoding it per
    subscriber turned one accepted submission into tens of megabytes of
    json.dumps on the event loop."""

    async def scenario():
        bc = Broadcaster()
        subs = [await bc.subscribe() for _ in range(3)]

        bc.broadcast("leaderboard_update", {"leaderboard": [{"n": "陳小明"}]})

        payloads = [s.queue.get_nowait() for s in subs]
        # One serialisation, shared by reference — not three.
        assert all(isinstance(p["data"], str) for p in payloads)
        assert payloads[0]["data"] is payloads[1]["data"] is payloads[2]["data"]
        assert "陳小明" in payloads[0]["data"]  # not \u escaped

    asyncio.run(scenario())
