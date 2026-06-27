"""Agent tool registry — exposes system tools to the brain and enforces guarded access.

Responsibilities:
  - Convert ``Tool`` definitions into ``ToolSpec`` for the brain's function-calling.
  - On dispatch: consult the capability registry; block default-denied ops; request one-tap
    confirmation for sensitive/system ops via an injected async callback; then run the
    handler (sync or async).
  - Record every call to the audit log and the command history.
"""

from __future__ import annotations

import asyncio
import inspect
import time
from typing import Awaitable, Callable

from ..brain.base import ToolSpec
from ..config.capabilities import CapabilityRegistry, default_registry
from ..history import HistoryStore
from ..system.base import Tool, ToolResult
from ..system.registry import build_system_tools

# async (tool_name, description, risk) -> approved?
ConfirmFn = Callable[[str, str, str], Awaitable[bool]]


async def _auto_approve(_tool: str, _desc: str, _risk: str) -> bool:
    return True


class ToolRegistry:
    def __init__(
        self,
        history: HistoryStore | None = None,
        capabilities: CapabilityRegistry | None = None,
        tools: list[Tool] | None = None,
    ) -> None:
        self.history = history or HistoryStore()
        self.caps = capabilities or default_registry()
        self.tools: dict[str, Tool] = {}
        for t in tools if tools is not None else build_system_tools():
            self.register(t)

    def register(self, tool: Tool) -> None:
        self.tools[tool.name] = tool
        # keep the capability registry in sync with the tool's declared risk
        if tool.name not in self.caps.caps:
            self.caps.register(tool.name, tool.risk, tool.description)

    def specs(self) -> list[ToolSpec]:
        return [
            ToolSpec(name=t.name, description=t.description, parameters=t.parameters)
            for t in self.tools.values()
        ]

    async def dispatch(
        self,
        name: str,
        args: dict,
        confirm: ConfirmFn | None = None,
        task_id: int | None = None,
    ) -> ToolResult:
        confirm = confirm or _auto_approve
        risk = self.caps.risk_of(name)

        # 1) hard block for default-denied dangerous operations (checked even if no handler
        #    is registered, so dangerous capabilities can never be invoked accidentally).
        if self.caps.is_blocked(name):
            self.history.audit(name, risk, "blocked", "Blocked by default-deny policy.", args)
            return ToolResult.fail(
                f"'{name}' is a high-danger operation that is disabled by default. "
                "Enable it in settings → advanced if you really need it."
            )

        tool = self.tools.get(name)
        if tool is None:
            self.history.audit(name, risk, "denied", "Unknown tool requested.", args)
            return ToolResult.fail(f"Unknown tool: {name}")

        # 2) confirmation for sensitive/system operations
        if self.caps.needs_confirmation(name):
            desc = f"{tool.description}  args={args}"
            approved = await confirm(name, desc, risk)
            if not approved:
                self.history.audit(name, risk, "denied", "User declined.", args)
                return ToolResult.fail("Action cancelled — you didn't approve it.")
            self.history.audit(name, risk, "approved", tool.description, args)
        else:
            self.history.audit(name, risk, "auto", tool.description, args)

        # 3) execute (handler may be sync or async)
        started = time.perf_counter()
        try:
            result = tool.handler(**args)
            if inspect.isawaitable(result):
                result = await result  # type: ignore[assignment]
        except TypeError as exc:
            result = ToolResult.fail(f"Bad arguments for {name}: {exc}")
        except Exception as exc:  # never let a tool crash the loop
            result = ToolResult.fail(f"{name} failed: {exc}")
        elapsed = int((time.perf_counter() - started) * 1000)

        assert isinstance(result, ToolResult)
        artifact_id = None
        if result.artifact_path:
            try:
                artifact_id = self.history.store_artifact(result.artifact_path)
            except Exception:
                pass
        self.history.log_command(
            tool=name,
            args=args,
            ok=result.ok,
            result=result.summary,
            task_id=task_id,
            duration_ms=elapsed,
        )
        if artifact_id is not None and result.data is not None:
            result.data["artifact_id"] = artifact_id
        return result


async def gather_specs(registry: ToolRegistry) -> list[ToolSpec]:
    # tiny helper kept async for symmetry with future remote tool discovery
    await asyncio.sleep(0)
    return registry.specs()
