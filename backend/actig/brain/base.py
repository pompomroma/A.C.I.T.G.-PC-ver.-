"""Common types for brain providers.

A *brain provider* turns a conversation (system prompt + message history) plus a set of
available tools into a result: assistant text, an optional list of tool invocations, and a
confidence score the router uses to decide whether to escalate from the local model to
Claude.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


@dataclass
class BrainMessage:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    # For role == "tool": which call this result answers.
    tool_call_id: str | None = None
    name: str | None = None


@dataclass
class ToolSpec:
    """Provider-agnostic description of a callable tool."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON-schema object


@dataclass
class ToolInvocation:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class BrainResult:
    text: str = ""
    tool_calls: list[ToolInvocation] = field(default_factory=list)
    # 0..1 self-rated confidence; the router escalates below a threshold.
    confidence: float = 1.0
    provider: str = "unknown"
    finish_reason: str = "stop"  # stop | tool_calls | error


class BrainProvider(Protocol):
    name: str

    async def available(self) -> bool:
        """Whether this provider is reachable/configured right now."""
        ...

    async def complete(
        self,
        messages: list[BrainMessage],
        tools: list[ToolSpec] | None = None,
    ) -> BrainResult:
        ...

    def stream(
        self,
        messages: list[BrainMessage],
        tools: list[ToolSpec] | None = None,
    ) -> AsyncIterator[str]:
        """Yield text chunks for live streaming to the UI (assistant_delta)."""
        ...
