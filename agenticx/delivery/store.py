#!/usr/bin/env python3
"""Persistent delivery task registry under ~/.agenticx/delivery/.

Author: Damon Li
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_STORE_ROOT = Path.home() / ".agenticx" / "delivery"
_TASKS_JSON = _STORE_ROOT / "tasks.json"
_lock = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DeliveryTaskRecord:
    """Lightweight task index entry."""

    task_id: str
    project_name: str
    target: str
    slug: str
    status: str = "pending"
    worktree_path: str = ""
    plan_path: str = ""
    output_dir: str = ""
    input_files: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeliveryTaskRecord":
        known = set(cls.__dataclass_fields__.keys())
        filtered = {k: v for k, v in data.items() if k in known}
        if "input_files" not in filtered:
            filtered["input_files"] = []
        return cls(**filtered)


def _load_registry() -> dict[str, Any]:
    _STORE_ROOT.mkdir(parents=True, exist_ok=True)
    if not _TASKS_JSON.is_file():
        return {"tasks": {}}
    try:
        raw = json.loads(_TASKS_JSON.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and isinstance(raw.get("tasks"), dict):
            return raw
    except json.JSONDecodeError:
        pass
    return {"tasks": {}}


def _save_registry(data: dict[str, Any]) -> None:
    _STORE_ROOT.mkdir(parents=True, exist_ok=True)
    _TASKS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def new_task_id() -> str:
    return uuid.uuid4().hex[:12]


def slugify(name: str) -> str:
    import re

    base = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", name.strip().lower())
    base = base.strip("-") or "delivery"
    return base[:48]


def upsert_task(record: DeliveryTaskRecord) -> DeliveryTaskRecord:
    with _lock:
        reg = _load_registry()
        tasks = reg.setdefault("tasks", {})
        now = _now_iso()
        if not record.created_at:
            record.created_at = now
        record.updated_at = now
        tasks[record.task_id] = record.to_dict()
        _save_registry(reg)
        return record


def get_task(task_id: str) -> DeliveryTaskRecord | None:
    with _lock:
        reg = _load_registry()
        raw = reg.get("tasks", {}).get(task_id)
        if not isinstance(raw, dict):
            return None
        return DeliveryTaskRecord.from_dict(raw)


def list_tasks() -> list[DeliveryTaskRecord]:
    with _lock:
        reg = _load_registry()
        items = reg.get("tasks", {})
        out = [DeliveryTaskRecord.from_dict(v) for v in items.values() if isinstance(v, dict)]
        out.sort(key=lambda t: t.updated_at or t.created_at, reverse=True)
        return out
