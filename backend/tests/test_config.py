import os

from app.config import load_env_file

KEYS = ("COACH_TEST_PLAIN", "COACH_TEST_QUOTED", "COACH_TEST_EXPORTED", "COACH_TEST_PRESET")


def test_load_env_file(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text(
        "# a comment\n"
        "\n"
        "COACH_TEST_PLAIN=plain\n"
        'COACH_TEST_QUOTED="quoted value"\n'
        "export COACH_TEST_EXPORTED=exported\n"
        "COACH_TEST_PRESET=from-file\n"
        "not a setting\n"
    )
    monkeypatch.setenv("COACH_TEST_PRESET", "from-shell")
    try:
        load_env_file(env)
        assert os.environ["COACH_TEST_PLAIN"] == "plain"
        assert os.environ["COACH_TEST_QUOTED"] == "quoted value"
        assert os.environ["COACH_TEST_EXPORTED"] == "exported"
        assert os.environ["COACH_TEST_PRESET"] == "from-shell"  # the shell wins
    finally:
        for key in KEYS[:3]:
            os.environ.pop(key, None)


def test_missing_env_file_is_fine(tmp_path):
    load_env_file(tmp_path / ".env")
