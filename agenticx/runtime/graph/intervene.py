#!/usr/bin/env python3
"""Apply Graph Runtime interventions (I1–I6) to a GraphRun.

Author: Damon Li
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from agenticx.runtime.graph.events import graph_event
from agenticx.runtime.graph.models import GraphNode, GraphRun, NodeKind, NodeStatus

P0_OPS = frozenset(
    {
        "node_inject",
        "node_retract",
        "edge_reassign",
        "selection_rule",
        "pause",
        "resume",
        "cancel_node",
    }
)

_REASSIGNABLE = frozenset(
    {
        NodeStatus.PENDING,
        NodeStatus.READY,
        NodeStatus.BLOCKED,
        NodeStatus.PAUSED,
    }
)

_TERMINAL = frozenset(
    {
        NodeStatus.DONE,
        NodeStatus.FAILED,
        NodeStatus.CANCELLED,
        NodeStatus.SKIPPED,
    }
)


class InterveneError(Exception):
    def __init__(self, message: str, *, status_code: int = 400, extra: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.extra = extra or {}


@dataclass
class InterveneResult:
    run: GraphRun
    applied: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    events: List[Dict[str, Any]] = field(default_factory=list)
    # Directives to push into a live session scratchpad: agent_id -> list
    scratchpad_directives: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    converge_policy: Optional[Dict[str, Any]] = None


def build_agent_projection(run: GraphRun) -> Dict[str, Any]:
    """Project TASK nodes into agent-centric view for the God-View UI."""
    by_agent: Dict[str, List[str]] = {}
    for node in run.nodes.values():
        aid = str(node.agent_id or "").strip() or "__unassigned__"
        by_agent.setdefault(aid, []).append(node.id)

    agent_nodes: List[Dict[str, Any]] = []
    for aid, task_ids in by_agent.items():
        statuses = [run.nodes[tid].status for tid in task_ids if tid in run.nodes]
        if any(s == NodeStatus.RUNNING for s in statuses):
            status = NodeStatus.RUNNING.value
        elif any(s == NodeStatus.BLOCKED for s in statuses):
            status = NodeStatus.BLOCKED.value
        elif any(s == NodeStatus.READY for s in statuses):
            status = NodeStatus.READY.value
        elif statuses and all(s in _TERMINAL for s in statuses):
            status = NodeStatus.DONE.value
        else:
            status = NodeStatus.PENDING.value
        labels = [run.nodes[tid].label for tid in task_ids if tid in run.nodes]
        # Prefer display name already stored on the agent presence node (not hex id).
        display = ""
        presence = run.nodes.get(f"agent:{aid}")
        if presence is not None:
            display = str(presence.label or "").strip()
        if not display or display == aid:
            for tid in task_ids:
                n = run.nodes.get(tid)
                if n is None:
                    continue
                cand = str(n.label or "").strip()
                if cand and cand != aid and cand != tid and not cand.startswith("agent:"):
                    display = cand
                    break
        agent_nodes.append(
            {
                "id": f"agent:{aid}",
                "kind": NodeKind.AGENT.value,
                "label": display or aid,
                "status": status,
                "agent_id": aid if aid != "__unassigned__" else None,
                "task_ids": task_ids,
                "view_role": "agent",
                "meta": {"task_labels": labels[:6]},
            }
        )

    agent_edges: List[Dict[str, Any]] = []
    for edge in run.edges:
        src = run.nodes.get(edge.source)
        tgt = run.nodes.get(edge.target)
        if src is None or tgt is None:
            continue
        sa = str(src.agent_id or "").strip() or "__unassigned__"
        ta = str(tgt.agent_id or "").strip() or "__unassigned__"
        if sa == ta:
            continue
        agent_edges.append(
            {
                "id": f"aedge_{edge.id}",
                "kind": edge.kind.value,
                "source": f"agent:{sa}",
                "target": f"agent:{ta}",
                "label": edge.label,
                "meta": {"from_edge": edge.id},
            }
        )
    return {"agent_nodes": agent_nodes, "agent_edges": agent_edges}


def _append_directive(node: GraphNode, text: str, *, op: str) -> None:
    prefix = "RETRACT: " if op == "node_retract" else ""
    node.directives.append(f"{prefix}{text}".strip())


def _queue_scratch(
    result: InterveneResult,
    agent_id: Optional[str],
    *,
    op: str,
    text: str,
) -> None:
    aid = str(agent_id or "").strip()
    if not aid:
        return
    result.scratchpad_directives.setdefault(aid, []).append(
        {
            "ts": time.time(),
            "text": text,
            "op": op,
        }
    )


def apply_intervention(
    run: GraphRun,
    *,
    op: str,
    version: Optional[int] = None,
    node_ids: Optional[Sequence[str]] = None,
    edge_ids: Optional[Sequence[str]] = None,
    payload: Optional[Dict[str, Any]] = None,
) -> InterveneResult:
    """Mutate ``run`` in-memory. Caller persists and bumps version via store.save."""
    op_name = str(op or "").strip()
    payload = dict(payload or {})
    node_ids = [str(x) for x in (node_ids or []) if str(x).strip()]
    edge_ids = [str(x) for x in (edge_ids or []) if str(x).strip()]
    result = InterveneResult(run=run)

    if version is not None and int(version) != int(run.version):
        raise InterveneError(
            "version_conflict",
            status_code=409,
            extra={"error": "version_conflict", "version": int(run.version)},
        )

    if op_name not in P0_OPS:
        raise InterveneError(
            f"op not implemented: {op_name}",
            status_code=501,
            extra={"error": "not_implemented", "op": op_name},
        )

    if op_name == "node_inject":
        text = str(payload.get("text") or "").strip()
        if not text:
            raise InterveneError("payload.text required")
        if not node_ids:
            raise InterveneError("node_ids required")
        for nid in node_ids:
            node = run.nodes.get(nid)
            if node is None:
                result.warnings.append(f"unknown_node:{nid}")
                continue
            _append_directive(node, text, op=op_name)
            _queue_scratch(result, node.agent_id, op=op_name, text=text)
            result.applied.append("node_inject")
            result.events.append(
                graph_event(
                    "graph.node_updated",
                    run_id=run.run_id,
                    version=run.version,
                    node=node.to_dict(),
                    view_role="task",
                )
            )

    elif op_name == "node_retract":
        text = str(payload.get("text") or "").strip()
        if not text:
            raise InterveneError("payload.text required")
        if not node_ids:
            raise InterveneError("node_ids required")
        for nid in node_ids:
            node = run.nodes.get(nid)
            if node is None:
                result.warnings.append(f"unknown_node:{nid}")
                continue
            _append_directive(node, text, op=op_name)
            _queue_scratch(result, node.agent_id, op=op_name, text=f"RETRACT: {text}")
            result.applied.append("node_retract")
            result.events.append(
                graph_event(
                    "graph.node_updated",
                    run_id=run.run_id,
                    version=run.version,
                    node=node.to_dict(),
                )
            )

    elif op_name == "edge_reassign":
        edge_id = str(payload.get("edge_id") or (edge_ids[0] if edge_ids else "")).strip()
        new_agent = str(payload.get("new_agent_id") or "").strip()
        # UI may send new_target_node_id as agent projection id "agent:xxx"
        new_target = str(payload.get("new_target_node_id") or "").strip()
        if new_target.startswith("agent:"):
            new_agent = new_target.split(":", 1)[1].strip()
        force = bool(payload.get("force"))
        if not edge_id:
            raise InterveneError("payload.edge_id required")
        if not new_agent:
            raise InterveneError("payload.new_agent_id required")
        edge = next((e for e in run.edges if e.id == edge_id), None)
        if edge is None:
            # Allow treating edge_id as task node id (reassign assignee of that task)
            node = run.nodes.get(edge_id)
            if node is None:
                raise InterveneError(f"unknown edge: {edge_id}")
            target_node = node
        else:
            target_node = run.nodes.get(edge.target)
            if target_node is None:
                raise InterveneError(f"edge target missing: {edge.target}")

        if target_node.status in _TERMINAL:
            raise InterveneError("cannot reassign terminal node")
        if target_node.status == NodeStatus.RUNNING and not force:
            result.warnings.append("target_running")
            return result
        if target_node.status == NodeStatus.RUNNING and force:
            target_node.status = NodeStatus.CANCELLED
            result.warnings.append("force_cancelled_running")
            # Re-open for new assignee
            target_node.status = NodeStatus.READY
            target_node.retry_count += 1
        elif target_node.status in _REASSIGNABLE:
            if target_node.status == NodeStatus.PENDING and run.deps_satisfied(target_node.id):
                target_node.status = NodeStatus.READY
        target_node.agent_id = new_agent
        result.applied.append("edge_reassign")
        result.events.append(
            graph_event(
                "graph.node_updated",
                run_id=run.run_id,
                version=run.version,
                node=target_node.to_dict(),
            )
        )

    elif op_name == "selection_rule":
        text = str(payload.get("text") or "").strip()
        if not text:
            raise InterveneError("payload.text required")
        policy = {
            "nodes": list(node_ids),
            "edges": list(edge_ids),
            "text": text,
            "ts": time.time(),
        }
        run.meta.setdefault("policies", []).append(policy)
        result.converge_policy = {
            "max_mention_hops": 0,
            "until_ts": time.time() + 3600,
            "text": text,
        }
        # Inject onto selected nodes' agents
        agents: List[str] = []
        for nid in node_ids:
            node = run.nodes.get(nid)
            if node is None:
                continue
            _append_directive(node, f"[selection_rule] {text}", op="node_inject")
            if node.agent_id:
                agents.append(str(node.agent_id))
                _queue_scratch(
                    result,
                    node.agent_id,
                    op="selection_rule",
                    text=f"快速收敛规则（authoritative）：{text}",
                )
        result.applied.append("selection_rule")
        result.events.append(
            graph_event(
                "graph.intervention_applied",
                run_id=run.run_id,
                version=run.version,
                op="selection_rule",
                policy=policy,
            )
        )

    elif op_name == "pause":
        scope = str(payload.get("scope") or "run").strip()
        if scope == "node":
            for nid in node_ids:
                node = run.nodes.get(nid)
                if node is None:
                    continue
                if node.status == NodeStatus.RUNNING:
                    node.status = NodeStatus.PAUSED
                    result.applied.append("pause")
        else:
            run.status = "paused"
            result.applied.append("pause")
        result.events.append(
            graph_event(
                "graph.run_status",
                run_id=run.run_id,
                version=run.version,
                status=run.status,
            )
        )

    elif op_name == "resume":
        scope = str(payload.get("scope") or "run").strip()
        if scope == "node":
            for nid in node_ids:
                node = run.nodes.get(nid)
                if node is not None and node.status == NodeStatus.PAUSED:
                    node.status = NodeStatus.READY
                    result.applied.append("resume")
        else:
            run.status = "open"
            for node in run.nodes.values():
                if node.status == NodeStatus.PAUSED:
                    node.status = NodeStatus.READY
            result.applied.append("resume")
        result.events.append(
            graph_event(
                "graph.run_status",
                run_id=run.run_id,
                version=run.version,
                status=run.status,
            )
        )

    elif op_name == "cancel_node":
        if not node_ids:
            raise InterveneError("node_ids required")
        skip_downstream = bool(payload.get("skip_downstream"))
        for nid in node_ids:
            node = run.nodes.get(nid)
            if node is None:
                result.warnings.append(f"unknown_node:{nid}")
                continue
            node.status = NodeStatus.CANCELLED
            result.applied.append("cancel_node")
            result.events.append(
                graph_event(
                    "graph.node_updated",
                    run_id=run.run_id,
                    version=run.version,
                    node=node.to_dict(),
                )
            )
            # Downstream depends edges
            for edge in run.edges:
                if edge.source != nid:
                    continue
                child = run.nodes.get(edge.target)
                if child is None or child.status in _TERMINAL:
                    continue
                child.status = NodeStatus.SKIPPED if skip_downstream else NodeStatus.BLOCKED
                result.events.append(
                    graph_event(
                        "graph.node_updated",
                        run_id=run.run_id,
                        version=run.version,
                        node=child.to_dict(),
                    )
                )

    result.events.append(
        graph_event(
            "graph.intervention_applied",
            run_id=run.run_id,
            version=run.version,
            op=op_name,
            applied=list(result.applied),
            warnings=list(result.warnings),
        )
    )
    return result


def scratchpad_key_for_agent(agent_id: str) -> str:
    return f"graph_directives::{agent_id}"


def consume_graph_directives(scratchpad: Dict[str, Any], agent_id: str) -> List[str]:
    """Pop pending directives for an agent from session scratchpad."""
    key = scratchpad_key_for_agent(agent_id)
    raw = scratchpad.pop(key, None)
    if not isinstance(raw, list):
        return []
    texts: List[str] = []
    for item in raw:
        if isinstance(item, dict):
            t = str(item.get("text") or "").strip()
            if t:
                texts.append(t)
        elif isinstance(item, str) and item.strip():
            texts.append(item.strip())
    return texts


CONVERGE_SCRATCH_KEY = "graph_policy::converge"


def effective_mention_hops(scratchpad: Dict[str, Any], default_hops: int) -> int:
    """Return 0 when converge policy is active; else default."""
    policy = scratchpad.get(CONVERGE_SCRATCH_KEY)
    if not isinstance(policy, dict):
        return default_hops
    until = float(policy.get("until_ts") or 0)
    if until and time.time() > until:
        scratchpad.pop(CONVERGE_SCRATCH_KEY, None)
        return default_hops
    try:
        return max(0, int(policy.get("max_mention_hops", 0)))
    except (TypeError, ValueError):
        return 0
