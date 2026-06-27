"""Voice manager — ties wake word, STT, TTS and VAD together and tracks mute state.

State it owns (requirement 5):
  - ``user_mic_muted``  : suppress STT capture of the user.
  - ``ai_speaker_muted``: suppress TTS output of ACTIG.
  - ``listening``       : whether a command capture is active.

Barge-in (requirement 12): while speaking, if the VAD detects user speech, TTS is stopped
and the manager flips to listening so the new utterance becomes the next turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable

from .stt import STT
from .tts import TTS
from .vad import VAD
from .wakeword import WakeWordDetector

OnWake = Callable[[], Awaitable[None]]


@dataclass
class VoiceFlags:
    user_mic_muted: bool = False
    ai_speaker_muted: bool = False
    listening: bool = False


class VoiceManager:
    def __init__(self, on_wake: OnWake) -> None:
        self.flags = VoiceFlags()
        self.tts = TTS()
        self.stt = STT()
        self.vad = VAD()
        self.wake = WakeWordDetector(on_wake)

    # ── lifecycle ───────────────────────────────────────────────────────
    async def start(self) -> None:
        await self.wake.start()

    async def stop(self) -> None:
        await self.wake.stop()

    # ── mute controls (requirement 5) ───────────────────────────────────
    def set_user_mic_muted(self, muted: bool) -> None:
        self.flags.user_mic_muted = muted

    def set_ai_speaker_muted(self, muted: bool) -> None:
        self.flags.ai_speaker_muted = muted
        self.tts.muted = muted

    # ── speech ──────────────────────────────────────────────────────────
    def speak(self, text: str, lang: str = "en") -> None:
        if not self.flags.ai_speaker_muted:
            self.tts.speak(text, lang)

    def greet(self) -> None:
        """Speak the fixed wake reaction (requirement 7)."""
        if not self.flags.ai_speaker_muted:
            self.tts.speak_reaction()

    def interrupt(self) -> None:
        """Barge-in: stop current speech so a new reply can take over (requirement 12)."""
        self.tts.stop()
        self.flags.listening = True

    def status(self) -> dict:
        return {
            "userMicMuted": self.flags.user_mic_muted,
            "aiSpeakerMuted": self.flags.ai_speaker_muted,
            "listening": self.flags.listening,
        }
