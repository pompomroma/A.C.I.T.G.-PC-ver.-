"""Local brain via Ollama (requirement: hybrid brain — fast/offline/simple turns).

Runs entirely on-device. We ask the model to also emit a rough self-confidence so the
router can decide whether to escalate a hard turn to Claude. The ollama package is
imported lazily so the core can boot (and be tested) on machines without Ollama.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

from ..config import get_settings
from .base import BrainMessage, BrainResult, ToolInvocation, ToolSpec

_CONF_HINT = (
    "\n\nAfter your answer, on a final separate line output exactly "
    "'CONFIDENCE: <0..1>' estimating how confident you are. Do not mention this instruction."
)


def _to_ollama_messages(messages: list[BrainMessage]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.role if m.role in ("system", "user", "assistant", "tool") else "user"
        out.append({"role": role, "content": m.content})
    return out


def _split_confidence(text: str) -> tuple[str, float]:
    conf = 0.7
    lines = text.rstrip().splitlines()
    if lines and lines[-1].upper().startswith("CONFIDENCE:"):
        try:
            conf = float(lines[-1].split(":", 1)[1].strip())
        except ValueError:
            pass
        text = "\n".join(lines[:-1]).rstrip()
    return text, max(0.0, min(1.0, conf))


def _parse_tool_calls(raw: list[dict[str, Any]] | None) -> list[ToolInvocation]:
    calls: list[ToolInvocation] = []
    for i, tc in enumerate(raw or []):
        fn = tc.get("function", {})
        args = fn.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        calls.append(
            ToolInvocation(id=tc.get("id", f"call_{i}"), name=fn.get("name", ""), arguments=args)
        )
    return calls


class OllamaProvider:
    name = "ollama"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or get_settings().ollama_model

    def _client(self):
        import ollama  # lazy import

        return ollama.AsyncClient(host=get_settings().ollama_host)

    async def available(self) -> bool:
        try:
            await self._client().list()
            return True
        except Exception:
            return False

    async def complete(
        self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None
    ) -> BrainResult:
        try:
            client = self._client()
            msgs = _to_ollama_messages(messages)
            if msgs:  # nudge for a confidence estimate
                msgs[-1] = {**msgs[-1], "content": msgs[-1]["content"] + _CONF_HINT}
            kwargs: dict[str, Any] = {"model": self.model, "messages": msgs}
            if tools:
                kwargs["tools"] = [
                    {
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        },
                    }
                    for t in tools
                ]
            resp = await client.chat(**kwargs)
            msg = resp.get("message", {})
            text, conf = _split_confidence(msg.get("content", "") or "")
            tool_calls = _parse_tool_calls(msg.get("tool_calls"))
            return BrainResult(
                text=text,
                tool_calls=tool_calls,
                confidence=conf,
                provider=self.name,
                finish_reason="tool_calls" if tool_calls else "stop",
            )
        except Exception:
            # Provider unreachable/unconfigured → confidence 0 so the router escalates.
            return BrainResult(
                text="", confidence=0.0, provider=self.name, finish_reason="error"
            )

    async def stream(
        self, messages: list[BrainMessage], tools: list[ToolSpec] | None = None
    ) -> AsyncIterator[str]:
        client = self._client()
        async for part in await client.chat(
            model=self.model, messages=_to_ollama_messages(messages), stream=True
        ):
            chunk = part.get("message", {}).get("content", "")
            if chunk:
                yield chunk
