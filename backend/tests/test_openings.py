"""Opening theory from Lichess's openings list: names, book moves, and when a theory move isn't "book"."""

import chess
import chess.engine

from app.grading import grade_move
from app.openings import book_move, in_book, mark_book, opening
from tests.test_grading import board_after, fake_analysis

Cp, Mate = chess.engine.Cp, chess.engine.Mate


def test_names_the_deepest_opening_reached():
    assert opening(board_after("e4", "e5", "Nf3", "Nc6", "Bc4")).name == "Italian Game"
    assert opening(board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6")).name == "Italian Game: Two Knights Defense"
    # Leaving theory keeps the last name the game had.
    assert opening(board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "a3", "a6")).name == "Italian Game: Two Knights Defense"
    assert opening(chess.Board()) is None


def test_positions_not_move_orders():
    # 1.Nf3 Nc6 2.e4 e5 3.Bc4 reaches the Italian Game by another route.
    board = board_after("Nf3", "Nc6", "e4", "e5")
    assert book_move(board, board.parse_san("Bc4"))
    board.push_san("Bc4")
    assert opening(board).name == "Italian Game"


def test_book_moves():
    board = board_after("e4", "e5", "Nf3", "Nc6")
    assert book_move(board, board.parse_san("Bc4"))
    assert not book_move(board, board.parse_san("h3"))
    # Once the game has left theory, a later move can't be "book" again.
    off = board_after("e4", "e5", "Nf3", "Nc6", "h3", "a6")
    assert not in_book(off) and not book_move(off, off.parse_san("Bc4"))


def grade(board, san, before_score, after_score):
    move = board.parse_san(san)
    after = board.copy()
    after.push(move)
    return mark_book(grade_move(board, move, fake_analysis(board, (san, before_score)), fake_analysis(after, ("a6", after_score))), board, move)


def test_a_good_theory_move_is_graded_book():
    board = board_after("e4", "e5")
    g = grade(board, "Nf3", Cp(40), Cp(-40))
    assert g.classification == "book" and g.opening == "King's Knight Opening" and g.eco == "C40"


def test_a_blunder_in_the_list_is_still_a_blunder():
    # "Barnes Opening: Fool's Mate" is in the list, but 2.g4 allows mate in one.
    board = board_after("f3", "e5")
    move = board.parse_san("g4")
    after = board.copy()
    after.push(move)
    g = mark_book(grade_move(board, move, fake_analysis(board, ("Nc3", Cp(-50))), fake_analysis(after, ("Qh4#", Mate(1)))), board, move)
    assert book_move(board, move)
    assert g.classification == "blunder" and g.opening == "Barnes Opening"
