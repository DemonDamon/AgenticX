from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import yaml

ALLOWED_NODE_TYPES = frozenset({"extract", "clean", "transform", "load", "snapshot"})


class JobDslError(ValueError):
    """Invalid job YAML / JobSpec."""


@dataclass
class JobNode:
    id: str
    type: str
    channel: Optional[str] = None
    statement: Optional[str] = None
    drop_null: List[str] = field(default_factory=list)
    idmap: Optional[str] = None
    table: Optional[str] = None
    grant_id: Optional[str] = None
    target: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "JobNode":
        if not isinstance(raw, dict):
            raise JobDslError("node must be a mapping")
        nid = str(raw.get("id") or "").strip()
        ntype = str(raw.get("type") or "").strip().lower()
        if not nid:
            raise JobDslError("node.id is required")
        if ntype not in ALLOWED_NODE_TYPES:
            raise JobDslError(f"unknown node type: {ntype!r}")
        known = {
            "id", "type", "channel", "statement", "drop_null", "idmap",
            "table", "grant_id", "target",
        }
        extra = {k: v for k, v in raw.items() if k not in known}
        drop = raw.get("drop_null") or []
        if not isinstance(drop, list):
            raise JobDslError("drop_null must be a list")
        return cls(
            id=nid,
            type=ntype,
            channel=raw.get("channel"),
            statement=raw.get("statement"),
            drop_null=[str(x) for x in drop],
            idmap=raw.get("idmap"),
            table=raw.get("table"),
            grant_id=raw.get("grant_id"),
            target=raw.get("target"),
            extra=extra,
        )


@dataclass
class JobSpec:
    name: str
    nodes: List[JobNode]
    schedule: Optional[str] = None
    meta: Dict[str, Any] = field(default_factory=dict)

    @property
    def node_types(self) -> List[str]:
        return [n.type for n in self.nodes]


def load_job(path: Union[str, Path]) -> JobSpec:
    p = Path(path)
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise JobDslError("job root must be a mapping")
    name = str(data.get("name") or "").strip()
    if not name:
        raise JobDslError("job.name is required")
    nodes_raw = data.get("nodes")
    if not isinstance(nodes_raw, list) or not nodes_raw:
        raise JobDslError("job.nodes must be a non-empty list")
    nodes = [JobNode.from_dict(n) for n in nodes_raw]
    known = {"name", "nodes", "schedule"}
    meta = {k: v for k, v in data.items() if k not in known}
    return JobSpec(
        name=name,
        nodes=nodes,
        schedule=data.get("schedule"),
        meta=meta,
    )
