"""Stockfish processes: one analyses at full strength, the other plays as the opponent."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from dataclasses import dataclass

import chess
import chess.engine

from .config import Settings
from .levels import Level


@dataclass(frozen=True)
class Line:
    """One candidate move with the engine's evaluation and main line."""

    score: chess.engine.Score  # from the point of view of the side to move
    pv: tuple[chess.Move, ...]  # starts with the candidate move itself

    @property
    def move(self) -> chess.Move:
        return self.pv[0]


@dataclass(frozen=True)
class Analysis:
    """The engine's verdict on a position. `lines` is best-first and empty when the game is over."""

    turn: chess.Color
    score: chess.engine.Score  # side to move's point of view, assuming best play
    lines: tuple[Line, ...]

    @property
    def best(self) -> Line | None:
        return self.lines[0] if self.lines else None

    def line_for(self, move: chess.Move) -> Line | None:
        return next((line for line in self.lines if line.move == move), None)

    def white_score(self) -> chess.engine.Score:
        return chess.engine.PovScore(self.score, self.turn).white()


# Threats only need a quick look; they're context for the explanation, not part of the grade.
THREAT_DEPTH = 14


def _position_key(board: chess.Board) -> str:
    # The move history matters, not just the FEN: it decides repetition draws.
    return board.root().fen() + "|" + " ".join(move.uci() for move in board.move_stack)


class EngineService:
    CACHE_SIZE = 2048

    def __init__(self, settings: Settings):
        self.settings = settings
        self._analyser: chess.engine.UciProtocol | None = None
        self._player: chess.engine.UciProtocol | None = None
        self._analyse_lock = asyncio.Lock()
        self._play_lock = asyncio.Lock()
        self._cache: OrderedDict[str, Analysis] = OrderedDict()

    @property
    def name(self) -> str:
        return self._analyser.id.get("name", "Stockfish") if self._analyser else "not started"

    async def start(self) -> None:
        _, self._analyser = await chess.engine.popen_uci(self.settings.stockfish_path)
        await self._analyser.configure(
            {"Threads": self.settings.analysis_threads, "Hash": self.settings.hash_mb}
        )
        _, self._player = await chess.engine.popen_uci(self.settings.stockfish_path)
        await self._player.configure({"Threads": 2, "Hash": 64})

    async def stop(self) -> None:
        for engine in (self._analyser, self._player):
            if engine is not None:
                try:
                    await engine.quit()
                except chess.engine.EngineTerminatedError:
                    pass

    async def analyse(self, board: chess.Board) -> Analysis:
        key = _position_key(board)
        async with self._analyse_lock:
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                return cached
            analysis = await self._run_analysis(board)
            self._remember(key, analysis)
            return analysis

    def _remember(self, key: str, analysis: Analysis) -> None:
        self._cache[key] = analysis
        if len(self._cache) > self.CACHE_SIZE:
            self._cache.popitem(last=False)

    async def _run_analysis(self, board: chess.Board) -> Analysis:
        if board.is_checkmate():
            return Analysis(board.turn, chess.engine.Mate(0), ())
        if board.is_game_over():  # stalemate, insufficient material, 75-move rule, fivefold repetition
            return Analysis(board.turn, chess.engine.Cp(0), ())

        limit = chess.engine.Limit(
            depth=self.settings.analysis_depth, time=self.settings.analysis_time
        )
        infos = await self._analyser.analyse(board, limit, multipv=self.settings.analysis_lines)
        lines = tuple(
            Line(info["score"].pov(board.turn), tuple(info["pv"]))
            for info in infos
            if info.get("pv") and "score" in info
        )
        if not lines:
            raise RuntimeError(f"Engine returned no analysis for {board.fen()}")
        return Analysis(board.turn, lines[0].score, lines)

    async def threat(self, board: chess.Board) -> Line | None:
        """What the side that just moved would play if it could move again (a null-move search).

        None when the side to move is in check (passing would be illegal) or the game is over.
        """
        if board.is_check() or board.is_game_over():
            return None
        key = "threat|" + _position_key(board)
        async with self._analyse_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key].best
            passed = board.copy(stack=False)
            passed.push(chess.Move.null())
            # Engines don't accept null moves in a move list, so search the resulting FEN instead.
            probe = chess.Board(passed.fen())
            limit = chess.engine.Limit(depth=THREAT_DEPTH, time=self.settings.analysis_time)
            info = await self._analyser.analyse(probe, limit)
            pv = tuple(info.get("pv") or ())
            lines = (Line(info["score"].pov(probe.turn), pv),) if pv and "score" in info else ()
            self._remember(key, Analysis(probe.turn, lines[0].score if lines else chess.engine.Cp(0), lines))
            return lines[0] if lines else None

    async def play(self, board: chess.Board, level: Level) -> chess.Move:
        async with self._play_lock:
            result = await self._player.play(board, level.limit, options=level.options)
        if result.move is None:
            raise RuntimeError(f"Engine returned no move for {board.fen()}")
        return result.move
