"""Opponent strength presets.

Stockfish's UCI_Elo only goes down to 1320, so the two weakest levels use
Skill Level 0 with a shallow search instead. All ratings are rough guides.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import chess.engine


@dataclass(frozen=True)
class Level:
    id: str
    name: str
    elo: int
    description: str
    options: dict[str, int | bool] = field(repr=False)
    limit: chess.engine.Limit = field(repr=False)


def _skill(skill: int) -> dict[str, int | bool]:
    return {"UCI_LimitStrength": False, "Skill Level": skill}


def _elo(elo: int) -> dict[str, int | bool]:
    return {"UCI_LimitStrength": True, "UCI_Elo": elo}


LEVELS: tuple[Level, ...] = (
    Level("beginner", "Beginner", 800, "Hangs pieces and misses simple threats.",
          _skill(0), chess.engine.Limit(depth=1, time=0.2)),
    Level("novice", "Novice", 1100, "Knows the basics but misses most tactics.",
          _skill(0), chess.engine.Limit(depth=4, time=0.3)),
    Level("casual", "Casual", 1400, "A solid casual player.",
          _elo(1400), chess.engine.Limit(time=0.5)),
    Level("club", "Club", 1700, "A typical club player.",
          _elo(1700), chess.engine.Limit(time=0.5)),
    Level("strong", "Strong club", 2000, "Punishes most mistakes.",
          _elo(2000), chess.engine.Limit(time=0.7)),
    Level("expert", "Expert", 2400, "Master-level play.",
          _elo(2400), chess.engine.Limit(time=1.0)),
    Level("max", "Stockfish", 3200, "Full strength. Good luck.",
          _skill(20), chess.engine.Limit(time=1.0)),
)

LEVELS_BY_ID = {level.id: level for level in LEVELS}
DEFAULT_LEVEL = "casual"
