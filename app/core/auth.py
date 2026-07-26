"""Two separate secrets.

`admin_token` opens the dashboard and every write endpoint. It is read from
`Settings.admin_token` and passed as `Authorization: Bearer <token>` — header
only, everywhere. The SSE endpoint cannot use a header (EventSource refuses to
set one), so it takes a short-lived ticket minted by an authenticated request
instead of the token itself.

`view_password` gates the public board so a class can't read each other's work
off the projector feed. It starts from the environment and the dashboard can
override it for the running process.
"""

from __future__ import annotations

import hmac
import secrets
import time
from typing import Dict, Optional

from fastapi import Depends, HTTPException, Query, Request, status

from .config import Settings, get_settings


def _matches(expected: str, given: str) -> bool:
    """Constant-time compare that survives non-ASCII secrets.

    `hmac.compare_digest` refuses `str` arguments containing non-ASCII and
    raises TypeError. Nothing catches that, so it surfaces as a 500 rather than
    a 401 — and this dashboard is in Chinese, so a Chinese password is the
    obvious thing for a teacher to type. Comparing the UTF-8 bytes keeps the
    timing property and accepts any character.
    """
    return hmac.compare_digest(expected.encode("utf-8"), given.encode("utf-8"))


def _extract_token(request: Request) -> Optional[str]:
    """Header only.

    A token in a URL is written to uvicorn's access log, kept in the browser's
    history, and handed to whatever proxy sits in front. Nothing may drive a
    reset or a roster deletion from a query string — and the one caller that
    genuinely cannot send a header (SSE) gets a ticket instead, below.
    """
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return None


async def require_admin(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.admin_token
    given = _extract_token(request)
    if not expected or not given or not _matches(expected, given):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")


# `EventSource` cannot set headers, so the admin stream URL has to carry its
# credential in the query string. Putting the real token there means the thing
# that never expires ends up in the access log, in browser history and in every
# proxy along the way. A ticket is minted by an authenticated request, expires
# in 30 seconds and is spent on first use, so a copy scraped out of a log is
# worthless by the time anyone reads it.
_TICKET_TTL_SEC = 30.0
_tickets: Dict[str, float] = {}


def mint_sse_ticket() -> str:
    now = time.monotonic()
    for expired in [t for t, exp in _tickets.items() if exp <= now]:
        _tickets.pop(expired, None)
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = now + _TICKET_TTL_SEC
    return ticket


async def require_sse_ticket(ticket: str = Query(default="")) -> None:
    # Popped whether or not it is still valid: a ticket is good for one stream.
    expires_at = _tickets.pop(ticket, None) if ticket else None
    if expires_at is None or expires_at <= time.monotonic():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired ticket"
        )


class ViewGate:
    """The password guarding the public board.

    The environment supplies the baseline. The dashboard can override it during
    a session, and that override lives in memory only — restarting the server
    always drops back to whatever the environment says, so an override made in
    a hurry can never quietly become permanent.

    An empty password means the board is open.
    """

    def __init__(self, env_password: str = "") -> None:
        self._env = (env_password or "").strip()
        self._override: Optional[str] = None

    @property
    def password(self) -> str:
        return self._env if self._override is None else self._override

    @property
    def is_open(self) -> bool:
        return self.password == ""

    @property
    def overridden(self) -> bool:
        return self._override is not None

    def set_override(self, password: str) -> None:
        self._override = (password or "").strip()

    def clear_override(self) -> None:
        self._override = None

    def accepts(self, given: Optional[str]) -> bool:
        if self.is_open:
            return True
        if not given:
            return False
        return _matches(self.password, given.strip())


def _extract_view_password(request: Request) -> Optional[str]:
    header = request.headers.get("x-view-password")
    if header:
        return header
    return request.query_params.get("view")


async def require_view(request: Request) -> None:
    gate: ViewGate = request.app.state.view_gate
    if not gate.accepts(_extract_view_password(request)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="view password required"
        )
