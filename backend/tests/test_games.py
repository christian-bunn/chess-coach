"""Saved games: kept on disk, listed newest first, without their moves in the list."""

from datetime import UTC, datetime, timedelta

from app.games import GameStore

SNAPSHOT = {"plies": [{"uci": "e2e4", "san": "e4", "grade": None}], "evals": [None, None], "userColor": "white",
            "result": "Checkmate. You win!"}


def test_save_list_open_and_delete(tmp_path):
    now = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)
    store = GameStore(tmp_path / "games.json", lambda: now)
    first = store.add(SNAPSHOT, color="white", result="Checkmate. You win!", opponent="Casual (~1400)", accuracy=81.5)
    now += timedelta(hours=1)
    second = store.add(SNAPSHOT, color="black", result=None, opponent="Beginner (~800)")
    listed = store.list()
    assert [g["id"] for g in listed] == [second["id"], first["id"]]  # newest first
    assert listed[1] == {
        "id": first["id"], "saved": "2026-10-24T09:00:00+00:00", "moves": 1, "color": "white",
        "result": "Checkmate. You win!", "opponent": "Casual (~1400)", "assistance": None, "opening": None,
        "accuracy": 81.5, "opponent_accuracy": None,
    }
    assert "snapshot" not in listed[0]

    reloaded = GameStore(tmp_path / "games.json")
    assert reloaded.get(first["id"])["snapshot"] == SNAPSHOT
    assert reloaded.remove(first["id"]) and not reloaded.remove(first["id"])
    assert [g["id"] for g in GameStore(tmp_path / "games.json").list()] == [second["id"]]
