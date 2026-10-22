"""A plain-language fact sheet about one move, for Claude to explain.

Claude can't see the board and shouldn't work out chess on its own, so
everything it might want to mention is computed here: what the move does,
what it threatens, the engine's lines spelled out move by move, and which
pieces are left loose. Anything the student shouldn't be told yet (the
best move, when they're about to try again) is left out entirely rather
than marked secret.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess
import chess.engine

from .engine import Analysis, Line
from .grading import MATERIAL_HORIZON, PIECE_VALUES, Eval, MoveGrade, material_change, numbered_san, win_percent

PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
    chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
}

GRADE_LABELS = {
    "forced": "Forced (the only legal move)",
    "best": "Best move (the engine's top choice)",
    "great": "Great move (the only move that keeps the position; every alternative was much worse)",
    "excellent": "Excellent (almost as good as the engine's top choice)",
    "good": "Good (a little weaker than the engine's top choice)",
    "inaccuracy": "Inaccuracy",
    "mistake": "Mistake",
    "miss": "Missed win (a much stronger move was available)",
    "blunder": "Blunder",
}

# Lines are spelled out this many plies deep.
LINE_PLIES = 6
# A threat must win at least this much material (or force mate) to be worth mentioning.
THREAT_MIN_MATERIAL = 1


def color_name(color: chess.Color) -> str:
    return "White" if color == chess.WHITE else "Black"


def piece_label(board: chess.Board, square: chess.Square) -> str:
    """'Black queen on d8'."""
    piece = board.piece_at(square)
    return f"{color_name(piece.color)} {PIECE_NAMES[piece.piece_type]} on {chess.square_name(square)}"


def describe_move(board: chess.Board, move: chess.Move) -> str:
    """'White knight g1 to f3' or 'Black pawn on d5 takes White pawn on e4, check'."""
    mover = color_name(board.turn)
    if board.is_castling(move):
        text = f"{mover} castles {'kingside' if board.is_kingside_castling(move) else 'queenside'}"
    else:
        name = PIECE_NAMES[board.piece_type_at(move.from_square)]
        start, end = chess.square_name(move.from_square), chess.square_name(move.to_square)
        if board.is_en_passant(move):
            text = f"{mover} pawn on {start} takes a pawn en passant, landing on {end}"
        elif board.is_capture(move):
            text = f"{mover} {name} on {start} takes {piece_label(board, move.to_square)}"
        else:
            text = f"{mover} {name} {start} to {end}"
    if move.promotion:
        text += f", promoting to a {PIECE_NAMES[move.promotion]}"
    after = board.copy(stack=False)
    after.push(move)
    if after.is_checkmate():
        text += ", checkmate"
    elif after.is_check():
        text += ", check"
    return text


def describe_line(board: chess.Board, moves: tuple[chess.Move, ...], plies: int = LINE_PLIES) -> str:
    """A line as numbered SAN with each move spelled out: '5.Nxf7 (White knight on g5 takes ...); 5...Qe7 (...)'."""
    b = board.copy(stack=False)
    parts = []
    for move in moves[:plies]:
        parts.append(f"{numbered_san(b, move)} ({describe_move(b, move)})")
        b.push(move)
    return "; ".join(parts)


def piece_list(board: chess.Board, color: chess.Color) -> str:
    order = (chess.KING, chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN)
    parts = []
    for piece_type in order:
        squares = sorted(chess.square_name(sq) for sq in board.pieces(piece_type, color))
        if squares:
            parts.append(f"{PIECE_NAMES[piece_type]} {', '.join(squares)}")
    return f"{color_name(color)}: " + "; ".join(parts)


def loose_pieces(board: chess.Board, color: chess.Color) -> list[str]:
    """`color`'s pieces that are attacked and either undefended or attacked by something cheaper."""
    found = []
    for square, piece in sorted(board.piece_map().items()):
        if piece.color != color or piece.piece_type == chess.KING:
            continue
        attackers = board.attackers(not color, square)
        if not attackers:
            continue
        defenders = board.attackers(color, square)
        # A king can only capture undefended pieces.
        capturers = [a for a in attackers if board.piece_type_at(a) != chess.KING or not defenders]
        if not capturers:
            continue
        cheapest = min(PIECE_VALUES.get(board.piece_type_at(a), 0) for a in capturers)
        if defenders and cheapest >= PIECE_VALUES[piece.piece_type]:
            continue
        by = ", ".join(piece_label(board, a) for a in sorted(capturers))
        status = "undefended" if not defenders else "defended, but attacked by a cheaper piece"
        found.append(f"{piece_label(board, square)} ({status}; attacked by {by})")
    return found


