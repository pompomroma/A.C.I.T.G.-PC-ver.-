"""Fake brain providers for deterministic tests (no network / no Ollama)."""

from __future__ import annotations

from actig.brain.base import BrainMessage, BrainResult, ToolInvocation, ToolSpec


class FakeProvider:
    def __init__(self, name: str, available: bool = True, script=None, confidence: float = 0.9):
        self.name = name
        self._available = available
        # script: list of BrainResult to return on successive complete() calls
        self._script = list(script or [])
        self._confidence = confidence
        self.calls = 0

    async def available(self) -> bool:
        return self._available

    async def complete(self, messages, tools=None):
        self.calls += 1
        if self._script:
            return self._script.pop(0)
        last = next((m for m in reversed(messages) if m.role == "user"), None)
        return BrainResult(
            text=f"[{self.name}] {last.content if last else ''}",
            confidence=self._confidence,
            provider=self.name,
        )

    async def stream(self, messages, tools=None):
        yield f"[{self.name}] streamed"


def tool_call_result(tool: str, args: dict, call_id: str = "c1") -> BrainResult:
    return BrainResult(
        text="",
        tool_calls=[ToolInvocation(id=call_id, name=tool, arguments=args)],
        provider="fake",
        finish_reason="tool_calls",
    )


def final_result(text: str, provider: str = "fake") -> BrainResult:
    return BrainResult(text=text, confidence=0.95, provider=provider)
