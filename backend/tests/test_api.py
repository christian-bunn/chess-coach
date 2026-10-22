"""End-to-end API tests against a real Stockfish."""

import json
from types import SimpleNamespace

import chess
import pytest
from fastapi.testclient import TestClient

from app.config import find_stockfish
from app.explain import Explainer
from app.grading import grade_move
from app.levels import LEVELS
from app.main import app
from tests.test_explain import FakeClient, text

try:
    find_stockfish()
except RuntimeError:
    pytest.skip("Stockfish is not installed", allow_module_level=True)

SCHOLARS_SETUP = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6"]  # Black's last move allows Qxf7#


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def grade(client, moves):
    response = client.post("/api/grade", json={"moves": moves})
    assert response.status_code == 200, response.text
    return response.json()


def test_health(client):
    assert client.get("/api/health").json()["engine"].startswith("Stockfish")


def test_start_position_is_roughly_equal(client):
    ev = client.post("/api/analyze", json={"moves": []}).json()["eval"]
    assert 45 < ev["white_win"] < 60


def test_normal_opening_move_is_fine(client):
    g = grade(client, ["e2e4"])
    assert g["classification"] in {"best", "great", "excellent", "good"}
    assert not g["retry_suggested"]


def test_hanging_the_queen(client):
    g = grade(client, ["e2e4", "d7d5", "d1g4"])  # 2...Bxg4
    assert g["classification"] == "blunder"
    assert g["retry_suggested"]
    assert g["refutation"][0] == "Bxg4"
    assert g["message"] == "Blunder! 2.Qg4 puts your queen on g4, where 2...Bxg4 takes it."


def test_allowing_mate(client):
    g = grade(client, SCHOLARS_SETUP)
    assert g["allows_mate_in"] == 1
    assert g["classification"] == "blunder"


def test_delivering_mate(client):
    g = grade(client, SCHOLARS_SETUP + ["h5f7"])
    assert g["delivers_mate"] and g["classification"] == "best"
    assert g["message"] == "Checkmate! Well played."


def test_missing_mate_in_one(client):
    # Back-rank mate with Ra8#; h3 is still completely winning, so it's a "miss", not a blunder.
    board = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1")
    engines = client.app.state.engines
    move = board.parse_uci("h2h3")
    after = board.copy()
    after.push(move)
    before_analysis = client.portal.call(engines.analyse, board)
    after_analysis = client.portal.call(engines.analyse, after)
    g = grade_move(board, move, before_analysis, after_analysis)
    assert g.classification == "miss"
    assert g.missed_mate_in == 1
    assert g.best_san == "Ra8#"
    assert g.retry_suggested


def test_missing_mate_and_hanging_the_queen(client):
    g = grade(client, SCHOLARS_SETUP + ["d2d3"])  # 4...Nxh5
    assert g["classification"] == "blunder"
    assert g["missed_mate_in"] == 1
    assert "checkmate in one" in g["message"]


@pytest.mark.parametrize("level", [level.id for level in LEVELS])
def test_bot_plays_a_legal_move_at_every_level(client, level):
    moves = ["e2e4", "e7e5", "g1f3"]
    response = client.post("/api/bot-move", json={"moves": moves, "level": level})
    assert response.status_code == 200, response.text
    board = chess.Board()
    for uci in moves:
        board.push_uci(uci)
    assert chess.Move.from_uci(response.json()["uci"]) in board.legal_moves


def test_rejects_illegal_moves(client):
    assert client.post("/api/grade", json={"moves": ["e2e5"]}).status_code == 400
    assert client.post("/api/grade", json={"moves": ["zz"]}).status_code == 400


def test_rejects_unknown_level(client):
    assert client.post("/api/bot-move", json={"moves": [], "level": "nope"}).status_code == 400


def test_bot_refuses_to_move_after_game_over(client):
    fools_mate = ["f2f3", "e7e5", "g2g4", "d8h4"]
    assert client.post("/api/bot-move", json={"moves": fools_mate}).status_code == 409


def explain(client, moves, **extra):
    response = client.post("/api/explain", json={"moves": moves, "student_color": "white", **extra})
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines()]


def use_explainer(client, fake):
    settings = SimpleNamespace(coach_model="claude-opus-5-5", coach_effort="low", coach_ai=False)
    client.app.state.explainer = Explainer(settings, client=fake, enabled=fake is not None)


