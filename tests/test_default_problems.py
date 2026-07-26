"""The term's problem set ships as a default, so a fresh state file is usable."""

from __future__ import annotations

from datetime import datetime, timezone

from app.domain.models import Contest, Difficulty, default_problems

# The list as the owner gave it: five rounds of three, in teaching order.
EXPECTED = [
    ("2235", "add-two-integers"),
    ("2769", "find-the-maximum-achievable-number"),
    ("2469", "convert-the-temperature"),
    ("2413", "smallest-even-multiple"),
    ("223", "rectangle-area"),
    ("2119", "a-number-after-a-double-reversal"),
    ("1342", "number-of-steps-to-reduce-a-number-to-zero"),
    ("509", "fibonacci-number"),
    ("7", "reverse-integer"),
    ("1603", "design-parking-system"),
    ("2526", "find-consecutive-integers-from-a-data-stream"),
    ("284", "peeking-iterator"),
    ("1929", "concatenation-of-array"),
    ("1", "two-sum"),
    ("53", "maximum-subarray"),
]


def test_ships_the_fifteen_in_teaching_order():
    problems = default_problems()

    assert [(p.frontend_id, p.title_slug) for p in problems] == EXPECTED
    assert [p.order for p in problems] == list(range(15))


def test_everything_starts_closed():
    # The board shows nothing and the poller stays quiet until a problem opens.
    assert all(not p.is_open and not p.windows for p in default_problems())


def test_points_and_bonus_follow_difficulty():
    by_slug = {p.title_slug: p for p in default_problems()}

    assert by_slug["two-sum"].difficulty is Difficulty.easy
    assert by_slug["two-sum"].points == 5
    assert by_slug["maximum-subarray"].difficulty is Difficulty.medium
    assert by_slug["maximum-subarray"].points == 10
    # Same three brackets everywhere, so students learn one rule.
    assert all(
        [(t.min_beat_pct, t.bonus_pts) for t in p.beat_bonus_tiers]
        == [(90.0, 4), (60.0, 2), (20.0, 1)]
        for p in default_problems()
    )


def test_a_fresh_contest_comes_with_them():
    assert len(Contest().problems) == 15


def test_each_call_returns_fresh_objects():
    # Shared instances would let one contest's open window leak into the next.
    first, second = default_problems(), default_problems()

    first[0].open_now(datetime.now(timezone.utc))

    assert second[0].is_open is False
