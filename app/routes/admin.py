"""Admin endpoints — gated by `require_admin`.

All write/control surfaces live here. The public router is read-only.
"""

from __future__ import annotations

import csv
import io
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..core.auth import admin_token_for_sse, require_admin
from ..core.sse import broadcaster
from ..domain.models import Difficulty, Problem


router = APIRouter()


# ---- Request / Response models ----------------------------------------------

class BonusTierIn(BaseModel):
    min_beat_pct: float = Field(ge=0.0, le=100.0)
    bonus_pts: int = Field(ge=0)


class ProblemIn(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None
    frontend_id: Optional[str] = None
    color: Optional[str] = None
    beat_bonus_tiers: List[BonusTierIn] = Field(default_factory=list)


class ProblemsIn(BaseModel):
    problems: List[ProblemIn]


class ProblemOpenIn(BaseModel):
    open: bool


class ParticipantsBulkIn(BaseModel):
    text: str = Field(description="CSV-ish: lines of `username,student_id`")


class ResetIn(BaseModel):
    keep_config: bool = True
    confirm: str = Field(default="")


# ---- Auth ping --------------------------------------------------------------

@router.get("/auth/check")
async def auth_check(_: None = Depends(require_admin)) -> dict:
    return {"ok": True}


# ---- Problems metadata refresh ---------------------------------------------

@router.post("/problems/refresh-metadata")
async def refresh_problem_metadata(
    request: Request,
    _: None = Depends(require_admin),
) -> dict:
    """Trigger best-effort backfill of frontend_id / title for all configured
    problems. Useful when legacy entries pre-date the frontend_id feature."""
    engine = request.app.state.engine
    client = request.app.state.lc_client
    await engine.backfill_problem_metadata(client.get_problem)
    return {"ok": True, "count": len(engine.contest.problems)}


# ---- Snapshot + stream ------------------------------------------------------

@router.get("/snapshot")
async def admin_snapshot(request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    return engine.snapshot_dict(audience="admin")


@router.get("/stream")
async def admin_stream(request: Request, _: bool = Depends(admin_token_for_sse)):
    engine = request.app.state.engine
    sub = await broadcaster.subscribe(audience="admin")

    async def event_gen():
        yield {
            "event": "snapshot",
            "data": json.dumps(engine.snapshot_dict(audience="admin"), ensure_ascii=False, default=str),
        }
        async for item in broadcaster.stream(sub):
            if await request.is_disconnected():
                break
            yield item

    return EventSourceResponse(event_gen(), ping=15)


# ---- Problems ---------------------------------------------------------------

@router.put("/problems")
async def set_problems(body: ProblemsIn, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    client = request.app.state.lc_client
    problems: list[Problem] = []
    for p in body.problems:
        prob = Problem(**p.model_dump())
        if not prob.frontend_id:
            try:
                data = await client.get_problem(prob.title_slug)
                raw_fid = (
                    data.get("questionFrontendId")
                    or data.get("frontend_id")
                    or data.get("questionId")
                    or data.get("id")
                )
                if raw_fid is not None:
                    prob.frontend_id = str(raw_fid)
                if not prob.title:
                    prob.title = data.get("title") or prob.title_slug
            except Exception:
                pass  # best-effort; missing id is OK
        problems.append(prob)
    try:
        added, removed = await engine.set_problems(problems)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "count": len(problems), "added": added, "removed": removed}


@router.put("/problems/open-all")
async def set_all_problems_open(
    body: ProblemOpenIn, request: Request, _: None = Depends(require_admin)
) -> dict:
    """Open or close every problem in one go."""
    engine = request.app.state.engine
    changed = await engine.set_all_problems_open(body.open)
    return {"ok": True, "open": body.open, "changed": changed}


@router.put("/problems/{title_slug}/open")
async def set_problem_open(
    title_slug: str, body: ProblemOpenIn, request: Request, _: None = Depends(require_admin)
) -> dict:
    """Open or close one problem. This is the live switch the teacher uses
    during a session — it takes effect immediately and never touches the rest
    of the problem list."""
    engine = request.app.state.engine
    try:
        problem = await engine.set_problem_open(title_slug, body.open)
    except KeyError:
        raise HTTPException(status_code=404, detail="problem not found")
    return {
        "ok": True,
        "title_slug": problem.title_slug,
        "is_open": problem.is_open,
        "opened_at": problem.opened_at.isoformat() if problem.opened_at else None,
        "closed_at": problem.closed_at.isoformat() if problem.closed_at else None,
    }


# ---- Participants -----------------------------------------------------------

@router.put("/participants/bulk")
async def bulk_upsert(body: ParticipantsBulkIn, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    rows: list[tuple[str, str]] = []
    line_errors: list[str] = []
    reader = csv.reader(io.StringIO(body.text))
    for idx, row in enumerate(reader, start=1):
        cleaned = [c.strip() for c in row if c is not None]
        if not cleaned or all(not c for c in cleaned):
            continue
        if cleaned[0].lower() in ("username", "user", "user_name"):  # header row
            continue
        if len(cleaned) < 2:
            line_errors.append(f"line {idx}: needs `username,student_id`")
            continue
        rows.append((cleaned[0], cleaned[1]))
    created, updated, errors, new_users = await engine.upsert_participants(rows)

    # Auto-trigger profile fetch for new users.
    polling = request.app.state.polling_worker
    if polling is not None:
        for u in new_users:
            polling.enqueue_profile_fetch(u)

    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "errors": line_errors + errors,
    }


@router.delete("/participants/{username}")
async def delete_participant(username: str, request: Request, _: None = Depends(require_admin)) -> dict:
    engine = request.app.state.engine
    existed = await engine.remove_participant(username)
    if not existed:
        raise HTTPException(status_code=404, detail="participant not found")
    return {"ok": True}


# ---- Reset ------------------------------------------------------------------

@router.post("/contest/reset")
async def reset_contest(body: ResetIn, request: Request, _: None = Depends(require_admin)) -> dict:
    if body.confirm != "RESET":
        raise HTTPException(status_code=400, detail='must POST {"confirm":"RESET"}')
    engine = request.app.state.engine
    await engine.reset_contest(keep_config=body.keep_config)

    # Re-queue profile fetch so any participants that hadn't yet received their
    # LC ranking / E-M-H counts get refreshed cleanly after reset.
    polling = request.app.state.polling_worker
    if polling is not None:
        for u in engine.contest.participants:
            polling.enqueue_profile_fetch(u)

    return {"ok": True, "keep_config": body.keep_config}
