"""Facts for hints and for answering the student's questions.

Same rule as facts.py: Claude only sees what it may say. A level-1 hint's facts
don't contain the move, so the hint can't give it away.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import chess
import chess.engine

from .engine import Analysis, Line
from .facts import (
    GRADE_LABELS, PIECE_NAMES, color_name, describe_line, describe_move, describe_threat, format_eval,
    loose_pieces, material_phrase, piece_list,
)
from .grading import Eval, MoveGrade, material_balance, material_change, numbered_san, win_percent

HINT_LEVELS = 3
# Questions get at most this many of their mentioned moves checked by the engine.
MAX_MENTIONED_MOVES = 3


def _game_header(board: chess.Board, student_color: chess.Color) -> list[str]:
    to_move = "the student" if board.turn == student_color else "the computer opponent"
    return [
        f"The student plays {color_name(student_color)}; the computer opponent plays {color_name(not student_color)}.",
        f"It is {color_name(board.turn)}'s move ({to_move}).",
        "Moves so far: " + (board.root().variation_san(board.move_stack) or "(none yet)"),
        f"Position (FEN): {board.fen()}",
        "Pieces: " + piece_list(board, chess.WHITE) + ". " + piece_list(board, chess.BLACK) + ".",
        _material_now(board),
    ]


def _material_now(board: chess.Board) -> str:
    balance = material_balance(board, chess.WHITE)
    if balance == 0:
        return "Material is level."
    ahead = "White" if balance > 0 else "Black"
    return f"Material: {ahead} is {abs(balance)} point{'s' if abs(balance) != 1 else ''} ahead (pawn = 1)."


# ---------------------------------------------------------------------------------------------- hints


@dataclass(frozen=True)
class Hint:
    facts: str  # what Claude may use for this level
    template: str  # the built-in hint, used when Claude isn't available
    move: str | None  # UCI of the suggested move, only at the last level (for the arrow)


def _idea(board: chess.Board, analysis: Analysis, threat_text: str | None) -> tuple[str, int]:
    """What the best line is about: ("mate", moves), ("material", points won), ("defend", 0) when it
    parries the opponent's threat, ("concede", points lost) when even the best line can't keep the
    material, or ("position", 0)."""
    mate = analysis.score.mate()
    if mate is not None and mate > 0:
        return "mate", mate
    gain = material_change(board, analysis.best.pv, board.turn)
    if gain >= 1:
        return "material", gain
    if gain < 0:
        return "concede", -gain
    return ("defend", 0) if threat_text else ("position", 0)


def _threatened(board: chess.Board, threat: Line | None) -> str | None:
    """'pawn on d5' when the opponent's threat starts by capturing one of the student's pieces."""
    if threat is None:
        return None
    passed = board.copy(stack=False)
    passed.push(chess.Move.null())
    target = passed.piece_at(threat.move.to_square)
    if target is None or target.color != board.turn:
        return None
    return f"{PIECE_NAMES[target.piece_type]} on {chess.square_name(threat.move.to_square)}"


def _idea_fact(kind: str, amount: int, threatened: str | None = None) -> str:
    if kind == "concede" and threatened:
        return (
            f"The student can't keep the {threatened}: every good move lets it go (about {amount} "
            f"point{'s' if amount != 1 else ''} of material back) and develops or improves the position instead. "
            f"Trying to hold on to the {threatened} is not what the engine recommends."
        )
    return {
        "mate": f"The student has a forced checkmate in {amount}.",
        "material": f"The student can win about {amount} point{'s' if amount != 1 else ''} of material (pawn = 1).",
        "defend": "The most important thing is dealing with the opponent's threat.",
        "concede": (
            f"Even the best move can't keep all the material: it gives back about {amount} "
            f"point{'s' if amount != 1 else ''} and concentrates on the student's development and position instead "
            "of defending."
        ),
        "position": "There's no immediate tactic: the best move improves the student's position.",
    }[kind]


def hint(board: chess.Board, analysis: Analysis, threat: Line | None, level: int, student_color: chess.Color) -> Hint:
    """A hint for the side to move (the student). Higher levels reveal more."""
    best = analysis.best
    threat_text = describe_threat(board, threat)
    kind, amount = _idea(board, analysis, threat_text)
    facts = _game_header(board, student_color)

    facts.append(_idea_fact(kind, amount, _threatened(board, threat)))
    if threat_text:
        facts.append(threat_text)
    template = {
        "mate": ("There's checkmate in one here. Look at every check you can give." if amount == 1
                 else f"There's a forced checkmate in {amount} here. Start by looking at every check you can give."),
        "material": "There's a way to win material here. Look for captures, checks, and pieces you can attack twice.",
        "defend": "Your opponent is threatening something. Work out what it is before you look for your own ideas.",
        "concede": "You can't hold on to everything here. Rather than defending at all costs, look for the move "
                   "that develops a piece or improves your position the most.",
        "position": "There's no immediate tactic here. Find your least active piece and give it a better square.",
    }[kind]

    if level >= 2:
        piece = board.piece_at(best.move.from_square)
        where = chess.square_name(best.move.from_square)
        kinds = [k for k, yes in (("a capture", board.is_capture(best.move)), ("a check", board.gives_check(best.move))) if yes]
        piece_fact = f"The move to find is made by the student's {PIECE_NAMES[piece.piece_type]} on {where}."
        if board.is_castling(best.move):
            piece_fact = "The move to find is castling."
        facts.append(piece_fact + (f" It is {' and '.join(kinds)}." if kinds else ""))
        template = (
            "Think about castling." if board.is_castling(best.move)
            else f"Look at your {PIECE_NAMES[piece.piece_type]} on {where}."
            + (f" The move is {' and '.join(kinds)}." if kinds else "")
        )

    move = None
    if level >= HINT_LEVELS:
        move = best.move.uci()
        facts.append(
            f"The engine's move: {numbered_san(board, best.move)} ({describe_move(board, best.move)}). "
            f"Its main line: {describe_line(board, best.pv)}."
        )
        if kind == "material":
            facts.append(f"Over that line, {material_phrase(board.turn, amount)}.")
        template = f"The engine's move is {numbered_san(board, best.move)}." + {
            "mate": f" It forces checkmate in {amount}." if amount > 1 else " It's checkmate.",
            "material": f" It wins about {amount} point{'s' if amount != 1 else ''} of material.",
            "defend": " It deals with your opponent's threat.",
            "concede": " It gives some material back, but improves your position the most.",
            "position": " It's the best way to improve your position.",
        }[kind]

    return Hint("\n".join(facts), template, move)


# ------------------------------------------------------------------------------------------- questions

_SAN = re.compile(r"(?<![\w-])(O-O-O|O-O|0-0-0|0-0|[KQRBNkqrbn]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBNqrbn])?)(?![\w-])")
_SPOKEN = re.compile(r"\b(king|queen|rook|bishop|knight|pawn)\s+(?:to\s+|takes\s+|captures\s+|on\s+|x\s*)?([a-h][1-8])\b", re.I)
_CASTLE = re.compile(r"\bcastl(?:e|es|ing)\b", re.I)
_WANTS_A_MOVE = re.compile(
    r"\b(best|should i|what (?:do|can|could|would|should) i|what to (?:play|do)|which move|what move|recommend|"
    r"suggest|good move|what now|next move|help me)\b",
    re.I,
)


def asks_for_a_move(question: str) -> bool:
    """Whether the student is asking what to play (so the engine's best moves may be shared)."""
    return bool(_WANTS_A_MOVE.search(question))
_PIECE_TYPES = {name: piece_type for piece_type, name in PIECE_NAMES.items()}


def mentioned_moves(board: chess.Board, text: str) -> tuple[list[chess.Move], list[str]]:
    """Moves named in `text`: those legal for the side to move, and other move-like words that aren't."""
    legal: list[chess.Move] = []
    not_legal: list[str] = []

    def add(move: chess.Move) -> None:
        if move not in legal:
            legal.append(move)

    for piece_name, square in _SPOKEN.findall(text):
        piece_type = _PIECE_TYPES[piece_name.lower()]
        target = chess.parse_square(square.lower())
        for move in board.legal_moves:
            if move.to_square == target and board.piece_type_at(move.from_square) == piece_type:
                add(move)
    text = _SPOKEN.sub(" ", text)  # "knight to g5" shouldn't also count as the pawn move g5

    # Moves already played ("why did I play e4?") aren't proposals, so they're not reported as illegal.
    replay = board.root()
    played = set()
    for move in board.move_stack:
        played.add(replay.san(move).rstrip("+#"))
        replay.push(move)

    for token in _SAN.findall(text):
        san = token.replace("0", "O")
        if san[-1] in "qrbn" and len(san) > 2 and (san[-2] == "=" or san[-2].isdigit()):
            san = san[:-1] + san[-1].upper()  # "e8=q" -> "e8=Q"
        candidates = [san]
        if san[0] in "kqrnb" and len(san) >= 3:
            candidates.append(san[0].upper() + san[1:])  # "nf5" -> "Nf5"; "bc4" is tried as a pawn move first
        for candidate in candidates:
            try:
                add(board.parse_san(candidate))
                break
            except ValueError:
                continue
        else:
            if token not in not_legal and san not in played:
                not_legal.append(token)

    if _CASTLE.search(text):
        castling = [move for move in board.legal_moves if board.is_castling(move)]
        for move in castling:
            add(move)
        if not castling:
            not_legal.append("castling")
    return legal[:MAX_MENTIONED_MOVES], not_legal[:MAX_MENTIONED_MOVES]


@dataclass(frozen=True)
class Hypothetical:
    move: chess.Move
    grade: MoveGrade
    after: Analysis


def position_facts(
    board: chess.Board,
    analysis: Analysis,
    threat: Line | None,
    *,
    student_color: chess.Color,
    last: MoveGrade | None,
    reveal_last_best: bool,
    hypotheticals: list[Hypothetical],
    not_legal: list[str],
    show_best_moves: bool,
) -> str:
    """The current position, for answering a question about it. The student's best moves are only
    included with `show_best_moves`, so the coach can't volunteer them unasked."""
    facts = _game_header(board, student_color)
    student_win = win_percent(analysis.score) if board.turn == student_color else 100 - win_percent(analysis.score)
    facts.append(
        f"Engine evaluation: {format_eval(Eval.from_white_score(analysis.white_score()))}. "
        f"The student's chance of winning: {student_win:.0f}%."
    )

    if last is not None and board.move_stack:
        before_last = board.copy()
        last_move = before_last.pop()
        by = "the student" if before_last.turn == student_color else "the computer opponent"
        facts.append(
            f"Last move ({by}): {numbered_san(before_last, last_move)}: {describe_move(before_last, last_move)}. "
            f"Engine grade: {GRADE_LABELS[last.classification]}."
        )
        if before_last.turn == student_color and last.best_san and last.classification not in ("best", "great", "forced"):
            if reveal_last_best:
                facts.append(f"Instead of that move, the engine preferred {numbered_san(before_last, chess.Move.from_uci(last.best_move))}.")
            else:
                facts.append("The student is being offered a retry of that move, so the better move is deliberately not given here.")

    if board.is_game_over(claim_draw=True):
        facts.append("The game is over.")
    else:
        side = color_name(board.turn)
        top = [
            f"{numbered_san(board, line.move)} ({format_eval(Eval.from_white_score(chess.engine.PovScore(line.score, board.turn).white()))}; "
            f"line: {describe_line(board, line.pv, plies=4)}; over that line, "
            f"{material_phrase(board.turn, material_change(board, line.pv, board.turn))})"
            for line in analysis.lines
        ]
        if show_best_moves or board.turn != student_color:
            facts.append(f"The engine's top moves for {side}: " + " | ".join(top) + ".")
        if board.turn == student_color:
            threat_text = describe_threat(board, threat)
            # The engine's one-line verdict on what matters now (the same one level-1 hints use), up front.
            verdict = _idea_fact(*_idea(board, analysis, threat_text), _threatened(board, threat))
            facts.insert(len(_game_header(board, student_color)), "ENGINE VERDICT (what matters most now): " + verdict)
            if threat_text:
                facts.append(threat_text)
        for color in (board.turn, not board.turn):
            if loose := loose_pieces(board, color):
                facts.append(f"Loose {color_name(color)} pieces: {'; '.join(loose)}.")

    for h in hypotheticals:
        mover = color_name(board.turn)
        reply = ""
        if h.after.best is not None:
            after_board = board.copy(stack=False)
            after_board.push(h.move)
            reply = f" The best reply would be: {describe_line(after_board, h.after.best.pv, plies=4)}."
        facts.append(
            f"If {mover} played {numbered_san(board, h.move)} ({describe_move(board, h.move)}): engine grade "
            f"{GRADE_LABELS[h.grade.classification]}; {mover}'s chance of winning would go from "
            f"{h.grade.win_before:.0f}% to {h.grade.win_after:.0f}%.{reply} Over the first few moves, "
            f"{material_phrase(board.turn, h.grade.material_change)}."
            + (f" It would allow checkmate in {h.grade.allows_mate_in}." if h.grade.allows_mate_in else "")
        )
    if not_legal:
        facts.append(f"Mentioned but not legal for {color_name(board.turn)} right now: {', '.join(not_legal)}.")
    return "\n".join(facts)
