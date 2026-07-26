"""FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.auth import ViewGate
from .core.config import get_settings
from .core.sse import broadcaster
from .core.storage import ContestStore
from .domain.models import GROUP_COUNT
from .domain.roster import load_roster_file
from .domain.state import ContestEngine
from .integrations.leetcode import LeetCodeClient
from .routes import admin as admin_routes
from .routes import public as public_routes
from .workers.polling import PollingWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("gdg.main")

# Bodies are read and parsed before dependencies resolve, so an unauthenticated
# caller can otherwise make the process allocate whatever it likes.
_MAX_BODY_BYTES = 2 * 1024 * 1024

_BODYLESS_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "DELETE"})


class _BodyTooLarge(HTTPException):
    """An HTTPException on purpose: FastAPI wraps unknown exceptions raised while
    reading a body into a generic 400, which would report a size limit as a
    parse error."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="request body too large")


class BodySizeLimit:
    """Cap the request body as it arrives, not as it claims to be.

    Trusting `Content-Length` is not a limit: omitting it and sending
    `Transfer-Encoding: chunked` skips the check entirely, and the framework
    then buffers the whole body before any auth dependency runs. That makes
    memory exhaustion an *unauthenticated* operation — a laptop serving a class
    can be pushed over by anyone who can reach the port. Counting bytes off the
    ASGI `receive` channel is the only version that actually holds.
    """

    def __init__(self, app, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("method") in _BODYLESS_METHODS:
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v for k, v in scope.get("headers", [])}
        declared = headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    await _reject(scope, send, 413, "request body too large")
                    return
            except ValueError:
                await _reject(scope, send, 400, "bad content-length")
                return

        received = 0
        started = False

        async def counting_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        async def watching_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, watching_send)
        except _BodyTooLarge:
            # Only safe while nothing has gone out yet — which is the case,
            # since the overrun is detected while the body is still being read.
            if not started:
                await _reject(scope, send, 413, "request body too large")


async def _reject(scope, send, status: int, detail: str) -> None:
    await JSONResponse({"detail": detail}, status_code=status)(scope, None, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("Starting backend sessions=%d", len(settings.session_list))

    if settings.admin_token == "change-me":
        log.error(
            "ADMIN_TOKEN is still the placeholder value. Anyone who reaches this "
            "port can open the console, reset scores and delete the roster. "
            "Set ADMIN_TOKEN in .env before letting anyone else near it."
        )
    if settings.cors_list == ["*"]:
        log.warning(
            "CORS_ORIGINS is '*'. Fine on a laptop; name the real front-end "
            "origin before deploying."
        )

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    store.load_sync()

    engine = ContestEngine(store, broadcaster, settings)
    app.state.engine = engine

    # Before the polling worker starts, so it seeds profile fetches for whoever
    # the file just added.
    await load_roster_file(engine, settings.roster_file, max_group=GROUP_COUNT)

    # In-memory on purpose: a password set from the dashboard must not outlive
    # the process that was told about it.
    app.state.view_gate = ViewGate(settings.view_password)

    client = LeetCodeClient(
        api_base=settings.leetcode_api_base,
        sessions=settings.session_list,
        timeout=settings.leetcode_http_timeout_sec,
    )
    await client.__aenter__()
    app.state.lc_client = client

    polling = PollingWorker(engine, client, settings)
    await polling.start()

    app.state.polling_worker = polling

    # Best-effort one-shot backfill: legacy problems may lack frontend_id.
    asyncio.create_task(engine.backfill_problem_metadata(client.get_problem))

    try:
        yield
    finally:
        log.info("Shutting down workers")
        try:
            await polling.stop()
        except Exception:
            log.exception("worker stop failed")
        await store.flush_now()
        await client.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="GDG NTUST · LeetCode Practice Board API",
        version="0.2.0",
        lifespan=lifespan,
        # Every route is gated, but the schema still hands a curious student the
        # exact shape of the admin write surface. Nothing here needs to be
        # browsable from the classroom.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(BodySizeLimit, max_bytes=_MAX_BODY_BYTES)

    app.include_router(public_routes.router, prefix="/api", tags=["public"])
    app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])
    return app


app = create_app()


def cli() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8080,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    cli()
