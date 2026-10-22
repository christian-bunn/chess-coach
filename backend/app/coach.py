"""Short, template-based coach comments built from a MoveGrade.

These are placeholders until the explanations come from Claude: they only
ever restate facts the engine produced, which is also the rule the LLM will follow.
"""

from __future__ import annotations

import chess

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


def describe_user_move(grade: MoveGrade, board: chess.Board) -> str:
    """Comment on the user's move. `board` is the position before it was played."""
    c = grade.classification
    if c == "forced":
        return "That was your only legal move."
    if grade.delivers_mate:
        return "Checkmate! Well played."
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
                f"{grade.missed_mate_in} starting with {grade.best_san}."
            )
        return "Excellent move."
    if c == "good":
        return f"Good move. {grade.best_san} was a little stronger."
    if c == "inaccuracy":
        return " ".join(filter(None, ["Inaccuracy.", _why_bad(grade, board), f"{grade.best_san} was better."]))
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
    return " ".join(filter(None, [label, missed, _why_bad(grade, board)]))


def describe_opponent_move(grade: MoveGrade) -> str | None:
    """A nudge after the bot's move, only when there's something for the user to find."""
    if grade.allows_mate_in:
        return "Your opponent just blundered. There's a forced checkmate for you here. Can you find it?"
    if grade.classification == "blunder":
        return "Your opponent just blundered! Look carefully: there's a way to punish it."
    if grade.classification == "mistake":
        return "Your opponent's last move was a mistake. See if you can take advantage."
    return None
