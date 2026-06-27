"""High-level history API used by the agent loop.

This is the single place the rest of the system records "what happened": conversation
turns, tasks, per-step process logs, executed commands, generated artifacts (any file
form), and guarded-access audit decisions. It also stores generated files to the
artifact directory and hashes them.
"""

from __future__ import annotations

import hashlib
import shutil
import uuid
from pathlib import Path
from typing import Any

from ..config import get_settings
from .db import session_scope
from .models import Artifact, AuditEntry, Command, ProcessLog, Session as SessionRow, Task, Turn


class HistoryStore:
    def __init__(self) -> None:
        self._session_id: int | None = None

    # ── session lifecycle ───────────────────────────────────────────────
    def start_session(self, boot_id: str | None = None) -> int:
        with session_scope() as s:
            row = SessionRow(boot_id=boot_id)
            s.add(row)
            s.flush()
            self._session_id = row.id
            return row.id

    @property
    def session_id(self) -> int:
        if self._session_id is None:
            self.start_session()
        assert self._session_id is not None
        return self._session_id

    # ── conversation ────────────────────────────────────────────────────
    def add_turn(
        self,
        role: str,
        text: str,
        lang: str = "en",
        source: str = "text",
        payload: dict[str, Any] | None = None,
        audio_artifact_id: int | None = None,
    ) -> int:
        with session_scope() as s:
            row = Turn(
                session_id=self.session_id,
                role=role,
                text=text,
                lang=lang,
                source=source,
                payload=payload,
                audio_artifact_id=audio_artifact_id,
            )
            s.add(row)
            s.flush()
            return row.id

    def recent_turns(self, limit: int = 20) -> list[dict[str, Any]]:
        with session_scope() as s:
            rows = (
                s.query(Turn)
                .filter(Turn.session_id == self.session_id)
                .order_by(Turn.id.desc())
                .limit(limit)
                .all()
            )
            return [
                {"role": r.role, "text": r.text, "lang": r.lang, "payload": r.payload}
                for r in reversed(rows)
            ]

    # ── tasks + process narration ───────────────────────────────────────
    def start_task(self, title: str, eta: str | None = None) -> int:
        with session_scope() as s:
            row = Task(session_id=self.session_id, title=title, eta=eta, status="running")
            s.add(row)
            s.flush()
            return row.id

    def log_step(self, task_id: int, step: str, status: str, detail: str | None = None) -> None:
        with session_scope() as s:
            s.add(ProcessLog(task_id=task_id, step=step, status=status, detail=detail))

    def finish_task(self, task_id: int, status: str, result_summary: str | None = None) -> None:
        with session_scope() as s:
            row = s.get(Task, task_id)
            if row:
                row.status = status
                row.result_summary = result_summary

    # ── commands ────────────────────────────────────────────────────────
    def log_command(
        self,
        tool: str,
        args: dict[str, Any] | None,
        ok: bool,
        result: str | None,
        task_id: int | None = None,
        duration_ms: int | None = None,
    ) -> int:
        with session_scope() as s:
            row = Command(
                tool=tool,
                args=args,
                ok=ok,
                result=result,
                task_id=task_id,
                duration_ms=duration_ms,
            )
            s.add(row)
            s.flush()
            return row.id

    # ── artifacts (any generated file form) ─────────────────────────────
    def store_artifact(
        self, src_path: str | Path, kind: str = "file", meta: dict[str, Any] | None = None
    ) -> int:
        """Copy a generated file into the artifact store and record it."""
        src = Path(src_path)
        artifacts = get_settings().artifacts_dir
        dest = artifacts / f"{uuid.uuid4().hex}_{src.name}"
        shutil.copy2(src, dest)
        data = dest.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        with session_scope() as s:
            row = Artifact(
                kind=kind,
                path=str(dest),
                sha256=sha,
                size_bytes=len(data),
                meta=meta,
            )
            s.add(row)
            s.flush()
            return row.id

    def store_artifact_bytes(
        self, name: str, data: bytes, kind: str = "file", mime: str | None = None
    ) -> int:
        artifacts = get_settings().artifacts_dir
        dest = artifacts / f"{uuid.uuid4().hex}_{name}"
        dest.write_bytes(data)
        sha = hashlib.sha256(data).hexdigest()
        with session_scope() as s:
            row = Artifact(
                kind=kind, path=str(dest), sha256=sha, size_bytes=len(data), mime=mime
            )
            s.add(row)
            s.flush()
            return row.id

    # ── audit (guarded access) ──────────────────────────────────────────
    def audit(
        self,
        tool: str,
        risk: str,
        decision: str,
        summary: str,
        args: dict[str, Any] | None = None,
    ) -> None:
        with session_scope() as s:
            s.add(
                AuditEntry(
                    tool=tool, risk=risk, decision=decision, summary=summary, args=args
                )
            )
