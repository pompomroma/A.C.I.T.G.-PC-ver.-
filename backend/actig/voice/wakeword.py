"""Wake-word detection for "wake up ACTIG" (requirements 6, 3, 15).

Uses openWakeWord with a custom keyword model when the optional voice extra is installed.
The detector runs continuously on a low-power audio stream so ACTIG can be woken from any
screen. If the model/audio stack is unavailable, ``available()`` is False and the system
relies on the emergency button + hotkey + text instead (the app never hard-fails).
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from ..config import get_settings

OnWake = Callable[[], Awaitable[None]]


class WakeWordDetector:
    def __init__(self, on_wake: OnWake, phrase: str | None = None) -> None:
        self.on_wake = on_wake
        self.phrase = phrase or get_settings().wake_phrase
        self._task: asyncio.Task | None = None
        self._running = False
        self._model = None

    def available(self) -> bool:
        try:
            import openwakeword  # noqa: F401
            import sounddevice  # noqa: F401

            return True
        except Exception:
            return False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:  # pragma: no cover - needs audio hardware
        if not self.available():
            return
        import numpy as np
        import sounddevice as sd
        from openwakeword.model import Model

        # A bundled custom model trained for "wake up ACTIG" ships under assets/models.
        self._model = Model(wakeword_models=["wake_up_actig"])
        sample_rate = 16000
        block = 1280  # 80ms frames
        loop = asyncio.get_running_loop()

        def callback(indata, _frames, _time, _status):
            audio = (indata[:, 0] * 32767).astype(np.int16)
            scores = self._model.predict(audio)
            if max(scores.values(), default=0.0) > 0.5:
                loop.call_soon_threadsafe(lambda: asyncio.ensure_future(self.on_wake()))

        with sd.InputStream(
            samplerate=sample_rate, blocksize=block, channels=1, callback=callback
        ):
            while self._running:
                await asyncio.sleep(0.1)
