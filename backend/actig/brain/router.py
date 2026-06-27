"""Hybrid brain router (the user's chosen "Hybrid" brain).

Policy:
  1. If the turn looks hard (tool use likely, long/complex, or explicitly flagged), go
     straight to Claude for best fluency + cognition.
  2. Otherwise try the local Ollama model first (fast, offline, private).
  3. If the local model is unavailable or returns low confidence (< escalate_threshold),
     escalate to Claude.

Providers are pluggable, so tests can inject fakes. The router never raises on provider
failure — it degrades to whichever brain is reachable and reports that in the result.
"""

from __future__ import annotations

import re

from ..config import get_settings
from .base import BrainMessage, BrainProvider, BrainResult, ToolSpec
from .claude_provider import ClaudeProvider
from .ollama_provider import OllamaProvider

# Heuristic signals that a turn benefits from the stronger model.
_HARD_HINTS = re.compile(
    r"\b(plan|debug|analy[sz]e|refactor|explain why|step by step|compare|design|"
    r"strategy|prove|optimi[sz]e|translate the following|write code|implement)\b",
    re.IGNORECASE,
)


def _looks_hard(messages: list[BrainMessage], has_tools: bool) -> bool:
    last_user = next((m for m in reversed(messages) if m.role == "user"), None)
    if not last_user:
        return False
    text = last_user.content
    if has_tools:
        return True  # agentic tool selection → use the strong model
    if len(text) > 400:
        return True
    return bool(_HARD_HINTS.search(text))


class HybridBrain:
    def __init__(
        self,
        local: BrainProvider | None = None,
        cloud: BrainProvider | None = None,
        threshold: float | None = None,
    ) -> None:
        self.local = local or OllamaProvider()
        self.cloud = cloud or ClaudeProvider()
        self.threshold = threshold if threshold is not None else get_settings().escalate_threshold

    async def complete(
        self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None
    ) -> BrainResult:
        hard = _looks_hard(messages, bool(tools))

        if hard and await self.cloud.available():
            return await self.cloud.complete(messages, tools)

        if await self.local.available():
            result = await self.local.complete(messages, tools)
            if result.finish_reason != "error" and result.confidence >= self.threshold:
                return result
            # low confidence / local error → escalate if we can
            if await self.cloud.available():
                escalated = await self.cloud.complete(messages, tools)
                if escalated.finish_reason != "error":
                    return escalated
            return result  # best we have

        # local unavailable → cloud, else a graceful offline message
        if await self.cloud.available():
            return await self.cloud.complete(messages, tools)

        return BrainResult(
            text=(
                "I can't reach my reasoning models right now — the local Ollama model isn't "
                "running and no Claude API key is configured. Start Ollama or add an API key "
                "in settings and I'll be right back."
            ),
            confidence=0.0,
            provider="none",
            finish_reason="error",
        )

    async def which(self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None) -> str:
        """Expose the routing decision (used for transparency / tests)."""
        if _looks_hard(messages, bool(tools)) and await self.cloud.available():
            return "claude"
        if await self.local.available():
            return "ollama"
        return "claude" if await self.cloud.available() else "none"
