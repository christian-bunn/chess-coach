"""The coach's guidance before the student's move: the priority it picks, and that it never gives the move."""

import chess
import chess.engine
import pytest

from app.engine import Analysis, Line
from app.guide import at_home, guide_facts, king_safety, plan, stage
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
    assert p.template == "Watch out: your queen on h5 is under attack. Deal with that before anything else."


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
    assert king_safety(board, chess.WHITE) == "is still on e1 and can castle kingside or queenside"


def test_guidance_never_contains_the_move():
    board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6")
    p = plan(board, fake_analysis(board, ("O-O", Cp(30))), None)
    text = guide_facts(board, p, None, chess.WHITE)
    assert "6.O-O" not in text and "O-O" not in text
    assert "castling is one of the engine's top choices" in text  # the plan, not the move


def test_a_chance_and_a_threat_together():
    board = board_after("e4", "e5", "Qh5", "Nf6")
    reply = board.copy()
    reply.push(board.parse_san("Qxe5+"))
    line = (board.parse_san("Qxe5+"), reply.parse_san("Be7"))
    p = plan(board, Analysis(board.turn, Cp(150), (Line(Cp(150), line),)), threat_line(board, "Nxh5", Cp(900)))
    assert p.topic == "material"
    assert p.template.startswith("Your queen on h5 is under attack, but there's also a chance to win material.")
