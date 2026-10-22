"""What the engine's lines mean, in words: why a move went wrong, and whether a threat is real.

The coach's comments only ever restate what's worked out here from Stockfish's analysis.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .engine import Line
from .grading import MATERIAL_HORIZON, PIECE_VALUES, MoveGrade, material_change, numbered_san

PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
    chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
}

# A threat must win at least this much material (or force mate) to count.
THREAT_MIN_MATERIAL = 1


def real_threat(board: chess.Board, threat: Line | None) -> bool:
    """Whether the opponent's threat (EngineService.threat, with the student to move on `board`) forces
    mate or wins material, rather than just being the opponent's best quiet move."""
    if threat is None:
        return False
    mate = threat.score.mate()
    if mate is not None and mate > 0:
        return True
    probe = board.copy(stack=False)
    probe.push(chess.Move.null())
    return material_change(probe, threat.pv, not board.turn) >= THREAT_MIN_MATERIAL


BAD_MOVES = ("inaccuracy", "mistake", "miss", "blunder")


@dataclass(frozen=True)
class Reason:
    """Why a move went wrong, worked out from the engine's line.

    kind: "allows_mate", "hung" (the opponent can take the piece that just moved), "ignored" (a piece
    was already under attack and the move did nothing about it), "defender" (the move took away a
    piece's defender), "loses" (material goes some other way), "missed_mate", "missed_win" or "worse".
    """

    kind: str
    move: str  # numbered SAN of the move, e.g. "3.d3"
    reply: str | None = None  # numbered SAN of the opponent's key reply, e.g. "3...Nxh5"
    piece: str | None = None  # the piece that's lost, e.g. "queen"
    square: str | None = None
    other: str | None = None  # "ignored": the attacker; "defender": the piece that moved away
    amount: int = 0  # moves to mate, or points of material
    also: Reason | None = None  # a second problem with the same move (a missed mate that also loses material)
    lead_in: str | None = None  # moves before the reply, e.g. a queen trade: "10...Qxd1 11.Raxd1"

    def _then(self, verb: str) -> str:
        """'3...Nxh5 wins it', or 'after 10...Qxd1 11.Raxd1, 11...Nxa4 wins it'."""
        return (f"after {self.lead_in}, " if self.lead_in else "") + f"{self.reply} {verb} it"

    def coach_text(self) -> str | None:
        """For the built-in comment, when there's a specific piece to talk about."""
        return {
            "hung": f"{self.move} puts your {self.piece} on {self.square}, and {self._then('takes')}.",
            "ignored": (
                f"Your {self.piece} on {self.square} was already under attack, and {self.move} didn't deal "
                f"with it, so {self._then('wins')}."
            ),
            "defender": (
                f"{self.move} moves your {self.other} away from guarding the {self.piece} on {self.square}, "
                f"so {self._then('wins')}."
            ),
        }.get(self.kind)


def _losing_capture(after_board: chess.Board, line: tuple[chess.Move, ...], mover: chess.Color) -> int | None:
    """Index in `line` of the first capture of one of `mover`'s pieces that actually costs material.

    A capture answered by an equal or bigger recapture (a queen trade, say) is skipped: the loss is
    whatever comes after it.
    """
    moves = line[:MATERIAL_HORIZON]
    b = after_board.copy(stack=False)
    for i, m in enumerate(moves):
        if b.turn != mover and b.is_capture(m) and not b.is_en_passant(m):
            taken = PIECE_VALUES[b.piece_type_at(m.to_square)]
            taker = PIECE_VALUES.get(b.piece_type_at(m.from_square), 100)  # a king can't be recaptured
            following = moves[i + 1] if i + 1 < len(moves) else None
            b.push(m)
            recaptured = following is not None and following.to_square == m.to_square and b.is_capture(following)
            if not recaptured or taker < taken:
                return i
            continue
        b.push(m)
    return None


def _material_loss(board: chess.Board, move: chess.Move, grade: MoveGrade, line: tuple[chess.Move, ...]) -> Reason | None:
    """How the move loses material: the piece the opponent wins, and how that relates to the move."""
    if grade.material_change > -1 or not line:
        return None
    mover = board.turn
    after_board = board.copy(stack=False)
    after_board.push(move)
    label = numbered_san(board, move)
    i = _losing_capture(after_board, line, mover)
    if i is None:
        return Reason("loses", label, numbered_san(after_board, line[0]), amount=-grade.material_change)

    # Play the line up to the capture; anything before it (a trade, a check) is mentioned as a lead-in.
    b = after_board.copy(stack=False)
    lead_in = []
    for m in line[:i]:
        lead_in.append(numbered_san(b, m))
        b.push(m)
    capture = line[i]
    square = capture.to_square
    victim = b.piece_at(square)
    reply_san = numbered_san(b, capture)
    lead = " ".join(lead_in) or None
    name, where = PIECE_NAMES[victim.piece_type], chess.square_name(square)
    # Has the piece stayed put since the student's move? Only then is it "the piece the move left there".
    unmoved = all(m.from_square != square for m in line[:i])
    if square == move.to_square and unmoved:
        return Reason("hung", label, reply_san, name, where, lead_in=lead)
    was_attacked = unmoved and board.piece_at(square) == victim and board.is_attacked_by(not mover, square)
    if was_attacked and move.from_square in board.attackers(mover, square):
        defender = PIECE_NAMES[board.piece_type_at(move.from_square)]
        return Reason("defender", label, reply_san, name, where, other=defender, lead_in=lead)
    if was_attacked:
        attackers = sorted(board.attackers(not mover, square), key=lambda s: PIECE_VALUES.get(board.piece_type_at(s), 99))
        attacker = f"{PIECE_NAMES[board.piece_type_at(attackers[0])]} on {chess.square_name(attackers[0])}"
        return Reason("ignored", label, reply_san, name, where, other=attacker, lead_in=lead)
    return Reason("loses", label, reply_san, amount=-grade.material_change)


def why_bad(board: chess.Board, move: chess.Move, grade: MoveGrade, line: tuple[chess.Move, ...]) -> Reason | None:
    """The reason the move on `board` is an inaccuracy, mistake, miss or blunder (None for other moves).
    `line` is the opponent's best continuation after it."""
    if grade.classification not in BAD_MOVES:
        return None
    after_board = board.copy(stack=False)
    after_board.push(move)
    label = numbered_san(board, move)
    reply = numbered_san(after_board, line[0]) if line else None

    if grade.allows_mate_in:
        return Reason("allows_mate", label, reply, amount=grade.allows_mate_in)
    loss = _material_loss(board, move, grade, line)
    if grade.missed_mate_in:
        return Reason("missed_mate", label, amount=grade.missed_mate_in, also=loss)
    if loss is not None:
        return loss
    if grade.classification == "miss":
        return Reason("missed_win", label, amount=max(0, grade.best_material_change))
    return Reason("worse", label, reply)
