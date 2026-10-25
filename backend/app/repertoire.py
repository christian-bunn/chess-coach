"""The student's opening repertoire, reviewed with spaced repetition.

An opening is added with the side the student plays, and is due straight away so it can be learned. Each
completed practice run of a due opening is a review: played without a mistake, it comes back later than last
time (a day, then 3 days, a week, two weeks, ...); with any mistake, it comes back the next day. Practising one
that isn't due doesn't change its schedule. Kept as JSON in the progress folder (git-ignored), like the puzzles.
"""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .puzzles import INTERVALS, MASTERED_STREAK


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="seconds")


@dataclass
class Entry:
    id: str
    name: str
    eco: str
    moves: list[str]  # the opening's line from the start (UCI)
    side: str  # the side the student plays, "white" or "black"
    added: str  # ISO times, UTC
    due: str
    streak: int = 0  # reviews in a row without a mistake
    reviews: int = 0
    lapses: int = 0
    last_mistakes: int | None = None  # in the last review


class RepertoireStore:
    def __init__(self, path: Path, clock=lambda: datetime.now(UTC)):
        self.path = path
        self.clock = clock
        self._entries: dict[str, Entry] = {}
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            self._entries = {e["id"]: Entry(**e) for e in data.get("entries", [])}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "entries": [asdict(e) for e in self._entries.values()]}, indent=1))
        os.replace(tmp, self.path)  # all or nothing, so a crash can't leave half a file

    def add(self, name: str, eco: str, moves: list[str], side: str) -> Entry:
        """Add an opening, due now. Adding the same line for the same side again returns the one already there."""
        for entry in self._entries.values():
            if entry.moves == moves and entry.side == side:
                return entry
        now = _iso(self.clock())
        entry = Entry(secrets.token_hex(6), name, eco, moves, side, added=now, due=now)
        self._entries[entry.id] = entry
        self._save()
        return entry

    def get(self, eid: str) -> Entry | None:
        return self._entries.get(eid)

    def list(self) -> list[Entry]:
        """Every opening in the repertoire, the soonest due (or longest overdue) first."""
        return sorted(self._entries.values(), key=lambda e: e.due)

    def review(self, eid: str, mistakes: int) -> tuple[Entry, bool] | None:
        """Record a completed practice run. Only a due opening's run counts as a review: returns the entry, and
        whether it counted."""
        entry = self._entries.get(eid)
        if entry is None:
            return None
        if entry.due > _iso(self.clock()):
            return entry, False
        entry.reviews += 1
        entry.last_mistakes = mistakes
        if mistakes == 0:
            entry.streak += 1
            days = INTERVALS[min(entry.streak - 1, len(INTERVALS) - 1)]
        else:
            entry.streak = 0
            entry.lapses += 1
            days = INTERVALS[0]
        entry.due = _iso(self.clock() + timedelta(days=days))
        self._save()
        return entry, True

    def remove(self, eid: str) -> bool:
        if self._entries.pop(eid, None) is None:
            return False
        self._save()
        return True

    def summary(self) -> dict:
        now = _iso(self.clock())
        return {
            "total": len(self._entries),
            "due": sum(e.due <= now for e in self._entries.values()),
            "mastered": sum(e.streak >= MASTERED_STREAK for e in self._entries.values()),
        }
