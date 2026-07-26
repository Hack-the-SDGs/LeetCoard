"""Two separate secrets.

`admin_token` opens the dashboard and every write endpoint. It is read from
`Settings.admin_token` and passed as `Authorization: Bearer <token>` or
`?token=...` (the SSE endpoint only supports the query string, because
EventSource cannot set custom headers).

`view_password` gates the public board so a class can't read each other's work
off the projector feed. It starts from the environment and the dashboard can
override it for the running process.
"""

from __future__ import annotations

import hmac
from typing import Optional

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

    The query-string form exists solely because `EventSource` cannot set
    headers, and it is confined to `admin_token_for_sse`. Accepting it here too
    meant a reset or a roster deletion could be driven by a URL, and uvicorn
    writes the full request target — token included — to its access log.
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


async def admin_token_for_sse(
    token: str = Query(default=""),
    settings: Settings = Depends(get_settings),
) -> bool:
    if not token or not _matches(settings.admin_token, token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return True


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
