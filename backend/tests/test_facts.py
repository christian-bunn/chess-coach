"""The fact sheet Claude explains from: content, and what it must never give away."""

import chess
import chess.engine

from app.engine import Analysis, Line
from app.facts import describe_move, fact_sheet, loose_pieces
from app.grading import grade_move
from tests.test_grading import board_after, fake_analysis

Cp, Mate = chess.engine.Cp, chess.engine.Mate
SCHOLARS_SETUP = ("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")  # White to move has Qxf7#


def sheet(board, san, before, after_score, reply=None, *, student=chess.WHITE, reveal_best=True, threat=None):
    move = board.parse_san(san)
    after_board = board.copy()
    after_board.push(move)
    after_lines = (Line(after_score, (after_board.parse_san(reply),)),) if reply else ()
    after = Analysis(after_board.turn, after_score, after_lines)
    grade = grade_move(board, move, before, after)
    return grade, fact_sheet(board, move, grade, before, after, threat, student_color=student, reveal_best=reveal_best)


class TestDescribeMove:
    def test_quiet_move(self):
        board = chess.Board()
        assert describe_move(board, board.parse_san("Nf3")) == "White knight g1 to f3"

    def test_capture_with_check(self):
        board = board_after("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6")
        assert describe_move(board, board.parse_san("Qxf7#")) == "White queen on h5 takes Black pawn on f7, checkmate"

    def test_castling(self):
        board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5")
        assert describe_move(board, board.parse_san("O-O")) == "White castles kingside"

    def test_promotion(self):
        board = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
        assert describe_move(board, board.parse_san("a8=Q")) == "White pawn a7 to a8, promoting to a queen"


def test_loose_pieces_finds_the_undefended_bishop():
    board = board_after("e4", "e6", "d4", "d5", "Ba6")
    loose = loose_pieces(board, chess.WHITE)
    assert any(item.startswith("White bishop on a6 (undefended") for item in loose)


def test_defended_piece_attacked_by_equal_piece_is_not_loose():
    board = board_after("e4", "e5", "Nf3", "Nc6")  # e5 pawn: attacked by Nf3, defended by Nc6
    assert not any("e5" in item for item in loose_pieces(board, chess.BLACK))


class TestHidingTheAnswer:
    def test_hidden_best_move_and_threat_are_left_out(self):
        board = board_after(*SCHOLARS_SETUP)
        before = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)), ("Qf3", Cp(40)))
        after_board = board.copy()
        after_board.push(board.parse_san("Qf3"))
        passed = after_board.copy(stack=False)
        passed.push(chess.Move.null())
        threat = Line(Cp(250), (passed.parse_san("Bxf7+"),))
        grade, text = sheet(board, "Qf3", before, Cp(-40), reply="Nd4", reveal_best=False, threat=threat)
        assert grade.retry_suggested
        assert "Qxf7" not in text and "Bxf7" not in text
        assert "forced checkmate in 1 available" in text
        assert "4...Nd4" in text  # the opponent's reply is fair game

    def test_revealed_best_move_is_included(self):
        board = board_after(*SCHOLARS_SETUP)
        before = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)), ("Qf3", Cp(40)))
        _, text = sheet(board, "Qf3", before, Cp(-40), reply="Nd4", reveal_best=True)
        assert "The engine's preferred move was 4.Qxf7#" in text

    def test_opponent_blunder_does_not_name_the_students_answer(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4")
        before = fake_analysis(board, ("g6", Cp(-50)), ("Qe7", Cp(-60)))
        grade, text = sheet(board, "Nf6", before, Mate(1), reply="Qxf7#", student=chess.WHITE)
        assert grade.classification == "blunder"
        assert "Qxf7" not in text
        assert "White (the student) now has a forced checkmate in 1" in text
        assert "computer opponent's move" in text


def test_checkmate_sheet_is_short_and_final():
    board = board_after(*SCHOLARS_SETUP)
    before = fake_analysis(board, ("Qxf7#", Mate(1)))
    _, text = sheet(board, "Qxf7#", before, Mate(0))
    assert text.endswith("The move is checkmate. The game is over.")
