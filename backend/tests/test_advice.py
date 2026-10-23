"""Hints: what each level reveals."""

import chess
import chess.engine

from app.advice import hint
from app.engine import Analysis, Line
from app.guide import plan
from tests.test_grading import board_after, fake_analysis

Cp, Mate = chess.engine.Cp, chess.engine.Mate
SCHOLARS_SETUP = ("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")  # White to move has Qxf7#


class TestHintLevels:
    board = board_after(*SCHOLARS_SETUP)
    analysis = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)))

    def test_level_one_names_only_the_idea(self):
        h = hint(self.board, self.analysis, None, 1)
        assert h.text == "There's checkmate in one here. Look at every check you can give."
        assert h.move is None and h.square is None

    def test_level_two_adds_the_piece(self):
        h = hint(self.board, self.analysis, None, 2)
        assert h.text == "Look at your queen on h5. The move is a capture and a check."
        assert h.square == "h5" and h.move is None

    def test_level_three_gives_the_move(self):
        h = hint(self.board, self.analysis, None, 3)
        assert h.move == "h5f7"
        assert h.text == "The engine's move is 4.Qxf7#. It's checkmate."

    def test_winning_material(self):
        board = board_after("e4", "d5", "Qg4")  # Black can take the queen
        h = hint(board, fake_analysis(board, ("Bxg4", Cp(900))), None, 1)
        assert h.text.startswith("There's a way to win material")
        assert hint(board, fake_analysis(board, ("Bxg4", Cp(900))), None, 3).text == (
            "The engine's move is 2...Bxg4. It wins about 9 points of material."
        )

    def test_defending_against_a_threat(self):
        board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5")  # Black to move; White eyes f7
        passed = board.copy(stack=False)
        passed.push(chess.Move.null())
        threat = Line(Cp(300), tuple(passed.parse_san(s) for s in ("Nxf7",)))
        h = hint(board, fake_analysis(board, ("d5", Cp(0))), threat, 1)
        assert h.text.startswith("Your opponent is threatening something")

    def test_conceding_material_when_the_threat_cant_be_parried(self):
        board = board_after("e4", "d5", "exd5", "Nf6")  # White is a pawn up, but d5 will fall
        analysis = fake_analysis(board, ("Nf3", Cp(20)))
        best = analysis.best
        reply = board.copy()
        reply.push(best.move)
        line = (best.move, reply.parse_san("Nxd5"))
        analysis = Analysis(board.turn, Cp(20), (Line(Cp(20), line),))
        passed = board.copy(stack=False)
        passed.push(chess.Move.null())
        threat = Line(Cp(100), (passed.parse_san("Nxd5"),))  # Black threatens to take the pawn back
        h = hint(board, analysis, threat, 1)
        assert h.text.startswith("You can't hold on to everything here.")

    def test_quiet_position(self):
        board = chess.Board()
        h = hint(board, fake_analysis(board, ("e4", Cp(30))), None, 1)
        assert h.text.startswith("There's no immediate tactic")


def test_quiet_hint_follows_the_coachs_plan():
    board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6")
    analysis = fake_analysis(board, ("O-O", Cp(30)))
    h = hint(board, analysis, None, 1, plan(board, analysis, None))
    assert h.text == "Your king is still in the center. This is a good moment to castle and keep it safe."


def test_a_pawn_won_back_straight_away_is_not_a_gain():
    # From a real game: after 1.f3 d5 the engine's line takes a pawn with 4.dxc5 that ...Bxc5 wins back just
    # after the counted moves. The coach called it "a chance to win material"; the evaluation is -0.38.
    board = board_after("f3", "d5")
    line, b = [], board.copy()
    for san in "d4 c5 e4 Nc6 dxc5 e6 Be3 d4".split():
        line.append(b.parse_san(san))
        b.push(line[-1])
    analysis = Analysis(board.turn, Cp(-38), (Line(Cp(-38), tuple(line)),))
    assert hint(board, analysis, None, 1).text.startswith("There's no immediate tactic")
    assert plan(board, analysis, None).topic == "center"
