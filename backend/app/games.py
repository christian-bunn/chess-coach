"""Games the student saves from the review, to look at again later.

A saved game is the review as the page had it (every move with its grade, and the evaluations), plus a few
facts for the list: who it was against, the result, the opening and the accuracy. Kept as JSON in the
progress folder (git-ignored), like the puzzles.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import UTC, datetime
from pathlib import Path

# The fields a saved game is listed by (everything but the moves themselves).
SUMMARY_FIELDS = ("id", "saved", "moves", "color", "result", "opponent", "assistance", "opening", "accuracy",
                  "opponent_accuracy")


class GameStore:
    def __init__(self, path: Path, clock=lambda: datetime.now(UTC)):
        self.path = path
        self.clock = clock
        self._games: dict[str, dict] = {}
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            self._games = {g["id"]: g for g in data.get("games", [])}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": 1, "games": list(self._games.values())}))
        os.replace(tmp, self.path)  # all or nothing, so a crash can't leave half a file

    def add(self, snapshot: dict, **summary) -> dict:
        """Save a game. `snapshot` is the review as the page holds it; `summary` the facts it's listed by."""
        game = {
            "id": secrets.token_hex(6),
            "saved": self.clock().astimezone(UTC).isoformat(timespec="seconds"),
            "moves": len(snapshot.get("plies", [])),
            **{k: summary.get(k) for k in SUMMARY_FIELDS[3:]},
            "snapshot": snapshot,
        }
        self._games[game["id"]] = game
        self._save()
        return game

    def list(self) -> list[dict]:
        """Every saved game's summary, the newest first."""
        games = sorted(self._games.values(), key=lambda g: g["saved"], reverse=True)
        return [{k: g.get(k) for k in SUMMARY_FIELDS} for g in games]

    def get(self, gid: str) -> dict | None:
        return self._games.get(gid)

    def remove(self, gid: str) -> bool:
        if self._games.pop(gid, None) is None:
            return False
        self._save()
        return True
