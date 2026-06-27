"""Runtime settings and on-disk paths for ACTIG.

All mutable runtime state (history DB, artifacts, logs, secrets, models) lives under a
single per-user data directory so the installer/uninstaller can manage it cleanly and so
nothing user-specific is ever committed to the repo.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _data_root() -> Path:
    """Per-user writable data directory, OS-appropriate."""
    override = os.environ.get("ACTIG_DATA_DIR")
    if override:
        return Path(override)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~\\AppData\\Local")
        return Path(base) / "ACTIG"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "ACTIG"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "actig"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=_data_root)
    host: str = field(default_factory=lambda: os.environ.get("ACTIG_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.environ.get("ACTIG_PORT", "8765")))

    # Brain
    ollama_host: str = field(
        default_factory=lambda: os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    )
    ollama_model: str = field(
        default_factory=lambda: os.environ.get("ACTIG_OLLAMA_MODEL", "llama3.1:8b")
    )
    claude_model: str = field(
        default_factory=lambda: os.environ.get("ACTIG_CLAUDE_MODEL", "claude-opus-4-8")
    )
    # When the local model's self-rated confidence is below this, escalate to Claude.
    escalate_threshold: float = 0.62

    # Voice
    whisper_model: str = field(
        default_factory=lambda: os.environ.get("ACTIG_WHISPER_MODEL", "base")
    )
    wake_phrase: str = "wake up ACTIG"
    wake_reaction: str = "ACTIG at your service sir"

    # Guarded access default: require confirmation for sensitive/system actions.
    guarded: bool = True

    def __post_init__(self) -> None:
        for p in (self.data_dir, self.artifacts_dir, self.logs_dir, self.secrets_dir):
            p.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "history.actig.db"

    @property
    def artifacts_dir(self) -> Path:
        return self.data_dir / "artifacts"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def secrets_dir(self) -> Path:
        return self.data_dir / "secrets"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
