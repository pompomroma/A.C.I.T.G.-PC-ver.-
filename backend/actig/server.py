"""ACTIG agent core server — FastAPI + WebSocket entrypoint.

The Electron shell connects here. The server:
  - completes the handshake (hello → welcome),
  - turns ``user_input`` into agent runs and streams tool/confirm/assistant events back,
  - bridges guarded-access confirmations (confirm_request ↔ confirm_response),
  - relays wake / voice-state / 3D / wallpaper / camera control messages,
  - reports component health via ``status``.

Run with ``python -m actig.server`` (or the ``actig`` console script).
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from . import __version__
from .agent import AgentLoop
from .config import get_settings
from .history import HistoryStore, init_db
from .lang import LanguageState
from .protocol import (
    ConfirmRequestPayload,
    Envelope,
    StatusComponents,
    StatusPayload,
    UserInputPayload,
    VoiceStatePayload,
    WelcomePayload,
    make_message,
)

app = FastAPI(title="ACTIG Core", version=__version__)

CAPABILITIES = [
    "text_chat",
    "voice_io",
    "wake_word",
    "guarded_system_access",
    "music",
    "project3d",
    "wallpaper",
    "camera_gestures",
    "history",
    "checkpoints",
    "multilingual",
]


class Connection:
    """Per-socket session: owns an agent loop and pending confirmations."""

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.history = HistoryStore()
        self.history.start_session(boot_id=uuid.uuid4().hex)
        self.lang = LanguageState()
        self.loop = AgentLoop(history=self.history, lang_state=self.lang)
        self._pending: dict[str, asyncio.Future[bool]] = {}
        self._send_lock = asyncio.Lock()

    async def send(self, type_: str, payload) -> None:
        async with self._send_lock:
            await self.ws.send_json(make_message(type_, payload))

    # emit callback used by the agent loop to stream tool events
    async def emit(self, type_: str, payload: dict) -> None:
        await self.send(type_, payload)

    # confirm callback used by the guarded ToolRegistry
    async def confirm(self, tool: str, description: str, risk: str) -> bool:
        call_id = uuid.uuid4().hex
        fut: asyncio.Future[bool] = asyncio.get_event_loop().create_future()
        self._pending[call_id] = fut
        await self.send(
            "confirm_request",
            ConfirmRequestPayload(
                callId=call_id, tool=tool, description=description, risk=risk
            ),
        )
        try:
            return await asyncio.wait_for(fut, timeout=120)
        except asyncio.TimeoutError:
            return False
        finally:
            self._pending.pop(call_id, None)

    def resolve_confirm(self, call_id: str, approved: bool) -> None:
        fut = self._pending.get(call_id)
        if fut and not fut.done():
            fut.set_result(approved)

    async def handle_user_input(self, payload: dict) -> None:
        ui = UserInputPayload(**payload)
        result = await self.loop.run(ui, emit=self.emit, confirm=self.confirm)
        await self.send("assistant_message", result)


@app.on_event("startup")
async def _startup() -> None:
    init_db()


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "version": __version__}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    conn = Connection(ws)
    await conn.send(
        "welcome", WelcomePayload(appVersion=__version__, capabilities=CAPABILITIES)
    )
    await conn.send(
        "status",
        StatusPayload(
            ok=True,
            components=StatusComponents(
                brain="ready", system="ready", wakeword="off", voice="ready"
            ),
        ),
    )
    try:
        while True:
            raw = await ws.receive_json()
            msg = Envelope(**raw)
            await _dispatch(conn, msg)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # keep the socket resilient
        await conn.send("error", {"code": "internal", "message": str(exc)})


async def _dispatch(conn: Connection, msg: Envelope) -> None:
    t = msg.type
    p = msg.payload or {}
    if t == "hello":
        await conn.send("welcome", WelcomePayload(appVersion=__version__, capabilities=CAPABILITIES))
    elif t == "ping":
        await conn.send("pong", {})
    elif t == "user_input":
        # run the turn without blocking the receive loop
        asyncio.create_task(conn.handle_user_input(p))
    elif t == "confirm_response":
        conn.resolve_confirm(p.get("callId", ""), bool(p.get("approved")))
    elif t == "interrupt":
        # barge-in: nothing to cancel server-side for text; voice manager handles audio
        await conn.send("tts_state", {"state": "stopped"})
    elif t == "voice_state":
        # echo authoritative state back to all UI surfaces
        await conn.send("voice_state", VoiceStatePayload(**p))
    elif t in ("wake", "sleep", "project3d", "wallpaper", "camera_gesture"):
        # these are coordinated by the shell across windows; the core just acks/logs them
        conn.history.add_turn("system", f"{t}:{p}", source="text")
        await conn.send(t, p)
    else:
        await conn.send("error", {"code": "unknown_type", "message": f"Unhandled: {t}"})


def main() -> None:
    import uvicorn

    s = get_settings()
    uvicorn.run("actig.server:app", host=s.host, port=s.port, log_level="info")


if __name__ == "__main__":
    main()
