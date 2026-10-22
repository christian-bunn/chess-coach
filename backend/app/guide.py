"""The coach's guidance before the student moves: what matters in the position and what to aim for.

The engine's best move decides the topic (a threat to meet, a chance to take, castling, development,
and so on), but the move itself is never in the facts: guidance points the way, and the hint buttons
are there for the move.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .advice import game_header, idea, idea_fact, threatened
from .engine import Analysis, Line
from .facts import GRADE_LABELS, PIECE_NAMES, attacked_by, color_name, describe_move, describe_threat, loose_pieces
from .grading import MoveGrade, numbered_san, win_percent

# Topics the coach always speaks up about, even in "key moments" mode.
URGENT = frozenset({"check", "mate", "material", "threat", "concede"})

HOME = {
    chess.WHITE: {chess.KNIGHT: (chess.B1, chess.G1), chess.BISHOP: (chess.C1, chess.F1)},
    chess.BLACK: {chess.KNIGHT: (chess.B8, chess.G8), chess.BISHOP: (chess.C8, chess.F8)},
}
CENTER_FILES = (2, 3, 4, 5)  # c, d, e and f
VALUES = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
# Pieces (not pawns) left on the board, both sides together, at or below which it's an endgame (62 at the start).
ENDGAME_MATERIAL = 26

PRIORITIES = {
    "castle": "getting the king to safety; castling is one of the engine's top choices.",
    "develop": "developing the pieces that are still on their starting squares.",
    "center": "the fight for the center with the pawns.",
    "rooks": "activating the rooks, for example on an open file.",
    "king": "using the king actively, since it's safe enough in the endgame.",
    "passed_pawn": "pushing a passed pawn, one that no enemy pawn can stop.",
    "improve": "there's no immediate tactic, so improving the least active piece while watching the opponent's plans.",
}


def stage(board: chess.Board) -> str:
    """'opening', 'middlegame' or 'endgame'."""
    material = sum(v * len(board.pieces(p, c)) for p, v in VALUES.items() for c in chess.COLORS)
    if material <= ENDGAME_MATERIAL:
        return "endgame"
    return "opening" if board.fullmove_number <= 10 else "middlegame"


def at_home(board: chess.Board, color: chess.Color) -> list[str]:
    """`color`'s knights and bishops still on their starting squares: ['knight on b1', ...]."""
    found = []
    for piece, squares in HOME[color].items():
        for square in squares:
            p = board.piece_at(square)
            if p is not None and p.color == color and p.piece_type == piece:
                found.append(f"{PIECE_NAMES[piece]} on {chess.square_name(square)}")
    return found


def king_safety(board: chess.Board, color: chess.Color) -> str:
    square = board.king(color)
    where = chess.square_name(square)
    sides = [s for s, ok in (("kingside", board.has_kingside_castling_rights(color)),
                             ("queenside", board.has_queenside_castling_rights(color))) if ok]
    if sides:
        return f"is still on {where} and can castle {' or '.join(sides)}"
    if chess.square_file(square) in (1, 2, 6, 7) and chess.square_rank(square) in (0, 7):
        return f"is tucked away on {where}"
    return f"is on {where} and can no longer castle"


def open_files(board: chess.Board) -> list[str]:
    return [chess.FILE_NAMES[f] for f in range(8)
            if not any(chess.square_file(s) == f for s in board.pieces(chess.PAWN, chess.WHITE) | board.pieces(chess.PAWN, chess.BLACK))]


def is_passed(board: chess.Board, square: chess.Square) -> bool:
    color = board.color_at(square)
    file, rank = chess.square_file(square), chess.square_rank(square)
    ahead = range(rank + 1, 8) if color == chess.WHITE else range(0, rank)
    for s in board.pieces(chess.PAWN, not color):
        if abs(chess.square_file(s) - file) <= 1 and chess.square_rank(s) in ahead:
            return False
    return True


def standing(win: float) -> str:
    if win >= 70:
        return "clearly better"
    if win >= 55:
        return "a little better"
    if win > 45:
        return "about equal"
    if win > 30:
        return "a little worse"
    return "clearly worse"


@dataclass(frozen=True)
class Plan:
    topic: str
    priority: str  # what matters most, in a phrase ("getting the king to safety; ...")
    urgent: bool  # a threat or a chance: worth saying even in "key moments" mode
    facts: list[str]  # what matters now, without the best move
    template: str  # the built-in guidance, used when Claude isn't available


