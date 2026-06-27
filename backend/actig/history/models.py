"""SQLAlchemy models for ACTIG's persistent history (requirement 1).

The schema captures everything the request asks to be saved:
  - Session            : one continuous run of the assistant
  - Turn               : each conversation message in/out, with language
  - Task               : a unit of agentic work the user asked for
  - ProcessLog         : step-by-step success/failure narration (req 1.(2-3))
  - Command            : an executed command/tool invocation
  - Artifact           : any generated file, in any form (req 1: generated files)
  - AuditEntry         : guarded-access decision log
  - Checkpoint         : the latest workflow state, resumable (req 1: checkpoints)
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    boot_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    turns: Mapped[list["Turn"]] = relationship(back_populates="session")
    tasks: Mapped[list["Task"]] = relationship(back_populates="session")


class Turn(Base):
    __tablename__ = "turns"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    source: Mapped[str] = mapped_column(String(16), default="text")  # text|voice|...
    lang: Mapped[str] = mapped_column(String(16), default="en")
    text: Mapped[str] = mapped_column(Text, default="")
    # Full assistant rich payload (error/qa/process/eta/options/recommendations).
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    audio_artifact_id: Mapped[int | None] = mapped_column(
        ForeignKey("artifacts.id"), nullable=True
    )

    session: Mapped[Session] = relationship(back_populates="turns")


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    title: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16), default="running")  # running|succeeded|failed
    eta: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    session: Mapped[Session] = relationship(back_populates="tasks")
    steps: Mapped[list["ProcessLog"]] = relationship(back_populates="task")
    commands: Mapped[list["Command"]] = relationship(back_populates="task")


class ProcessLog(Base):
    __tablename__ = "process_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    step: Mapped[str] = mapped_column(String(256))
    status: Mapped[str] = mapped_column(String(16))  # pending|running|succeeded|failed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    task: Mapped[Task] = relationship(back_populates="steps")


class Command(Base):
    __tablename__ = "commands"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    tool: Mapped[str] = mapped_column(String(64))
    args: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    task: Mapped[Task | None] = relationship(back_populates="commands")


class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    kind: Mapped[str] = mapped_column(String(32))  # file|image|audio|code|other
    path: Mapped[str] = mapped_column(Text)
    mime: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AuditEntry(Base):
    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    tool: Mapped[str] = mapped_column(String(64))
    risk: Mapped[str] = mapped_column(String(16))
    decision: Mapped[str] = mapped_column(String(16))  # auto|approved|denied|blocked
    summary: Mapped[str] = mapped_column(Text)
    args: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class Checkpoint(Base):
    __tablename__ = "checkpoints"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=_now)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    label: Mapped[str] = mapped_column(String(128))
    # Serialized workflow state: task graph + per-step status + cursor.
    state: Mapped[dict] = mapped_column(JSON)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
