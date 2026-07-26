"""Parsing for the class roster: `組別,姓名,username`.

One format, two entry points — the file the server reads at boot and the paste
box in the console — so a line that works in one always works in the other.
"""

from __future__ import annotations

import csv
import io
import logging
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional, Tuple

if TYPE_CHECKING:  # pragma: no cover
    from .state import ContestEngine

log = logging.getLogger("gdg.roster")

RosterRow = Tuple[str, str, Optional[int]]

FORMAT_HINT = "組別,姓名,username"

_HEADER_FIRST_CELL = {"組別", "group", "group_id", "team"}


def parse_roster(text: str, *, max_group: int = 6) -> Tuple[List[RosterRow], List[str]]:
    """Return (rows, errors). Rows are `(username, nickname, group_id)` — the
    order the engine wants, not the order humans type.

    An empty group cell is allowed and means "unassigned": on import that
    leaves whatever team the student is already in alone, so a partial list is
    never destructive.
    """
    rows: List[RosterRow] = []
    errors: List[str] = []

    for idx, raw in enumerate(csv.reader(io.StringIO(text)), start=1):
        cells = [c.strip() for c in raw if c is not None]
        if not cells or not any(cells) or cells[0].startswith("#"):
            continue
        if cells[0] in _HEADER_FIRST_CELL:
            continue
        if len(cells) < 3 or not cells[1] or not cells[2]:
            errors.append(f"第 {idx} 行：需要 `{FORMAT_HINT}`")
            continue

        group_id: Optional[int] = None
        if cells[0]:
            try:
                group_id = int(cells[0])
            except ValueError:
                errors.append(f"第 {idx} 行：組別「{cells[0]}」不是數字")
                continue
            if not 1 <= group_id <= max_group:
                errors.append(f"第 {idx} 行：組別 {group_id} 超出 1–{max_group}")
                continue

        rows.append((cells[2], cells[1], group_id))

    seen: dict[str, int] = {}
    unique: List[RosterRow] = []
    for username, nickname, group_id in rows:
        key = username.lower()
        if key in seen:
            # Later line wins, but say so — a duplicated handle is nearly always
            # two different students, one of whom would silently vanish.
            errors.append(f"username「{username}」重複，採用最後一筆")
            unique[seen[key]] = (username, nickname, group_id)
            continue
        seen[key] = len(unique)
        unique.append((username, nickname, group_id))

    return unique, errors


async def load_roster_file(engine: "ContestEngine", path: Path, *, max_group: int = 6) -> None:
    """Make the live roster match the file, then log what moved.

    Called once at boot. Students the file no longer lists are removed along
    with their scores, which is the point — the file is the class list. Two
    guards keep that from being a footgun: a missing file is a no-op, and a
    file that yields no usable rows is treated as a mistake rather than as an
    instruction to empty the room.
    """
    if not path.exists():
        log.info("No roster file at %s — leaving the existing roster alone.", path)
        return

    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        log.error("Could not read roster file %s: %s", path, exc)
        return

    rows, errors = parse_roster(text, max_group=max_group)
    for message in errors:
        log.error("roster %s: %s", path.name, message)

    if not rows:
        log.error(
            "Roster file %s produced no usable rows (%d problem lines). Refusing "
            "to apply it — the current roster stays as it is.",
            path,
            len(errors),
        )
        return

    listed = {username.lower() for username, _, _ in rows}
    stale = [u for u in engine.contest.participants if u.lower() not in listed]

    created, updated, upsert_errors, _ = await engine.upsert_participants(rows)
    for message in upsert_errors:
        log.error("roster %s: %s", path.name, message)

    for username in stale:
        await engine.remove_participant(username)

    log.info(
        "Roster synced from %s: %d listed, %d added, %d updated, %d removed%s",
        path,
        len(rows),
        created,
        updated,
        len(stale),
        f" ({', '.join(stale)})" if stale else "",
    )
