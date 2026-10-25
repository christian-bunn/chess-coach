"""The coach's comments on the student's moves, and on the opponent's bad moves, built from a MoveGrade.

They only ever restate what the engine worked out: the grade, and for bad moves the reason
(facts.why_bad) or the engine's refutation.
"""

from __future__ import annotations

import chess

from .facts import BAD_MOVES, Reason, why_bad
from .grading import PIECE_VALUES, MoveGrade, is_recapture, numbered_san

# Messages for moves the coach offers to take back never reveal the best move,
# so "try again" stays a real puzzle. The client has a separate "show me" button.


PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook", chess.QUEEN: "queen"
}


def material_phrase(points: int) -> str:
    exact = {1: "a pawn", 2: "two pawns", 3: "a piece", 4: "a piece and a pawn", 5: "a rook", 6: "a rook and a pawn"}
    if points in exact:
        return exact[points]
    if points <= 8:
        return "a lot of material"
    if points <= 10:
        return "about a queen's worth of material"
    return "a huge amount of material"


def _standing(win: float) -> str:
    if win >= 60:
        return "keeps your advantage"
    if win >= 40:
        return "holds the balance"
    return "keeps you in the game"


def _why_bad(grade: MoveGrade, board: chess.Board) -> str:
    """Explain what the opponent gets after the move, using the engine's refutation."""
    if grade.allows_mate_in == 1:
        return "It allows checkmate in one."
    if grade.allows_mate_in:
        return f"It allows a forced checkmate in {grade.allows_mate_in}."
    if not grade.refutation:
        return ""
    after = board.copy(stack=False)
    after.push(chess.Move.from_uci(grade.uci))
    reply_move = after.parse_san(grade.refutation[0])
    reply = numbered_san(after, reply_move)
    lost = -grade.material_change
    if lost >= 1:
        captured = after.piece_at(reply_move.to_square)
        if captured and captured.color != after.turn and PIECE_VALUES[captured.piece_type] <= lost + 1:
            return f"{reply} wins your {PIECE_NAMES[captured.piece_type]}."
        return f"After {reply} you lose {material_phrase(lost)}."
    return f"Your opponent can answer {reply} and gets the better position."


def _reason(grade: MoveGrade, board: chess.Board) -> Reason | None:
    """facts.why_bad for the graded move, along the engine's refutation."""
    move = chess.Move.from_uci(grade.uci)
    b = board.copy(stack=False)
    b.push(move)
    line = []
    for san in grade.refutation:
        line.append(b.parse_san(san))
        b.push(line[-1])
    return why_bad(board, move, grade, tuple(line))


def _reason_text(grade: MoveGrade, board: chess.Board) -> str | None:
    """The specific reason from facts.why_bad, when it names a piece."""
    reason = _reason(grade, board)
    if reason is not None and reason.also is not None:
        reason = reason.also  # the missed mate is mentioned separately
    return reason.coach_text() if reason is not None else None


def _best(grade: MoveGrade, board: chess.Board) -> str:
    """The engine's move with its number ("3.d4"), so the page can show it on the board when pointed at."""
    return numbered_san(board, chess.Move.from_uci(grade.best_move)) if grade.best_move else (grade.best_san or "")


