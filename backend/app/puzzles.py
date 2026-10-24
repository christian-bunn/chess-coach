"""Puzzles from the student's own mistakes, brought back with spaced repetition.

Every mistake, missed win and blunder in a game (and every missed mate) is saved with the position just
before it. A puzzle comes back the next day; each time it's solved at the first try the gap grows (3 days,
a week, two weeks, a month, ...), and a miss sends it back to the next day. Puzzles are kept as JSON in the
progress folder (git-ignored), so they last across games and browsers.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

# Days until a puzzle comes back, by how many times in a row it has been solved at the first try.
INTERVALS = (1, 3, 7, 14, 30, 60, 120)
# Solved this many times in a row: it's next due in a month or more.
MASTERED_STREAK = 4


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="seconds")


@dataclass
class Puzzle:
    id: str
    moves: list[str]  # the game up to the puzzle position (UCI); the student is to move
    color: str  # the student's side, "white" or "black"
    played: str  # what the student played there in the game (UCI)
    played_san: str
    best: str  # the engine's move (UCI)
    best_san: str
    grade: str  # how the game move was graded ("blunder", ...)
    comment: str | None  # the coach's comment on the game move
    opening: str | None
    created: str  # ISO times, UTC
    due: str
    streak: int = 0  # solved at the first try this many times in a row
    reviews: int = 0
    lapses: int = 0  # times it was missed (including making the same mistake again in a game)


def puzzle_id(position_key: str) -> str:
    """The same position always gets the same id, so a mistake made twice is one puzzle."""
    return hashlib.sha1(position_key.encode()).hexdigest()[:12]


class PuzzleStore:
    def __init__(self, path: Path, clock=lambda: datetime.now(UTC)):
        self.path = path
        self.clock = clock
        self._puzzles: dict[str, Puzzle] = {}
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            self._puzzles = {p["id"]: Puzzle(**p) for p in data.get("puzzles", [])}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "puzzles": [asdict(p) for p in self._puzzles.values()]}, indent=1))
        os.replace(tmp, self.path)  # all or nothing, so a crash can't leave half a file

    def _due_in(self, streak: int) -> str:
        return _iso(self.clock() + timedelta(days=INTERVALS[min(streak, len(INTERVALS) - 1)]))

    def add(self, key: str, **fields) -> Puzzle:
        """Save a mistake as a puzzle, due the next day. The same position again (the same mistake in another
        game) starts its schedule over."""
        pid = puzzle_id(key)
        if (existing := self._puzzles.get(pid)) is not None:
            existing.streak = 0
            existing.lapses += 1
            existing.due = self._due_in(0)
            existing.played, existing.played_san = fields["played"], fields["played_san"]
            existing.grade, existing.comment = fields["grade"], fields["comment"]
            self._save()
            return existing
        now = _iso(self.clock())
        puzzle = Puzzle(id=pid, created=now, due=self._due_in(0), **fields)
        self._puzzles[pid] = puzzle
        self._save()
        return puzzle

    def get(self, pid: str) -> Puzzle | None:
        return self._puzzles.get(pid)

    def all(self) -> list[Puzzle]:
        """Every puzzle, the soonest due (or longest overdue) first."""
        return sorted(self._puzzles.values(), key=lambda p: p.due)

    def next(self, early: bool = False) -> Puzzle | None:
        """The puzzle due longest ago. With `early`, the one due soonest when none is due yet."""
        now = _iso(self.clock())
        ordered = sorted(self._puzzles.values(), key=lambda p: p.due)
        due = [p for p in ordered if p.due <= now]
        if due:
            return due[0]
        return ordered[0] if early and ordered else None

    def record(self, pid: str, solved: bool) -> Puzzle | None:
        """The result of a review: solved at the first try moves it further out, anything else brings it back
        tomorrow."""
        puzzle = self._puzzles.get(pid)
        if puzzle is None:
            return None
        puzzle.reviews += 1
        if solved:
            puzzle.streak += 1
        else:
            puzzle.streak = 0
            puzzle.lapses += 1
        puzzle.due = self._due_in(puzzle.streak)
        self._save()
        return puzzle

    def remove(self, pid: str) -> bool:
        if self._puzzles.pop(pid, None) is None:
            return False
        self._save()
        return True

    def summary(self) -> dict:
        now = _iso(self.clock())
        waiting = [p.due for p in self._puzzles.values() if p.due > now]
        return {
            "total": len(self._puzzles),
            "due": sum(p.due <= now for p in self._puzzles.values()),
            "mastered": sum(p.streak >= MASTERED_STREAK for p in self._puzzles.values()),
            "next_due": min(waiting) if waiting else None,
        }
