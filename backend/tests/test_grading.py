"""Unit tests for the grading rules, using hand-made engine output (no Stockfish needed)."""

import chess
import chess.engine
import pytest

from app.coach import describe_user_move
from app import grading
from app.engine import Analysis, Line
from app.grading import classify, grade_move, material_change, win_percent

Cp, Mate, MateGiven = chess.engine.Cp, chess.engine.Mate, chess.engine.MateGiven


def board_after(*sans: str) -> chess.Board:
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def fake_analysis(board: chess.Board, *lines: tuple[str, chess.engine.Score]) -> Analysis:
    """Analysis whose lines are (SAN of first move, score for the side to move)."""
    built = tuple(Line(score, (board.parse_san(san),)) for san, score in lines)
    return Analysis(board.turn, built[0].score, built)


def grade(board: chess.Board, san: str, before: Analysis, after_score: chess.engine.Score, reply: str | None = None):
    move = board.parse_san(san)
    after_board = board.copy()
    after_board.push(move)
    after_lines = (Line(after_score, (after_board.parse_san(reply),)),) if reply else ()
    after = Analysis(after_board.turn, after_score, after_lines)
    return grade_move(board, move, before, after)


class TestWinPercent:
    def test_equal_position_is_fifty_fifty(self):
        assert win_percent(Cp(0)) == 50

    def test_symmetric(self):
        assert win_percent(Cp(250)) + win_percent(Cp(-250)) == pytest.approx(100)

    def test_mates(self):
        assert win_percent(Mate(3)) == 100
        assert win_percent(Mate(-2)) == 0
        assert win_percent(MateGiven) == 100
        assert win_percent(Mate(0)) == 0  # side to move is checkmated

    def test_extra_pawn_matters_less_when_already_winning(self):
        equal_gain = win_percent(Cp(100)) - win_percent(Cp(0))
        winning_gain = win_percent(Cp(900)) - win_percent(Cp(800))
        assert equal_gain > 3 * winning_gain


class TestMaterialChange:
    def test_capture_that_is_recaptured_nets_zero(self):
        board = board_after("e4", "d5")
        line = (board.parse_san("exd5"),)
        assert material_change(board, line, chess.WHITE) == 1
        b = board.copy()
        b.push(line[0])
        line += (b.parse_san("Qxd5"),)
        assert material_change(board, line, chess.WHITE) == 0

    def test_horizon_does_not_cut_an_exchange_in_half(self, monkeypatch):
        monkeypatch.setattr(grading, "MATERIAL_HORIZON", 1)
        board = board_after("e4", "d5")
        b = board.copy()
        exd5 = b.parse_san("exd5")
        b.push(exd5)
        # Only exd5 is inside the horizon, but the line continues with Qxd5: don't count the pawn.
        assert material_change(board, (exd5, b.parse_san("Qxd5")), chess.WHITE) == 0


class TestClassify:
    defaults = dict(forced=False, is_best=False, is_great=False, win_before=50.0, win_after=50.0, missed_mate_in=None)

    @pytest.mark.parametrize(
        ("loss", "expected"),
        [(0.5, "excellent"), (3, "good"), (7, "inaccuracy"), (15, "mistake"), (35, "blunder")],
    )
    def test_thresholds(self, loss, expected):
        assert classify(**{**self.defaults, "loss": loss}) == expected

    def test_forced_wins_over_everything(self):
        assert classify(**{**self.defaults, "forced": True, "loss": 50}) == "forced"

    def test_missing_a_winning_shot_without_losing_is_a_miss(self):
        assert classify(**{**self.defaults, "loss": 30, "win_before": 90, "win_after": 55}) == "miss"

    def test_missed_short_mate_is_a_miss_even_if_still_winning(self):
        assert classify(**{**self.defaults, "loss": 0.5, "win_before": 100, "win_after": 99.5, "missed_mate_in": 2}) == "miss"

    def test_missed_long_mate_while_still_winning_is_fine(self):
        assert classify(**{**self.defaults, "loss": 0.5, "win_before": 100, "win_after": 99.5, "missed_mate_in": 6}) == "excellent"

    def test_missed_mate_that_also_loses_is_a_blunder(self):
        assert classify(**{**self.defaults, "loss": 93, "win_before": 100, "win_after": 7, "missed_mate_in": 1}) == "blunder"


