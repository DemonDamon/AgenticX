#!/usr/bin/env python3
"""Compile Workforce / subtask plans into a GraphRun.

Author: Damon Li
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Mapping, Optional, Sequence

from agenticx.runtime.graph.models import (
    EdgeKind,
    GraphEdge,
    GraphNode,
    GraphRun,
    NodeKind,
    NodeStatus,
)


def _subtask_id(st: Any) -> str:
    return str(getattr(st, "id", None) or (st.get("id") if isinstance(st, dict) else "") or "").strip()


def _subtask_description(st: Any) -> str:
    if isinstance(st, dict):
        return str(st.get("description") or st.get("name") or "").strip()
    return str(
        getattr(st, "description", None)
        or getattr(st, "name", None)
        or ""
    ).strip()


def _subtask_deps(st: Any) -> List[str]:
    raw = None
    if isinstance(st, dict):
        raw = st.get("dependencies")
        if raw is None:
            raw = st.get("depends_on")
    else:
        raw = getattr(st, "dependencies", None)
        if raw is None:
            raw = getattr(st, "depends_on", None)
    if not raw:
        return []
    return [str(x).strip() for x in raw if str(x).strip()]


def compile_workforce_run(
    *,
    session_id: str,
    group_id: Optional[str],
    subtasks: Sequence[Any],
    assignment_map: Mapping[str, str],
    run_id: Optional[str] = None,
) -> GraphRun:
    """Build a WorkGraph from decomposed subtasks and assignee map.

    Nodes with no depends edges start as READY (eligible for parallel schedule).
    Missing dependency fields default to full parallelism (empty depends).
    """
    rid = str(run_id or f"gr_{uuid.uuid4().hex[:16]}")
    nodes: Dict[str, GraphNode] = {}
    edges: List[GraphEdge] = []
    id_set = {_subtask_id(st) for st in subtasks if _subtask_id(st)}

    for st in subtasks:
        tid = _subtask_id(st)
        if not tid:
            continue
        desc = _subtask_description(st)
        agent_id = str(assignment_map.get(tid) or "").strip() or None
        deps = [d for d in _subtask_deps(st) if d in id_set and d != tid]
        status = NodeStatus.READY if not deps else NodeStatus.PENDING
        nodes[tid] = GraphNode(
            id=tid,
            kind=NodeKind.TASK,
            label=(desc[:48] + ("…" if len(desc) > 48 else "")) or tid,
            status=status,
            agent_id=agent_id,
            task_text=desc,
            meta={"subtask_id": tid},
        )
        for dep in deps:
            edges.append(
                GraphEdge(
                    id=f"dep_{dep}_{tid}",
                    kind=EdgeKind.DEPENDS,
                    source=dep,
                    target=tid,
                    label="depends",
                )
            )

    return GraphRun(
        run_id=rid,
        session_id=str(session_id or ""),
        group_id=(str(group_id) if group_id else None),
        nodes=nodes,
        edges=edges,
        status="open",
        version=0,
        meta={"source": "workforce"},
    )