def describe_user_move(grade: MoveGrade, board: chess.Board) -> str:
    """Comment on the user's move. `board` is the position before it was played."""
    c = grade.classification
    if c == "forced":
        return "That was your only legal move."
    if grade.delivers_mate:
        return "Checkmate! Well played."
    if c == "book":
        return f"Book move. That's opening theory: the {grade.opening}." if grade.opening else "Book move."
    if c == "great":
        return f"Great move! {grade.san} was the only move that {_standing(grade.win_after)}."
    if c == "best":
        # Taking back a piece that was just captured isn't "winning" material.
        if grade.material_change >= 1 and not is_recapture(board, chess.Move.from_uci(grade.uci)):
            return f"Best move! It wins {material_phrase(grade.material_change)}."
        return "Best move. That's exactly what the engine would play."
    if c == "excellent":
        if grade.missed_mate_in:
            return (
                f"Excellent, you're still winning. There was also a forced mate in "
                f"{grade.missed_mate_in} starting with {_best(grade, board)}."
            )
        return "Excellent move."
    if c == "good":
        return f"Good move. {_best(grade, board)} was a little stronger."
    if c == "inaccuracy":
        why = _reason_text(grade, board) or _why_bad(grade, board)
        return " ".join(filter(None, ["Inaccuracy.", why, f"{_best(grade, board)} was better."]))
    if c == "miss":
        if grade.missed_mate_in == 1:
            return "You missed checkmate in one!"
        if grade.missed_mate_in:
            return f"You missed a forced checkmate in {grade.missed_mate_in}!"
        if grade.best_material_change >= 2:
            return f"Missed opportunity! There was a way to win {material_phrase(grade.best_material_change)}."
        return "Missed opportunity! There was a much stronger move here that gives you a winning position."
    label = "Mistake." if c == "mistake" else "Blunder!"
    missed = ""
    if grade.missed_mate_in == 1:
        missed = "You had checkmate in one here."
    elif grade.missed_mate_in:
        missed = f"You had a forced checkmate in {grade.missed_mate_in} here."
    return " ".join(filter(None, [label, missed, _reason_text(grade, board) or _why_bad(grade, board)]))


OPPONENT_LABELS = {
    "inaccuracy": "Inaccuracy by your opponent.",
    "mistake": "Mistake by your opponent.",
    "blunder": "Blunder by your opponent!",
    "miss": "Your opponent missed a chance!",
}


def _your_standing(win: float) -> str:
    """What the opponent's move gives the student, from their win% after it with best play."""
    if win >= 80:
        return "gives you a winning position"
    if win >= 60:
        return "gives you the better position"
    if win >= 40:
        return "lets you even things out"
    return "gives you a way back into the game"


def _your_chance(reason: Reason | None, grade: MoveGrade, board: chess.Board) -> str:
    """What the opponent's bad move gives the student, without naming the move that takes it: that's for the
    student to find (the hints can help)."""
    kind = reason.kind if reason else "worse"
    move = reason.move if reason else numbered_san(board, chess.Move.from_uci(grade.uci))
    if kind == "allows_mate":
        if reason.amount == 1:
            return f"{move} lets you checkmate in one. Can you find it?"
        return f"{move} lets you force checkmate in {reason.amount}. Can you find the first move?"
    if kind == "hung":
        return f"{move} puts their {reason.piece} on {reason.square} where you can win it. Can you find how?"
    if kind == "ignored":
        return (
            f"Their {reason.piece} on {reason.square} was already under attack, and {move} didn't deal with it. "
            "Can you win it?"
        )
    if kind == "defender":
        return f"{move} moves their {reason.other} away from guarding the {reason.piece} on {reason.square}. Can you win it?"
    if kind == "loses":
        return f"After {move} you can win {material_phrase(reason.amount)}. Can you find how?"
    if grade.classification == "inaccuracy":
        return f"{_best(grade, board)} was better for them."
    return f"{move} {_your_standing(100 - grade.win_after)}. Can you find the best move?"


def describe_opponent_move(grade: MoveGrade, board: chess.Board) -> str | None:
    """Comment on the opponent's move, for the student: only bad moves get one. `board` is the position before
    the move. What the opponent missed is named (it's in the past); what the student can do about the move isn't."""
    if grade.classification not in BAD_MOVES:
        return None
    reason = _reason(grade, board)
    parts = [OPPONENT_LABELS[grade.classification]]
    if reason is not None and reason.kind == "missed_mate":
        if reason.amount == 1:
            parts.append(f"They had checkmate in one with {_best(grade, board)}.")
        else:
            parts.append(f"They had a forced checkmate in {reason.amount}, starting with {_best(grade, board)}.")
        if reason.also is None:
            return " ".join(parts)
        reason = reason.also
    elif reason is not None and reason.kind == "missed_win":
        if reason.amount >= 2:
            parts.append(f"They could have won {material_phrase(reason.amount)} with {_best(grade, board)}.")
        else:
            parts.append(f"{_best(grade, board)} was much stronger for them.")
        return " ".join(parts)
    parts.append(_your_chance(reason, grade, board))
    return " ".join(parts)
