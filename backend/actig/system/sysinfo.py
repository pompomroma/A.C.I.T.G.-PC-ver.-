"""Read-only system information tools (requirement 19: info access)."""

from __future__ import annotations

import getpass
import platform

from .base import ToolResult


def system_info() -> ToolResult:
    info: dict[str, object] = {
        "os": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "user": getpass.getuser(),
    }
    try:
        import psutil  # optional

        info["cpu_percent"] = psutil.cpu_percent(interval=0.1)
        vm = psutil.virtual_memory()
        info["ram_total_gb"] = round(vm.total / 1e9, 1)
        info["ram_used_pct"] = vm.percent
        battery = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
        if battery is not None:
            info["battery_pct"] = battery.percent
            info["plugged_in"] = battery.power_plugged
        info["process_count"] = len(psutil.pids())
    except Exception:
        pass
    return ToolResult(ok=True, summary="Read system info.", data=info)


def account_info() -> ToolResult:
    """Local account profile only — never reads or returns passwords."""
    data = {"username": getpass.getuser(), "home": platform.node()}
    return ToolResult(ok=True, summary="Read local account info (no credentials).", data=data)
