"""The coach's voice: text to speech with Piper, a neural voice that runs locally on the CPU.

The audio is made here and played by the page, so speech works in any browser, including ones
without voices of their own (like the Claude desktop app's browser).
"""

from __future__ import annotations

import asyncio
import io
import logging
import wave
from pathlib import Path

log = logging.getLogger(__name__)

MAX_TEXT = 2000


class Speech:
    def __init__(self, model_path: Path | None):
        self.model_path = model_path
        self._voice = None
        # One synthesis at a time: they're short, and it keeps the voice object single-threaded.
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self._voice is not None

    def start(self) -> None:
        if self.model_path is None:
            return
        if not self.model_path.is_file():
            log.info("No voice model at %s, so the coach won't speak (see README: Speak)", self.model_path)
            return
        try:
            from piper import PiperVoice
        except ImportError:
            log.warning("piper-tts isn't installed, so the coach won't speak")
            return
        self._voice = PiperVoice.load(self.model_path)
        log.info("Coach voice: %s", self.model_path.name)

    def _synthesize(self, text: str) -> bytes:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            self._voice.synthesize_wav(text, wav)
        return buffer.getvalue()

    async def wav(self, text: str) -> bytes:
        """`text` spoken, as a WAV file."""
        if self._voice is None:
            raise RuntimeError("No voice loaded")
        async with self._lock:
            return await asyncio.to_thread(self._synthesize, text[:MAX_TEXT])
