"""Voice-activity detection for barge-in (requirement 12).

While ACTIG is speaking, a lightweight VAD listens for the user starting to talk. On speech
onset it signals the manager to stop TTS and capture the new utterance, enabling
"interrupt + new reply". Uses webrtcvad when available.
"""

from __future__ import annotations


class VAD:
    def __init__(self, aggressiveness: int = 2) -> None:
        self.aggressiveness = aggressiveness
        self._vad = None

    def available(self) -> bool:
        try:
            import webrtcvad  # noqa: F401

            return True
        except Exception:
            return False

    def _ensure(self):  # pragma: no cover - needs lib
        if self._vad is None:
            import webrtcvad

            self._vad = webrtcvad.Vad(self.aggressiveness)
        return self._vad

    def is_speech(self, frame: bytes, sample_rate: int = 16000) -> bool:  # pragma: no cover
        try:
            return self._ensure().is_speech(frame, sample_rate)
        except Exception:
            return False
