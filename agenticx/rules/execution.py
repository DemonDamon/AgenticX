"""Execution records for compiled rule runs (admin / e2e)."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.rules.model import utc_now_iso
from agenticx.rules.store import resolve_store_dir

ALLOWED_EXEC_STATUS = frozenset(
    {"queued", "running", "completed", "failed", "cancelled"}
)


@dataclass
class ExecutionRecord:
    id: str
    rule_id: str
    rule_version: int
    status: str
    nodes: List[Dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None
    started_at: str = ""
    finished_at: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip() or f"exec-{uuid.uuid4().hex[:10]}"
        self.rule_id = str(self.rule_id or "").strip()
        if not self.rule_id:
            raise ValueError("execution.rule_id is required")
        self.rule_version = int(self.rule_version)
        self.status = str(self.status or "queued").strip().lower()
        if self.status not in ALLOWED_EXEC_STATUS:
            raise ValueError(f"invalid execution status: {self.status!r}")
        self.nodes = [dict(n) for n in (self.nodes or [])]
        self.error = None if self.error is None else str(self.error)
        if not self.started_at:
            self.started_at = utc_now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "rule_id": self.rule_id,
            "rule_version": self.rule_version,
            "status": self.status,
            "nodes": [dict(n) for n in self.nodes],
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "ExecutionRecord":
        return cls(
            id=str(raw.get("id") or ""),
            rule_id=str(raw.get("rule_id") or ""),
            rule_version=int(raw.get("rule_version") or 1),
            status=str(raw.get("status") or "queued"),
            nodes=list(raw.get("nodes") or []),
            error=raw.get("error"),
            started_at=str(raw.get("started_at") or ""),
            finished_at=str(raw.get("finished_at") or ""),
        )


class ExecutionFileStore:
    """Persist execution records in ``executions.json`` beside rules store."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "executions.json"
        self._rows: Dict[str, ExecutionRecord] = {}
        self._load()

    def _load(self) -> None:
        self._rows.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("executions") or []:
            rec = ExecutionRecord.from_dict(row)
            self._rows[rec.id] = rec

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {
            "executions": [self._rows[k].to_dict() for k in sorted(self._rows)]
        }
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def list_executions(self, *, rule_id: Optional[str] = None) -> List[ExecutionRecord]:
        rows = [self._rows[k] for k in sorted(self._rows)]
        if rule_id is not None:
            rows = [r for r in rows if r.rule_id == rule_id]
        return rows

    def get_execution(self, exec_id: str) -> ExecutionRecord:
        try:
            return self._rows[exec_id]
        except KeyError as e:
            raise KeyError(exec_id) from e

    def upsert_execution(self, record: ExecutionRecord) -> ExecutionRecord:
        if not isinstance(record, ExecutionRecord):
            raise TypeError("record must be an ExecutionRecord")
        self._rows[record.id] = record
        self._persist()
        return record

    def record_run(
        self,
        *,
        rule_id: str,
        rule_version: int,
        nodes: List[Dict[str, Any]],
        status: str = "completed",
        error: Optional[str] = None,
    ) -> ExecutionRecord:
        now = utc_now_iso()
        rec = ExecutionRecord(
            id=f"exec-{uuid.uuid4().hex[:10]}",
            rule_id=rule_id,
            rule_version=rule_version,
            status=status,
            nodes=nodes,
            error=error,
            started_at=now,
            finished_at=now if status in {"completed", "failed", "cancelled"} else "",
        )
        return self.upsert_execution(rec)
