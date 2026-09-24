#!/usr/bin/env python3
"""Pending versus active memory items for prompt recall.

Author: Damon Li
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.utils.agx_home import agx_home

_EXPLICIT_ORIGINS = {"user", "manual", "explicit"}


def status_for_write(*, inferred: bool, origin: str) -> str:
    """Inferred guesses stay pending until confirmed. Explicit notes are active."""

    if inferred and str(origin or "").strip().lower() not in _EXPLICIT_ORIGINS:
        return "pending"
    return "active"


class MemoryItemStore:
    """JSON list of memory items. Missing file means there is nothing to filter."""

    def __init__(self, path: Path) -> None:
        self.path = path

    @classmethod
    def default(cls) -> "MemoryItemStore":
        return cls(agx_home() / "memory" / "items.json")

    def _load(self) -> List[Dict[str, Any]]:
        if not self.path.is_file():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return data if isinstance(data, list) else []

    def _save(self, rows: List[Dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def add(self, content: str, *, inferred: bool, origin: str) -> Dict[str, Any]:
        item = {
            "id": uuid.uuid4().hex,
            "content": str(content or "").strip(),
            "status": status_for_write(inferred=inferred, origin=origin),
            "origin": str(origin or ""),
            "inferred": bool(inferred),
        }
        rows = self._load()
        rows.append(item)
        self._save(rows)
        return item

    def confirm(self, item_id: str) -> Optional[Dict[str, Any]]:
        rows = self._load()
        found: Optional[Dict[str, Any]] = None
        for row in rows:
            if str(row.get("id")) == item_id:
                row["status"] = "active"
                found = row
                break
        if found is not None:
            self._save(rows)
        return found

    def pending_ids(self) -> set[str]:
        return {str(row.get("id")) for row in self._load() if row.get("status") == "pending"}

    def active_matches(self, query: str) -> List[Dict[str, Any]]:
        needle = (query or "").strip().lower()
        if not needle:
            return []
        matches: List[Dict[str, Any]] = []
        for row in self._load():
            if row.get("status") != "active":
                continue
            content = str(row.get("content") or "")
            if needle in content.lower():
                matches.append(
                    {
                        "id": row.get("id"),
                        "content": content,
                        "status": "active",
                        "source": "memory_item",
                    }
                )
        return matches


def apply_memory_status(
    rows: List[Dict[str, Any]],
    *,
    query: str,
    store: Optional[MemoryItemStore] = None,
) -> List[Dict[str, Any]]:
    """Drop pending rows and append confirmed items that match ``query``."""

    item_store = store if store is not None else MemoryItemStore.default()
    if store is None and not item_store.path.is_file():
        return list(rows)
    pending = item_store.pending_ids()
    kept = [
        row
        for row in rows
        if str(row.get("status") or "active") != "pending" and str(row.get("id") or "") not in pending
    ]
    seen = {str(row.get("id") or "") for row in kept}
    for item in item_store.active_matches(query):
        if str(item.get("id")) not in seen:
            kept.append(item)
    return kept
