from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class SnapshotStore:
    """Immutable JSON snapshots for ID-Mapping replay (memory or directory)."""

    root: Optional[Path] = None
    _memory: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def save(self, payload: Dict[str, Any], *, snapshot_id: Optional[str] = None) -> str:
        sid = snapshot_id or f"idmap-{uuid.uuid4().hex[:12]}"
        body = dict(payload)
        body["snapshot_id"] = sid
        if self.root is not None:
            self.root.mkdir(parents=True, exist_ok=True)
            path = self.root / f"{sid}.json"
            path.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
        self._memory[sid] = body
        return sid

    def load(self, snapshot_id: str) -> Dict[str, Any]:
        if snapshot_id in self._memory:
            return dict(self._memory[snapshot_id])
        if self.root is not None:
            path = self.root / f"{snapshot_id}.json"
            if path.exists():
                return json.loads(path.read_text(encoding="utf-8"))
        raise KeyError(f"unknown snapshot: {snapshot_id}")

    def list_ids(self) -> List[str]:
        ids = set(self._memory.keys())
        if self.root is not None and self.root.is_dir():
            for path in self.root.glob("*.json"):
                ids.add(path.stem)
        return sorted(ids)