def attacked_by(board: chess.Board, square: chess.Square) -> list[str]:
    """Enemy pieces the piece on `square` attacks."""
    piece = board.piece_at(square)
    targets = [t for t in board.attacks(square) if (p := board.piece_at(t)) and p.color != piece.color]
    return [piece_label(board, t) for t in sorted(targets)]


def format_eval(ev: Eval) -> str:
    if ev.mate == 0:
        return "checkmate on the board"
    if ev.mate is not None:
        side = "White" if ev.mate > 0 else "Black"
        return f"{side} forces mate in {abs(ev.mate)}"
    pawns = (ev.cp or 0) / 100
    return f"{pawns:+.1f} pawns for White"


def material_phrase(color: chess.Color, change: int) -> str:
    who = color_name(color)
    if change > 0:
        return f"{who} gains {change} point{'s' if change != 1 else ''} of material compared with now (pawn = 1)"
    if change < 0:
        return f"{who} loses {-change} point{'s' if change != -1 else ''} of material compared with now (pawn = 1)"
    return "the material balance doesn't change"


def describe_threat(board_after: chess.Board, threat: Line | None) -> str | None:
    """What the side that just moved would do next if left alone, when it's a real threat."""
    if threat is None:
        return None
    mover = not board_after.turn
    probe = board_after.copy(stack=False)
    probe.push(chess.Move.null())
    mate = threat.score.mate()
    if mate is not None and mate > 0:
        outcome = f"forcing checkmate in {mate}"
    else:
        gain = material_change(probe, threat.pv, mover)
        if gain < THREAT_MIN_MATERIAL:
            return None
        outcome = f"winning about {gain} point{'s' if gain != 1 else ''} of material"
    return (
        f"Threat: if {color_name(board_after.turn)} ignored it, {color_name(mover)} would continue "
        f"{describe_line(probe, threat.pv, plies=3)}, {outcome}."
    )


BAD_MOVES = ("inaccuracy", "mistake", "miss", "blunder")


@dataclass(frozen=True)
class Reason:
    """Why a move went wrong, worked out from the engine's line instead of left for Claude to infer.

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

    def sentence(self) -> str:
        points = f"about {self.amount} point{'s' if self.amount != 1 else ''} of material"
        return {
            "allows_mate": f"{self.move} allows the opponent to force checkmate in {self.amount}, starting with {self.reply}.",
            "hung": f"{self.move} puts the student's {self.piece} on {self.square}, where {self.reply} takes it.",
            "ignored": (
                f"The student's {self.piece} on {self.square} was already under attack from the {self.other} "
                f"before {self.move}. {self.move} did nothing about that, so {self.reply} wins it."
            ),
            "defender": (
                f"{self.move} moves the student's {self.other} away from defending the {self.piece} on "
                f"{self.square}, so {self.reply} wins it."
            ),
            "loses": f"After {self.move}, the opponent wins {points}, starting with {self.reply}.",
            "missed_mate": f"{self.move} misses a forced checkmate in {self.amount}.",
            "missed_win": (
                f"{self.move} misses a chance to win {points}." if self.amount
                else f"{self.move} misses a much stronger move that would have given the student a winning position."
            ),
            "worse": f"{self.move} lets the opponent take over the better position with {self.reply}.",
        }[self.kind]

    def facts_text(self) -> str:
        """For Claude's fact sheet."""
        return "MAIN POINT: " + self.sentence() + (f" On top of that: {self.also.sentence()}" if self.also else "")

    def coach_text(self) -> str | None:
        """For the built-in comment, when there's a specific piece to talk about."""
        return {
            "hung": f"{self.move} puts your {self.piece} on {self.square}, where {self.reply} takes it.",
            "ignored": (
                f"Your {self.piece} on {self.square} was already under attack, and {self.move} didn't deal "
                f"with it: {self.reply} wins it."
            ),
            "defender": (
                f"{self.move} moves your {self.other} away from guarding the {self.piece} on {self.square}, "
                f"so {self.reply} wins it."
            ),
        }.get(self.kind)


