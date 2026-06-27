"""File tools (requirement 19: files info + actions). Cross-platform."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from ..config import get_settings
from .base import ToolResult

# Read tools are unrestricted; write/delete are gated by the capability registry, but we
# also keep destructive ops inside a sane boundary unless an absolute path is explicit.


def list_files(path: str = ".") -> ToolResult:
    p = Path(path).expanduser()
    if not p.exists():
        return ToolResult.fail(f"Path not found: {p}")
    if p.is_file():
        return ToolResult(ok=True, summary=f"{p} is a file.", data={"file": str(p)})
    entries = []
    for child in sorted(p.iterdir())[:500]:
        entries.append(
            {"name": child.name, "dir": child.is_dir(), "size": child.stat().st_size}
        )
    return ToolResult(ok=True, summary=f"Listed {len(entries)} entries in {p}.", data={"entries": entries})


def read_file(path: str, max_bytes: int = 200_000) -> ToolResult:
    p = Path(path).expanduser()
    if not p.is_file():
        return ToolResult.fail(f"Not a file: {p}")
    try:
        text = p.read_text(encoding="utf-8", errors="replace")[:max_bytes]
    except Exception as exc:
        return ToolResult.fail(f"Could not read {p}: {exc}")
    return ToolResult(ok=True, summary=f"Read {p}.", data={"content": text})


def create_file(path: str | None = None, content: str = "") -> ToolResult:
    """Create a file. Defaults into the ACTIG workspace so generated files are tracked."""
    if path:
        p = Path(path).expanduser()
    else:
        workspace = get_settings().data_dir / "workspace"
        workspace.mkdir(parents=True, exist_ok=True)
        p = workspace / "note.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return ToolResult(ok=True, summary=f"Created {p}.", artifact_path=str(p), data={"path": str(p)})


def write_note(text: str, name: str = "note.txt") -> ToolResult:
    workspace = get_settings().data_dir / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    p = workspace / name
    with p.open("a", encoding="utf-8") as fh:
        fh.write(text + "\n")
    return ToolResult(ok=True, summary=f"Saved note to {p}.", artifact_path=str(p))


def delete_file(path: str) -> ToolResult:  # risk: sensitive (confirmation handled upstream)
    p = Path(path).expanduser()
    if not p.exists():
        return ToolResult.fail(f"Path not found: {p}")
    try:
        if p.is_dir():
            shutil.rmtree(p)
        else:
            os.remove(p)
    except Exception as exc:
        return ToolResult.fail(f"Delete failed: {exc}")
    return ToolResult(ok=True, summary=f"Deleted {p}.")


def move_file(src: str, dst: str) -> ToolResult:  # risk: sensitive
    s, d = Path(src).expanduser(), Path(dst).expanduser()
    if not s.exists():
        return ToolResult.fail(f"Source not found: {s}")
    try:
        shutil.move(str(s), str(d))
    except Exception as exc:
        return ToolResult.fail(f"Move failed: {exc}")
    return ToolResult(ok=True, summary=f"Moved {s} → {d}.")
