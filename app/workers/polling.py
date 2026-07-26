"""Polling worker.

Polling budget follows attention rather than standing. A student who just
submitted is the one about to submit again, so they get checked every few
seconds; a student who has been quiet — finished, chatting, not here yet —
backs off exponentially. Score is deliberately *not* the signal: someone who
has solved everything will never submit again, while someone stuck grinding
wrong answers submits constantly.

The whole fleet is then scaled so the combined request rate stays under
`poll_max_rps`, which is what keeps 70 active students from turning a 5 s
floor into 14 requests per second.

Errors on any single user are isolated — a failure for `alice` never stops
polling for `bob`. A low-priority profile-fetch loop (avatar, LC ranking, AC
totals by difficulty) runs alongside, exposed via `enqueue_profile_fetch()`.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Set

from ..core.config import Settings
from ..domain.state import ContestEngine
from ..integrations.leetcode import LeetCodeClient, LeetCodeError

log = logging.getLogger("gdg.polling")

PROFILE_REFRESH_SEC = 600  # refresh every 10 min while a session is live
_MAX_BACKOFF_DOUBLINGS = 6  # 5s * 2^6 = 320s, well past any sane max interval

# Process-wide ceiling on concurrent beat-% lookups against leetcode.com. Four
# is plenty for enrichment nobody is waiting on, and it holds no matter how many
# students happen to submit in the same polling round.
_ENRICH_SEM = asyncio.Semaphore(4)


def backoff_delay(idle_rounds: int, min_sec: float, max_sec: float) -> float:
    """Exponential back-off for one student, clamped to the configured band."""
    doublings = min(max(idle_rounds, 0), _MAX_BACKOFF_DOUBLINGS)
    return min(min_sec * (2 ** doublings), max_sec)


def rate_limit_scale(delays: Dict[str, float], max_rps: float) -> float:
    """Factor to stretch every delay by so the fleet stays under `max_rps`.

    Each student polled every `d` seconds contributes `1/d` requests per second.
    When the sum overshoots the ceiling, stretching every delay by the overshoot
    ratio brings the total back to exactly `max_rps` while preserving the
    relative attention each student has earned. Returns 1.0 when there is room.
    """
    if max_rps <= 0:
        return 1.0
    demand = sum(1.0 / d for d in delays.values() if d > 0)
    return max(1.0, demand / max_rps)


class PollingWorker:
    def __init__(self, engine: ContestEngine, client: LeetCodeClient, settings: Settings) -> None:
        self._engine = engine
        self._client = client
        self._cfg = settings
        self._task: Optional[asyncio.Task] = None
        self._profile_task: Optional[asyncio.Task] = None
        self._stop = asyncio.Event()
        self._profile_queue: asyncio.Queue[str] = asyncio.Queue()
        self._enqueued: Set[str] = set()
        self._idle_rounds: Dict[str, int] = {}
        self._sem = asyncio.Semaphore(max(1, settings.poll_concurrency))

    async def start(self) -> None:
        self._stop.clear()
        # Seed profile fetches for participants already loaded from disk.
        for u in self._engine.usernames():
            self.enqueue_profile_fetch(u)
        self._task = asyncio.create_task(self._loop(), name="polling-worker")
        self._profile_task = asyncio.create_task(self._profile_loop(), name="polling-profile")

    async def stop(self) -> None:
        self._stop.set()
        for t in (self._task, self._profile_task):
            if t is None:
                continue
            try:
                await asyncio.wait_for(t, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                t.cancel()
        self._task = None
        self._profile_task = None

    # -------- health / introspection --------

    def status(self) -> dict:
        """Small summary the dashboard shows next to the practice controls."""
        active = sum(1 for n in self._idle_rounds.values() if n == 0)
        return {
            "polling": self._engine.is_polling_window(),
            "open_problems": self._engine.open_problem_count(),
            "tracked_users": len(self._engine.usernames()),
            "active_users": active,
        }

    def enqueue_profile_fetch(self, username: str) -> None:
        """Schedule a profile/avatar fetch for `username`. Idempotent per pending."""
        if username in self._enqueued:
            return
        self._enqueued.add(username)
        try:
            self._profile_queue.put_nowait(username)
        except asyncio.QueueFull:
            self._enqueued.discard(username)

    async def _profile_loop(self) -> None:
        log.info("Polling profile loop started")
        next_refresh = datetime.now(timezone.utc) + timedelta(seconds=PROFILE_REFRESH_SEC)
        while not self._stop.is_set():
            try:
                # Profiles are part of "calling the API", so they follow the
                # same gate as submissions. Without this the worker kept
                # fetching all night with every problem closed.
                if not self._engine.is_polling_window():
                    await asyncio.sleep(2)
                    continue

                now = datetime.now(timezone.utc)
                if now >= next_refresh:
                    for u in self._engine.usernames():
                        self.enqueue_profile_fetch(u)
                    next_refresh = now + timedelta(seconds=PROFILE_REFRESH_SEC)
                try:
                    username = await asyncio.wait_for(self._profile_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                self._enqueued.discard(username)
                # Share the concurrency budget with submission polling, and
                # pace the drain so a roster-wide refresh isn't a burst.
                async with self._sem:
                    await self._fetch_profile(username)
                await asyncio.sleep(1.0 / max(1.0, self._cfg.poll_max_rps))
            except asyncio.CancelledError:
                break
            except Exception:
                log.exception("Profile loop hiccup")
                await asyncio.sleep(2)

    async def _fetch_profile(self, username: str) -> None:
        try:
            data = await self._client.get_user_profile(username)
        except LeetCodeError as exc:
            log.warning("Profile fetch failed for %s: %s", username, exc)
            return
        profile = data.get("profile") or {}
        stats = (data.get("submitStats") or {}).get("acSubmissionNum") or []
        easy = medium = hard = 0
        for row in stats:
            d = (row.get("difficulty") or "").lower()
            c = int(row.get("count") or 0)
            if d == "easy":
                easy = c
            elif d == "medium":
                medium = c
            elif d == "hard":
                hard = c
        await self._engine.update_profile(
            username,
            avatar_url=profile.get("userAvatar"),
            lc_ranking=profile.get("ranking"),
            easy_total=easy,
            medium_total=medium,
            hard_total=hard,
        )

    # -------- scheduling --------

    def _current_delays(self, usernames: list[str]) -> Dict[str, float]:
        """Per-student delay after back-off and the fleet-wide rate ceiling."""
        wanted = {
            u: backoff_delay(
                self._idle_rounds.get(u, 0),
                self._cfg.poll_min_interval_sec,
                self._cfg.poll_max_interval_sec,
            )
            for u in usernames
        }
        scale = rate_limit_scale(wanted, self._cfg.poll_max_rps)
        return {u: d * scale for u, d in wanted.items()}

    async def _loop(self) -> None:
        next_due: dict[str, datetime] = {}
        was_polling = False
        log.info("Polling worker started")
        while not self._stop.is_set():
            try:
                if not self._engine.is_polling_window():
                    was_polling = False
                    await asyncio.sleep(2)
                    continue

                if not was_polling:
                    # Everything queued up while the window was shut is now
                    # overdue, so resuming would fire the whole roster in one
                    # instant — the surest way to earn a 429 mid-class. Start
                    # the schedule from scratch instead and let the spread
                    # below lay it out again.
                    next_due.clear()
                    was_polling = True

                usernames = self._engine.usernames()
                if not usernames:
                    await asyncio.sleep(2)
                    continue

                now = datetime.now(timezone.utc)
                delays = self._current_delays(usernames)
                jitter = self._cfg.poll_jitter

                # Spread first-seen users across one full interval so a cold
                # start doesn't fire every request in the same instant.
                for i, u in enumerate(usernames):
                    if u not in next_due:
                        spread = i * delays[u] / max(1, len(usernames))
                        next_due[u] = now + timedelta(
                            seconds=spread + random.uniform(0, delays[u] * jitter)
                        )

                due = [u for u, t in next_due.items() if t <= now and u in delays]
                if not due:
                    sleep_for = min((next_due[u] - now).total_seconds() for u in usernames)
                    await asyncio.sleep(max(0.1, min(sleep_for, 1.0)))
                    continue

                results = await asyncio.gather(
                    *(self._poll_one(u) for u in due), return_exceptions=True
                )

                for u, found in zip(due, results):
                    if isinstance(found, BaseException):
                        found = 0
                    self._idle_rounds[u] = 0 if found else self._idle_rounds.get(u, 0) + 1

                # Recompute after the streak update so a fresh submission
                # pulls that student back to the floor immediately.
                delays = self._current_delays(usernames)
                for u in due:
                    delay = delays[u] * (1 + random.uniform(-jitter, jitter))
                    next_due[u] = datetime.now(timezone.utc) + timedelta(
                        seconds=max(0.5, delay)
                    )

                for u in set(next_due) - set(usernames):
                    next_due.pop(u, None)
                    self._idle_rounds.pop(u, None)

            except Exception:
                log.exception("Polling loop hiccup; sleeping 2s")
                await asyncio.sleep(2)

    async def _enrich_runtime_percentile(self, subs: list[dict]) -> None:
        """Best-effort: inject `runtimePercentile` into new AC submissions.

        leetcode-api-pied's submission list lacks beat-%; we fetch each new AC's
        detail via LeetCode GraphQL. Skips already-seen ids to bound API load.
        Any failure is silent — beat-% bonus simply doesn't apply for that submission.
        """
        seen = self._engine.contest.seen_submission_ids
        targets = [
            s for s in subs
            if (s.get("statusDisplay") or s.get("status")) == "Accepted"
            and "runtimePercentile" not in s
            and str(s.get("id") or "") not in seen
            and s.get("id") is not None
        ]
        if not targets:
            return

        async def enrich(entry: dict) -> None:
            async with _ENRICH_SEM:
                pct = await self._client.get_submission_runtime_percentile(str(entry["id"]))
            if pct is not None:
                entry["runtimePercentile"] = pct

        # Concurrently, and outside the polling slot the caller released: these
        # go to leetcode.com rather than the submissions API, and run serially
        # they could hold a slot for the timeout multiplied by POLL_RECENT_LIMIT
        # while other students waited their turn.
        #
        # Bounded, though, and bounded process-wide rather than per call: the
        # gather itself is per-student, so the minute a problem opens and a
        # class of 70 all submit, an unbounded version aims the whole fleet's
        # fresh ACs at leetcode.com at once — hundreds of authenticated requests
        # from the teacher's personal account, which is how an account gets rate
        # limited or locked.
        await asyncio.gather(*(enrich(s) for s in targets), return_exceptions=True)

    async def _poll_one(self, username: str) -> int:
        """Returns the number of submissions seen for the first time."""
        try:
            async with self._sem:
                subs = await self._client.get_recent_submissions(
                    username, limit=self._cfg.poll_recent_limit
                )
            # The slot is released before enrichment so a student with several
            # fresh ACs cannot block the rest of the fleet behind their detail
            # lookups.
            await self._enrich_runtime_percentile(subs)
            return await self._engine.ingest_submissions(username, subs)
        except LeetCodeError as exc:
            log.warning("Poll failed for %s: %s", username, exc)
        except Exception:
            log.exception("Unexpected polling error for %s", username)
        return 0
