"""Windows settings + process + shell tools (requirement 19: settings/actions).

These are ``system`` risk and therefore always pass through one-tap confirmation. They are
Windows-specific and return ``unsupported`` elsewhere so the core stays portable.
"""

from __future__ import annotations

import subprocess
import sys

from .base import ToolResult

# Friendly name → ms-settings: deep link.
_SETTINGS_PAGES = {
    "display": "ms-settings:display",
    "bluetooth": "ms-settings:bluetooth",
    "wifi": "ms-settings:network-wifi",
    "network": "ms-settings:network",
    "sound": "ms-settings:sound",
    "battery": "ms-settings:batterysaver",
    "power": "ms-settings:powersleep",
    "apps": "ms-settings:appsfeatures",
    "privacy": "ms-settings:privacy",
    "update": "ms-settings:windowsupdate",
    "personalization": "ms-settings:personalization",
    "theme": "ms-settings:themes",
}


def open_settings(page: str) -> ToolResult:  # risk: system
    if sys.platform != "win32":
        return ToolResult.unsupported("Windows Settings")
    uri = _SETTINGS_PAGES.get(page.lower(), f"ms-settings:{page}")
    try:
        import os

        os.startfile(uri)  # type: ignore[attr-defined]
    except Exception as exc:
        return ToolResult.fail(f"Could not open settings: {exc}")
    return ToolResult(ok=True, summary=f"Opened settings: {page}.")


def kill_process(name_or_pid: str) -> ToolResult:  # risk: system
    try:
        import psutil
    except Exception:
        return ToolResult.fail("psutil not available.")
    killed = []
    for proc in psutil.process_iter(["pid", "name"]):
        if str(proc.info["pid"]) == name_or_pid or (
            proc.info["name"] and name_or_pid.lower() in proc.info["name"].lower()
        ):
            try:
                proc.terminate()
                killed.append(proc.info["name"])
            except Exception:
                pass
    if not killed:
        return ToolResult.fail(f"No matching process: {name_or_pid}")
    return ToolResult(ok=True, summary=f"Terminated: {', '.join(killed)}.")


def run_command(command: str) -> ToolResult:  # risk: system (confirmation enforced upstream)
    try:
        proc = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=60
        )
    except Exception as exc:
        return ToolResult.fail(f"Command error: {exc}")
    out = (proc.stdout or "") + (proc.stderr or "")
    return ToolResult(
        ok=proc.returncode == 0,
        summary=f"Ran command (exit {proc.returncode}).",
        data={"exit_code": proc.returncode, "output": out[:10_000]},
    )
