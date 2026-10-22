"""Turn engine analysis into a chess.com-style grade for a single move.

Everything here is measured in "win percentage": the engine's centipawn score
mapped onto a 0-100 chance of winning (the curve Lichess uses for accuracy).
Grading on win% rather than raw centipawns means dropping a pawn when you're
already a rook up barely registers, while dropping one in an equal endgame does.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import chess
import chess.engine

from .engine import Analysis

Classification = Literal[
    "forced", "best", "great", "excellent", "good", "inaccuracy", "mistake", "miss", "blunder"
]

# Classifications where the coach offers to take the move back.
RETRY_CLASSIFICATIONS = frozenset({"mistake", "miss", "blunder"})

# Win% lost compared with the best move.
EXCELLENT_MAX_LOSS = 2.0
GOOD_MAX_LOSS = 5.0
INACCURACY_MAX_LOSS = 10.0
MISTAKE_MAX_LOSS = 20.0

# A "great" move is the best move when the next-best one is at least this much worse.
GREAT_MIN_GAP = 10.0
# Missing a forced mate this short is always flagged, even when you're still winning.
MISSED_MATE_MAX = 3
# "Miss": a winning shot was available but you played something that merely keeps you afloat.
MISS_MIN_BEST_WIN = 70.0
MISS_MIN_AFTER_WIN = 40.0

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}

# How far along a line to look when counting material won or lost (in plies).
# Short, so a loss can be pinned on the reply the coach names.
MATERIAL_HORIZON = 6
# How many moves of a line to send to the client.
LINE_LENGTH = 8


def win_percent(score: chess.engine.Score) -> float:
    """Chance of winning (0-100) for the side whose point of view `score` is from."""
    if score.is_mate():
        return 100.0 if score > chess.engine.Cp(0) else 0.0
    cp = max(-1000, min(1000, score.score()))
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def material_balance(board: chess.Board, color: chess.Color) -> int:
    return sum(
        value * (len(board.pieces(piece, color)) - len(board.pieces(piece, not color)))
        for piece, value in PIECE_VALUES.items()
    )


def material_change(board: chess.Board, moves: tuple[chess.Move, ...], color: chess.Color) -> int:
    """Net material `color` gains (in pawns) over the first moves of `moves`.

    Counted at the last quiet point within the horizon (where the line's next
    move isn't a capture), so an exchange still in progress isn't counted half-done.
    """
    b = board.copy(stack=False)
    start = material_balance(b, color)
    change = 0
    for i, move in enumerate(moves[:MATERIAL_HORIZON]):
        b.push(move)
        next_move = moves[i + 1] if i + 1 < len(moves) else None
        if next_move is None or not b.is_capture(next_move):
            change = material_balance(b, color) - start
    return change


def san_line(board: chess.Board, moves: tuple[chess.Move, ...], limit: int = LINE_LENGTH) -> list[str]:
    b = board.copy(stack=False)
    sans = []
    for move in moves[:limit]:
        sans.append(b.san(move))
        b.push(move)
    return sans


def numbered_san(board: chess.Board, move: chess.Move) -> str:
    """'14.Nf3' or '14...Nf6', for the move about to be played on `board`."""
    dots = "." if board.turn == chess.WHITE else "..."
    return f"{board.fullmove_number}{dots}{board.san(move)}"


@dataclass(frozen=True)
class Eval:
    """An evaluation from White's point of view, ready to send to the client."""

    cp: int | None  # centipawns; None when there's a forced mate
    mate: int | None  # moves until mate: positive = White mates, negative = Black mates, 0 = game over
    white_win: float

    @classmethod
    def from_white_score(cls, score: chess.engine.Score) -> Eval:
        return cls(cp=score.score(), mate=score.mate(), white_win=round(win_percent(score), 1))


@dataclass
class MoveGrade:
    ply: int  # 1 = White's first move
    color: Literal["white", "black"]
    uci: str
    san: str
    classification: Classification
    win_before: float  # mover's win% with best play before the move
    win_after: float  # mover's win% after the move actually played
    win_loss: float
    eval_after: Eval
    best_move: str | None  # UCI
    best_san: str | None
    best_line: list[str]  # SAN, starting with the best move
    refutation: list[str]  # SAN: the opponent's best continuation after the move played
    material_change: int  # mover's net material along the played line
    best_material_change: int  # mover's net material along the best line
    missed_mate_in: int | None
    allows_mate_in: int | None
    delivers_mate: bool
    retry_suggested: bool
    message: str | None = field(default=None)
    # For the opponent's moves: what the student should focus on next (see guide.plan), and whether it's
    # urgent enough (a threat, a chance) for the coach to speak up even in "key moments" mode.
    guide_topic: str | None = field(default=None)
    guide_urgent: bool = field(default=False)


def classify(
    *,
    forced: bool,
    is_best: bool,
    is_great: bool,
    loss: float,
    win_before: float,
    win_after: float,
    missed_mate_in: int | None,
) -> Classification:
    if forced:
        return "forced"
    if is_best:
        return "great" if is_great else "best"
    # A missed mate is a "miss" only if the move didn't also throw the game away.
    if (
        missed_mate_in is not None
        and missed_mate_in <= MISSED_MATE_MAX
        and win_after >= MISS_MIN_AFTER_WIN
    ):
        return "miss"
    if loss < EXCELLENT_MAX_LOSS:
        return "excellent"
    if loss < GOOD_MAX_LOSS:
        return "good"
    if loss < INACCURACY_MAX_LOSS:
        return "inaccuracy"
    if win_before >= MISS_MIN_BEST_WIN and win_after >= MISS_MIN_AFTER_WIN:
        return "miss"
    if loss < MISTAKE_MAX_LOSS:
        return "mistake"
    return "blunder"


def is_recapture(board: chess.Board, move: chess.Move) -> bool:
    """True if `move` captures on the square the opponent just moved to."""
    return bool(board.move_stack) and board.is_capture(move) and board.peek().to_square == move.to_square


def grade_move(board: chess.Board, move: chess.Move, before: Analysis, after: Analysis) -> MoveGrade:
    """Grade `move` played on `board`. `before`/`after` analyse the positions before and after it."""
    mover = board.turn
    after_board = board.copy()
    after_board.push(move)
    best = before.best
    played_line = before.line_for(move)
    delivers_mate = after_board.is_checkmate()

    # Prefer the score from the same search as the best move so the two compare fairly.
    if delivers_mate:
        played_score: chess.engine.Score = chess.engine.MateGiven
    elif played_line is not None:
        played_score = played_line.score
    else:
        played_score = -after.score

    win_before = win_percent(before.score)
    win_after = win_percent(played_score)
    is_best = best is not None and (
        move == best.move or delivers_mate or (played_line is not None and played_line.score == best.score)
    )
    loss = 0.0 if is_best else max(0.0, win_before - win_after)

    is_great = False
    if is_best and not delivers_mate and len(before.lines) > 1 and not is_recapture(board, move):
        is_great = win_percent(before.score) - win_percent(before.lines[1].score) >= GREAT_MIN_GAP

    best_mate = before.score.mate()
    played_mate = played_score.mate()
    mate_available = best_mate is not None and best_mate > 0
    still_mating = delivers_mate or (played_mate is not None and played_mate > 0)
    missed_mate_in = best_mate if mate_available and not still_mating else None
    opponent_mate = after.score.mate()
    allows_mate_in = opponent_mate if opponent_mate is not None and opponent_mate > 0 else None

    refutation = after.best.pv if after.best else ()
    classification = classify(
        forced=board.legal_moves.count() == 1,
        is_best=is_best,
        is_great=is_great,
        loss=loss,
        win_before=win_before,
        win_after=win_after,
        missed_mate_in=missed_mate_in,
    )

    return MoveGrade(
        ply=board.ply() + 1,
        color="white" if mover == chess.WHITE else "black",
        uci=move.uci(),
        san=board.san(move),
        classification=classification,
        win_before=round(win_before, 1),
        win_after=round(win_after, 1),
        win_loss=round(loss, 1),
        eval_after=Eval.from_white_score(after.white_score()),
        best_move=best.move.uci() if best else None,
        best_san=board.san(best.move) if best else None,
        best_line=san_line(board, best.pv) if best else [],
        refutation=san_line(after_board, refutation),
        material_change=material_change(board, (move, *refutation), mover),
        best_material_change=material_change(board, best.pv, mover) if best else 0,
        missed_mate_in=missed_mate_in,
        allows_mate_in=allows_mate_in,
        delivers_mate=delivers_mate,
        retry_suggested=classification in RETRY_CLASSIFICATIONS,
    )
