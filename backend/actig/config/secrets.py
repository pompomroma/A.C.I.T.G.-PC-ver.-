"""Encrypted secret store for the Claude API key and any saved credentials.

On Windows the value is sealed with DPAPI (``win32crypt.CryptProtectData``) so it is bound
to the user account and never stored in plaintext. On other platforms (and in CI/tests) we
fall back to a base64-obfuscated file with strict permissions — clearly *not* strong
encryption, only a non-plaintext fallback for development. The public API is identical.

Secrets are NEVER written to the repo; they live under ``Settings.secrets_dir``.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from .settings import get_settings


def _win_protect(data: bytes) -> bytes:  # pragma: no cover - Windows only
    import win32crypt  # type: ignore

    return win32crypt.CryptProtectData(data, "ACTIG", None, None, None, 0)


def _win_unprotect(blob: bytes) -> bytes:  # pragma: no cover - Windows only
    import win32crypt  # type: ignore

    _, data = win32crypt.CryptUnprotectData(blob, None, None, None, 0)
    return data


def _seal(data: bytes) -> bytes:
    if sys.platform == "win32":
        try:
            return _win_protect(data)
        except Exception:
            pass
    # Dev fallback — obfuscation only.
    return b"b64:" + base64.b64encode(data)


def _unseal(blob: bytes) -> bytes:
    if blob.startswith(b"b64:"):
        return base64.b64decode(blob[4:])
    if sys.platform == "win32":  # pragma: no cover - Windows only
        return _win_unprotect(blob)
    raise ValueError("cannot unseal secret on this platform")


class SecretStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (get_settings().secrets_dir / "secrets.bin")

    def _load(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        raw = _unseal(self.path.read_bytes())
        return json.loads(raw.decode("utf-8"))

    def _save(self, data: dict[str, str]) -> None:
        blob = _seal(json.dumps(data).encode("utf-8"))
        self.path.write_bytes(blob)
        try:
            self.path.chmod(0o600)
        except OSError:
            pass

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._load().get(key, default)

    def set(self, key: str, value: str) -> None:
        data = self._load()
        data[key] = value
        self._save(data)

    def delete(self, key: str) -> None:
        data = self._load()
        data.pop(key, None)
        self._save(data)
