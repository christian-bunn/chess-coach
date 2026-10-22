"""The coach's voice: text to speech with Piper, neural voices that run locally on the CPU.

The audio is made here and played by the page, so speech works in any browser, including ones
without voices of their own (like the Claude desktop app's browser). Voices are Piper models in
./voices (see README: Speak); the student picks one in Settings.
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
# Used when no voice is chosen, if it's installed: the only high-quality male US voice.
PREFERRED_VOICE = "en_US-ryan-high"
# Piper reads each sentence separately and butts them together, which sounds rushed and choppy;
# a short pause between sentences sounds like someone talking.
SENTENCE_PAUSE = 0.3  # seconds
# A touch slower than the voices' default pace (1.0), for a calmer coaching tone.
LENGTH_SCALE = 1.06
# Piper also sets each sentence's volume separately; the whole comment is levelled to this peak instead.
PEAK = 0.9


def voice_label(name: str) -> str:
    """'en_US-ryan-high' -> 'Ryan (high quality)'."""
    locale, speaker, quality = (name.split("-") + ["", ""])[:3]
    label = speaker.replace("_", " ").title()
    notes = [n for n in ("British" if locale == "en_GB" else "", "high quality" if quality == "high" else "") if n]
    return label + (f" ({', '.join(notes)})" if notes else "")


class Speech:
    def __init__(self, voices_dir: Path | None, default: str | None = None):
        self.voices_dir = voices_dir
        self.default: str | None = default
        self._loaded: dict = {}
        self._piper = None
        # One synthesis at a time: they're short, and it keeps each voice object single-threaded.
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self._piper is not None and self.default is not None

    def voices(self) -> list[str]:
        """Installed voice names (each a .onnx model with its .onnx.json config)."""
        if self.voices_dir is None or not self.voices_dir.is_dir():
            return []
        return sorted(p.stem for p in self.voices_dir.glob("*.onnx") if p.with_suffix(".onnx.json").is_file())

    def start(self) -> None:
        installed = self.voices()
        if not installed:
            log.info("No voices in %s, so the coach won't speak (see README: Speak)", self.voices_dir)
            self.default = None
            return
        try:
            import piper
        except ImportError:
            log.warning("piper-tts isn't installed, so the coach won't speak")
            return
        self._piper = piper
        if self.default not in installed:
            self.default = PREFERRED_VOICE if PREFERRED_VOICE in installed else installed[0]
        self._voice(self.default)  # load the default now, so the first comment isn't delayed
        log.info("Coach voices: %s (default %s)", ", ".join(installed), self.default)

    def _voice(self, name: str):
        if name not in self._loaded:
            self._loaded[name] = self._piper.PiperVoice.load(self.voices_dir / f"{name}.onnx")
        return self._loaded[name]

    def _synthesize(self, text: str, name: str) -> bytes:
        voice = self._voice(name)
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

    async def wav(self, text: str, voice: str | None = None) -> bytes:
        """`text` spoken by `voice` (default: the default voice), as a WAV file."""
        if not self.available:
            raise RuntimeError("No voice available")
        name = voice or self.default
        if name not in self.voices():
            raise ValueError(f"Unknown voice {name!r}")
        async with self._lock:
            return await asyncio.to_thread(self._synthesize, text[:MAX_TEXT], name)
