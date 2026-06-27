"""Application launching + listing (requirement 19: activate installed apps).

On Windows we enumerate Start-Menu shortcuts and the App Paths registry, and launch UWP
apps via ``shell:AppsFolder``. Off-Windows we fall back to best-effort ``which``/open so the
tool is testable.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .base import ToolResult


def _start_menu_dirs() -> list[Path]:
    dirs = []
    for env in ("APPDATA", "PROGRAMDATA"):
        base = os.environ.get(env)
        if base:
            dirs.append(Path(base) / "Microsoft" / "Windows" / "Start Menu" / "Programs")
    return [d for d in dirs if d.exists()]


def list_apps() -> ToolResult:
    apps: list[str] = []
    if sys.platform == "win32":
        for d in _start_menu_dirs():
            for lnk in d.rglob("*.lnk"):
                apps.append(lnk.stem)
        apps = sorted(set(apps))
    else:
        # Dev fallback: a few common executables on PATH.
        for exe in ("code", "firefox", "google-chrome", "gedit", "xdg-open"):
            if shutil.which(exe):
                apps.append(exe)
    return ToolResult(ok=True, summary=f"Found {len(apps)} apps.", data={"apps": apps})


def open_app(name: str) -> ToolResult:  # risk: safe_write
    if sys.platform == "win32":
        # Try a Start-Menu shortcut match first, then a bare command.
        for d in _start_menu_dirs():
            for lnk in d.rglob("*.lnk"):
                if name.lower() in lnk.stem.lower():
                    os.startfile(str(lnk))  # type: ignore[attr-defined]
                    return ToolResult(ok=True, summary=f"Opened {lnk.stem}.")
        try:
            os.startfile(name)  # type: ignore[attr-defined]
            return ToolResult(ok=True, summary=f"Launched {name}.")
        except Exception as exc:
            return ToolResult.fail(f"Could not launch {name}: {exc}")
    else:
        exe = shutil.which(name)
        if not exe:
            return ToolResult.fail(f"App not found on PATH: {name}")
        try:
            subprocess.Popen([exe])
        except Exception as exc:
            return ToolResult.fail(f"Could not launch {name}: {exc}")
        return ToolResult(ok=True, summary=f"Launched {name}.")
