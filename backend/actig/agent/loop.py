"""The agent orchestration loop.

One ``run`` call handles a single user turn end-to-end:

  1. Resolve the turn's language (req 1: in/out language switching).
  2. Assemble the prompt (persona + recent history + the new user message).
  3. Estimate an ETA and emit it (req 1.(2-4)).
  4. Ask the hybrid brain for a reply, offering the tool catalog.
  5. While the brain requests tools: dispatch each through the guarded ToolRegistry,
     record process steps + workflow checkpoints (req 1: process narration + checkpoints),
     feed results back, and iterate (bounded).
  6. Build the rich assistant payload and persist both turns to history.

The loop is transport-agnostic: ``emit`` and ``confirm`` callbacks let the server stream
tool/confirmation events to the UI, while tests pass simple stubs.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from ..brain import BrainMessage, HybridBrain
from ..history import CheckpointManager, HistoryStore
from ..lang import LanguageState
from ..protocol import (
    AssistantMessagePayload,
    ToolCallPayload,
    ToolResultPayload,
    UserInputPayload,
)
from .schema import AssistantTurnBuilder
from .persona import build_system_prompt
from .tools import ToolRegistry

EmitFn = Callable[[str, dict], Awaitable[None]]
ConfirmFn = Callable[[str, str, str], Awaitable[bool]]

MAX_TOOL_ITERS = 6


async def _noop_emit(_type: str, _payload: dict) -> None:
    return None


async def _auto_confirm(_t: str, _d: str, _r: str) -> bool:
    return True


def _estimate_eta(text: str, has_tools: bool) -> str:
    """Cheap, honest time estimate shown before work starts (req 1.(2-4))."""
    if not has_tools:
        return "a moment"
    n = max(1, text.count(" and ") + 1)
    secs = 5 * n + 10
    if secs < 15:
        return "about 10 seconds"
    if secs < 45:
        return "under a minute"
    return "a minute or two"


class AgentLoop:
    def __init__(
        self,
        brain: HybridBrain | None = None,
        registry: ToolRegistry | None = None,
        history: HistoryStore | None = None,
        lang_state: LanguageState | None = None,
        checkpoints: CheckpointManager | None = None,
    ) -> None:
        self.history = history or HistoryStore()
        self.brain = brain or HybridBrain()
        self.registry = registry or ToolRegistry(history=self.history)
        self.lang = lang_state or LanguageState()
        self.checkpoints = checkpoints or CheckpointManager()

    async def run(
        self,
        user_input: UserInputPayload,
        emit: EmitFn | None = None,
        confirm: ConfirmFn | None = None,
    ) -> AssistantMessagePayload:
        emit = emit or _noop_emit
        confirm = confirm or _auto_confirm

        lang = self.lang.resolve(user_input.text, user_input.lang)
        self.history.add_turn("user", user_input.text, lang=lang, source=user_input.source)

        messages: list[BrainMessage] = [BrainMessage("system", build_system_prompt(lang))]
        for t in self.history.recent_turns(limit=16):
            if t["text"]:
                messages.append(BrainMessage(t["role"], t["text"]))

        specs = self.registry.specs()
        builder = AssistantTurnBuilder(lang=lang)

        # ETA up front
        eta = _estimate_eta(user_input.text, has_tools=True)
        builder.set_eta(eta)

        task_id: int | None = None
        steps_state: list[dict] = []

        for iteration in range(MAX_TOOL_ITERS):
            result = await self.brain.complete(messages, tools=specs)
            builder.brain = result.provider if result.provider in ("ollama", "claude") else None

            if not result.tool_calls:
                # final natural-language answer
                payload = builder.build(result.text)
                self.history.add_turn(
                    "assistant",
                    payload.text,
                    lang=lang,
                    payload=payload.model_dump(exclude_none=True),
                )
                return payload

            # The brain wants to act → make sure we have a task to attach steps to.
            if task_id is None:
                task_id = self.history.start_task(user_input.text[:120], eta=eta)

            # Echo the assistant's (possibly empty) interim text, then run each tool.
            if result.text:
                messages.append(BrainMessage("assistant", result.text))

            for call in result.tool_calls:
                step_label = f"{call.name}({', '.join(call.arguments) or ''})"
                builder.add_step(step_label, "running")
                steps_state.append({"step": step_label, "status": "running"})
                self.checkpoints.save("workflow", steps_state, len(steps_state) - 1, task_id)
                await emit(
                    "tool_call",
                    ToolCallPayload(
                        callId=call.id,
                        tool=call.name,
                        summary=step_label,
                        risk=self.registry.caps.risk_of(call.name),
                        args=call.arguments,
                    ).model_dump(),
                )
                self.history.log_step(task_id, step_label, "running")

                tool_result = await self.registry.dispatch(
                    call.name, call.arguments, confirm=confirm, task_id=task_id
                )

                status = "succeeded" if tool_result.ok else "failed"
                builder.process[-1].status = status
                builder.process[-1].detail = tool_result.summary
                steps_state[-1]["status"] = status
                self.checkpoints.save("workflow", steps_state, len(steps_state) - 1, task_id)
                self.history.log_step(task_id, step_label, status, tool_result.summary)
                await emit(
                    "tool_result",
                    ToolResultPayload(
                        callId=call.id,
                        ok=tool_result.ok,
                        summary=tool_result.summary,
                        error=tool_result.error,
                    ).model_dump(),
                )

                # feed the tool result back to the brain
                messages.append(
                    BrainMessage(
                        role="tool",
                        content=tool_result.summary
                        + ("" if not tool_result.data else f" data={tool_result.data}"),
                        tool_call_id=call.id,
                        name=call.name,
                    )
                )

        # Hit the iteration cap — wrap up gracefully.
        if task_id is not None:
            self.history.finish_task(task_id, "succeeded", "Completed (reached step limit).")
        payload = builder.build(
            "I've done what I can on that for now. Want me to keep going or adjust anything?"
        )
        self.history.add_turn(
            "assistant", payload.text, lang=lang, payload=payload.model_dump(exclude_none=True)
        )
        return payload
