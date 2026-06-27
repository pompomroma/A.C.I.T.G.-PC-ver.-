"""Capability / risk registry — the heart of the *guarded access* model.

Every tool the agent can run declares a risk level. The agent loop consults this registry
before executing a tool:

  - ``read``       → runs automatically (e.g. list files, read system info).
  - ``safe_write`` → runs automatically (e.g. create a note, open an app window).
  - ``sensitive``  → requires one-tap confirmation (delete/move/send/purchase/credentials).
  - ``system``     → requires one-tap confirmation (settings, processes, registry).

A small ``DEFAULT_DENY`` set of high-danger operations is blocked outright unless the user
explicitly enables it in settings. Every decision is written to the audit log.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Ordered from least to most privileged; used for comparisons / UI sorting.
RISK_ORDER = ["read", "safe_write", "sensitive", "system"]

# Operations that never run automatically even if a tool requests them, unless the user
# has explicitly opted in (settings -> advanced -> dangerous operations).
DEFAULT_DENY = {
    "disk_format",
    "registry_bulk_delete",
    "mass_file_delete",
    "shell_raw",  # arbitrary raw shell — must be explicitly enabled
}


@dataclass(frozen=True)
class Capability:
    name: str
    risk: str
    description: str
    # Whether this capability is in the default-deny list.
    default_denied: bool = False


@dataclass
class CapabilityRegistry:
    caps: dict[str, Capability] = field(default_factory=dict)
    # Tools the user pre-approved for this session via "always".
    session_allow: set[str] = field(default_factory=set)
    # Dangerous ops the user has explicitly enabled in settings.
    enabled_dangerous: set[str] = field(default_factory=set)

    def register(self, name: str, risk: str, description: str) -> None:
        if risk not in RISK_ORDER:
            raise ValueError(f"unknown risk level {risk!r}")
        self.caps[name] = Capability(
            name=name,
            risk=risk,
            description=description,
            default_denied=name in DEFAULT_DENY,
        )

    def risk_of(self, name: str) -> str:
        cap = self.caps.get(name)
        return cap.risk if cap else "sensitive"  # unknown tools are treated cautiously

    def needs_confirmation(self, name: str) -> bool:
        """True if running ``name`` should prompt the user for one-tap approval."""
        if name in self.session_allow:
            return False
        risk = self.risk_of(name)
        return risk in ("sensitive", "system")

    def is_blocked(self, name: str) -> bool:
        """True if the tool is default-denied and not explicitly enabled."""
        cap = self.caps.get(name)
        if cap and cap.default_denied:
            return name not in self.enabled_dangerous
        return False

    def approve_always(self, name: str) -> None:
        self.session_allow.add(name)


def default_registry() -> CapabilityRegistry:
    """Registry pre-populated with ACTIG's built-in tool capabilities (requirement 19)."""
    reg = CapabilityRegistry()
    builtin: list[tuple[str, str, str]] = [
        # info / read
        ("system_info", "read", "Read CPU/RAM/OS/battery and running processes."),
        ("list_files", "read", "List files and folders in a directory."),
        ("read_file", "read", "Read the contents of a file."),
        ("list_apps", "read", "List installed applications."),
        ("read_settings", "read", "Read a Windows setting value."),
        ("account_info", "read", "Read local/online account profile info (no passwords)."),
        # safe writes
        ("write_note", "safe_write", "Create or append to a text note/file in the workspace."),
        ("open_app", "safe_write", "Launch an installed application."),
        ("open_url", "safe_write", "Open a web page in the default browser."),
        ("play_music", "safe_write", "Play requested music via a web music service."),
        ("create_file", "safe_write", "Create a new file with given content."),
        # sensitive
        ("delete_file", "sensitive", "Delete a file or folder."),
        ("move_file", "sensitive", "Move or rename a file or folder."),
        ("send_message", "sensitive", "Send an email/chat message on the user's behalf."),
        ("purchase", "sensitive", "Make a purchase or payment."),
        ("app_action", "sensitive", "Drive an installed app's UI to perform an action."),
        # system
        ("write_settings", "system", "Change a Windows/system setting."),
        ("kill_process", "system", "Terminate a running process."),
        ("run_command", "system", "Run a shell command."),
        # default-deny (must be explicitly enabled)
        ("mass_file_delete", "sensitive", "Delete many files at once."),
        ("registry_bulk_delete", "system", "Delete multiple registry keys."),
        ("disk_format", "system", "Format a disk/volume."),
        ("shell_raw", "system", "Run an arbitrary unrestricted shell command."),
    ]
    for name, risk, desc in builtin:
        reg.register(name, risk, desc)
    return reg