def _material_loss(board: chess.Board, move: chess.Move, grade: MoveGrade, line: tuple[chess.Move, ...]) -> Reason | None:
    """How the move loses material, judged by the opponent's immediate reply."""
    if grade.material_change > -1 or not line:
        return None
    mover = board.turn
    after_board = board.copy(stack=False)
    after_board.push(move)
    label = numbered_san(board, move)
    reply, reply_san = line[0], numbered_san(after_board, line[0])
    if after_board.is_capture(reply) and not after_board.is_en_passant(reply):
        square = reply.to_square
        victim = after_board.piece_at(square)
        name, where = PIECE_NAMES[victim.piece_type], chess.square_name(square)
        if square == move.to_square:
            return Reason("hung", label, reply_san, name, where)
        was_attacked = board.piece_at(square) == victim and board.is_attacked_by(not mover, square)
        if was_attacked and move.from_square in board.attackers(mover, square):
            defender = PIECE_NAMES[board.piece_type_at(move.from_square)]
            return Reason("defender", label, reply_san, name, where, other=defender)
        if was_attacked:
            attackers = sorted(board.attackers(not mover, square), key=lambda s: PIECE_VALUES.get(board.piece_type_at(s), 99))
            attacker = f"{PIECE_NAMES[board.piece_type_at(attackers[0])]} on {chess.square_name(attackers[0])}"
            return Reason("ignored", label, reply_san, name, where, other=attacker)
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


def fact_sheet(
    board: chess.Board,
    move: chess.Move,
    grade: MoveGrade,
    before: Analysis,
    after: Analysis,
    threat: Line | None,
    *,
    student_color: chess.Color,
    reveal_best: bool,
) -> str:
    """Everything Claude may say about `move`, played on `board` (the position before it)."""
    mover = board.turn
    opponent = not mover
    by_student = mover == student_color
    after_board = board.copy()
    after_board.push(move)

    lines = [
        f"The student plays {color_name(student_color)}; the computer opponent plays {color_name(not student_color)}.",
        f"This comment is about {'the student' if by_student else 'the computer opponent'}'s move.",
        "Moves so far: " + (board.root().variation_san(board.move_stack) or "(none, this is the first move)"),
        f"Position before the move (FEN): {board.fen()}",
        "Pieces before the move: " + piece_list(board, chess.WHITE) + ". " + piece_list(board, chess.BLACK) + ".",
        f"The move: {numbered_san(board, move)}: {describe_move(board, move)}.",
        f"Engine grade: {GRADE_LABELS[grade.classification]}.",
    ]
    # Why the student's move went wrong. Not for the opponent's moves: that would point at the student's answer.
    if by_student and (reason := why_bad(board, move, grade, after.best.pv if after.best else ())) is not None:
        lines.append(reason.facts_text())
    lines += [
        (
            f"Engine evaluation: {format_eval(Eval.from_white_score(before.white_score()))} before the move, "
            f"{format_eval(grade.eval_after)} after it. {color_name(mover)}'s chance of winning went from "
            f"{grade.win_before:.0f}% to {grade.win_after:.0f}%."
        ),
    ]

    if grade.delivers_mate:
        lines.append("The move is checkmate. The game is over.")
        return "\n".join(lines)
    if after_board.is_stalemate():
        lines.append("The move is stalemate, so the game is a draw.")
    elif after_board.is_insufficient_material():
        lines.append("After the move neither side has enough material to checkmate: the game is a draw.")
    elif after_board.is_repetition(3):
        lines.append("The move repeats the position a third time: the game is a draw.")

    if not board.is_castling(move):
        targets = attacked_by(after_board, move.to_square)
        if targets:
            lines.append(f"After the move, the {PIECE_NAMES[after_board.piece_type_at(move.to_square)]} on "
                         f"{chess.square_name(move.to_square)} attacks: {'; '.join(targets)}.")
    hiding_best = by_student and not reveal_best
    # What the student's move threatens is often the very idea they missed, so it's hidden along with the best move.
    if not hiding_best and (threat_text := describe_threat(after_board, threat)) is not None:
        lines.append(threat_text)
    for color in (mover, opponent):
        # The opponent's loose pieces can point straight at the move the student is about to look for.
        if color == opponent and hiding_best:
            continue
        if loose := loose_pieces(after_board, color):
            lines.append(f"Loose {color_name(color)} pieces after the move: {'; '.join(loose)}.")
    if grade.allows_mate_in:
        lines.append(f"The move allows {color_name(opponent)} to force checkmate in {grade.allows_mate_in}.")

    if by_student:
        lines += _student_move_facts(board, after_board, grade, before, after, reveal_best)
    else:
        lines += _opponent_move_facts(after_board, grade, after)
    return "\n".join(lines)


