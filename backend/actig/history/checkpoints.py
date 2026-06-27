"""Workflow checkpoints — "check points latest workflow" (requirement 1).

A checkpoint is a serialized snapshot of an in-flight workflow: the ordered list of steps,
each step's status, and a cursor pointing at the current step. Exactly one checkpoint per
task is flagged ``is_latest`` so ACTIG can answer "where were we?" and resume after a crash
or reboot (the watchdog/agent calls :meth:`resume_latest` on startup).
"""

from __future__ import annotations

from typing import Any

from .db import session_scope
from .models import Checkpoint


class CheckpointManager:
    def save(
        self,
        label: str,
        steps: list[dict[str, Any]],
        cursor: int,
        task_id: int | None = None,
    ) -> int:
        """Persist the latest workflow state, superseding the previous latest for this task."""
        progress = 0.0
        if steps:
            done = sum(1 for s in steps if s.get("status") == "succeeded")
            progress = round(done / len(steps), 3)
        state = {"steps": steps, "cursor": cursor}
        with session_scope() as s:
            # demote previous latest for this task
            q = s.query(Checkpoint).filter(Checkpoint.is_latest.is_(True))
            if task_id is not None:
                q = q.filter(Checkpoint.task_id == task_id)
            for old in q.all():
                old.is_latest = False
            row = Checkpoint(
                task_id=task_id,
                label=label,
                state=state,
                is_latest=True,
                progress=progress,
            )
            s.add(row)
            s.flush()
            return row.id

    def latest(self, task_id: int | None = None) -> dict[str, Any] | None:
        with session_scope() as s:
            q = s.query(Checkpoint).filter(Checkpoint.is_latest.is_(True))
            if task_id is not None:
                q = q.filter(Checkpoint.task_id == task_id)
            row = q.order_by(Checkpoint.id.desc()).first()
            if not row:
                return None
            return {
                "id": row.id,
                "label": row.label,
                "progress": row.progress,
                "task_id": row.task_id,
                **row.state,
            }

    def resume_latest(self) -> dict[str, Any] | None:
        """Return the most recent unfinished workflow, if any, for the agent to continue."""
        cp = self.latest()
        if not cp:
            return None
        steps = cp.get("steps", [])
        if steps and all(s.get("status") in ("succeeded", "failed") for s in steps):
            return None  # nothing left to resume
        return cp
