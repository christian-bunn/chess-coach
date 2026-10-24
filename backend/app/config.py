"""Runtime settings, read from environment variables."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def load_env_file(path: Path = PROJECT_ROOT / ".env") -> None:
    """Read KEY=value lines from the project's .env (if any) into the environment.

    Variables that are already set win, so the shell can still override the file.
    """
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


def find_stockfish() -> str:
    """Locate a Stockfish binary: $STOCKFISH_PATH, then PATH, then the apt location, then ./engine."""
    candidates = [
        os.environ.get("STOCKFISH_PATH"),
        shutil.which("stockfish"),
        "/usr/games/stockfish",
        str(PROJECT_ROOT / "engine" / "stockfish"),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError(
        "Stockfish not found. Install it with `sudo apt install stockfish`, "
        "or set STOCKFISH_PATH to the binary."
    )


@dataclass(frozen=True)
class Settings:
    stockfish_path: str
    analysis_depth: int
    analysis_time: float  # seconds; caps the depth search on slow machines
    analysis_lines: int  # MultiPV: how many candidate moves to evaluate per position
    analysis_threads: int
    hash_mb: int
    voices_dir: Path | None  # Piper voice models for the coach's speech; None turns speech off
    progress_dir: Path  # the student's own data, such as their puzzles (git-ignored)

    @classmethod
    def from_env(cls) -> Settings:
        load_env_file()
        cpus = os.cpu_count() or 2
        return cls(
            stockfish_path=find_stockfish(),
            analysis_depth=int(os.environ.get("COACH_ANALYSIS_DEPTH", 18)),
            analysis_time=float(os.environ.get("COACH_ANALYSIS_TIME", 2.0)),
            analysis_lines=int(os.environ.get("COACH_ANALYSIS_LINES", 3)),
            analysis_threads=int(os.environ.get("COACH_ENGINE_THREADS", max(1, min(8, cpus // 2)))),
            hash_mb=int(os.environ.get("COACH_ENGINE_HASH_MB", 256)),
            # $COACH_VOICE=off turns the coach's voice off.
            voices_dir=None if os.environ.get("COACH_VOICE") == "off" else PROJECT_ROOT / "voices",
            progress_dir=Path(os.environ.get("COACH_PROGRESS_DIR") or PROJECT_ROOT / "progress"),
        )
