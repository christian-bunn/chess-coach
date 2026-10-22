"""Why a move went wrong, and whether a threat is real: worked out from the engine's lines."""

import chess
import chess.engine

from app.engine import Analysis, Line
from app.facts import real_threat, why_bad
from app.grading import grade_move
from tests.test_grading import board_after, fake_analysis, grade

Cp, Mate = chess.engine.Cp, chess.engine.Mate
SCHOLARS_SETUP = ("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")  # White to move has Qxf7#


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
        assert r.coach_text() == "Your queen on h5 was already under attack, and 3.d3 didn't deal with it, so 3...Nxh5 wins it."

    def test_moving_onto_an_attacked_square(self):
        board = board_after("e4", "d5")
        r = self.reason(board, "Qg4", fake_analysis(board, ("exd5", Cp(50))), Cp(700), "Bxg4")
        assert r.kind == "hung"
        assert r.coach_text() == "2.Qg4 puts your queen on g4, and 2...Bxg4 takes it."

    def test_moving_a_defender_away(self):
        board = chess.Board("3r2k1/5ppp/8/3P4/8/2N5/5PPP/6K1 w - - 0 1")  # the knight guards d5
        r = self.reason(board, "Nb5", fake_analysis(board, ("Ne4", Cp(-50))), Cp(300), "Rxd5")
        assert r.kind == "defender"
        assert r.coach_text() == "1.Nb5 moves your knight away from guarding the pawn on d5, so 1...Rxd5 wins it."

    def test_missed_mate_comes_first(self):
        board = board_after(*SCHOLARS_SETUP)
        r = self.reason(board, "d3", fake_analysis(board, ("Qxf7#", Mate(1))), Cp(700), "Nxh5")
        assert r.kind == "missed_mate" and r.also.kind == "ignored"

    def test_an_even_trade_is_not_the_loss(self):
        # From a real game: after 10.O-O the rooks defend d1, so 10...Qxd1 is only a queen trade.
        # The real loss is the a4 bishop, attacked by the knight on b6 since 9...Nb6.
        board = board_after(*"e4 e5 Nc3 Nf6 Bb5 c6 Ba4 a5 d4 d5 dxe5 Nfd7 Nf3 dxe4 Bg5 Be7 Nxe4 Nb6".split())
        move = board.parse_san("O-O")
        after_board = board.copy()
        after_board.push(move)
        pv, b = [], after_board.copy()
        for san in ("Qxd1", "Raxd1", "Nxa4"):
            pv.append(b.parse_san(san))
            b.push(pv[-1])
        after = Analysis(after_board.turn, Cp(150), (Line(Cp(150), tuple(pv)),))
        g = grade_move(board, move, fake_analysis(board, ("Nd6+", Cp(370))), after)
        r = why_bad(board, move, g, tuple(pv))
        assert r.kind == "ignored" and r.piece == "bishop" and r.square == "a4"
        assert r.coach_text() == (
            "Your bishop on a4 was already under attack, and 10.O-O didn't deal with it, "
            "so after 10...Qxd1 11.Raxd1, 11...Nxa4 wins it."
        )

    def test_good_moves_have_no_reason(self):
        board = board_after("e4", "e5")
        g = grade(board, "Nf3", fake_analysis(board, ("Nf3", Cp(40))), Cp(-40), "Nc6")
        assert why_bad(board, board.parse_san("Nf3"), g, ()) is None


class TestRealThreat:
    def threat(self, board, san, score):
        passed = board.copy(stack=False)
        passed.push(chess.Move.null())
        return Line(score, (passed.parse_san(san),))

    def test_attacked_queen(self):
        board = board_after("e4", "e5", "Qh5", "Nf6")  # Black just attacked White's queen
        assert real_threat(board, self.threat(board, "Nxh5", Cp(800)))

    def test_mate_threat(self):
        board = board_after("e4", "e5", "Bc4", "Nc6", "Qh5")  # White threatens Qxf7#; Black to move
        assert real_threat(board, self.threat(board, "Qxf7#", Mate(1)))

    def test_a_quiet_move_is_no_threat(self):
        board = board_after("e4", "e5")
        assert not real_threat(board, self.threat(board, "Nc6", Cp(0)))
        assert not real_threat(board, None)
