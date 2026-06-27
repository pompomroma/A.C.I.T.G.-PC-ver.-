"""Text-to-speech via Piper (requirements 2, 7).

Piper is a fast local neural TTS with multilingual voices, so ACTIG can speak the wake
reaction and replies in the user's language. Playback is interruptible (requirement 12):
``stop()`` halts the current utterance for barge-in. Heavy deps are lazy.
"""

from __future__ import annotations

import threading

from ..config import get_settings


class TTS:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self.muted = False  # AI speaker mute (requirement 5)

    def available(self) -> bool:
        try:
            import piper  # noqa: F401

            return True
        except Exception:
            return False

    def stop(self) -> None:
        """Interrupt current speech (barge-in)."""
        self._stop.set()

    def speak(self, text: str, lang: str = "en") -> None:  # pragma: no cover - audio out
        if self.muted or not text.strip():
            return
        self._stop.clear()
        with self._lock:
            try:
                self._speak_piper(text, lang)
            except Exception:
                # Fall back to the OS voice if Piper isn't set up.
                self._speak_os(text)

    def speak_reaction(self) -> None:
        """The fixed wake reaction (requirement 7)."""
        self.speak(get_settings().wake_reaction, lang="en")

    # ── backends ────────────────────────────────────────────────────────
    def _speak_piper(self, text: str, lang: str) -> None:  # pragma: no cover
        import sounddevice as sd
        from piper import PiperVoice

        voice = PiperVoice.load(self._voice_path(lang))
        for chunk in voice.synthesize_stream_raw(text):
            if self._stop.is_set():
                break
            sd.play(chunk, samplerate=voice.config.sample_rate)
            sd.wait()

    def _speak_os(self, text: str) -> None:  # pragma: no cover
        import sys

        if sys.platform == "win32":
            import win32com.client  # type: ignore

            win32com.client.Dispatch("SAPI.SpVoice").Speak(text)

    def _voice_path(self, lang: str) -> str:
        from ..config import get_settings as _gs

        voices = _gs().data_dir.parent / "assets" / "voices"
        # Map language → bundled voice file; default to English.
        mapping = {"en": "en_US.onnx", "ja": "ja_JP.onnx", "es": "es_ES.onnx"}
        return str(voices / mapping.get(lang, "en_US.onnx"))
