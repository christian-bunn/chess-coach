"""The coach's voice: text to speech with Piper, neural voices that run locally on the CPU.

The audio is made here and played by the page, so speech works in any browser, including ones
without voices of their own (like the Claude desktop app's browser). The voice is Joe, a natural
US male voice: the Piper model en_US-joe-medium in ./voices (see README: Speak).
"""

from __future__ import annotations

import asyncio
import io
import logging
import wave
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

MAX_TEXT = 2000
VOICE = "en_US-joe-medium"
# Piper reads each sentence separately and butts them together, which sounds rushed and choppy;
# a short pause between sentences sounds like someone talking.
SENTENCE_PAUSE = 0.3  # seconds
# A touch slower than the voice's default pace (1.0), for a calmer coaching tone.
LENGTH_SCALE = 1.06
# Piper also sets each sentence's volume separately; the whole comment is levelled to this peak instead.
PEAK = 0.9


class Speech:
    def __init__(self, voices_dir: Path | None, name: str = VOICE):
        self.voices_dir = voices_dir
        self.name = name
        self._voice = None
        self._piper = None
        # One synthesis at a time: they're short, and it keeps the voice object single-threaded.
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self._voice is not None

    def start(self) -> None:
        model = self.voices_dir / f"{self.name}.onnx" if self.voices_dir else None
        if model is None or not model.is_file() or not model.with_suffix(".onnx.json").is_file():
            log.info("No %s voice in %s, so the coach won't speak (see README: Speak)", self.name, self.voices_dir)
            return
        try:
            import piper
        except ImportError:
            log.warning("piper-tts isn't installed, so the coach won't speak")
            return
        self._piper = piper
        self._voice = piper.PiperVoice.load(model)  # loaded now, so the first comment isn't delayed
        log.info("Coach voice: %s", self.name)

    def _synthesize(self, text: str) -> bytes:
        voice = self._voice
        config = self._piper.SynthesisConfig(length_scale=LENGTH_SCALE, normalize_audio=False)
        pieces: list[np.ndarray] = []
        rate = voice.config.sample_rate
        for chunk in voice.synthesize(text, syn_config=config):
            rate = chunk.sample_rate
            if pieces:
                pieces.append(np.zeros(int(rate * SENTENCE_PAUSE), dtype=np.float32))
            pieces.append(chunk.audio_float_array)
        audio = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
        peak = float(np.max(np.abs(audio)))
        if peak > 1e-6:
            audio = audio * (PEAK / peak)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes((np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16).tobytes())
        return buffer.getvalue()

    async def wav(self, text: str) -> bytes:
        """`text` spoken by the coach's voice, as a WAV file."""
        if not self.available:
            raise RuntimeError("No voice available")
        async with self._lock:
            return await asyncio.to_thread(self._synthesize, text[:MAX_TEXT])
