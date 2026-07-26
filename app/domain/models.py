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
from typing import Annotated, Dict, List, Optional, Set
from uuid import uuid4

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: object) -> object:
    """Attach UTC to a naive datetime instead of letting it through.

    A single naive timestamp in the state file used to poison every comparison
    in the scoring path with `TypeError: can't compare offset-naive and
    offset-aware datetimes`. The polling worker catches and logs that, so the
    board looks healthy while nothing scores for the whole session.
    """
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return value
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


UTCDateTime = Annotated[datetime, BeforeValidator(_as_utc)]


class Difficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


GROUP_COUNT = 6


class Group(BaseModel):
    """One of the six fixed teams.

    Colour is the single source of identity on the board: avatars, names and
    scoring chips all take it, so editing the hex here re-skins every surface
    at once.
    """

    id: int = Field(ge=1, le=GROUP_COUNT)
    name: str
    color: str  # css hex, e.g. "#E4572E"


# Six hues at matched lightness so no team reads as louder than another, and
# far enough apart to stay separable on a projector from the back of a room.
_DEFAULT_GROUPS = (
    (1, "第一組", "#E4572E"),
    (2, "第二組", "#E8B33C"),
    (3, "第三組", "#4FA96B"),
    (4, "第四組", "#3FA7C4"),
    (5, "第五組", "#7B72D6"),
    (6, "第六組", "#D45C9B"),
)


def default_groups() -> List[Group]:
    return [Group(id=i, name=name, color=color) for i, name, color in _DEFAULT_GROUPS]


class BonusTier(BaseModel):
    """One bracket in the runtime-beat-% bonus table.

    Example: BonusTier(min_beat_pct=95.0, bonus_pts=3) awards +3 points
    when the submission beats ≥ 95 % of LeetCode runtime submissions.
    """

    min_beat_pct: float = Field(ge=0.0, le=100.0)
    bonus_pts: int = Field(ge=0)


class Window(BaseModel):
    """One stretch of time during which a problem was open for scoring."""

    opened_at: UTCDateTime
    closed_at: Optional[UTCDateTime] = None

    def contains(self, moment: datetime) -> bool:
        if moment < self.opened_at:
            return False
        return self.closed_at is None or moment <= self.closed_at


class Problem(BaseModel):
    title_slug: str
    difficulty: Difficulty
    points: int = Field(ge=0)
    order: int = Field(ge=0)
    title: Optional[str] = None  # cached display name from /problem/{slug}
    frontend_id: Optional[str] = None  # LeetCode official problem number, e.g. "1", "1768"
    color: Optional[str] = None  # css colour for status pip; defaults from difficulty
    beat_bonus_tiers: List[BonusTier] = Field(default_factory=list)

    # Practice windows. Opening appends one, closing stamps its end. Every
    # window a problem has ever had still scores, because "close this, open the
    # next, oh wait let's reopen it" is a normal classroom move and a student
    # who solved it during the first window must not be told 「problem closed」
    # just because the poll that found them arrived after the second one began.
    is_open: bool = False
    windows: List[Window] = Field(default_factory=list)

    @property
    def was_opened(self) -> bool:
        """True once the teacher has opened this problem at least once."""
        return bool(self.windows)

    @property
    def opened_at(self) -> Optional[datetime]:
        return self.windows[-1].opened_at if self.windows else None

    @property
    def closed_at(self) -> Optional[datetime]:
        return self.windows[-1].closed_at if self.windows else None

    def accepts(self, submitted_at: datetime) -> bool:
        """True when `submitted_at` falls inside any window this problem had.

        Closing records an end rather than slamming the door, so a submission
        made a second before the toggle still scores even though the poll that
        discovers it arrives afterwards.
        """
        return any(window.contains(submitted_at) for window in self.windows)

    def open_now(self, moment: datetime) -> None:
        if self.is_open:
            return
        self.is_open = True
        self.windows.append(Window(opened_at=moment))

    def close_now(self, moment: datetime) -> None:
        if not self.is_open:
            return
        self.is_open = False
        if self.windows and self.windows[-1].closed_at is None:
            self.windows[-1].closed_at = moment

    def max_points(self) -> int:
        """Base points plus the most generous bonus tier."""
        best_bonus = max((t.bonus_pts for t in self.beat_bonus_tiers), default=0)
        return self.points + best_bonus


class Participant(BaseModel):
    username: str
    nickname: str  # real name, shown on the public board instead of the handle
    group_id: Optional[int] = None  # None = unassigned, excluded from the team board
    avatar_url: Optional[str] = None
    score: int = 0
    rank: int = 0
    solved_problems: Set[str] = Field(default_factory=set)
    problem_first_ac_at: Dict[str, UTCDateTime] = Field(default_factory=dict)
    # When this problem last *gained* points — first AC or a bonus top-up. The
    # rank tie-break is built from these, and they are stored rather than
    # derived so the incremental path and a full recompute can never disagree.
    problem_last_scored_at: Dict[str, UTCDateTime] = Field(default_factory=dict)
    problem_bonus_pts: Dict[str, int] = Field(default_factory=dict)  # current bonus per problem (upgradable)
    problem_best_beat_pct: Dict[str, float] = Field(default_factory=dict)  # best beat% seen so far
    reached_current_score_at: Optional[UTCDateTime] = None
    added_at: UTCDateTime = Field(default_factory=_utcnow)

    # LeetCode profile snapshot (refreshed by polling worker / on add).
    lc_ranking: Optional[int] = None
    lc_easy_total: int = 0
    lc_medium_total: int = 0
    lc_hard_total: int = 0
    profile_fetched_at: Optional[UTCDateTime] = None

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
    nickname: str
    group_id: Optional[int] = None
    title_slug: str
    title: Optional[str] = None
    status: str  # raw provider string ("Accepted", "Wrong Answer", ...)
    short_label: str  # AC, WA, TLE, RE, CE, MLE, OLE, ...
    submitted_at: UTCDateTime
    detected_at: UTCDateTime = Field(default_factory=_utcnow)
    points_delta: int = 0       # total points awarded (base + bonus)
    bonus_delta: int = 0        # bonus portion of points_delta (from beat-% tiers)
    beat_pct: Optional[float] = None  # runtime beat percentile reported by LeetCode
    is_accepted: bool = False
    is_scoring: bool = False  # True only if it actually awarded points
    note: Optional[str] = None  # e.g. "problem closed", "bonus +2→+4"


class Contest(BaseModel):
    """Full persistent practice state. Mirrored to disk as JSON on every change."""

    groups: List[Group] = Field(default_factory=default_groups)
    problems: List[Problem] = Field(default_factory=list)
    participants: Dict[str, Participant] = Field(default_factory=dict)  # keyed by username

    seen_submission_ids: Set[str] = Field(default_factory=set)

    events: List[SubmissionEvent] = Field(default_factory=list)

    last_reset_at: Optional[UTCDateTime] = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


def default_contest() -> Contest:
    """Cold-boot factory — empty practice board, every problem closed."""

    return Contest()