def plan(board: chess.Board, analysis: Analysis, threat: Line | None) -> Plan | None:
    """What the side to move (the student) should focus on. None when the game is over."""
    if analysis.best is None:
        return None
    me = board.turn
    best = analysis.best.move
    when = stage(board)
    threat_text = describe_threat(board, threat)
    kind, amount = idea(board, analysis, threat_text)
    target = threatened(board, threat)
    home = at_home(board, me)

    if board.is_check():
        topic = "check"
        priority = "the student is in check and must get out of it."
    elif kind != "position":
        topic = {"mate": "mate", "material": "material", "concede": "concede", "defend": "threat"}[kind]
        priority = idea_fact(kind, amount, target)
    else:
        piece = board.piece_type_at(best.from_square)
        if board.is_castling(best):
            topic = "castle"
        elif when == "opening" and piece in (chess.KNIGHT, chess.BISHOP) and best.from_square in HOME[me][piece]:
            topic = "develop"
        elif when == "opening" and piece == chess.PAWN and chess.square_file(best.from_square) in CENTER_FILES:
            topic = "center"
        elif piece == chess.ROOK and not any(chess.square_file(s) == chess.square_file(best.to_square)
                                             for s in board.pieces(chess.PAWN, me)):
            topic = "rooks"
        elif when == "endgame" and piece == chess.KING:
            topic = "king"
        elif piece == chess.PAWN and is_passed(board, best.from_square):
            topic = "passed_pawn"
        else:
            topic = "improve"
        priority = PRIORITIES[topic]

    facts = [f"Stage of the game: {when}.", f"What matters most now, according to the engine: {priority}"]
    if threat_text:
        facts.append(threat_text)
    facts.append(f"The student's king {king_safety(board, me)}; the opponent's king {king_safety(board, not me)}.")
    if when != "endgame":
        theirs = at_home(board, not me)
        facts.append(
            f"The student's knights and bishops still on their starting squares: {', '.join(home) or 'none'}. "
            f"The opponent's: {', '.join(theirs) or 'none'}."
        )
    if files := open_files(board):
        facts.append(f"Open files, with no pawns on them: {', '.join(files)}.")
    for color in (me, not me):
        if loose := loose_pieces(board, color):
            facts.append(f"Loose {color_name(color)} pieces: {'; '.join(loose)}.")
    facts.append(f"The engine thinks the student is {standing(win_percent(analysis.score))}.")

    return Plan(topic, priority, topic in URGENT, facts, _template(topic, amount, target, home))


def _template(topic: str, amount: int, target: str | None, home: list[str]) -> str:
    if topic in ("mate", "material") and target:
        # A chance and a threat at once: say both, so the attacked piece isn't forgotten.
        chance = "a forced checkmate" if topic == "mate" else "a chance to win material"
        return f"Your {target} is under attack, but there's also {chance}. Look at captures and checks."
    if topic == "develop" and home:
        pieces = " and ".join(f"your {p}" for p in home[:2])
        return f"Keep developing: {pieces} {'is' if len(home[:2]) == 1 else 'are'} still waiting to join the game."
    if topic == "threat" and target:
        return f"Watch out: your {target} is under attack. Deal with that before anything else."
    if topic == "concede" and target:
        return f"You can't keep the {target} here, so don't spend the move defending it. Develop or improve instead."
    return {
        "check": "You're in check, so that comes first. Look at every way out.",
        "mate": ("There's checkmate in one here! Look at every check you can give." if amount == 1
                 else "There's a forced checkmate here! Look at every check you can give."),
        "material": "There's a chance to win material. Look at captures, checks and undefended pieces.",
        "threat": "Your opponent is threatening something. Work out what before you make your own plans.",
        "concede": "You can't hold on to everything here, so don't defend at all costs. Develop and improve instead.",
        "castle": "Your king is still in the center. This is a good moment to castle and keep it safe.",
        "develop": "Keep developing your pieces.",
        "center": "Claim space in the center with your pawns.",
        "rooks": "Bring your rooks into the game. They're strongest on open files.",
        "king": "In the endgame your king is a fighting piece. Bring it toward the center.",
        "passed_pawn": "You have a passed pawn. Push it, with your pieces supporting it.",
        "improve": "No tactics right now. Find your least active piece and give it a better square.",
    }[topic]


def guide_facts(board: chess.Board, the_plan: Plan, last: MoveGrade | None, student_color: chess.Color) -> str:
    """Facts for the guidance before the student's move: the opponent's last move, then the plan."""
    facts = game_header(board, student_color)
    if last is not None and board.move_stack and board.turn == student_color:
        before = board.copy()
        move = before.pop()
        facts.append(
            f"The opponent's last move: {numbered_san(before, move)}: {describe_move(before, move)}. "
            f"Engine grade: {GRADE_LABELS[last.classification]}."
        )
        if targets := attacked_by(board, move.to_square):
            facts.append(f"After it, the {PIECE_NAMES[board.piece_type_at(move.to_square)]} on "
                         f"{chess.square_name(move.to_square)} attacks: {'; '.join(targets)}.")
    elif not board.move_stack:
        facts.append("This is the very start of the game.")
    facts += the_plan.facts
    facts.append("The move itself is deliberately not given here: the student should find it.")
    return "\n".join(facts)
