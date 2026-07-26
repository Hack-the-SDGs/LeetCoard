"""Write a populated contest.json so the board can be looked at, not imagined.

    python tools/seed_demo_board.py ./demo-data 66
    DATA_DIR=./demo-data uvicorn app.main:app --port 8080

Everything it writes is invented. Point it at a scratch directory, never at the
DATA_DIR of a real session — it replaces the state file outright.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402
from app.core.sse import Broadcaster  # noqa: E402
from app.core.storage import ContestStore  # noqa: E402
from app.domain.models import (  # noqa: E402
    BonusTier,
    Contest,
    Difficulty,
    Group,
    Participant,
    Problem,
    SubmissionEvent,
    Window,
)
from app.domain.state import ContestEngine  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "./demo-data")
COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 66
NOW = datetime.now(timezone.utc)
T0 = NOW - timedelta(minutes=52)

TIERS = [
    BonusTier(min_beat_pct=90.0, bonus_pts=4),
    BonusTier(min_beat_pct=60.0, bonus_pts=2),
    BonusTier(min_beat_pct=20.0, bonus_pts=1),
]

GROUPS = [
    Group(id=1, name="紅隊", color="#E4572E"),
    Group(id=2, name="琥珀隊", color="#E8B33C"),
    Group(id=3, name="綠隊", color="#4FA96B"),
    Group(id=4, name="青隊", color="#3FA7C4"),
    Group(id=5, name="紫隊", color="#7B72D6"),
    Group(id=6, name="桃隊", color="#D45C9B"),
]

# Two open, three already covered, one never opened — every visibility state.
PROBLEMS = [
    Problem(title_slug="two-sum", title="Two Sum", frontend_id="1",
            difficulty=Difficulty.easy, points=5, order=0, beat_bonus_tiers=TIERS,
            is_open=True, windows=[Window(opened_at=T0)]),
    Problem(title_slug="valid-parentheses", title="Valid Parentheses", frontend_id="20",
            difficulty=Difficulty.easy, points=5, order=1, beat_bonus_tiers=TIERS,
            is_open=True,
            windows=[Window(opened_at=T0 + timedelta(minutes=18))]),
    Problem(title_slug="3sum", title="3Sum", frontend_id="15",
            difficulty=Difficulty.medium, points=10, order=2, beat_bonus_tiers=TIERS,
            is_open=False,
            windows=[Window(opened_at=T0 - timedelta(minutes=40),
                            closed_at=T0 - timedelta(minutes=3))]),
    Problem(title_slug="merge-k-sorted-lists", title="Merge k Sorted Lists", frontend_id="23",
            difficulty=Difficulty.hard, points=20, order=3, beat_bonus_tiers=TIERS,
            is_open=False,
            windows=[Window(opened_at=T0 - timedelta(minutes=95),
                            closed_at=T0 - timedelta(minutes=48))]),
    Problem(title_slug="lru-cache", title="LRU Cache", frontend_id="146",
            difficulty=Difficulty.medium, points=10, order=4, beat_bonus_tiers=TIERS,
            is_open=False,
            windows=[Window(opened_at=T0 - timedelta(minutes=140),
                            closed_at=T0 - timedelta(minutes=100))]),
    Problem(title_slug="trapping-rain-water", title="Trapping Rain Water", frontend_id="42",
            difficulty=Difficulty.hard, points=20, order=5, beat_bonus_tiers=TIERS),
]

SURNAMES = "陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高"
GIVEN = [
    "彥廷", "詩涵", "冠宇", "雅婷", "承翰", "思穎", "柏毅", "家豪", "孟儒", "伊婷",
    "凱翔", "佩珊", "俊傑", "曉薇", "柏勳", "怡君", "振宇", "俊安", "敏慧", "士豪",
    "子晴", "宗翰", "郁婷", "建良", "宜臻",
]
HANDLES = [
    "yenting", "shihhan", "kuanyu", "yating", "chenghan", "sszying", "poyi", "chiahao",
    "mengju", "yiting", "kaihsiang", "peishan", "chunchieh", "hsiaowei", "pohsun",
    "yichun", "chenyu", "chunan", "minhui", "shihhao", "tzuching", "tsunghan", "yuting",
    "chienliang", "yichen",
]


def make_roster(count: int) -> list[tuple[str, str, int | None]]:
    """(name, username, group). Deterministic, no repeats."""
    rows: list[tuple[str, str, int | None]] = []
    for i in range(count):
        surname = SURNAMES[i % len(SURNAMES)]
        given = GIVEN[(i * 7) % len(GIVEN)]
        handle = f"{HANDLES[(i * 11) % len(HANDLES)]}{i:02d}"
        # Leave the last two unassigned so the neutral-grey path stays exercised.
        group = None if i >= count - 2 else (i % 6) + 1
        rows.append((f"{surname}{given}", handle, group))
    return rows


ROSTER = make_roster(COUNT)

# Solve profiles: everyone attacks the easy one, fewer reach the rest. Beat
# percentages fan out across the whole axis, and a few solvers deliberately have
# none so the "no runtime data" path stays exercised.
participants: dict[str, Participant] = {}
for i, (name, username, group_id) in enumerate(ROSTER):
    person = Participant(username=username, nickname=name, group_id=group_id)

    def solve(target: Participant, slug: str, minutes: float, beat: float | None) -> None:
        target.solved_problems.add(slug)
        moment = T0 + timedelta(minutes=minutes)
        target.problem_first_ac_at[slug] = moment
        target.problem_last_scored_at[slug] = moment
        if beat is not None:
            target.problem_best_beat_pct[slug] = beat

    if i < COUNT - 4:  # nearly everyone solves the open easy problem
        beat = None if i % 17 == 0 else round(4.0 + (i * 97.3) % 95.5, 1)
        solve(person, "two-sum", 2 + i * 0.4, beat)
    if i % 2 == 0:  # half get to the second open one
        solve(person, "valid-parentheses", 20 + i * 0.5, round(9.0 + (i * 53.7) % 89.0, 1))
    if i % 3 == 0:  # a third finished the closed medium
        solve(person, "3sum", -35 + i * 0.4, round(15.0 + (i * 41.1) % 82.0, 1))
    if i % 7 == 0:  # a handful cleared the closed hard one
        solve(person, "merge-k-sorted-lists", -90 + i * 0.3, round(30.0 + (i * 23.9) % 65.0, 1))
    if i % 5 == 0:
        solve(person, "lru-cache", -135 + i * 0.3, round(20.0 + (i * 31.3) % 75.0, 1))

    participants[username] = person

events: list[SubmissionEvent] = []
STATUSES = [
    ("Accepted", "AC", True),
    ("Wrong Answer", "WA", False),
    ("Time Limit Exceeded", "TLE", False),
    ("Accepted", "AC", True),
    ("Runtime Error", "RE", False),
    ("Wrong Answer", "WA", False),
    ("Accepted", "AC", True),
    ("Accepted", "AC", True),
]
for n, (status, label, scoring) in enumerate(STATUSES):
    name, username, group_id = ROSTER[(n * 5) % len(ROSTER)]
    problem = PROBLEMS[n % 2]
    events.append(SubmissionEvent(
        submission_id=f"evt{n}", username=username, nickname=name, group_id=group_id,
        title_slug=problem.title_slug, title=problem.title, status=status,
        short_label=label, submitted_at=T0 + timedelta(minutes=44 + n),
        points_delta=problem.points + 2 if scoring else 0,
        bonus_delta=2 if scoring else 0,
        beat_pct=round(40.0 + n * 6.5, 1) if status == "Accepted" else None,
        is_accepted=status == "Accepted", is_scoring=scoring,
    ))

contest = Contest(groups=GROUPS, problems=PROBLEMS, participants=participants, events=events)

settings = Settings(admin_token="demo-token", data_dir=OUT)
store = ContestStore(settings.state_file, settings.state_backup_file)
store.replace_contest(contest)
engine = ContestEngine(store, Broadcaster(), settings)
engine._recompute_scores()
store._write_sync()

# The demo needs its own roster file too, or the next boot would sync the state
# file against the real class list and prune all 66 invented students.
roster_file = OUT / "roster.txt"
roster_file.write_text(
    "\n".join(f"{group or ''},{name},{username}" for name, username, group in ROSTER) + "\n",
    encoding="utf-8",
)

board = engine._leaderboard_snapshot()
print(f"wrote {settings.state_file}")
print(f"wrote {roster_file} — pass ROSTER_FILE={roster_file} when you boot")
print(f"  {len(participants)} students, {len(PROBLEMS)} problems, {len(events)} events")
for problem in PROBLEMS:
    solvers = engine._solvers_for(problem.title_slug)
    ranked = [s for s in solvers if s["beat_pct"] is not None]
    print(f"  {problem.title_slug:<22} open={problem.is_open!s:<5} "
          f"solvers={len(solvers):>3} ranked={len(ranked):>3}")
print("  top 5:", [(r["rank"], r["nickname"], r["score"]) for r in board[:5]])
print("  teams:", [(t["rank"], t["name"], t["score"]) for t in engine._group_leaderboard()])
