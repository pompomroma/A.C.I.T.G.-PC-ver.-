"""Speech-to-text via faster-whisper (requirements 2, 11).

Whisper also reports the detected language, which we trust for the in/out language switch
(requirement 1). Heavy deps are lazy so the core imports without the voice extra.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import get_settings


@dataclass
class Transcript:
    text: str
    lang: str
    confidence: float


class STT:
    def __init__(self, model_size: str | None = None) -> None:
        self.model_size = model_size or get_settings().whisper_model
        self._model = None

    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401

            return True
        except Exception:
            return False

    def _ensure_model(self):  # pragma: no cover - heavy model load
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(self.model_size, device="auto", compute_type="int8")
        return self._model

    def transcribe(self, audio_path: str) -> Transcript:  # pragma: no cover - needs model
        model = self._ensure_model()
        segments, info = model.transcribe(audio_path, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        conf = float(getattr(info, "language_probability", 0.9) or 0.9)
        return Transcript(text=text, lang=info.language, confidence=conf)
