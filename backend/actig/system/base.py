"""Base types for system tools (the agent's hands on the PC).

Every tool is a small, single-purpose callable with a JSON-schema for its arguments, a
declared risk level (mirrored in the capability registry), and a uniform ``ToolResult``.
Tools must degrade gracefully off-Windows so the core can be developed and tested anywhere.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Union

ToolReturn = Union["ToolResult", Awaitable["ToolResult"]]


@dataclass
class ToolResult:
    ok: bool
    summary: str
    data: dict[str, Any] | None = None
    artifact_path: str | None = None
    error: str | None = None

    @classmethod
    def fail(cls, msg: str) -> "ToolResult":
        return cls(ok=False, summary=msg, error=msg)

    @classmethod
    def unsupported(cls, what: str) -> "ToolResult":
        return cls(
            ok=False,
            summary=f"{what} is only available on Windows.",
            error="unsupported_platform",
        )


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., ToolReturn]
    risk: str = "read"
    # Schema metadata for the brain's function-calling interface.
    extra: dict[str, Any] = field(default_factory=dict)


IS_WINDOWS = sys.platform == "win32"
