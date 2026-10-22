"""The fact sheet Claude explains from: content, and what it must never give away."""

import chess
import chess.engine

from app.coach import describe_opponent_move, threat_warning
from app.engine import Analysis, Line
from app.facts import describe_move, fact_sheet, loose_pieces, why_bad
from app.grading import grade_move
from tests.test_grading import board_after, fake_analysis, grade

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


class TestWhyBad:
    """The reason a bad move is bad, worked out in code (see facts.why_bad)."""

    def reason(self, board, san, before, after_score, reply):
        g = grade(board, san, before, after_score, reply)
        after_board = board.copy()
        after_board.push(board.parse_san(san))
        return why_bad(board, board.parse_san(san), g, (after_board.parse_san(reply),))

    def test_ignoring_an_attacked_queen(self):
        board = board_after("e4", "e5", "Qh5", "Nf6")  # the knight attacks the queen
        r = self.reason(board, "d3", fake_analysis(board, ("Qe2", Cp(0))), Cp(700), "Nxh5")
        assert r.kind == "ignored"
        assert r.facts_text() == (
            "MAIN POINT: The student's queen on h5 was already under attack from the knight on f6 before 3.d3. "
            "3.d3 did nothing about that, so 3...Nxh5 wins it."
        )
        assert r.coach_text() == "Your queen on h5 was already under attack, and 3.d3 didn't deal with it: 3...Nxh5 wins it."

    def test_moving_onto_an_attacked_square(self):
        board = board_after("e4", "d5")
        r = self.reason(board, "Qg4", fake_analysis(board, ("exd5", Cp(50))), Cp(700), "Bxg4")
        assert r.kind == "hung"
        assert r.coach_text() == "2.Qg4 puts your queen on g4, where 2...Bxg4 takes it."

    def test_moving_a_defender_away(self):
        board = chess.Board("3r2k1/5ppp/8/3P4/8/2N5/5PPP/6K1 w - - 0 1")  # the knight guards d5
        r = self.reason(board, "Nb5", fake_analysis(board, ("Ne4", Cp(-50))), Cp(300), "Rxd5")
        assert r.kind == "defender"
        assert r.coach_text() == "1.Nb5 moves your knight away from guarding the pawn on d5, so 1...Rxd5 wins it."

    def test_missed_mate_comes_first(self):
        board = board_after(*SCHOLARS_SETUP)
        r = self.reason(board, "d3", fake_analysis(board, ("Qxf7#", Mate(1))), Cp(700), "Nxh5")
        assert r.kind == "missed_mate" and r.also.kind == "ignored"
        assert r.facts_text().startswith("MAIN POINT: 4.d3 misses a forced checkmate in 1. On top of that: ")

    def test_good_moves_have_no_reason(self):
        board = board_after("e4", "e5")
        g = grade(board, "Nf3", fake_analysis(board, ("Nf3", Cp(40))), Cp(-40), "Nc6")
        assert why_bad(board, board.parse_san("Nf3"), g, ()) is None

    def test_main_point_leads_the_students_fact_sheet(self):
        board = board_after("e4", "e5", "Qh5", "Nf6")
        _, text = sheet(board, "d3", fake_analysis(board, ("Qe2", Cp(0))), Cp(700), reply="Nxh5", reveal_best=False)
        assert "MAIN POINT: The student's queen on h5 was already under attack" in text


class TestThreatWarning:
    def passed(self, board):
        b = board.copy(stack=False)
        b.push(chess.Move.null())
        return b

    def test_attacked_queen(self):
        board = board_after("e4", "e5", "Qh5", "Nf6")  # Black just attacked White's queen
        threat = Line(Cp(800), (self.passed(board).parse_san("Nxh5"),))
        assert threat_warning(board, threat) == "Watch out: your queen on h5 is under attack."

    def test_mate_threat(self):
        board = board_after("e4", "e5", "Bc4", "Nc6", "Qh5")  # White threatens Qxf7#; Black to move
        threat = Line(Mate(1), (self.passed(board).parse_san("Qxf7#"),))
        assert threat_warning(board, threat) == "Watch out: your opponent is threatening checkmate."

    def test_small_threats_are_not_worth_a_warning(self):
        board = board_after("e4", "d5")  # Black attacks the e4 pawn
        threat = Line(Cp(100), (self.passed(board).parse_san("dxe4"),))
        assert threat_warning(board, threat) is None

    def test_an_opponent_blunder_beats_the_warning(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4")
        g = grade(board, "Nf6", fake_analysis(board, ("g6", Cp(-50))), Mate(1), reply="Qxf7#")
        assert describe_opponent_move(g, "Watch out: ...").startswith("Your opponent just blundered.")
