"""Hints for the student's move, from the engine's best line.

Each level reveals more: the idea behind the move, then the piece to move, then the move itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import chess

from .engine import Analysis, Line
from .facts import PIECE_NAMES, real_threat
from .grading import material_balance, material_change, numbered_san

if TYPE_CHECKING:
    from .guide import Plan

HINT_LEVELS = 3


@dataclass(frozen=True)
class Hint:
    """Level 1 is the idea, level 2 the piece to move (highlighted on the board), level 3 the move itself."""

    text: str
    move: str | None  # UCI of the suggested move, only at the last level (for the arrow)
    square: str | None = None  # the piece to move, from level 2 on (for the highlight)


def idea(board: chess.Board, analysis: Analysis, threat: Line | None) -> tuple[str, int]:
    """What the best line is about: ("mate", moves), ("material", points won), ("defend", 0) when it
    parries the opponent's threat, ("concede", points lost) when even the best line can't keep the
    material, or ("position", 0)."""
    mate = analysis.score.mate()
    if mate is not None and mate > 0:
        return "mate", mate
    gain = material_change(board, analysis.best.pv, board.turn)
    if gain >= 1 and gain_holds(board, analysis, gain):
        return "material", gain
    if not real_threat(board, threat):
        # Without a threat, a small loss is usually an exchange still going on where the line was cut off.
        return "position", 0
    return ("concede", -gain) if gain < 0 else ("defend", 0)


def gain_holds(board: chess.Board, analysis: Analysis, gain: int) -> bool:
    """Whether the engine's evaluation backs up a material gain along its best line: the side to move should
    be at least half the gain better off than the material on the board says.

    A capture near the end of the counted moves can look like a gain when the piece is won straight back
    just after them. After 1.f3 d5, the line 2.d4 c5 3.e4 Nc6 4.dxc5 e6 "wins" a pawn that ...Bxc5 takes
    back, and the evaluation (-0.4) shows nothing was won.
    """
    expected = material_balance(board, board.turn) + gain / 2
    return analysis.score.score(mate_score=100_000) >= expected * 100


def threatened(board: chess.Board, threat: Line | None) -> str | None:
    """'pawn on d5' when the opponent's threat starts by capturing one of the student's pieces."""
    if threat is None:
        return None
    passed = board.copy(stack=False)
    passed.push(chess.Move.null())
    target = passed.piece_at(threat.move.to_square)
    if target is None or target.color != board.turn:
        return None
    return f"{PIECE_NAMES[target.piece_type]} on {chess.square_name(threat.move.to_square)}"


def threat_answer(board: chess.Board, best: chess.Move, threat: Line | None) -> str | None:
    """How the engine's best move meets the opponent's threat: "capture" (take the attacking piece),
    "move" (move the attacked piece away), "mate", "check" (a check first), "block", "defend", or
    "ignore" (something stronger than defending). None when there's no real threat to meet.
    Without this, the coach would say "move the attacked piece" even when the answer is to take the attacker.
    """
    if not real_threat(board, threat):
        return None
    me = board.turn
    passed = board.copy(stack=False)
    passed.push(chess.Move.null())
    attacker_sq, target_sq = threat.move.from_square, threat.move.to_square
    if passed.piece_at(attacker_sq) is None:
        return None
    target = board.piece_at(target_sq)
    mine = target is not None and target.color == me
    after = board.copy(stack=False)
    after.push(best)
    if best.to_square == attacker_sq:
        return "capture"
    if mine and best.from_square == target_sq:
        return "move"
    if after.is_checkmate():
        return "mate"
    if after.is_check():
        return "check"
    if mine:
        if not after.is_attacked_by(not me, target_sq):
            return "block"
        if len(after.attackers(me, target_sq)) > len(board.attackers(me, target_sq)):
            return "defend"
    return "ignore"


def checkers(board: chess.Board) -> str:
    """The pieces giving check to the side to move: 'knight on e2'."""
    return " and ".join(f"{PIECE_NAMES[board.piece_type_at(s)]} on {chess.square_name(s)}" for s in board.checkers())


def check_answer(board: chess.Board, best: chess.Move) -> str | None:
    """When the side to move is in check, how the engine's best move gets out of it: "capture" (take
    the checking piece), "king" (move the king) or "block". None when not in check."""
    if not board.is_check():
        return None
    if best.to_square in board.checkers():
        return "capture"
    if best.from_square == board.king(board.turn):
        return "king"
    return "block"


def check_text(board: chess.Board, answer: str) -> str:
    """'Your king on g1 is in check from the knight on e2. ...' Naming both squares matters: "you're in
    check from the knight" was once read as the opponent's king being in check."""
    return f"Your king on {chess.square_name(board.king(board.turn))} is in check from the {checkers(board)}. " + (
        "Before you move the king, see whether you can capture the checking piece." if answer == "capture"
        else "Look at every way out: moving the king, blocking, or capturing."
    )


def hint(board: chess.Board, analysis: Analysis, threat: Line | None, level: int, focus: Plan | None = None) -> Hint:
    """A hint for the side to move (the student). Higher levels reveal more. `focus` is the coach's
    plan for the position (guide.plan): in quiet positions the hint points to the same priority."""
    best = analysis.best
    kind, amount = idea(board, analysis, threat)
    quiet_focus = kind == "position" and focus is not None and not focus.urgent
    answer = threat_answer(board, best.move, threat)
    in_check = check_answer(board, best.move)

    text = focus.text if quiet_focus else {
        "mate": ("There's checkmate in one here. Look at every check you can give." if amount == 1
                 else f"There's a forced checkmate in {amount} here. Start by looking at every check you can give."),
        "material": "There's a way to win material here. Look for captures, checks, and pieces you can attack twice.",
        "defend": "Your opponent is threatening something. Work out what it is before you look for your own ideas.",
        "concede": "You can't hold on to everything here. Rather than defending at all costs, look for the move "
                   "that develops a piece or improves your position the most.",
        "position": "There's no immediate tactic here. Find your least active piece and give it a better square.",
    }[kind]
    if answer == "capture" and not quiet_focus:
        text = "Something of yours is under attack. Before you move it away, see whether you can capture the attacker."
    if in_check and kind != "mate":
        text = check_text(board, in_check)

    if level >= 2:
        piece = board.piece_at(best.move.from_square)
        where = chess.square_name(best.move.from_square)
        kinds = [k for k, yes in (("a capture", board.is_capture(best.move)), ("a check", board.gives_check(best.move))) if yes]
        text = (
            "Think about castling." if board.is_castling(best.move)
            else f"Look at your {PIECE_NAMES[piece.piece_type]} on {where}."
            + (f" The move is {' and '.join(kinds)}." if kinds else "")
        )

    move = None
    square = chess.square_name(best.move.from_square) if level >= 2 else None
    if level >= HINT_LEVELS:
        move = best.move.uci()
        why = {
            "mate": f" It forces checkmate in {amount}." if amount > 1 else " It's checkmate.",
            "material": f" It wins about {amount} point{'s' if amount != 1 else ''} of material.",
            "defend": " It deals with your opponent's threat.",
            "concede": " It gives some material back, but improves your position the most.",
            "position": " It's the best way to improve your position.",
        }[kind]
        if in_check == "capture" and kind != "mate":
            why = " It gets you out of check by taking the checking piece."
        elif answer == "capture" and kind in ("defend", "position"):
            why = " It takes the piece that was attacking you."
        text = f"The engine's move is {numbered_san(board, best.move)}.{why}"

    return Hint(text, move, square)
