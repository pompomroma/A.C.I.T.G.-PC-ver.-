"""Language detection + switching (requirement 1: "switches language of (in/out)put
depending on the language of input").

For typed text we detect the language with ``langdetect``; for voice the STT engine
already returns a language code (Whisper detects it), which we trust over text detection.
The detected code is attached to the user turn and propagated to the assistant reply and
TTS so the whole turn round-trips in the user's language.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Minimal display-name map for the languages we most commonly handle; falls back to the
# raw code for anything else.
_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "zh-cn": "Chinese",
    "zh": "Chinese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "hi": "Hindi",
}


def language_name(code: str) -> str:
    return _NAMES.get(code.lower(), code)


def detect_language(text: str, default: str = "en") -> str:
    """Best-effort language code for a piece of typed text.

    Empty/very short strings can't be reliably detected, so we return ``default``.
    """
    cleaned = text.strip()
    if len(cleaned) < 2:
        return default
    try:
        from langdetect import detect  # imported lazily; optional at runtime

        return detect(cleaned)
    except Exception:
        return default


@dataclass
class LanguageState:
    """Tracks the active conversation language so out-of-band events (e.g. wake greeting)
    can be spoken in the right language too."""

    current: str = "en"
    history: list[str] = field(default_factory=list)

    def update(self, code: str | None) -> str:
        if code:
            self.current = code
            self.history.append(code)
            if len(self.history) > 50:
                self.history.pop(0)
        return self.current

    def resolve(self, text: str, stt_lang: str | None = None) -> str:
        """Decide the language for this turn: trust STT if present, else detect from text."""
        code = stt_lang or detect_language(text, default=self.current)
        return self.update(code)
