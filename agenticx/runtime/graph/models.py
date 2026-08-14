#!/usr/bin/env python3
"""WorkGraph models for Near Graph Runtime.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeKind(str, Enum):
    AGENT = "agent"
    SPAWN = "spawn"
    TASK = "task"
    HUMAN = "human"
    REVIEW = "review"


class NodeStatus(str, Enum):
    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    BLOCKED = "blocked"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


class EdgeKind(str, Enum):
    DEPENDS = "depends"
    MESSAGE = "message"
    ARTIFACT = "artifact"
    DELEGATE = "delegate"


_TERMINAL = frozenset(
    {
        NodeStatus.DONE,
        NodeStatus.FAILED,
        NodeStatus.CANCELLED,
        NodeStatus.SKIPPED,
    }
)


@dataclass
class GraphNode:
    id: str
    kind: NodeKind
    label: str
    status: NodeStatus = NodeStatus.PENDING
    agent_id: Optional[str] = None
    task_text: str = ""
    directives: List[str] = field(default_factory=list)
    retry_count: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "label": self.label,
            "status": self.status.value,
            "agent_id": self.agent_id,
            "task_text": self.task_text,
            "directives": list(self.directives),
            "retry_count": int(self.retry_count),
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "GraphNode":
        return cls(
            id=str(raw["id"]),
            kind=NodeKind(str(raw.get("kind") or NodeKind.TASK.value)),
            label=str(raw.get("label") or ""),
            status=NodeStatus(str(raw.get("status") or NodeStatus.PENDING.value)),
            agent_id=(str(raw["agent_id"]) if raw.get("agent_id") is not None else None),
            task_text=str(raw.get("task_text") or ""),
            directives=[str(x) for x in (raw.get("directives") or [])],
            retry_count=int(raw.get("retry_count") or 0),
            meta=dict(raw.get("meta") or {}),
        )


@dataclass
class GraphEdge:
    id: str
    kind: EdgeKind
    source: str
    target: str
    label: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind.value,
            "source": self.source,
            "target": self.target,
            "label": self.label,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "GraphEdge":
        return cls(
            id=str(raw["id"]),
            kind=EdgeKind(str(raw.get("kind") or EdgeKind.DEPENDS.value)),
            source=str(raw["source"]),
            target=str(raw["target"]),
            label=str(raw.get("label") or ""),
            meta=dict(raw.get("meta") or {}),
        )


@dataclass
class RunState:
    current_nodes: List[str] = field(default_factory=list)
    branch: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "current_nodes": list(self.current_nodes),
            "branch": dict(self.branch),
        }

    @classmethod
    def from_dict(cls, raw: Optional[Dict[str, Any]]) -> "RunState":
        raw = raw or {}
        return cls(
            current_nodes=[str(x) for x in (raw.get("current_nodes") or [])],
            branch=dict(raw.get("branch") or {}),
        )


@dataclass
class ArtifactRef:
    id: str
    node_id: str
    kind: str
    path_or_uri: str
    summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "ArtifactRef":
        return cls(
            id=str(raw["id"]),
            node_id=str(raw["node_id"]),
            kind=str(raw.get("kind") or "other"),
            path_or_uri=str(raw.get("path_or_uri") or ""),
            summary=str(raw.get("summary") or ""),
        )


@dataclass
class EvidenceRef:
    id: str
    node_id: str
    kind: str
    payload: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "node_id": self.node_id,
            "kind": self.kind,
            "payload": dict(self.payload),
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "EvidenceRef":
        return cls(
            id=str(raw["id"]),
            node_id=str(raw["node_id"]),
            kind=str(raw.get("kind") or "log"),
            payload=dict(raw.get("payload") or {}),
        )


@dataclass
class MemoryPointer:
    namespace: str
    key: str

    def to_dict(self) -> Dict[str, Any]:
        return {"namespace": self.namespace, "key": self.key}

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "MemoryPointer":
        return cls(namespace=str(raw["namespace"]), key=str(raw["key"]))


@dataclass
class GraphRun:
    run_id: str
    session_id: str
    group_id: Optional[str]
    nodes: Dict[str, GraphNode]
    edges: List[GraphEdge]
    run_state: RunState = field(default_factory=RunState)
    artifacts: List[ArtifactRef] = field(default_factory=list)
    evidence: List[EvidenceRef] = field(default_factory=list)
    memory_pointers: List[MemoryPointer] = field(default_factory=list)
    status: str = "open"
    version: int = 1
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "session_id": self.session_id,
            "group_id": self.group_id,
            "nodes": {k: v.to_dict() for k, v in self.nodes.items()},
            "edges": [e.to_dict() for e in self.edges],
            "run_state": self.run_state.to_dict(),
            "artifacts": [a.to_dict() for a in self.artifacts],
            "evidence": [e.to_dict() for e in self.evidence],
            "memory_pointers": [m.to_dict() for m in self.memory_pointers],
            "status": self.status,
            "version": int(self.version),
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "GraphRun":
        nodes_raw = raw.get("nodes") or {}
        nodes: Dict[str, GraphNode] = {}
        if isinstance(nodes_raw, dict):
            for key, val in nodes_raw.items():
                if isinstance(val, dict):
                    nodes[str(key)] = GraphNode.from_dict(val)
        edges = [
            GraphEdge.from_dict(e)
            for e in (raw.get("edges") or [])
            if isinstance(e, dict)
        ]
        return cls(
            run_id=str(raw["run_id"]),
            session_id=str(raw.get("session_id") or ""),
            group_id=(str(raw["group_id"]) if raw.get("group_id") is not None else None),
            nodes=nodes,
            edges=edges,
            run_state=RunState.from_dict(raw.get("run_state")),
            artifacts=[
                ArtifactRef.from_dict(a)
                for a in (raw.get("artifacts") or [])
                if isinstance(a, dict)
            ],
            evidence=[
                EvidenceRef.from_dict(e)
                for e in (raw.get("evidence") or [])
                if isinstance(e, dict)
            ],
            memory_pointers=[
                MemoryPointer.from_dict(m)
                for m in (raw.get("memory_pointers") or [])
                if isinstance(m, dict)
            ],
            status=str(raw.get("status") or "open"),
            version=int(raw.get("version") or 1),
            meta=dict(raw.get("meta") or {}),
        )

    def depends_sources(self, node_id: str) -> List[str]:
        return [
            e.source
            for e in self.edges
            if e.kind == EdgeKind.DEPENDS and e.target == node_id
        ]

    def deps_satisfied(self, node_id: str) -> bool:
        for dep_id in self.depends_sources(node_id):
            dep = self.nodes.get(dep_id)
            if dep is None or dep.status != NodeStatus.DONE:
                return False
        return True

    def is_finished(self) -> bool:
        if not self.nodes:
            return True
        return all(n.status in _TERMINAL for n in self.nodes.values())
