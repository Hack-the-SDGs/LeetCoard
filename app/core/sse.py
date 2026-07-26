"""Tiny in-process SSE broadcaster.

Each subscriber gets its own bounded asyncio.Queue. The broadcaster fans out
events without ever blocking on a slow consumer — slow queues drop the oldest
events. This keeps a wedged client from holding up the entire scoreboard.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, Set
from uuid import uuid4

log = logging.getLogger("gdg.sse")

_QUEUE_MAX = 64


@dataclass(eq=False)  # identity hashable so it can live in a set
class _Subscriber:
    sid: str
    queue: asyncio.Queue
    audience: str = "public"  # "public" or "admin"
    dropped: int = 0
    closed: bool = False


@dataclass
class Broadcaster:
    subs: Set[_Subscriber] = field(default_factory=set)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def subscribe(self, audience: str = "public") -> _Subscriber:
        sub = _Subscriber(sid=uuid4().hex, queue=asyncio.Queue(maxsize=_QUEUE_MAX), audience=audience)
        async with self._lock:
            self.subs.add(sub)
        log.info("SSE subscribe sid=%s audience=%s total=%d", sub.sid, audience, len(self.subs))
        return sub

    async def unsubscribe(self, sub: _Subscriber) -> None:
        async with self._lock:
            self.subs.discard(sub)
        log.info("SSE unsubscribe sid=%s total=%d", sub.sid, len(self.subs))

    def broadcast(self, event: str, data: Any, audience: str = "all") -> None:
        """Non-blocking fanout.

        Audience values:
          - "all"    : every subscriber
          - "public" : public subscribers only (admins get admin-flavoured event instead)
          - "admin"  : admin subscribers only
        """

        payload = {"event": event, "data": data}
        for sub in list(self.subs):
            if audience == "admin" and sub.audience != "admin":
                continue
            if audience == "public" and sub.audience != "public":
                continue
            try:
                sub.queue.put_nowait(payload)
            except asyncio.QueueFull:
                # Drop the oldest message and retry — never block the producer.
                try:
                    sub.queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    sub.queue.put_nowait(payload)
                    sub.dropped += 1
                except asyncio.QueueFull:
                    sub.dropped += 1

    async def close_audience(self, audience: str) -> None:
        """Hang up on everyone in `audience`.

        Used when the view password changes: without this, viewers who were
        already connected would keep receiving the board and the new password
        would only apply to people arriving afterwards.
        """
        async with self._lock:
            targets = [s for s in self.subs if s.audience == audience]
        for sub in targets:
            sub.closed = True
            # A full queue must not swallow the goodbye, or the viewer keeps
            # streaming until the next event or the idle timeout.
            while True:
                try:
                    sub.queue.put_nowait({"event": "closed", "data": {}})
                    break
                except asyncio.QueueFull:
                    try:
                        sub.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break
        if targets:
            log.info("SSE closing %d %s subscriber(s)", len(targets), audience)

    async def stream(self, sub: _Subscriber) -> AsyncIterator[Dict[str, str]]:
        """Yield SSE-shaped dicts (sse-starlette consumes `{event, data}`)."""

        try:
            while True:
                try:
                    item = await asyncio.wait_for(sub.queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    if sub.closed:
                        break
                    # Heartbeat — keeps proxies from killing the connection.
                    yield {"event": "ping", "data": json.dumps({"ts": _now_iso()})}
                    continue
                # Drain the backlog and hang up on the goodbye itself. Breaking
                # on `sub.closed` alone dropped the `closed` event whenever a
                # queued item was collected first, which is the common case —
                # and then the client fell back to a blind reconnect instead of
                # re-authenticating straight away.
                yield {
                    "event": item["event"],
                    "data": json.dumps(item["data"], ensure_ascii=False, default=str),
                }
                if item["event"] == "closed":
                    break
        finally:
            await self.unsubscribe(sub)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


# A single process-wide broadcaster. Bound at app startup.
broadcaster = Broadcaster()
