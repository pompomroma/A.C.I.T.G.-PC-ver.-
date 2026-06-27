"""Aggregates the built-in system tools into ``Tool`` objects (name, JSON-schema, risk,
handler). The agent's :class:`ToolRegistry` consumes these to expose function-calling to
the brain and to gate execution via the capability registry.
"""

from __future__ import annotations

from .base import Tool
from . import apps, browser, files, settings_win, sysinfo


def _obj(**props):
    return {"type": "object", "properties": props, "required": [k for k in props]}


def _opt(**props):
    return {"type": "object", "properties": props}


def build_system_tools() -> list[Tool]:
    return [
        # ── read ──────────────────────────────────────────────────────────
        Tool("system_info", "Read CPU/RAM/OS/battery/process info.", _opt(), sysinfo.system_info, "read"),
        Tool("account_info", "Read local account profile (no passwords).", _opt(), sysinfo.account_info, "read"),
        Tool(
            "list_files",
            "List files/folders in a directory.",
            _opt(path={"type": "string", "description": "Directory path (default '.')"}),
            files.list_files,
            "read",
        ),
        Tool(
            "read_file",
            "Read a text file's contents.",
            _obj(path={"type": "string"}),
            files.read_file,
            "read",
        ),
        Tool("list_apps", "List installed applications.", _opt(), apps.list_apps, "read"),
        # ── safe_write ────────────────────────────────────────────────────
        Tool(
            "create_file",
            "Create a file with given content.",
            _opt(path={"type": "string"}, content={"type": "string"}),
            files.create_file,
            "safe_write",
        ),
        Tool(
            "write_note",
            "Append text to a note in the workspace.",
            _obj(text={"type": "string"}),
            files.write_note,
            "safe_write",
        ),
        Tool(
            "open_app",
            "Launch an installed application by name.",
            _obj(name={"type": "string"}),
            apps.open_app,
            "safe_write",
        ),
        Tool(
            "open_url",
            "Open a web page in the default browser.",
            _obj(url={"type": "string"}),
            browser.open_url,
            "safe_write",
        ),
        Tool(
            "play_music",
            "Play requested music via a web service (youtube/ytmusic/spotify/soundcloud).",
            _opt(query={"type": "string"}, service={"type": "string"}),
            browser.play_music,
            "safe_write",
        ),
        # ── sensitive (confirmation) ──────────────────────────────────────
        Tool(
            "delete_file",
            "Delete a file or folder.",
            _obj(path={"type": "string"}),
            files.delete_file,
            "sensitive",
        ),
        Tool(
            "move_file",
            "Move or rename a file/folder.",
            _obj(src={"type": "string"}, dst={"type": "string"}),
            files.move_file,
            "sensitive",
        ),
        # ── system (confirmation) ─────────────────────────────────────────
        Tool(
            "write_settings",
            "Open/change a Windows setting page (display, wifi, sound, ...).",
            _obj(page={"type": "string"}),
            settings_win.open_settings,
            "system",
        ),
        Tool(
            "kill_process",
            "Terminate a running process by name or PID.",
            _obj(name_or_pid={"type": "string"}),
            settings_win.kill_process,
            "system",
        ),
        Tool(
            "run_command",
            "Run a shell command and capture its output.",
            _obj(command={"type": "string"}),
            settings_win.run_command,
            "system",
        ),
    ]
