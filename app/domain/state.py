"""ContestEngine — owns Contest mutations and is the single source of truth.

All routes and the polling worker call into this class. It enforces:
- each problem's own open window as the only scoring gate
- "at most one base score per (user, problem)" invariant
- score consistency whenever the problem set changes
- snapshot publishing + persistence

Frontends never compute scores or rank.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from ..core.config import Settings
from ..core.scoring import compute_beat_bonus
from ..core.sse import Broadcaster
from ..core.storage import ContestStore
from .models import (
    Contest,
    Difficulty,
    Group,
    Participant,
    Problem,
    SubmissionEvent,
    SubmissionStatus,
    default_groups,
)

log = logging.getLogger("gdg.engine")

_MAX_EVENTS = 500
_SHORT_LABELS = {
    "Accepted": "AC",
    "Wrong Answer": "WA",
    "Time Limit Exceeded": "TLE",
    "Runtime Error": "RE",
    "Compile Error": "CE",
    "Memory Limit Exceeded": "MLE",
    "Output Limit Exceeded": "OLE",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _short_label(status: str) -> str:
    return _SHORT_LABELS.get(status, status[:3].upper() if status else "??")


def _extract_beat_pct(sub: dict) -> Optional[float]:
    """Try known field names for the runtime beat percentile (0–100)."""
    for key in ("runtimePercentile", "runtime_percentile", "beatPercentile", "beat_percentile"):
        v = sub.get(key)
        if v is not None:
            try:
                f = float(v)
                if 0.0 <= f <= 100.0:
                    return f
            except (TypeError, ValueError):
                pass
    return None


_LATEST = datetime.max.replace(tzinfo=timezone.utc)


class ContestEngine:
    def __init__(self, store: ContestStore, broadcaster: Broadcaster, settings: Settings):
        self._store = store
        self._bc = broadcaster
        self._cfg = settings
        self._lock = asyncio.Lock()

    # -------- helpers --------

    @property
    def contest(self) -> Contest:
        return self._store.contest

    def _problems_for_audience(self, audience: str) -> List[dict]:
        """Admins see every problem; the public board only sees problems that
        have been opened at least once, so an unopened set can't be previewed
        and a closed one never loses the scores already on it."""
        sorted_probs = sorted(self.contest.problems, key=lambda p: p.order)
        if audience != "admin":
            sorted_probs = [p for p in sorted_probs if p.was_opened]
        return [p.model_dump(mode="json") for p in sorted_probs]

    def snapshot_dict(self, audience: str = "public") -> dict:
        """Full state for new SSE subscribers."""
        c = self.contest
        payload = {
            "server_time": _utcnow().isoformat(),
            "groups": [g.model_dump(mode="json") for g in c.groups],
            "problems": self._problems_for_audience(audience),
            "leaderboard": self._leaderboard_snapshot(),
            "group_leaderboard": self._group_leaderboard(),
            "events": [e.model_dump(mode="json") for e in c.events[-200:]],
        }
        if audience == "admin":
            payload["participants_admin"] = {
                k: v.model_dump(mode="json") for k, v in c.participants.items()
            }
        return payload

    def _push_leaderboard(self) -> None:
        self._bc.broadcast(
            "leaderboard_update",
            {
                "leaderboard": self._leaderboard_snapshot(),
                "group_leaderboard": self._group_leaderboard(),
            },
        )

    def _broadcast_groups(self) -> None:
        self._bc.broadcast(
            "groups_updated", {"groups": [g.model_dump(mode="json") for g in self.contest.groups]}
        )

    def _broadcast_problems(self) -> None:
        """Send problems_updated to admin (every problem) and public (only the
        ones that have been opened)."""
        self._bc.broadcast(
            "problems_updated",
            {"problems": self._problems_for_audience("admin")},
            audience="admin",
        )
        self._bc.broadcast(
            "problems_updated",
            {"problems": self._problems_for_audience("public")},
            audience="public",
        )

    def _broadcast_participants_admin(self) -> None:
        self._store.mark_dirty()
        self._bc.broadcast(
            "participants_updated",
            {
                "count": len(self.contest.participants),
                "participants_admin": {
                    k: v.model_dump(mode="json") for k, v in self.contest.participants.items()
                },
            },
            audience="admin",
        )

    def _leaderboard_snapshot(self) -> List[dict]:
        ranked = self._compute_ranks()
        diff_by_slug = {prob.title_slug: prob.difficulty for prob in self.contest.problems}
        out: List[dict] = []
        for p in ranked:
            counts = {Difficulty.easy: 0, Difficulty.medium: 0, Difficulty.hard: 0}
            for slug in p.solved_problems:
                d = diff_by_slug.get(slug)
                if d is not None:
                    counts[d] += 1
            out.append(
                {
                    "rank": p.rank,
                    "username": p.username,
                    "nickname": p.nickname,
                    "group_id": p.group_id,
                    "avatar_url": p.avatar_url,
                    "score": p.score,
                    "solved_problems": sorted(p.solved_problems),
                    "reached_current_score_at": p.reached_current_score_at.isoformat()
                    if p.reached_current_score_at
                    else None,
                    # Practice-set counts (only for configured problems).
                    "easy_solved": counts[Difficulty.easy],
                    "medium_solved": counts[Difficulty.medium],
                    "hard_solved": counts[Difficulty.hard],
                    # Pre-game info (LeetCode global stats).
                    "lc_ranking": p.lc_ranking,
                    "lc_easy_total": p.lc_easy_total,
                    "lc_medium_total": p.lc_medium_total,
                    "lc_hard_total": p.lc_hard_total,
                }
            )
        return out

    def _group_leaderboard(self) -> List[dict]:
        """Team standings: plain sum of member scores.

        Teams are pre-assigned and near equal in size, so a sum ranks the same
        as an average while moving in numbers big enough to read across a room.
        Member count travels with the row so an uneven team is visible rather
        than hidden. Unassigned students are counted nowhere.
        """
        rows = {
            g.id: {
                "group_id": g.id,
                "name": g.name,
                "color": g.color,
                "score": 0,
                "member_count": 0,
                "_reached": None,
            }
            for g in self.contest.groups
        }
        for p in self.contest.participants.values():
            row = rows.get(p.group_id) if p.group_id is not None else None
            if row is None:
                continue
            row["score"] += p.score
            row["member_count"] += 1
            reached = p.reached_current_score_at
            if reached is not None and (row["_reached"] is None or reached > row["_reached"]):
                row["_reached"] = reached

        ordered = sorted(
            rows.values(),
            key=lambda r: (-r["score"], r["_reached"] or _LATEST, r["group_id"]),
        )
        out: List[dict] = []
        for rank, row in enumerate(ordered, start=1):
            reached = row.pop("_reached")
            out.append(
                {**row, "rank": rank, "reached_current_score_at": reached.isoformat() if reached else None}
            )
        return out

    def _compute_ranks(self) -> List[Participant]:
        # Sort: -score, reached_current_score_at asc (never None for >0 score),
        # then username for stability.
        sentinel = _LATEST
        plist = list(self.contest.participants.values())
        plist.sort(
            key=lambda p: (
                -p.score,
                p.reached_current_score_at or sentinel,
                p.username.lower(),
            )
        )

        # Dense-style ranking that ties only on score==0 (per spec).
        rank = 0
        last_score: Optional[int] = None
        last_rank = 0
        for idx, p in enumerate(plist, start=1):
            if p.score == 0 and last_score == 0:
                p.rank = last_rank
            else:
                rank = idx
                p.rank = rank
                last_rank = rank
            last_score = p.score
        return plist

    async def backfill_problem_metadata(self, fetch) -> None:
        """Best-effort fill of frontend_id/title for problems missing them.
        `fetch(slug)` is an async callable returning a dict with
        questionFrontendId/title (or returns None / raises on failure).
        Broadcasts a problems_updated event when anything changed."""
        targets = [
            p for p in self.contest.problems
            if not p.frontend_id or not p.title
        ]
        if not targets:
            return
        changed = False
        for prob in targets:
            try:
                data = await fetch(prob.title_slug)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            raw_fid = (
                data.get("questionFrontendId")
                or data.get("frontend_id")
                or data.get("questionId")
                or data.get("id")
            )
            if raw_fid is not None and not prob.frontend_id:
                prob.frontend_id = str(raw_fid)
                changed = True
            new_title = data.get("title")
            if new_title and not prob.title:
                prob.title = new_title
                changed = True
        if changed:
            async with self._lock:
                self._store.mark_dirty()
                self._broadcast_problems()

    # -------- score consistency --------

    def _recompute_scores(self) -> None:
        """Rebuild every participant's score from stored per-problem facts.

        Called after any change to the problem set, because adding, deleting,
        re-pointing or re-tiering a problem all change what a solve is worth.
        Everything needed already lives on the participant (best beat %, first
        AC time), so this never reads the capped event log.
        """
        by_slug = {p.title_slug: p for p in self.contest.problems}
        for participant in self.contest.participants.values():
            for slug in participant.solved_problems - by_slug.keys():
                participant.solved_problems.discard(slug)
                participant.problem_first_ac_at.pop(slug, None)
                participant.problem_bonus_pts.pop(slug, None)
                participant.problem_best_beat_pct.pop(slug, None)
                participant.problem_best_submission_id.pop(slug, None)

            total = 0
            for slug in participant.solved_problems:
                problem = by_slug[slug]
                bonus = compute_beat_bonus(
                    participant.problem_best_beat_pct.get(slug), problem.beat_bonus_tiers
                )
                participant.problem_bonus_pts[slug] = bonus
                total += problem.points + bonus
            participant.score = total

            ac_times = [
                participant.problem_first_ac_at[slug]
                for slug in participant.solved_problems
                if slug in participant.problem_first_ac_at
            ]
            participant.reached_current_score_at = max(ac_times) if ac_times else None

    # -------- problems --------

    async def set_problems(self, problems: List[Problem]) -> Tuple[List[str], List[str]]:
        """Replace the problem list. Returns (added_slugs, removed_slugs).

        Editing the list never disturbs a live window: problems that survive
        keep their is_open / opened_at / closed_at, so saving a typo fix in the
        middle of a session doesn't silently close everything.
        """
        async with self._lock:
            seen_slugs: set[str] = set()
            for p in problems:
                if p.title_slug in seen_slugs:
                    raise ValueError(f"Duplicate problem slug: {p.title_slug}")
                seen_slugs.add(p.title_slug)

            existing = {p.title_slug: p for p in self.contest.problems}
            merged: List[Problem] = []
            for p in problems:
                prev = existing.get(p.title_slug)
                if prev is not None:
                    p = p.model_copy(
                        update={
                            "is_open": prev.is_open,
                            "opened_at": prev.opened_at,
                            "closed_at": prev.closed_at,
                        }
                    )
                merged.append(p)

            added = sorted(seen_slugs - existing.keys())
            removed = sorted(existing.keys() - seen_slugs)

            self.contest.problems = sorted(merged, key=lambda p: p.order)
            self._recompute_scores()
            self._store.mark_dirty()
            self._broadcast_problems()
            self._push_leaderboard()
        return added, removed

    def _apply_open(self, problem: Problem, is_open: bool) -> bool:
        """Toggle one problem's window. Returns True when something changed.

        Opening restarts the window from now, so an AC made while the problem
        was closed can never be back-credited. Closing records the moment
        rather than dropping the door, so a submission made a second earlier
        still scores when the next poll finds it.
        """
        if problem.is_open == is_open:
            return False
        problem.is_open = is_open
        if is_open:
            problem.opened_at = _utcnow()
            problem.closed_at = None
        else:
            problem.closed_at = _utcnow()
        return True

    async def set_problem_open(self, title_slug: str, is_open: bool) -> Problem:
        async with self._lock:
            problem = next(
                (p for p in self.contest.problems if p.title_slug == title_slug), None
            )
            if problem is None:
                raise KeyError(title_slug)
            if self._apply_open(problem, is_open):
                self._store.mark_dirty()
                self._broadcast_problems()
            return problem

    async def set_all_problems_open(self, is_open: bool) -> int:
        async with self._lock:
            changed = sum(self._apply_open(p, is_open) for p in self.contest.problems)
            if changed:
                self._store.mark_dirty()
                self._broadcast_problems()
            return changed

    # -------- participants --------

    async def upsert_participants(
        self, rows: List[Tuple[str, str, Optional[int]]]
    ) -> Tuple[int, int, List[str], List[str]]:
        """Bulk add/update; returns (created, updated, errors, new_usernames).

        A row without a group leaves an existing assignment alone, so re-importing
        a name list never silently unassigns everyone.
        """
        created = 0
        updated = 0
        errors: List[str] = []
        new_usernames: List[str] = []
        valid_groups = {g.id for g in self.contest.groups}
        async with self._lock:
            for username, nickname, group_id in rows:
                u = (username or "").strip()
                n = (nickname or "").strip()
                if not u or not n:
                    errors.append(f"缺少 username 或姓名：'{username}','{nickname}'")
                    continue
                if group_id is not None and group_id not in valid_groups:
                    errors.append(f"{u}：組別 {group_id} 不存在（可用 1–{len(valid_groups)}）")
                    continue
                existing = self.contest.participants.get(u)
                if existing is not None:
                    existing.nickname = n
                    if group_id is not None:
                        existing.group_id = group_id
                    updated += 1
                else:
                    self.contest.participants[u] = Participant(
                        username=u, nickname=n, group_id=group_id
                    )
                    created += 1
                    new_usernames.append(u)
            self._broadcast_participants_admin()
            self._push_leaderboard()
        return created, updated, errors, new_usernames

    async def set_participant_group(self, username: str, group_id: Optional[int]) -> None:
        valid_groups = {g.id for g in self.contest.groups}
        if group_id is not None and group_id not in valid_groups:
            raise ValueError(f"組別 {group_id} 不存在")
        async with self._lock:
            participant = self.contest.participants.get(username)
            if participant is None:
                raise KeyError(username)
            participant.group_id = group_id
            self._broadcast_participants_admin()
            self._push_leaderboard()

    # -------- groups --------

    async def set_groups(self, groups: List[Group]) -> None:
        """Rename / re-colour the fixed teams. Colour changes land everywhere
        immediately because every surface resolves colour through group id."""
        async with self._lock:
            by_id = {g.id: g for g in self.contest.groups}
            for incoming in groups:
                current = by_id.get(incoming.id)
                if current is None:
                    raise ValueError(f"未知的組別 {incoming.id}")
                current.name = incoming.name.strip() or current.name
                current.color = incoming.color.strip() or current.color
            self._store.mark_dirty()
            self._broadcast_groups()
            self._push_leaderboard()

    async def remove_participant(self, username: str) -> bool:
        async with self._lock:
            existed = self.contest.participants.pop(username, None) is not None
            if existed:
                self._broadcast_participants_admin()
                self._push_leaderboard()
            return existed

    async def update_profile(self, username: str, *, avatar_url: Optional[str], lc_ranking: Optional[int],
                              easy_total: int, medium_total: int, hard_total: int) -> None:
        async with self._lock:
            p = self.contest.participants.get(username)
            if not p:
                return
            p.avatar_url = avatar_url or p.avatar_url
            p.lc_ranking = lc_ranking
            p.lc_easy_total = easy_total
            p.lc_medium_total = medium_total
            p.lc_hard_total = hard_total
            p.profile_fetched_at = _utcnow()
            self._broadcast_participants_admin()
        self._push_leaderboard()

    # -------- reset --------

    async def reset_contest(self, *, keep_config: bool) -> None:
        """Wipe scores, events and dedupe state. Problems and the roster stay,
        but every window is closed and cleared so the board is back at a clean
        starting line rather than half-open with orphaned timestamps."""
        async with self._lock:
            problems = (
                [
                    p.model_copy(update={"is_open": False, "opened_at": None, "closed_at": None})
                    for p in self.contest.problems
                ]
                if keep_config
                else []
            )
            participants = (
                {
                    u: Participant(
                        username=u,
                        nickname=p.nickname,
                        group_id=p.group_id,
                        avatar_url=p.avatar_url,
                        lc_ranking=p.lc_ranking,
                        lc_easy_total=p.lc_easy_total,
                        lc_medium_total=p.lc_medium_total,
                        lc_hard_total=p.lc_hard_total,
                        profile_fetched_at=p.profile_fetched_at,
                    )
                    for u, p in self.contest.participants.items()
                }
                if keep_config
                else {}
            )
            self._store.replace_contest(
                Contest(
                    # Team names and colours are setup, not scores — a reset
                    # between sessions must not send them back to "第一組".
                    groups=[g.model_copy() for g in self.contest.groups]
                    if keep_config
                    else default_groups(),
                    problems=problems,
                    participants=participants,
                    last_reset_at=_utcnow(),
                )
            )
        # Send reset to BOTH audiences with audience-specific snapshots so the
        # admin dashboard doesn't lose its admin-only fields.
        self._store.mark_dirty()
        self._bc.broadcast(
            "contest_reset",
            {"keep_config": keep_config, "snapshot": self.snapshot_dict("public")},
            audience="public",
        )
        self._bc.broadcast(
            "contest_reset",
            {"keep_config": keep_config, "snapshot": self.snapshot_dict("admin")},
            audience="admin",
        )
        self._push_leaderboard()
        await self._store.flush_now()

    # -------- submission ingestion (the scoring path) --------

    async def ingest_submissions(self, username: str, raw_submissions: List[dict]) -> int:
        """Apply scoring rules to a batch of LeetCode-shaped submissions.

        `raw_submissions` is the list returned by `/user/{username}/submissions`,
        each containing at least: id, statusDisplay, titleSlug, timestamp.

        Submissions to anything outside the configured problem set are dropped
        entirely — students practising other problems must not flood the feed.

        Returns how many submissions were seen for the first time. The polling
        worker reads that as an activity signal: it counts any fresh submission,
        including ones to problems we don't track, because a student grinding
        something else is still a student who is actively submitting.
        """

        if not raw_submissions:
            return 0
        newly_seen = 0
        async with self._lock:
            participant = self.contest.participants.get(username)
            if not participant:
                return 0  # ignore submissions for unknown users (defensive)

            tracked = {p.title_slug: p for p in self.contest.problems}
            new_events: List[SubmissionEvent] = []

            for sub in raw_submissions:
                sub_id = str(sub.get("id") or "")
                if not sub_id or sub_id in self.contest.seen_submission_ids:
                    continue
                # Always mark seen so we don't reprocess on the next poll.
                self.contest.seen_submission_ids.add(sub_id)
                newly_seen += 1

                slug = sub.get("titleSlug") or sub.get("title_slug")
                status_disp = sub.get("statusDisplay") or sub.get("status") or "Other"
                ts_raw = sub.get("timestamp")
                if not slug or ts_raw is None:
                    continue
                try:
                    submitted_at = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc)
                except (TypeError, ValueError):
                    continue

                problem = tracked.get(slug)
                if problem is None:
                    continue

                is_accepted = status_disp == SubmissionStatus.accepted.value
                is_scoring = False
                points_delta = 0
                bonus_delta = 0
                beat_pct: Optional[float] = None
                note: Optional[str] = None

                if is_accepted:
                    beat_pct = _extract_beat_pct(sub)
                    if not problem.accepts(submitted_at):
                        note = "problem closed"
                    else:
                        new_bonus = compute_beat_bonus(beat_pct, problem.beat_bonus_tiers)
                        best_so_far = participant.problem_best_beat_pct.get(slug)

                        if slug not in participant.solved_problems:
                            # First AC inside the window — base points + bonus.
                            is_scoring = True
                            bonus_delta = new_bonus
                            points_delta = problem.points + bonus_delta
                            participant.solved_problems.add(slug)
                            participant.problem_first_ac_at[slug] = submitted_at
                            participant.problem_bonus_pts[slug] = new_bonus
                            participant.problem_best_submission_id[slug] = sub_id
                            if beat_pct is not None:
                                participant.problem_best_beat_pct[slug] = beat_pct
                            participant.score += points_delta
                            participant.reached_current_score_at = submitted_at
                        else:
                            # Re-AC. There is no attempt limit: every resubmit
                            # can improve the recorded runtime, and crossing
                            # into a higher tier tops up the difference.
                            if beat_pct is not None and (
                                best_so_far is None or beat_pct > best_so_far
                            ):
                                participant.problem_best_beat_pct[slug] = beat_pct
                                participant.problem_best_submission_id[slug] = sub_id
                            old_bonus = participant.problem_bonus_pts.get(slug, 0)
                            if new_bonus > old_bonus:
                                is_scoring = True
                                bonus_delta = new_bonus - old_bonus
                                points_delta = bonus_delta
                                participant.problem_bonus_pts[slug] = new_bonus
                                participant.score += bonus_delta
                                participant.reached_current_score_at = submitted_at
                                note = f"bonus +{old_bonus}→+{new_bonus}"

                evt = SubmissionEvent(
                    submission_id=sub_id,
                    username=username,
                    nickname=participant.nickname,
                    group_id=participant.group_id,
                    title_slug=slug,
                    title=problem.title or slug,
                    status=status_disp,
                    short_label=_short_label(status_disp),
                    submitted_at=submitted_at,
                    points_delta=points_delta,
                    bonus_delta=bonus_delta,
                    beat_pct=beat_pct,
                    is_accepted=is_accepted,
                    is_scoring=is_scoring,
                    note=note,
                )
                self.contest.events.append(evt)
                new_events.append(evt)

            if len(self.contest.events) > _MAX_EVENTS:
                self.contest.events = self.contest.events[-_MAX_EVENTS:]

            if new_events:
                self._store.mark_dirty()

        if not new_events:
            return newly_seen

        # Push events + refreshed leaderboard *outside* the lock.
        for evt in new_events:
            self._bc.broadcast("submission_event", evt.model_dump(mode="json"))
        if any(e.is_scoring for e in new_events):
            self._push_leaderboard()
        return newly_seen

    # -------- helpers used by routes / workers --------

    def open_problem_count(self) -> int:
        return sum(1 for p in self.contest.problems if p.is_open)

    def is_polling_window(self) -> bool:
        """Poll while any problem is open, plus a grace period after the last
        one closes so late-arriving submissions still land."""
        if any(p.is_open for p in self.contest.problems):
            return True
        closed_times = [p.closed_at for p in self.contest.problems if p.closed_at is not None]
        if not closed_times:
            return False
        return _utcnow() - max(closed_times) < timedelta(seconds=self._cfg.post_end_grace_sec)

    def usernames(self) -> List[str]:
        return list(self.contest.participants.keys())
