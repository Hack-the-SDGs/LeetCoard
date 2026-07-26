"""Keep the suite away from the live board.

The tests that build the real app run the real lifespan, and the real lifespan
reads `.env`: it opens `DATA_DIR/contest.json`, rotates its backup, and syncs
`ROSTER_FILE` — a sync that removes every participant the file does not
mention, scores included. So running `pytest` in a checkout that is also
serving a class rewrote that class's state, and the README tells you to run it.

Redirect the environment before any settings are read, and clear the cached
`Settings` on both sides so neither the real `.env` nor one test's temp dir
leaks into the next.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings

# Long enough to satisfy the startup guard in `app.main`, which refuses to boot
# on a short or placeholder-looking token.
TEST_ADMIN_TOKEN = "test-token-not-a-real-secret-0123456789"


@pytest.fixture(autouse=True)
def isolate_settings(tmp_path, monkeypatch):
    # Deliberately absent rather than empty: a missing roster means "leave the
    # roster alone", while an empty one is a file that parsed to nothing.
    roster = tmp_path / "roster.txt"

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ROSTER_FILE", str(roster))
    monkeypatch.setenv("ADMIN_TOKEN", TEST_ADMIN_TOKEN)
    monkeypatch.setenv("VIEW_PASSWORD", "")
    # No live cookie, so nothing in a test can reach leetcode.com with it.
    monkeypatch.setenv("LEETCODE_SESSIONS", "")

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
