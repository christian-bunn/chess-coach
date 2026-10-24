"""The coach's voice (Piper text to speech)."""

import asyncio
import io
import wave
from pathlib import Path

import pytest

from app.config import PROJECT_ROOT
from app.speech import SENTENCE_PAUSE, VOICE, Speech

VOICES = PROJECT_ROOT / "voices"
INSTALLED = (VOICES / f"{VOICE}.onnx").is_file()


def test_no_voices_means_no_speech(tmp_path):
    for folder in (None, tmp_path):
        speech = Speech(folder)
        speech.start()
        assert not speech.available


def seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio)) as wav:
        return wav.getnframes() / wav.getframerate()


@pytest.mark.skipif(not INSTALLED, reason=f"the {VOICE} voice isn't downloaded")
def test_joes_voice():
    speech = Speech(VOICES)
    speech.start()
    assert speech.available
    one = asyncio.run(speech.wav("Knight takes e4, check."))
    two = asyncio.run(speech.wav("Knight takes e4, check. Now look at your queen."))
    assert seconds(one) > 0.5
    # The second sentence comes after a pause, not run straight on.
    assert seconds(two) > seconds(one) + SENTENCE_PAUSE
