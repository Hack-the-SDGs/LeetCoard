"""The password guarding the public board."""

from __future__ import annotations

from app.core.auth import ViewGate


def test_no_password_leaves_the_board_open():
    gate = ViewGate("")
    assert gate.is_open
    assert gate.accepts(None)
    assert gate.accepts("anything")


def test_password_from_the_environment_is_enforced():
    gate = ViewGate("classroom")
    assert not gate.is_open
    assert gate.accepts("classroom")
    assert not gate.accepts("Classroom")
    assert not gate.accepts("")
    assert not gate.accepts(None)


def test_a_chinese_password_works_rather_than_exploding():
    """hmac.compare_digest refuses non-ASCII str and raises TypeError, which
    surfaces as a 500 and takes the whole board down — including for people
    typing the correct password. This dashboard is in Chinese."""
    gate = ViewGate("課堂密碼2026")
    assert gate.accepts("課堂密碼2026")
    assert not gate.accepts("課堂密碼")
    assert not gate.accepts("ascii-guess")

    gate.set_override("練習🔒")
    assert gate.accepts("練習🔒")
    assert not gate.accepts("練習")


def test_surrounding_whitespace_is_forgiven():
    """People paste passwords; a trailing space must not lock them out."""
    gate = ViewGate("  classroom  ")
    assert gate.accepts("classroom")
    assert gate.accepts(" classroom\n")


def test_override_takes_over_and_can_be_handed_back():
    gate = ViewGate("from-env")
    assert not gate.overridden

    gate.set_override("today-only")
    assert gate.overridden
    assert gate.accepts("today-only")
    assert not gate.accepts("from-env")

    gate.clear_override()
    assert not gate.overridden
    assert gate.accepts("from-env")


def test_override_can_open_a_board_the_environment_locked():
    gate = ViewGate("from-env")
    gate.set_override("")
    assert gate.is_open
    assert gate.accepts(None)

    gate.clear_override()
    assert not gate.is_open


def test_override_can_lock_a_board_the_environment_left_open():
    gate = ViewGate("")
    gate.set_override("late-decision")
    assert not gate.is_open
    assert gate.accepts("late-decision")
