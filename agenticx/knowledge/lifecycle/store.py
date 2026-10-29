"""JSON file persistence for KnowledgeObject entities.

Path resolution: explicit ``root`` argument, else ``AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR``,
else a process-local default under the cwd (``.runtime/knowledge-lifecycle``).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.knowledge.lifecycle.model import (
    KnowledgeObject,
    KnowledgeStatus,
    apply_transition,
    utc_now_iso,
)

# Optional forward ref — trail imported lazily to avoid cycles at import time


_DEFAULT_REL = Path(".runtime") / "knowledge-lifecycle"


def resolve_store_dir(root: Optional[Union[str, Path]] = None) -> Path:
    if root is not None:
        return Path(root)
    env = os.environ.get("AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR", "").strip()
    if env:
        return Path(env)
    return Path.cwd() / _DEFAULT_REL


class KnowledgeObjectFileStore:
    """Upsert / list / transition KnowledgeObject rows in ``objects.json``."""

    def __init__(
        self,
        root: Optional[Union[str, Path]] = None,
        *,
        trail: Any = None,
        actor: str = "system",
    ) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "objects.json"
        self._objects: Dict[str, KnowledgeObject] = {}
        self._trail = trail
        self._actor = str(actor or "system")
        self._load()

    def _load(self) -> None:
        self._objects.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("objects") or []:
            obj = KnowledgeObject.from_dict(row)
            self._objects[obj.id] = obj

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"objects": [self._objects[k].to_dict() for k in sorted(self._objects)]}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def list_objects(
        self,
        *,
        status: Optional[KnowledgeStatus] = None,
    ) -> List[KnowledgeObject]:
        items = [self._objects[k] for k in sorted(self._objects)]
        if status is None:
            return items
        if isinstance(status, str):
            status = KnowledgeStatus(status)
        return [o for o in items if o.status is status]

    def get_object(self, object_id: str) -> KnowledgeObject:
        try:
            return self._objects[object_id]
        except KeyError as e:
            raise KeyError(object_id) from e

    def upsert_object(
        self,
        obj: KnowledgeObject,
        *,
        bump_version: bool = False,
    ) -> KnowledgeObject:
        if not isinstance(obj, KnowledgeObject):
            raise TypeError("obj must be a KnowledgeObject")
        now = utc_now_iso()
        existing = self._objects.get(obj.id)
        if existing is None:
            stored = KnowledgeObject.from_dict(
                {
                    **obj.to_dict(),
                    "created_at": obj.created_at or now,
                    "updated_at": now,
                }
            )
        else:
            version = existing.version + 1 if bump_version else max(existing.version, obj.version)
            payload = obj.to_dict()
            payload["version"] = version
            payload["created_at"] = existing.created_at
            payload["updated_at"] = now
            stored = KnowledgeObject.from_dict(payload)
        self._objects[stored.id] = stored
        self._persist()
        if self._trail is not None:
            action = "create" if existing is None else "update"
            self._trail.append(
                _change_event(
                    object_id=stored.id,
                    action=action,
                    actor=self._actor,
                    from_status=None if existing is None else existing.status.value,
                    to_status=stored.status.value,
                    detail={"version": stored.version, "kind": stored.kind},
                )
            )
        return stored

    def transition(self, object_id: str, to: KnowledgeStatus) -> KnowledgeObject:
        current = self.get_object(object_id)
        updated = apply_transition(current, to)
        self._objects[object_id] = updated
        self._persist()
        if self._trail is not None:
            from agenticx.knowledge.lifecycle.trail import record_transition

            record_transition(
                self._trail,
                object_id=object_id,
                from_status=current.status.value,
                to_status=updated.status.value,
                actor=self._actor,
            )
        return updated


def _change_event(
    *,
    object_id: str,
    action: str,
    actor: str,
    from_status: Optional[str],
    to_status: Optional[str],
    detail: Optional[Dict[str, Any]] = None,
) -> Any:
    from agenticx.knowledge.lifecycle.trail import ChangeEvent

    return ChangeEvent(
        id="",
        object_id=object_id,
        action=action,
        actor=actor,
        from_status=from_status,
        to_status=to_status,
        detail=dict(detail or {}),
    )
