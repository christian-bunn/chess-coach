"""Opening theory: named openings, "book" moves, and the opening tree for learning openings.

Stockfish has no opening book, so theory comes from lichess-org/chess-openings (CC0), copied into
backend/data/openings: 3,865 named lines, each with its ECO code. Positions are matched rather than
move orders, so a book position reached by a different order still counts. Practising an opening
follows the lines' own move orders instead (see practice_moves).
"""

from __future__ import annotations

import csv
from collections import Counter, defaultdict
from dataclasses import dataclass, field
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


@dataclass(frozen=True)
class BookLine:
    """One named line of the list, e.g. Sicilian Defense (B20): 1. e4 c5."""

    opening: Opening
    moves: tuple[str, ...]  # UCI
    pgn: str  # "1. e4 c5"


@dataclass
class _Node:
    """A move-order prefix of the named lines, and how many of them go through it."""

    lines: int = 0
    next: dict[str, _Node] = field(default_factory=dict)


@dataclass(frozen=True)
class _Book:
    named: dict[str, Opening]  # positions where a line ends, and its name
    lines: list[BookLine]
    through: Counter  # position -> how many lines pass through it (a rough measure of how mainline it is)
    edges: dict[str, dict[str, str]]  # position -> {UCI of a book move: the position it leads to}
    leads_to: dict[str, Opening]  # position -> the shortest named line through it
    root: _Node  # the lines by move order, for practice


def _key(board: chess.Board) -> str:
    return board.epd()


@cache
def _book() -> _Book:
    named: dict[str, Opening] = {}
    lines: list[BookLine] = []
    through: Counter = Counter()
    edges: dict[str, dict[str, str]] = defaultdict(dict)
    leads_to: dict[str, Opening] = {}
    shortest: dict[str, int] = {}
    root = _Node()
    for path in sorted(DATA.glob("*.tsv")):
        with path.open(newline="", encoding="utf-8") as file:
            for row in csv.DictReader(file, delimiter="\t"):
                board = chess.Board()
                keys, moves = [_key(board)], []
                for san in row["pgn"].split():
                    if san.endswith("."):  # a move number ("1.")
                        continue
                    move = board.parse_san(san)
                    board.push(move)
                    moves.append(move.uci())
                    edges[keys[-1]][move.uci()] = _key(board)
                    keys.append(_key(board))
                opening = Opening(row["eco"], row["name"])
                named[keys[-1]] = opening
                lines.append(BookLine(opening, tuple(moves), row["pgn"]))
                for k in set(keys):
                    through[k] += 1
                    if len(moves) < shortest.get(k, 1000):
                        shortest[k], leads_to[k] = len(moves), opening
                node = root
                root.lines += 1
                for uci in moves:
                    node = node.next.setdefault(uci, _Node())
                    node.lines += 1
    return _Book(named, lines, through, dict(edges), leads_to, root)


def load() -> None:
    """Read the list now (about a second), so the first graded move isn't slow."""
    _book()


def in_book(board: chess.Board) -> bool:
    """Whether the position on `board` lies on one of the named opening lines."""
    return _key(board) in _book().through


def book_move(board: chess.Board, move: chess.Move) -> bool:
    """Whether `move`, played on `board`, keeps the game on a named opening line."""
    after = board.copy(stack=False)
    after.push(move)
    return in_book(board) and in_book(after)


def opening(board: chess.Board) -> Opening | None:
    """The opening the game on `board` has reached: the last named position along its moves."""
    named = _book().named
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


# ----------------------------------------------------------------------------- learning openings

# Popular openings to start from, by who chooses them. Each is the shortest line with that name.
FEATURED = (
    ("For White", "white", ("Italian Game", "Ruy Lopez", "Scotch Game", "Vienna Game", "King's Gambit",
                            "Queen's Gambit", "Queen's Pawn Game: London System", "English Opening", "Catalan Opening")),
    ("Against 1.e4", "black", ("Sicilian Defense", "French Defense", "Caro-Kann Defense", "Scandinavian Defense",
                               "Pirc Defense", "Petrov's Defense", "Alekhine Defense")),
    ("Against 1.d4", "black", ("Queen's Gambit Declined", "Queen's Gambit Accepted", "Slav Defense",
                               "King's Indian Defense", "Nimzo-Indian Defense", "Grünfeld Defense", "Dutch Defense")),
)


def shortest_line(name: str) -> BookLine | None:
    candidates = [line for line in _book().lines if line.opening.name == name]
    return min(candidates, key=lambda line: len(line.moves)) if candidates else None


def featured() -> list[tuple[str, str, list[BookLine]]]:
    """(group, side, lines) for the popular openings."""
    return [(group, side, [line for name in names if (line := shortest_line(name))]) for group, side, names in FEATURED]


def search(query: str, limit: int = 40) -> list[BookLine]:
    """Named lines whose name (or ECO code) matches `query`: names starting with it first, then the shortest."""
    q = query.strip().lower()
    if not q:
        return []
    found = [line for line in _book().lines if q in line.opening.name.lower() or q == line.opening.eco.lower()]
    found.sort(key=lambda line: (not line.opening.name.lower().startswith(q), len(line.moves), line.opening.name))
    return found[:limit]


@dataclass(frozen=True)
class Continuation:
    move: chess.Move
    leads_to: Opening  # the shortest named line it's part of
    lines: int  # how many named lines go through it
    named: bool  # whether the position it reaches is itself a named one


def continuations(board: chess.Board) -> list[Continuation]:
    """The book moves from the position on `board` (by position, so transpositions count), most lines first."""
    book = _book()
    found = []
    for uci, child in book.edges.get(_key(board), {}).items():
        move = chess.Move.from_uci(uci)
        if move in board.legal_moves:
            found.append(Continuation(move, book.leads_to[child], book.through[child], child in book.named))
    return sorted(found, key=lambda c: -c.lines)


def name_of(board: chess.Board) -> Opening | None:
    """The name of the position on `board`, if a named line ends there."""
    return _book().named.get(_key(board))


def _walk(moves: tuple[str, ...]) -> _Node | None:
    node = _book().root
    for uci in moves:
        node = node.next.get(uci)
        if node is None:
            return None
    return node


def practice_moves(target: tuple[str, ...], moves: tuple[str, ...]) -> list[tuple[str, int]] | None:
    """The book moves that carry `moves` on within the opening being practised: the lines starting with
    `target`, in their own move order. Until `target` is reached that's just its next move; after it, every
    move that continues one of its lines, with how many lines go that way. None once `moves` has left them."""
    if len(moves) < len(target):
        return [(target[len(moves)], 1)] if moves == target[: len(moves)] else None
    if moves[: len(target)] != target:
        return None
    node = _walk(moves)
    if node is None:
        return None
    return sorted(((uci, n.lines) for uci, n in node.next.items()), key=lambda m: -m[1])
