"""Cloud brain via the Claude API (requirement: hybrid brain — hard reasoning, high
fluency, high input cognition).

Only the conversation text is sent to Claude; voice, wake-word, files and history stay
local. The API key is read from the encrypted SecretStore (never from the repo). The
anthropic SDK is imported lazily so the core can boot without it.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

from ..config import get_settings
from ..config.secrets import SecretStore
from .base import BrainMessage, BrainResult, ToolInvocation, ToolSpec


def _split_system(messages: list[BrainMessage]) -> tuple[str, list[dict[str, Any]]]:
    system_parts: list[str] = []
    convo: list[dict[str, Any]] = []
    for m in messages:
        if m.role == "system":
            system_parts.append(m.content)
        elif m.role == "tool":
            convo.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id or "",
                            "content": m.content,
                        }
                    ],
                }
            )
        else:
            convo.append({"role": m.role, "content": m.content})
    return "\n\n".join(system_parts), convo


class ClaudeProvider:
    name = "claude"

    def __init__(self, model: str | None = None, secrets: SecretStore | None = None) -> None:
        self.model = model or get_settings().claude_model
        self.secrets = secrets or SecretStore()

    def _api_key(self) -> str | None:
        import os

        return self.secrets.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")

    def _client(self):
        import anthropic  # lazy import

        return anthropic.AsyncAnthropic(api_key=self._api_key())

    async def available(self) -> bool:
        return bool(self._api_key())

    async def complete(
        self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None
    ) -> BrainResult:
        if not self._api_key():
            return BrainResult(
                text="", confidence=0.0, provider=self.name, finish_reason="error"
            )
        system, convo = _split_system(messages)
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 2048,
            "system": system,
            "messages": convo,
        }
        if tools:
            kwargs["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.parameters}
                for t in tools
            ]
        resp = await self._client().messages.create(**kwargs)
        text = ""
        tool_calls: list[ToolInvocation] = []
        for block in resp.content:
            if block.type == "text":
                text += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolInvocation(id=block.id, name=block.name, arguments=dict(block.input))
                )
        return BrainResult(
            text=text.strip(),
            tool_calls=tool_calls,
            confidence=0.95,  # Claude is the high-confidence escalation target
            provider=self.name,
            finish_reason="tool_calls" if tool_calls else "stop",
        )

    async def stream(
        self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[str]:
        system, convo = _split_system(messages)
        async with self._client().messages.stream(
            model=self.model, max_tokens=2048, system=system, messages=convo
        ) as stream:
            async for text in stream.text_stream:
                yield text
