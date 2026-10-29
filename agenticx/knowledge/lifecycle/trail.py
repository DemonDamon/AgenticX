"""Append-only change / audit trail for knowledge objects."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.knowledge.lifecycle.model import utc_now_iso
from agenticx.knowledge.lifecycle.store import resolve_store_dir

_VALID_ACTIONS = frozenset({"create", "update", "transition", "retire", "reopen"})


@dataclass
class ChangeEvent:
    id: str
    object_id: str
    action: str
    actor: str = "system"
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)
    at: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip() or str(uuid.uuid4())
        self.object_id = str(self.object_id or "").strip()
        if not self.object_id:
            raise ValueError("ChangeEvent.object_id is required")
        self.action = str(self.action or "").strip().lower()
        if self.action not in _VALID_ACTIONS:
            raise ValueError(f"invalid ChangeEvent.action: {self.action!r}")
        self.actor = str(self.actor or "system")
        self.from_status = None if self.from_status is None else str(self.from_status)
        self.to_status = None if self.to_status is None else str(self.to_status)
        self.detail = dict(self.detail or {})
        if not self.at:
            self.at = utc_now_iso()

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "ChangeEvent":
        if not isinstance(raw, dict):
            raise ValueError("change event must be a mapping")
        return cls(
            id=str(raw.get("id") or ""),
            object_id=str(raw.get("object_id") or ""),
            action=str(raw.get("action") or ""),
            actor=str(raw.get("actor") or "system"),
            from_status=raw.get("from_status"),
            to_status=raw.get("to_status"),
            detail=dict(raw.get("detail") or {}),
            at=str(raw.get("at") or ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "object_id": self.object_id,
            "action": self.action,
            "actor": self.actor,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "detail": dict(self.detail),
            "at": self.at,
        }


class ChangeTrailStore:
    """Append-only ``changes.json`` under the knowledge-lifecycle store root."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "changes.json"
        self._events: List[ChangeEvent] = []
        self._load()

    def _load(self) -> None:
        self._events.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("events") or []:
            self._events.append(ChangeEvent.from_dict(row))

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"events": [e.to_dict() for e in self._events]}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def append(self, event: ChangeEvent) -> ChangeEvent:
        if not isinstance(event, ChangeEvent):
            raise TypeError("event must be a ChangeEvent")
        stored = ChangeEvent.from_dict(event.to_dict())
        self._events.append(stored)
        self._persist()
        return stored

    def list_for(self, object_id: str) -> List[ChangeEvent]:
        oid = str(object_id)
        return [e for e in self._events if e.object_id == oid]

    def list_all(self) -> List[ChangeEvent]:
        return list(self._events)


def record_transition(
    trail: ChangeTrailStore,
    *,
    object_id: str,
    from_status: str,
    to_status: str,
    actor: str = "system",
    detail: Optional[Dict[str, Any]] = None,
) -> ChangeEvent:
    """Helper: map status change to create/transition/retire/reopen action."""
    action = "transition"
    if to_status == "retired":
        action = "retire"
    elif from_status == "retired" and to_status == "draft":
        action = "reopen"
    return trail.append(
        ChangeEvent(
            id="",
            object_id=object_id,
            action=action,
            actor=actor,
            from_status=from_status,
            to_status=to_status,
            detail=dict(detail or {}),
        )
    )
