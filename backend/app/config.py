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


def anthropic_credentials_present() -> bool:
    """Whether the Anthropic SDK has credentials to find (it only complains at request time)."""
    env = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "ANTHROPIC_FEDERATION_RULE_ID")
    if any(os.environ.get(name) for name in env):
        return True
    # Profiles saved by `ant auth login`.
    config_dir = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "anthropic"
    return config_dir.is_dir() and any(config_dir.iterdir())


@dataclass(frozen=True)
class Settings:
    stockfish_path: str
    analysis_depth: int
    analysis_time: float  # seconds; caps the depth search on slow machines
    analysis_lines: int  # MultiPV: how many candidate moves to evaluate per position
    analysis_threads: int
    hash_mb: int
    # Who writes the comments: "auto" (an API key if there is one, else Claude Code on your plan),
    # "api", "claude-code", or "off" (the built-in templates).
    coach_ai: str
    coach_model: str | None  # None: the default for whichever of the above is used
    coach_effort: str
    voices_dir: Path | None  # Piper voice models for the coach's speech; None turns speech off
    voice: str | None  # the default voice's name; None picks one

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
            coach_ai=os.environ.get("COACH_AI", "auto"),
            coach_model=os.environ.get("COACH_MODEL") or None,
            coach_effort=os.environ.get("COACH_EFFORT", "low"),
            # $COACH_VOICE: "off", or the name of the default voice (one of the models in ./voices).
            voices_dir=None if os.environ.get("COACH_VOICE") == "off" else PROJECT_ROOT / "voices",
            voice=os.environ.get("COACH_VOICE") or None,
        )
