"""Public, read-only endpoints for the projector scoreboard.

Both data endpoints sit behind the view password when one is set, so a class
can't read each other's work straight off the API.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sse_starlette.sse import EventSourceResponse

from ..core.auth import require_view
from ..core.sse import SEND_TIMEOUT_SEC, broadcaster

router = APIRouter()


@router.get("/snapshot")
async def snapshot(
    request: Request, response: Response, _: None = Depends(require_view)
) -> dict:
    # What comes back depends on a request header, so any shared cache in front
    # (a "cache everything" CDN rule, a school proxy) could otherwise replay one
    # authorised fetch to everybody who asks without the password.
    response.headers["Cache-Control"] = "private, no-store"
    engine = request.app.state.engine
    return engine.snapshot_dict(audience="public")


@router.get("/stream")
async def stream(request: Request, _: None = Depends(require_view)):
    if broadcaster.at_capacity():
        raise HTTPException(status_code=503, detail="too many stream subscribers")
    engine = request.app.state.engine

    async def event_gen():
        # Subscribe inside the generator. Registering before the response is
        # first iterated leaves a subscriber behind if the client walks away in
        # between, and nothing would ever unsubscribe it.
        sub = await broadcaster.subscribe(audience="public")
        # Push current snapshot first.
        yield {
            "event": "snapshot",
            "data": _json(engine.snapshot_dict(audience="public")),
        }
        async for item in broadcaster.stream(sub):
            if await request.is_disconnected():
                break
            yield item

    return EventSourceResponse(event_gen(), ping=15, send_timeout=SEND_TIMEOUT_SEC)


def _json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.get("/view-required")
async def view_required(request: Request) -> dict:
    """Whether the board asks for a password. Deliberately unauthenticated so
    the scoreboard knows whether to show the prompt before it has one."""
    gate = request.app.state.view_gate
    return {"required": not gate.is_open}
