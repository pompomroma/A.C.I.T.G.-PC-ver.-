"""Builds the rich ``AssistantMessagePayload`` (requirement 1's full explanation set).

The visible reply text stays clean and conversational; structured extras travel in an
optional fenced ``actig-meta`` JSON block which we parse out here. The builder also folds
in execution-derived data: the step-by-step process log (req 1.(2-3)) and the ETA.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from ..protocol import AssistantMessagePayload, ChoiceChip, ProcessStep

_META_RE = re.compile(r"```actig-meta\s*(\{.*?\})\s*```", re.DOTALL)


def parse_meta(text: str) -> tuple[str, dict[str, Any]]:
    """Split the natural reply from the optional structured meta block."""
    m = _META_RE.search(text)
    if not m:
        return text.strip(), {}
    clean = (text[: m.start()] + text[m.end() :]).strip()
    try:
        meta = json.loads(m.group(1))
    except json.JSONDecodeError:
        meta = {}
    return clean, meta


def _chips(items: Any, kind: str) -> list[ChoiceChip]:
    chips: list[ChoiceChip] = []
    for it in items or []:
        if isinstance(it, str):
            chips.append(ChoiceChip(id=uuid.uuid4().hex[:8], label=it, kind=kind))
        elif isinstance(it, dict):
            chips.append(
                ChoiceChip(
                    id=uuid.uuid4().hex[:8],
                    label=it.get("label", it.get("command", "option")),
                    kind=kind,
                    command=it.get("command"),
                )
            )
    return chips


class AssistantTurnBuilder:
    """Accumulates everything about an assistant turn, then renders the wire payload."""

    def __init__(self, lang: str, brain: str | None = None) -> None:
        self.lang = lang
        self.brain = brain
        self.process: list[ProcessStep] = []
        self.eta: str | None = None
        self.continues = False

    def add_step(self, step: str, status: str, detail: str | None = None) -> None:
        self.process.append(ProcessStep(step=step, status=status, detail=detail))

    def set_eta(self, eta: str | None) -> None:
        if eta:
            self.eta = eta

    def build(self, raw_text: str) -> AssistantMessagePayload:
        text, meta = parse_meta(raw_text)
        return AssistantMessagePayload(
            text=text or "…",
            lang=self.lang,
            brain=self.brain,  # type: ignore[arg-type]
            qa=meta.get("qa"),
            errorExplanation=meta.get("errorExplanation"),
            eta=meta.get("eta") or self.eta,
            process=self.process or None,
            options=_chips(meta.get("options"), "option") or None,
            recommendations=_chips(meta.get("recommendations"), "recommendation") or None,
            continues=self.continues,
        )