class TestGradeMove:
    def test_playing_the_top_move_is_best(self):
        board = board_after("e4", "e5")
        before = fake_analysis(board, ("Nf3", Cp(40)), ("Nc3", Cp(30)), ("d4", Cp(25)))
        g = grade(board, "Nf3", before, Cp(-40), reply="Nc6")
        assert g.classification == "best"
        assert g.win_loss == 0
        assert not g.retry_suggested

    def test_only_good_move_is_great(self):
        board = board_after("e4", "e5")
        before = fake_analysis(board, ("Nf3", Cp(40)), ("Nc3", Cp(-150)), ("d4", Cp(-200)))
        assert grade(board, "Nf3", before, Cp(-40), reply="Nc6").classification == "great"

    def test_only_legal_move_is_forced(self):
        board = chess.Board("k7/2K5/8/8/8/8/8/1R6 b - - 0 1")
        before = fake_analysis(board, ("Ka7", Cp(-2000)))
        assert grade(board, "Ka7", before, Cp(2000), reply="Rb8").classification == "forced"

    def test_move_outside_top_lines_uses_the_after_position(self):
        board = board_after("e4", "e5")
        before = fake_analysis(board, ("Nf3", Cp(40)), ("Nc3", Cp(30)), ("d4", Cp(25)))
        g = grade(board, "Qh5", before, Cp(300), reply="Nf6")  # Black is +3 after Qh5
        assert g.win_after < 30
        assert g.classification == "blunder"
        assert g.retry_suggested

    def test_missed_mate_in_one(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")
        before = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)), ("Qf3", Cp(40)))
        g = grade(board, "Qf3", before, Cp(-40), reply="Nd4")
        assert g.missed_mate_in == 1
        assert g.classification == "miss"
        assert g.retry_suggested
        assert "checkmate in one" in describe_user_move(g, board)
        assert "Qxf7" not in describe_user_move(g, board)  # don't give the answer away

    def test_delivering_mate(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")
        before = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)))
        g = grade(board, "Qxf7#", before, Mate(0))
        assert g.delivers_mate
        assert g.classification == "best"
        assert g.eval_after.mate == 0 and g.eval_after.white_win == 100

    def test_allowing_mate(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4")
        before = fake_analysis(board, ("g6", Cp(-50)), ("Qe7", Cp(-60)), ("Qf6", Cp(-70)))
        g = grade(board, "Nf6", before, Mate(1), reply="Qxf7#")
        assert g.allows_mate_in == 1
        assert g.classification == "blunder"
        assert "checkmate in one" in describe_user_move(g, board)

    def test_recapture_is_not_described_as_winning_material(self):
        board = board_after("e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6")
        before = fake_analysis(board, ("dxc6", Cp(0)), ("bxc6", Cp(-10)))
        g = grade(board, "dxc6", before, Cp(0), reply="O-O")
        assert g.classification == "best"
        assert "wins" not in describe_user_move(g, board)


def test_better_moves_come_with_their_number():
    # Numbered ("3.Bb5"), the page can show the move on the board when it's pointed at.
    board = board_after("e4", "e5", "Nf3", "Nc6")
    before = fake_analysis(board, ("Bb5", Cp(40)))
    inaccuracy = grade(board, "d3", before, Cp(40), "d5")
    assert inaccuracy.classification == "inaccuracy"
    assert describe_user_move(inaccuracy, board).endswith(" 3.Bb5 was better.")
    good = grade(board, "d3", before, Cp(-8), "d5")
    assert good.classification == "good"
    assert describe_user_move(good, board) == "Good move. 3.Bb5 was a little stronger."