def _student_move_facts(
    board: chess.Board, after_board: chess.Board, grade: MoveGrade, before: Analysis, after: Analysis, reveal_best: bool
) -> list[str]:
    mover = board.turn
    facts = []
    if after.best is not None:
        reply_line = describe_line(after_board, after.best.pv)
        facts.append(
            f"The opponent's best reply and the engine's main line after it: {reply_line}. "
            f"Over the first few moves of this line, {material_phrase(mover, grade.material_change)}."
        )
    if grade.classification in ("best", "great", "forced"):
        if grade.classification == "great" and len(before.lines) > 1:
            second = before.lines[1]
            facts.append(
                f"The next-best alternative, {numbered_san(board, second.move)}, would have dropped "
                f"{color_name(mover)}'s winning chances to {win_percent(second.score):.0f}%."
            )
        return facts
    best = before.best
    if best is None:
        return facts
    if reveal_best:
        facts.append(
            f"The engine's preferred move was {numbered_san(board, best.move)} ({describe_move(board, best.move)}). "
            f"Its main line: {describe_line(board, best.pv)}. Over that line, "
            f"{material_phrase(mover, grade.best_material_change)}."
        )
        if grade.missed_mate_in:
            facts.append(f"The preferred move forces checkmate in {grade.missed_mate_in}.")
    else:
        facts.append("The student will now get the chance to take the move back and look for a better one.")
        if grade.missed_mate_in:
            facts.append(f"There was a forced checkmate in {grade.missed_mate_in} available.")
        elif grade.best_material_change >= 1:
            facts.append(f"There was a way to win about {grade.best_material_change} points of material.")
        else:
            facts.append(f"A better move would have kept {color_name(mover)}'s winning chances at about {grade.win_before:.0f}%.")
    return facts


def _opponent_move_facts(after_board: chess.Board, grade: MoveGrade, after: Analysis) -> list[str]:
    student = after_board.turn
    facts = []
    if grade.classification in ("mistake", "blunder", "miss", "inaccuracy") and after.best is not None:
        # The student's best answer stays hidden: finding it is their job. Only say how big the chance is.
        mate = after.score.mate()
        if mate is not None and mate > 0:
            facts.append(f"{color_name(student)} (the student) now has a forced checkmate in {mate}.")
        else:
            gain = material_change(after_board, after.best.pv, student)
            if gain >= 1:
                facts.append(f"{color_name(student)} (the student) now has a way to win about {gain} points of material.")
            facts.append(f"The student's chance of winning is now {100 - grade.win_after:.0f}%.")
        facts.append("The student's best reply is deliberately not given here: they should find it themselves.")
    return facts
