"""Pydantic models for practice state, persisted as JSON.

Time policy: every datetime stored here is timezone-aware UTC.
The frontend converts to the projector's local timezone for display.

There is no global session clock. Each problem carries its own open window,
driven by the teacher's toggle, and that window is the only thing that decides
whether an accepted submission scores.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Set
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Difficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


class BonusTier(BaseModel):
    """One bracket in the runtime-beat-% bonus table.

    Example: BonusTier(min_beat_pct=95.0, bonus_pts=3) awards +3 points
    when the submission beats ≥ 95 % of LeetCode runtime submissions.
    """

    min_beat_pct: float = Field(ge=0.0, le=100.0)
    bonus_pts: int = Field(ge=0)


class Problem(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None  # cached display name from /problem/{slug}
    frontend_id: Optional[str] = None  # LeetCode official problem number, e.g. "1", "1768"
    color: Optional[str] = None  # css colour for status pip; defaults from difficulty
    beat_bonus_tiers: List[BonusTier] = Field(default_factory=list)

    # Practice window. Opening starts scoring, closing stops it. Re-opening
    # restarts the window from that moment, so an AC made while the problem was
    # closed never scores. A problem that has been opened at least once stays
    # visible on the public board forever, so earned points never disappear.
    is_open: bool = False
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None

    @property
    def was_opened(self) -> bool:
        """True once the teacher has opened this problem at least once."""
        return self.opened_at is not None

    def accepts(self, submitted_at: datetime) -> bool:
        """True when `submitted_at` falls inside this problem's open window.

        Closing records `closed_at` rather than slamming the door immediately,
        so a submission made a second before the toggle still scores even
        though the poll that discovers it arrives afterwards.
        """
        if self.opened_at is None or submitted_at < self.opened_at:
            return False
        return self.closed_at is None or submitted_at <= self.closed_at

    def max_points(self) -> int:
        """Base points plus the most generous bonus tier."""
        best_bonus = max((t.bonus_pts for t in self.beat_bonus_tiers), default=0)
        return self.points + best_bonus


class Participant(BaseModel):
    username: str
    student_id: str
    avatar_url: Optional[str] = None
    color: Optional[str] = None  # frontend uses username hash if absent
    score: int = 0
    rank: int = 0
    solved_problems: Set[str] = Field(default_factory=set)
    problem_first_ac_at: Dict[str, datetime] = Field(default_factory=dict)
    problem_bonus_pts: Dict[str, int] = Field(default_factory=dict)  # current bonus per problem (upgradable)
    problem_best_beat_pct: Dict[str, float] = Field(default_factory=dict)  # best beat% seen so far
    problem_best_submission_id: Dict[str, str] = Field(default_factory=dict)  # submission behind that best beat%
    reached_current_score_at: Optional[datetime] = None
    added_at: datetime = Field(default_factory=_utcnow)

    # LeetCode profile snapshot (refreshed by polling worker / on add).
    lc_ranking: Optional[int] = None
    lc_easy_total: int = 0
    lc_medium_total: int = 0
    lc_hard_total: int = 0
    profile_fetched_at: Optional[datetime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class SubmissionStatus(str, Enum):
    accepted = "Accepted"
    wrong_answer = "Wrong Answer"
    time_limit_exceeded = "Time Limit Exceeded"
    runtime_error = "Runtime Error"
    compile_error = "Compile Error"
    memory_limit_exceeded = "Memory Limit Exceeded"
    output_limit_exceeded = "Output Limit Exceeded"
    other = "Other"


class SubmissionEvent(BaseModel):
    """Anything that should appear in the event feed.

    Only submissions to configured problems produce events; everything else a
    student happens to submit on LeetCode is silently ignored.
    """

    id: str = Field(default_factory=lambda: uuid4().hex)
    submission_id: Optional[str] = None  # provider-side id, e.g. LeetCode submission id
    username: str
    student_id: str
    title_slug: str
    title: Optional[str] = None
    status: str  # raw provider string ("Accepted", "Wrong Answer", ...)
    short_label: str  # AC, WA, TLE, RE, CE, MLE, OLE, ...
    submitted_at: datetime
    detected_at: datetime = Field(default_factory=_utcnow)
    points_delta: int = 0       # total points awarded (base + bonus)
    bonus_delta: int = 0        # bonus portion of points_delta (from beat-% tiers)
    beat_pct: Optional[float] = None  # runtime beat percentile reported by LeetCode
    is_accepted: bool = False
    is_scoring: bool = False  # True only if it actually awarded points
    note: Optional[str] = None  # e.g. "problem closed", "bonus +2→+4"


class Contest(BaseModel):
    """Full persistent practice state. Mirrored to disk as JSON on every change."""

    problems: List[Problem] = Field(default_factory=list)
    participants: Dict[str, Participant] = Field(default_factory=dict)  # keyed by username

    seen_submission_ids: Set[str] = Field(default_factory=set)

    events: List[SubmissionEvent] = Field(default_factory=list)

    last_reset_at: Optional[datetime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


def default_contest() -> Contest:
    """Cold-boot factory — empty practice board, every problem closed."""

    return Contest()
