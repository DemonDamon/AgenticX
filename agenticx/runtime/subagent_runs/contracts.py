#!/usr/bin/env python3
"""Contracts for sub-agent run persistence.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA_VERSION = 1


@dataclass
class ActivityEntry:
    """One persisted activity timeline entry."""

    seq: int
    ts: float
    type: str
    title: str
    detail: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize entry into a JSON-compatible dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ActivityEntry":
        """Build an activity entry from persisted dictionary data."""
        return cls(
            seq=int(data.get("seq", 0) or 0),
            ts=float(data.get("ts", 0) or 0),
            type=str(data.get("type", "note") or "note"),
            title=str(data.get("title", "") or ""),
            detail=str(data.get("detail", "") or "").strip() or None,
        )


@dataclass
class ClusterInfo:
    """One cluster of runs that belong to the same delegation/spawn batch."""

    cluster_id: str
    owner_session_id: str
    run_ids: List[str] = field(default_factory=list)
    title: str = ""
    created_at: float = 0
    updated_at: float = 0
    sealed: bool = False
    source_tool_call_id: str = ""
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        """Serialize cluster into JSON-compatible dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ClusterInfo":
        """Build cluster info from persisted dictionary data."""
        run_ids_raw = data.get("run_ids", [])
        run_ids = [str(item).strip() for item in run_ids_raw if str(item).strip()]
        return cls(
            cluster_id=str(data.get("cluster_id", "") or "").strip(),
            owner_session_id=str(data.get("owner_session_id", "") or "").strip(),
            run_ids=run_ids,
            title=str(data.get("title", "") or "").strip(),
            created_at=float(data.get("created_at", 0) or 0),
            updated_at=float(data.get("updated_at", 0) or 0),
            sealed=bool(data.get("sealed", False)),
            source_tool_call_id=str(data.get("source_tool_call_id", "") or "").strip(),
            schema_version=int(data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION),
        )


@dataclass
class RunRecord:
    """Persisted run metadata for one sub-agent/delegation execution."""

    run_id: str
    kind: str
    owner_session_id: str
    cluster_id: str
    badge_seq: str
    name: str
    role: str
    task: str
    status: str
    created_at: float
    updated_at: float
    persona: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    avatar_id: Optional[str] = None
    avatar_session_id: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    status_history: List[Dict[str, Any]] = field(default_factory=list)
    result_summary: Optional[str] = None
    error_text: Optional[str] = None
    result_file: Optional[str] = None
    output_files: List[str] = field(default_factory=list)
    artifacts: List[Dict[str, Any]] = field(default_factory=list)
    detail_refs: Dict[str, Any] = field(default_factory=dict)
    activity_count: int = 0
    source_tool_call_id: str = ""
    schema_version: int = SCHEMA_VERSION

    def to_dict(self) -> Dict[str, Any]:
        """Serialize run record into JSON-compatible dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RunRecord":
        """Build run record from persisted dictionary data."""
        status_history_raw = data.get("status_history", [])
        status_history: List[Dict[str, Any]] = []
        if isinstance(status_history_raw, list):
            for item in status_history_raw:
                if isinstance(item, dict):
                    status_history.append(
                        {
                            "status": str(item.get("status", "") or "").strip(),
                            "ts": float(item.get("ts", 0) or 0),
                        }
                    )
        output_files_raw = data.get("output_files", [])
        output_files = [str(item).strip() for item in output_files_raw if str(item).strip()]
        artifacts_raw = data.get("artifacts", [])
        artifacts: List[Dict[str, Any]] = []
        if isinstance(artifacts_raw, list):
            for item in artifacts_raw:
                if isinstance(item, dict):
                    artifacts.append(dict(item))
        detail_refs_raw = data.get("detail_refs", {})
        detail_refs = dict(detail_refs_raw) if isinstance(detail_refs_raw, dict) else {}
        return cls(
            run_id=str(data.get("run_id", "") or "").strip(),
            kind=str(data.get("kind", "") or "").strip(),
            owner_session_id=str(data.get("owner_session_id", "") or "").strip(),
            cluster_id=str(data.get("cluster_id", "") or "").strip(),
            badge_seq=str(data.get("badge_seq", "") or "").strip(),
            name=str(data.get("name", "") or "").strip(),
            role=str(data.get("role", "") or "").strip(),
            task=str(data.get("task", "") or "").strip(),
            status=str(data.get("status", "") or "").strip(),
            created_at=float(data.get("created_at", 0) or 0),
            updated_at=float(data.get("updated_at", 0) or 0),
            persona=str(data.get("persona", "") or "").strip() or None,
            provider=str(data.get("provider", "") or "").strip() or None,
            model=str(data.get("model", "") or "").strip() or None,
            avatar_id=str(data.get("avatar_id", "") or "").strip() or None,
            avatar_session_id=str(data.get("avatar_session_id", "") or "").strip() or None,
            started_at=float(data.get("started_at", 0) or 0) or None,
            completed_at=float(data.get("completed_at", 0) or 0) or None,
            status_history=status_history,
            result_summary=str(data.get("result_summary", "") or "").strip() or None,
            error_text=str(data.get("error_text", "") or "").strip() or None,
            result_file=str(data.get("result_file", "") or "").strip() or None,
            output_files=output_files,
            artifacts=artifacts,
            detail_refs=detail_refs,
            activity_count=int(data.get("activity_count", 0) or 0),
            source_tool_call_id=str(data.get("source_tool_call_id", "") or "").strip(),
            schema_version=int(data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION),
        )
