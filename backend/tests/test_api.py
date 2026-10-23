"""End-to-end API tests against a real Stockfish."""

import chess
import pytest
from fastapi.testclient import TestClient

from app.config import find_stockfish
from app.grading import grade_move
from app.levels import LEVELS
from app.main import app

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


def test_normal_opening_move_is_book(client):
    g = grade(client, ["e2e4"])
    assert g["classification"] == "book" and g["opening"] == "King's Pawn Game" and g["eco"] == "B00"
    assert g["message"] == "Book move. That's opening theory: the King's Pawn Game."
    assert not g["retry_suggested"]


def test_hanging_the_queen(client):
    g = grade(client, ["e2e4", "d7d5", "d1g4"])  # 2...Bxg4
    assert g["classification"] == "blunder"
    assert g["retry_suggested"]
    assert g["refutation"][0] == "Bxg4"
    assert g["message"] == "Blunder! 2.Qg4 puts your queen on g4, and 2...Bxg4 takes it."


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


def post(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_config_reports_the_voice(client):
    assert client.get("/api/config").json() == {"voice": False}


def test_hint_levels(client):
    payload = {"moves": SCHOLARS_SETUP, "student_color": "white"}
    assert post(client, "/api/hint", {**payload, "level": 1}) == {
        "text": "There's checkmate in one here. Look at every check you can give.", "square": None, "move": None,
    }
    assert post(client, "/api/hint", {**payload, "level": 2}) == {
        "text": "Look at your queen on h5. The move is a capture and a check.", "square": "h5", "move": None,
    }
    assert post(client, "/api/hint", {**payload, "level": 3}) == {
        "text": "The engine's move is 4.Qxf7#. It's checkmate.", "square": "h5", "move": "h5f7",
    }


def test_hint_only_on_the_students_move(client):
    response = client.post("/api/hint", json={"moves": SCHOLARS_SETUP, "student_color": "black", "level": 1})
    assert response.status_code == 409


class FakeSpeech:
    available = True
    default = "en_US-ryan-high"

    def voices(self):
        return ["en_US-joe-medium", "en_US-ryan-high"]

    async def wav(self, text, voice=None):
        if voice not in (None, *self.voices()):
            raise ValueError("Unknown voice")
        return b"RIFF" + text.encode()


def test_speech_without_a_voice(client):
    assert client.get("/api/config").json()["voice"] is False
    assert client.post("/api/speech", json={"text": "Hello"}).status_code == 503


def test_speech_returns_audio(client):
    real = client.app.state.speech
    client.app.state.speech = FakeSpeech()
    try:
        response = client.post("/api/speech", json={"text": "Knight takes e4"})
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert response.content == b"RIFFKnight takes e4"
        assert client.get("/api/config").json()["voice"] is True
        assert client.get("/api/voices").json() == {
            "voices": [{"name": "en_US-joe-medium", "label": "Joe"}, {"name": "en_US-ryan-high", "label": "Ryan (high quality)"}],
            "default": "en_US-ryan-high",
        }
        assert client.post("/api/speech", json={"text": "Hi", "voice": "en_US-joe-medium"}).status_code == 200
        assert client.post("/api/speech", json={"text": "Hi", "voice": "en_US-nobody"}).status_code == 400
    finally:
        client.app.state.speech = real
