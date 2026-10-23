"""What matters in a position (guide.plan, used by hints): the priority it picks, and that it never gives the move."""

import chess
import chess.engine
import pytest

from app.engine import Analysis, Line
from app.advice import hint, threat_answer
from app.guide import at_home, plan, stage
from tests.test_grading import board_after, fake_analysis

Cp, Mate = chess.engine.Cp, chess.engine.Mate


def threat_line(board, san, score=Cp(300)):
    passed = board.copy(stack=False)
    passed.push(chess.Move.null())
    return Line(score, (passed.parse_san(san),))


@pytest.mark.parametrize(
    ("moves", "best", "topic"),
    [
        (("e4", "e5"), "Nf3", "develop"),
        ((), "e4", "center"),
        (("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6"), "O-O", "castle"),
    ],
)
def test_quiet_priorities(moves, best, topic):
    board = board_after(*moves)
    p = plan(board, fake_analysis(board, (best, Cp(30))), None)
    assert p.topic == topic and not p.urgent


def test_threat_is_urgent():
    board = board_after("e4", "e5", "Qh5", "Nf6")  # the knight attacks the queen
    p = plan(board, fake_analysis(board, ("Qe2", Cp(0))), threat_line(board, "Nxh5", Cp(900)))
    assert p.topic == "threat" and p.urgent
    assert p.text == "Watch out: your queen on h5 is under attack. Find it a safe square."


def test_a_mate_to_find_is_urgent():
    board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")
    p = plan(board, fake_analysis(board, ("Qxf7#", Mate(1))), None)
    assert p.topic == "mate" and p.urgent


def test_check_comes_first():
    board = board_after("e4", "e5", "Bc4", "Bc5", "Bxf7+")
    p = plan(board, fake_analysis(board, ("Kxf7", Cp(200))), None)
    assert p.topic == "check" and p.urgent


def test_board_checks():
    board = board_after("e4", "e5", "Nf3", "Nc6")
    assert stage(board) == "opening"
    assert at_home(board, chess.WHITE) == ["knight on b1", "bishop on c1", "bishop on f1"]


def test_the_plan_never_contains_the_move():
    board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6")
    p = plan(board, fake_analysis(board, ("O-O", Cp(30))), None)
    assert p.topic == "castle" and "O-O" not in p.text


def test_a_chance_and_a_threat_together():
    board = board_after("e4", "e5", "Qh5", "Nf6")
    reply = board.copy()
    reply.push(board.parse_san("Qxe5+"))
    line = (board.parse_san("Qxe5+"), reply.parse_san("Be7"))
    p = plan(board, Analysis(board.turn, Cp(150), (Line(Cp(150), line),)), threat_line(board, "Nxh5", Cp(900)))
    assert p.topic == "material"
    assert p.text.startswith("Your queen on h5 is under attack, but there's also a chance to win material.")


def test_capturing_the_attacker():
    # From a real game: Black's knight on f5 attacks the queen on e3, and the best answer is 18.gxf5,
    # taking the knight. The coach used to say "move your queen out of danger".
    board = chess.Board("1k1r3r/ppp3pp/4Ppq1/5n2/2B3P1/4QN2/PPPN2P1/R3K3 w - - 0 18")
    p = plan(board, fake_analysis(board, ("gxf5", Cp(400))), threat_line(board, "Nxe3", Cp(900)))
    assert p.text == ("Your queen on e3 is under attack, but don't just move it away: see whether you can capture "
                      "the attacker. That also wins material.")


def test_threat_answers():
    # Black's knight on f5 attacks the queen on e3.
    board = chess.Board("1k1r3r/ppp3pp/4Ppq1/5n2/2B3P1/4QN2/PPPN2P1/R3K3 w - - 0 18")
    threat = threat_line(board, "Nxe3", Cp(900))
    assert threat_answer(board, board.parse_san("gxf5"), threat) == "capture"
    assert threat_answer(board, board.parse_san("Qe4"), threat) == "move"
    # No real threat (nothing to win), so nothing to answer.
    assert threat_answer(board, board.parse_san("gxf5"), threat_line(board, "a6", Cp(0))) is None


def test_mate_beats_answering_the_threat():
    # Black's knight on g3 attacks the rook on h1, but 6.Qxf7# ends the game.
    board = chess.Board("r1bqkb1r/pppp1ppp/8/4p3/2B1P3/5Qn1/PPPP1PP1/RNB1K2R w KQkq - 1 6")
    assert threat_answer(board, board.parse_san("Qxf7#"), threat_line(board, "Nxh1", Cp(500))) == "mate"


def test_check_names_the_king_and_the_checking_piece():
    # From a real game: after 24...Ne2+ the coach said "your king is in check from the knight", which was
    # read as the opponent's king. Now it says which king and which piece, and how to get out.
    board = chess.Board("r5k1/5pp1/7B/1B6/2pP4/2n2Q2/PPP2PPN/R5K1 b - - 0 24")
    board.push_san("Ne2+")
    analysis = fake_analysis(board, ("Qxe2", Cp(900)))
    p = plan(board, analysis, None)
    assert p.topic == "check" and p.urgent
    assert p.text == ("Your king on g1 is in check from the knight on e2. Before you move the king, see whether "
                      "you can capture the checking piece.")
    assert hint(board, analysis, None, 1, p).text == p.text
    assert hint(board, analysis, None, 3, p).text == (
        "The engine's move is 25.Qxe2. It gets you out of check by taking the checking piece."
    )
