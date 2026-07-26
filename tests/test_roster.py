"""Roster parsing, and the boot-time sync that makes the file authoritative."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.sse import Broadcaster
from app.core.storage import ContestStore
from app.domain.models import Contest, Participant
from app.domain.roster import load_roster_file, parse_roster
from app.domain.state import ContestEngine


def _make_engine(tmp_path: Path, participants: dict[str, Participant] | None = None) -> ContestEngine:
    settings = Settings(admin_token="t", leetcode_sessions="", data_dir=tmp_path)
    store = ContestStore(settings.state_file, settings.state_backup_file)
    store._contest = Contest(participants=participants or {})
    return ContestEngine(store, Broadcaster(), settings)


# ---- parsing ----------------------------------------------------------------

def test_parses_group_name_username_in_that_order():
    rows, errors = parse_roster("1,蔡文諺,xiguawa\n4,張淮淇,Zhanghuaichi")

    assert errors == []
    assert rows == [("xiguawa", "蔡文諺", 1), ("Zhanghuaichi", "張淮淇", 4)]


def test_skips_blanks_comments_and_header():
    text = "# 這是註解\n組別,姓名,username\n\n   \n1,蔡文諺,xiguawa\n"

    rows, errors = parse_roster(text)

    assert errors == []
    assert rows == [("xiguawa", "蔡文諺", 1)]


def test_empty_group_column_means_leave_the_team_alone():
    rows, errors = parse_roster(",蔡文諺,xiguawa")

    assert errors == []
    assert rows == [("xiguawa", "蔡文諺", None)]


@pytest.mark.parametrize(
    "line",
    ["1,蔡文諺", "1,,xiguawa", "1,蔡文諺,", "7,蔡文諺,xiguawa", "甲,蔡文諺,xiguawa"],
)
def test_rejects_unusable_lines_without_dropping_them_silently(line):
    rows, errors = parse_roster(line)

    assert rows == []
    assert len(errors) == 1


def test_duplicate_handle_keeps_the_last_line_and_says_so():
    rows, errors = parse_roster("1,舊名字,xiguawa\n2,新名字,XIGUAWA")

    assert rows == [("XIGUAWA", "新名字", 2)]
    assert any("重複" in e for e in errors)


def test_real_roster_shape_parses_clean():
    text = "\n".join(f"{i % 6 + 1},學員{i},handle{i}" for i in range(51))

    rows, errors = parse_roster(text)

    assert errors == []
    assert len(rows) == 51


# ---- boot-time sync ---------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_adds_updates_and_drops_to_match_the_file(tmp_path):
    engine = _make_engine(tmp_path, {
        "stays": Participant(username="stays", nickname="舊名字", group_id=3),
        "left": Participant(username="left", nickname="退選", group_id=2),
    })
    path = tmp_path / "roster.txt"
    path.write_text("1,新名字,stays\n5,新同學,joined\n", encoding="utf-8")

    await load_roster_file(engine, path)

    assert set(engine.contest.participants) == {"stays", "joined"}
    assert engine.contest.participants["stays"].nickname == "新名字"
    assert engine.contest.participants["stays"].group_id == 1


@pytest.mark.asyncio
async def test_missing_file_leaves_the_roster_alone(tmp_path):
    engine = _make_engine(tmp_path, {"a": Participant(username="a", nickname="甲")})

    await load_roster_file(engine, tmp_path / "nope.txt")

    assert set(engine.contest.participants) == {"a"}


@pytest.mark.asyncio
async def test_a_file_with_no_usable_rows_never_empties_the_room(tmp_path):
    engine = _make_engine(tmp_path, {"a": Participant(username="a", nickname="甲")})
    path = tmp_path / "roster.txt"
    path.write_text("# 全部被註解掉了\n壞掉的行\n", encoding="utf-8")

    await load_roster_file(engine, path)

    assert set(engine.contest.participants) == {"a"}
