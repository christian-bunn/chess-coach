"""The coach's voice (Piper text to speech)."""

import asyncio
import io
import wave
from pathlib import Path

import pytest

from app.config import PROJECT_ROOT
from app.speech import PREFERRED_VOICE, SENTENCE_PAUSE, Speech, voice_label

VOICES = PROJECT_ROOT / "voices"
INSTALLED = sorted(p.stem for p in VOICES.glob("*.onnx")) if VOICES.is_dir() else []


def test_no_voices_means_no_speech(tmp_path):
    for folder in (None, tmp_path):
        speech = Speech(folder)
        speech.start()
        assert not speech.available and speech.voices() == []


def test_labels():
    assert voice_label("en_US-ryan-high") == "Ryan (high quality)"
    assert voice_label("en_US-joe-medium") == "Joe"
    assert voice_label("en_GB-northern_english_male-medium") == "Northern English Male (British)"


def seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio)) as wav:
        return wav.getnframes() / wav.getframerate()


@pytest.mark.skipif(not INSTALLED, reason="no Piper voices downloaded")
def test_real_voices():
    speech = Speech(VOICES)
    speech.start()
    if PREFERRED_VOICE in INSTALLED:
        assert speech.default == PREFERRED_VOICE
    one = asyncio.run(speech.wav("Knight takes e4, check."))
    two = asyncio.run(speech.wav("Knight takes e4, check. Now look at your queen."))
    assert seconds(one) > 0.5
    # The second sentence comes after a pause, not run straight on.
    assert seconds(two) > seconds(one) + SENTENCE_PAUSE
    with pytest.raises(ValueError):
        asyncio.run(speech.wav("Hello", "en_US-nobody-medium"))
