"""ACTIG WebSocket protocol — Python mirror of ``packages/shared/src/protocol.ts``.

Both sides exchange the same JSON envelope ``{id, type, ts, payload}``. These Pydantic
models give the backend validation + autocompletion while keeping the wire format
identical to the TypeScript definitions. Keep the two files in lock-step.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

PROTOCOL_VERSION = 1

MessageType = Literal[
    "hello",
    "welcome",
    "ping",
    "pong",
    "status",
    "wake",
    "sleep",
    "user_input",
    "assistant_delta",
    "assistant_message",
    "interrupt",
    "voice_state",
    "tts_state",
    "tool_call",
    "tool_result",
    "confirm_request",
    "confirm_response",
    "project3d",
    "wallpaper",
    "camera_gesture",
    "set_secret",
    "get_status",
    "audio_input",
    "error",
]

InputSource = Literal["text", "voice", "emergency", "hotkey"]
RiskLevel = Literal["read", "safe_write", "sensitive", "system"]
ShapeKind = Literal[
    "cube", "sphere", "cylinder", "cone", "torus", "plane", "tetrahedron", "icosahedron"
]


class Envelope(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    type: MessageType
    ts: int = Field(default_factory=lambda: int(time.time() * 1000))
    payload: dict[str, Any] = Field(default_factory=dict)


# ── conversation ────────────────────────────────────────────────────────


class UserInputPayload(BaseModel):
    text: str
    source: InputSource = "text"
    lang: Optional[str] = None
    confidence: Optional[float] = None


class ChoiceChip(BaseModel):
    id: str
    label: str
    kind: Literal["option", "recommendation"]
    command: Optional[str] = None


class ProcessStep(BaseModel):
    step: str
    status: Literal["pending", "running", "succeeded", "failed"]
    detail: Optional[str] = None


class AssistantMessagePayload(BaseModel):
    """Rich assistant turn. Each field maps to a numbered requirement (see protocol.ts)."""

    text: str
    lang: str = "en"
    errorExplanation: Optional[str] = None  # req 1.(2-1)
    qa: Optional[str] = None  # req 1.(2-2)
    process: Optional[list[ProcessStep]] = None  # req 1.(2-3)
    eta: Optional[str] = None  # req 1.(2-4)
    options: Optional[list[ChoiceChip]] = None  # req 1.(3)
    recommendations: Optional[list[ChoiceChip]] = None  # req 1.(4)
    brain: Optional[Literal["ollama", "claude"]] = None
    continues: bool = False


# ── voice ───────────────────────────────────────────────────────────────


class VoiceStatePayload(BaseModel):
    userMicMuted: Optional[bool] = None
    aiSpeakerMuted: Optional[bool] = None
    listening: Optional[bool] = None


# ── guarded tools ───────────────────────────────────────────────────────


class ToolCallPayload(BaseModel):
    callId: str
    tool: str
    summary: str
    risk: RiskLevel
    args: Optional[dict[str, Any]] = None


class ToolResultPayload(BaseModel):
    callId: str
    ok: bool
    summary: str
    artifactId: Optional[str] = None
    error: Optional[str] = None


class ConfirmRequestPayload(BaseModel):
    callId: str
    tool: str
    description: str
    risk: RiskLevel


class ConfirmResponsePayload(BaseModel):
    callId: str
    approved: bool
    scope: Optional[Literal["once", "always"]] = None


# ── wake / 3D / status ──────────────────────────────────────────────────


class WakePayload(BaseModel):
    source: InputSource = "voice"
    greet: bool = True


class WallpaperPayload(BaseModel):
    enabled: bool


class CameraGesturePayload(BaseModel):
    enabled: bool
    drag: Optional[bool] = None
    scale: Optional[bool] = None


class StatusComponents(BaseModel):
    brain: Optional[Literal["ready", "degraded", "down"]] = None
    voice: Optional[Literal["ready", "degraded", "down"]] = None
    wakeword: Optional[Literal["listening", "off"]] = None
    system: Optional[Literal["ready", "down"]] = None


class StatusPayload(BaseModel):
    ok: bool
    components: StatusComponents = Field(default_factory=StatusComponents)
    message: Optional[str] = None


class ErrorPayload(BaseModel):
    code: str
    message: str


class WelcomePayload(BaseModel):
    protocolVersion: int = PROTOCOL_VERSION
    appVersion: str = "0.1.0"
    capabilities: list[str] = Field(default_factory=list)


def make_message(type_: MessageType, payload: BaseModel | dict[str, Any]) -> dict[str, Any]:
    """Build a wire-ready envelope dict from a payload model or plain dict."""
    body = payload.model_dump(exclude_none=True) if isinstance(payload, BaseModel) else payload
    return Envelope(type=type_, payload=body).model_dump()
