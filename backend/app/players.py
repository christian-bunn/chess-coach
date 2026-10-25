"""Each player's progress (puzzles, saved games and repertoire), kept apart.

The page sends the name of whoever is playing with every request (the X-Player header). A name isn't a
password: this is for friends sharing one server, so typing someone's name opens their progress. Each player's
files go in progress/players/<id>/, where the id is the name in lower case with anything but letters and digits
turned into dashes ("Christian Bunn" -> "christian-bunn").
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .games import GameStore
from .puzzles import PuzzleStore
from .repertoire import RepertoireStore

MAX_ID = 32


def player_id(name: str) -> str | None:
    """The folder name for a player's progress, or None if the name has no letters or digits."""
    pid = re.sub(r"[\W_]+", "-", name.strip().lower()).strip("-")[:MAX_ID].strip("-")
    return pid or None


@dataclass
class Progress:
    puzzles: PuzzleStore
    games: GameStore
    repertoire: RepertoireStore


class Players:
    def __init__(self, progress_dir: Path):
        self.root = progress_dir / "players"
        self._open: dict[str, Progress] = {}

    def progress(self, pid: str) -> Progress:
        """Player `pid`'s progress (an id from player_id), loaded the first time it's asked for."""
        if pid not in self._open:
            folder = self.root / pid
            self._open[pid] = Progress(
                PuzzleStore(folder / "puzzles.json"),
                GameStore(folder / "games.json"),
                RepertoireStore(folder / "repertoire.json"),
            )
        return self._open[pid]
