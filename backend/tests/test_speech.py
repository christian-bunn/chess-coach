"""The coach's voice (Piper text to speech)."""

import asyncio
import io
import wave
from pathlib import Path

import pytest

from app.config import PROJECT_ROOT
from app.speech import Speech

REAL_VOICE = PROJECT_ROOT / "voices" / "en_US-lessac-medium.onnx"


def test_no_model_means_no_voice(tmp_path):
    for path in (None, tmp_path / "missing.onnx"):
        speech = Speech(path)
        speech.start()
        assert not speech.available


@pytest.mark.skipif(not REAL_VOICE.is_file(), reason="Piper voice not downloaded")
def test_real_voice_speaks():
    speech = Speech(REAL_VOICE)
    speech.start()
    audio = asyncio.run(speech.wav("Knight takes e4, check."))
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnframes() / wav.getframerate() > 0.5  # at least half a second of speech
