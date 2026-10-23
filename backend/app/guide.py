"""What matters in a position, for the 💡 Hint: a threat to meet, a chance to take, castling, development,
and so on, in words that point the way without naming the move.

The engine's best move decides the topic. (This used to drive guidance before every move too, which was
dropped for repeating itself; hints ask for it only when the student wants it.)
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

from .advice import check_answer, check_text, idea, threat_answer, threatened
from .engine import Analysis, Line
from .facts import PIECE_NAMES

# Topics with something to act on right away. A hint in a quieter position follows the plan's topic instead.
URGENT = frozenset({"check", "mate", "material", "threat", "concede"})

HOME = {
    chess.WHITE: {chess.KNIGHT: (chess.B1, chess.G1), chess.BISHOP: (chess.C1, chess.F1)},
    chess.BLACK: {chess.KNIGHT: (chess.B8, chess.G8), chess.BISHOP: (chess.C8, chess.F8)},
}
CENTER_FILES = (2, 3, 4, 5)  # c, d, e and f
VALUES = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
# Pieces (not pawns) left on the board, both sides together, at or below which it's an endgame (62 at the start).
ENDGAME_MATERIAL = 26


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


def is_passed(board: chess.Board, square: chess.Square) -> bool:
    color = board.color_at(square)
    file, rank = chess.square_file(square), chess.square_rank(square)
    ahead = range(rank + 1, 8) if color == chess.WHITE else range(0, rank)
    for s in board.pieces(chess.PAWN, not color):
        if abs(chess.square_file(s) - file) <= 1 and chess.square_rank(s) in ahead:
            return False
    return True


@dataclass(frozen=True)
class Plan:
    topic: str
    urgent: bool  # a threat or a chance to act on now
    text: str  # what to aim for, without the move


def plan(board: chess.Board, analysis: Analysis, threat: Line | None) -> Plan | None:
    """What the side to move (the student) should focus on. None when the game is over."""
    if analysis.best is None:
        return None
    me = board.turn
    best = analysis.best.move
    when = stage(board)
    kind, amount = idea(board, analysis, threat)
    target = threatened(board, threat)
    home = at_home(board, me)

    if board.is_check():
        topic = "check"
    elif kind != "position":
        topic = {"mate": "mate", "material": "material", "concede": "concede", "defend": "threat"}[kind]
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

    if in_check := check_answer(board, best):
        text = check_text(board, in_check)
    else:
        text = _text(topic, amount, target, home, threat_answer(board, best, threat))
    return Plan(topic, topic in URGENT, text)


def _text(topic: str, amount: int, target: str | None, home: list[str], answer: str | None = None) -> str:
    if target and answer == "capture" and topic in ("threat", "material", "mate"):
        extra = {"material": " That also wins material.", "mate": " There's even a forced checkmate."}.get(topic, "")
        return f"Your {target} is under attack, but don't just move it away: see whether you can capture the attacker.{extra}"
    if target and answer == "move" and topic == "threat":
        return f"Watch out: your {target} is under attack. Find it a safe square."
    if topic == "material" and target:
        # A chance and a threat at once: say both, so the attacked piece isn't forgotten. (With a forced
        # mate, the threat doesn't matter.)
        return f"Your {target} is under attack, but there's also a chance to win material. Look at captures and checks."
    if topic == "develop" and home:
        pieces = " and ".join(f"your {p}" for p in home[:2])
        return f"Keep developing: {pieces} {'is' if len(home[:2]) == 1 else 'are'} still waiting to join the game."
    if topic == "threat" and target:
        return f"Watch out: your {target} is under attack. Deal with that before anything else."
    if topic == "concede" and target:
        return f"You can't keep the {target} here, so don't spend the move defending it. Develop or improve instead."
    return {
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