def test_explain_falls_back_to_the_template_without_claude(client):
    use_explainer(client, None)
    assert client.get("/api/config").json() == {"coach_ai": False, "model": None, "via": None}
    events = explain(client, ["e2e4", "d7d5", "d1g4"])
    assert events == [{"type": "done", "text": "Blunder! 2.Qg4 puts your queen on g4, where 2...Bxg4 takes it.", "source": "template"}]


def test_explain_streams_claudes_comment_from_the_fact_sheet(client):
    fake = FakeClient([text("Your queen "), text("is hanging.")])
    use_explainer(client, fake)
    events = explain(client, ["e2e4", "d7d5", "d1g4"], reveal_best=False)
    assert events[-1] == {"type": "done", "text": "Your queen is hanging.", "source": "claude"}
    facts = fake.calls[0]["messages"][0]["content"]
    assert "2...Bxg4 (Black bishop on c8 takes White queen on g4)" in facts
    # The best move (2.exd5) stays hidden while a retry is on offer.
    assert "2.exd5" not in facts and "preferred move" not in facts


def test_explain_opponent_move(client):
    fake = FakeClient([text("Your opponent develops.")])
    use_explainer(client, fake)
    events = explain(client, ["e2e4", "e7e5", "g1f3", "b8c6"])
    assert events[-1]["source"] == "claude"
    assert "computer opponent's move" in fake.calls[0]["messages"][0]["content"]


def test_explain_falls_back_when_claude_fails(client):
    use_explainer(client, FakeClient([text("half")], final_message=SimpleNamespace(stop_reason="refusal")))
    events = explain(client, ["e2e4", "d7d5", "d1g4"])
    assert [e["type"] for e in events] == ["text", "reset", "done"]
    assert events[-1]["source"] == "template"


def test_explain_falls_back_on_unexpected_errors(client):
    use_explainer(client, FakeClient([text("half"), RuntimeError("bug")]))
    events = explain(client, ["e2e4", "d7d5", "d1g4"])
    assert events[-1] == {"type": "done", "text": "Blunder! 2.Qg4 puts your queen on g4, where 2...Bxg4 takes it.", "source": "template"}


def stream_events(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines()]


def test_hint_without_claude_uses_the_template(client):
    use_explainer(client, None)
    events = stream_events(client, "/api/hint", {"moves": SCHOLARS_SETUP, "student_color": "white", "level": 1})
    assert events == [{"type": "done", "text": "There's checkmate in one here. Look at every check you can give.",
                       "source": "template"}]


def test_last_hint_level_sends_the_move_first(client):
    use_explainer(client, FakeClient([text("Take on f7 with the queen.")]))
    events = stream_events(client, "/api/hint", {"moves": SCHOLARS_SETUP, "student_color": "white", "level": 3})
    assert events[0] == {"type": "move", "uci": "h5f7"}
    assert events[-1]["source"] == "claude"


def test_hint_only_on_the_students_move(client):
    response = client.post("/api/hint", json={"moves": SCHOLARS_SETUP, "student_color": "black", "level": 1})
    assert response.status_code == 409


def test_ask_without_claude_explains_how_to_turn_it_on(client):
    use_explainer(client, None)
    events = stream_events(client, "/api/ask", {"moves": ["e2e4"], "student_color": "white", "question": "Why?"})
    assert events[-1]["source"] == "template" and "Claude Code" in events[-1]["text"]


def test_ask_checks_the_moves_in_the_question(client):
    fake = FakeClient([text("Bxf7+ wins a pawn but...")])
    use_explainer(client, fake)
    payload = {
        "moves": SCHOLARS_SETUP, "student_color": "white", "question": "What about Bxf7+ or Ra3?",
        "history": [{"question": "Who is better?", "answer": "You are."}],
    }
    events = stream_events(client, "/api/ask", payload)
    assert events[-1]["source"] == "claude"
    prompt = fake.calls[0]["messages"][0]["content"]
    assert "If White played 4.Bxf7+" in prompt
    assert "Mentioned but not legal for White right now: Ra3." in prompt  # the a2 pawn is in the way
    assert prompt.startswith("Earlier in this conversation:\nStudent: Who is better?\nCoach: You are.")
    assert prompt.endswith("The student's question: What about Bxf7+ or Ra3?")
    assert fake.calls[0]["system"][0]["text"].startswith("You are a friendly, expert chess coach answering")
