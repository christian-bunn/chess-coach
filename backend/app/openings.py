"""Opening theory: named openings and "book" moves, from Lichess's openings list.

Stockfish has no opening book, so theory comes from lichess-org/chess-openings (CC0), copied into
backend/data/openings: 3,865 named lines, each with its ECO code. Positions are matched rather than
move orders, so a book position reached by a different order still counts.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import chess

from .grading import MoveGrade

DATA = Path(__file__).resolve().parents[1] / "data" / "openings"

# Only moves the engine is happy with are called "book": the list also has traps like
# "Barnes Opening: Fool's Mate" (1.f3 e5 2.g4??), and a coach shouldn't call 2.g4 theory.
BOOK_GRADES = frozenset({"best", "great", "excellent", "good"})


@dataclass(frozen=True)
class Opening:
    eco: str  # e.g. "C50"
    name: str  # e.g. "Italian Game: Two Knights Defense"


def _key(board: chess.Board) -> str:
    return board.epd()


@cache
def _book() -> tuple[dict[str, Opening], frozenset[str]]:
    """The named positions (where each line ends), and every position on a named line."""
    named: dict[str, Opening] = {}
    positions = {_key(chess.Board())}
    for path in sorted(DATA.glob("*.tsv")):
        with path.open(newline="", encoding="utf-8") as file:
            for row in csv.DictReader(file, delimiter="\t"):
                board = chess.Board()
                for san in row["pgn"].split():
                    if not san.endswith("."):  # skip the move numbers ("1.")
                        board.push_san(san)
                        positions.add(_key(board))
                named[_key(board)] = Opening(row["eco"], row["name"])
    return named, frozenset(positions)


def load() -> None:
    """Read the list now (about a second), so the first graded move isn't slow."""
    _book()


def in_book(board: chess.Board) -> bool:
    """Whether the position on `board` lies on one of the named opening lines."""
    return _key(board) in _book()[1]


def book_move(board: chess.Board, move: chess.Move) -> bool:
    """Whether `move`, played on `board`, keeps the game on a named opening line."""
    after = board.copy(stack=False)
    after.push(move)
    return in_book(board) and in_book(after)


def opening(board: chess.Board) -> Opening | None:
    """The opening the game on `board` has reached: the last named position along its moves."""
    named = _book()[0]
    replay = board.root()
    found = None
    for move in board.move_stack:
        replay.push(move)
        found = named.get(_key(replay), found)
    return found


def mark_book(grade: MoveGrade, board: chess.Board, move: chess.Move) -> MoveGrade:
    """Add the opening the game has reached to `grade` (for `move`, played on `board`), and grade it "book"
    when it's a theory move the engine also likes."""
    after = board.copy()
    after.push(move)
    found = opening(after)
    grade.opening = found.name if found else None
    grade.eco = found.eco if found else None
    if grade.classification in BOOK_GRADES and not grade.delivers_mate and book_move(board, move):
        grade.classification = "book"
    return grade
