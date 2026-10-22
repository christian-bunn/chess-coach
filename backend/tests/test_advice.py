"""Hints and question facts: what each hint level reveals, and how mentioned moves are found."""

import chess
import chess.engine
import pytest

from app.advice import Hypothetical, asks_for_a_move, hint, mentioned_moves, position_facts
from app.engine import Analysis, Line
from app.grading import grade_move
from tests.test_grading import board_after, fake_analysis

Cp, Mate = chess.engine.Cp, chess.engine.Mate
SCHOLARS_SETUP = ("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6")  # White to move has Qxf7#


def sans(board, moves):
    return [board.san(m) for m in moves]


class TestMentionedMoves:
    board = board_after("e4", "e5", "Nf3", "Nc6")

    @pytest.mark.parametrize(
        ("question", "legal", "not_legal"),
        [
            ("what about Bb5?", ["Bb5"], []),
            ("should I play bc4 or d4", ["Bc4", "d4"], []),  # lowercase piece letters
            ("is knight to g5 good?", ["Ng5"], []),  # not also the pawn move "g5"
            ("why not Qh5?", [], ["Qh5"]),  # blocked by the knight on f3
            ("why did I play e4?", [], []),  # already played: not a proposal
            ("can I castle?", [], ["castling"]),  # the bishop is still on f1
            ("Nf3 is where the knight already is", [], []),
        ],
    )
    def test_questions(self, question, legal, not_legal):
        found, bad = mentioned_moves(self.board, question)
        assert sans(self.board, found) == legal
        assert bad == not_legal

    def test_castling_when_legal(self):
        board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5")
        found, _ = mentioned_moves(board, "should I castle now?")
        assert sans(board, found) == ["O-O"]

    def test_promotion(self):
        board = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
        found, _ = mentioned_moves(board, "what about a8=q or a8=N?")
        assert sans(board, found) == ["a8=Q", "a8=N"]

    def test_at_most_three(self):
        found, _ = mentioned_moves(chess.Board(), "a3 a4 b3 b4 c3 c4")
        assert len(found) == 3


class TestHintLevels:
    board = board_after(*SCHOLARS_SETUP)
    analysis = fake_analysis(board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)))

    def test_level_one_names_only_the_idea(self):
        h = hint(self.board, self.analysis, None, 1, chess.WHITE)
        assert "checkmate in 1" in h.facts
        assert "Qxf7" not in h.facts and "queen on h5" not in h.facts
        assert h.move is None
        assert h.template == "There's checkmate in one here. Look at every check you can give."

    def test_level_two_adds_the_piece(self):
        h = hint(self.board, self.analysis, None, 2, chess.WHITE)
        assert "student's queen on h5. It is a capture and a check." in h.facts
        assert "Qxf7" not in h.facts and h.move is None
        assert h.template == "Look at your queen on h5. The move is a capture and a check."

    def test_level_three_gives_the_move(self):
        h = hint(self.board, self.analysis, None, 3, chess.WHITE)
        assert "4.Qxf7#" in h.facts
        assert h.move == "h5f7"
        assert h.template == "The engine's move is 4.Qxf7#. It's checkmate."

    def test_winning_material(self):
        board = board_after("e4", "d5", "Qg4")  # Black can take the queen
        h = hint(board, fake_analysis(board, ("Bxg4", Cp(900))), None, 1, chess.BLACK)
        assert "win about 9 points" in h.facts
        assert h.template.startswith("There's a way to win material")

    def test_defending_against_a_threat(self):
        board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5")  # Black to move; White eyes f7
        passed = board.copy(stack=False)
        passed.push(chess.Move.null())
        threat = Line(Cp(300), tuple(passed.parse_san(s) for s in ("Nxf7",)))
        h = hint(board, fake_analysis(board, ("d5", Cp(0))), threat, 1, chess.BLACK)
        assert "dealing with the opponent's threat" in h.facts
        assert "5.Nxf7" in h.facts
        assert h.template.startswith("Your opponent is threatening something")

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
        h = hint(board, analysis, threat, 1, chess.WHITE)
        assert "can't keep the pawn on d5: every good move lets it go" in h.facts
        assert h.template.startswith("You can't hold on to everything here.")

    def test_quiet_position(self):
        board = chess.Board()
        h = hint(board, fake_analysis(board, ("e4", Cp(30))), None, 1, chess.WHITE)
        assert h.template.startswith("There's no immediate tactic")


class TestPositionFacts:
    def setup_method(self):
        self.before = board_after(*SCHOLARS_SETUP[:-1])
        self.board = board_after(*SCHOLARS_SETUP)
        last_before = fake_analysis(self.before, ("g6", Cp(-50)), ("Qe7", Cp(-60)))
        self.analysis = fake_analysis(self.board, ("Qxf7#", Mate(1)), ("Bxf7+", Cp(300)))
        self.last = grade_move(self.before, self.before.parse_san("Nf6"), last_before, self.analysis)

    def facts(self, **kwargs):
        defaults = dict(student_color=chess.WHITE, last=self.last, reveal_last_best=True, hypotheticals=[],
                        not_legal=[], show_best_moves=True)
        return position_facts(self.board, self.analysis, None, **{**defaults, **kwargs})

    def test_basics(self):
        text = self.facts()
        assert "It is White's move (the student)." in text
        assert "Last move (the computer opponent): 3...Nf6" in text
        assert "The engine's top moves for White (student): 4.Qxf7#" in text

    def test_best_moves_only_when_asked(self):
        assert "top moves" not in self.facts(show_best_moves=False)

    def test_hidden_best_for_the_students_last_move(self):
        board = board_after("e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "d3")  # White missed Qxf7#
        before = board_after(*SCHOLARS_SETUP)
        analysis = fake_analysis(board, ("Nxh5", Cp(700)))
        last = grade_move(before, before.parse_san("d3"), fake_analysis(before, ("Qxf7#", Mate(1))), analysis)
        text = position_facts(board, analysis, None, student_color=chess.WHITE, last=last,
                              reveal_last_best=False, hypotheticals=[], not_legal=[], show_best_moves=False)
        assert "Qxf7" not in text
        assert "offered a retry" in text

    def test_hypotheticals_and_illegal_moves(self):
        move = self.board.parse_san("Bxf7+")
        after_board = self.board.copy()
        after_board.push(move)
        after = Analysis(after_board.turn, Cp(-250), (Line(Cp(-250), (after_board.parse_san("Ke7"),)),))
        h = Hypothetical(move, grade_move(self.board, move, self.analysis, after), after)
        text = self.facts(hypotheticals=[h], not_legal=["Qh7"])
        assert "If White played 4.Bxf7+" in text
        assert "The best reply would be: 4...Ke7" in text
        assert "Mentioned but not legal for White right now: Qh7." in text


@pytest.mark.parametrize(
    ("question", "wants"),
    [
        ("What should I play?", True),
        ("what's the best move here", True),
        ("Can you suggest something?", True),
        ("Is my d5 pawn safe?", False),
        ("What about Nf5?", False),
        ("why was that a blunder", False),
    ],
)
def test_asks_for_a_move(question, wants):
    assert asks_for_a_move(question) is wants


def test_quiet_hint_follows_the_coachs_plan():
    from app.guide import plan

    board = board_after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6")
    analysis = fake_analysis(board, ("O-O", Cp(30)))
    h = hint(board, analysis, None, 1, chess.WHITE, plan(board, analysis, None))
    assert "getting the king to safety" in h.facts
    assert h.template == "Your king is still in the center. This is a good moment to castle and keep it safe."
