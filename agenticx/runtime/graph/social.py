#!/usr/bin/env python3
"""Presence / MESSAGE-edge helpers for H2A·A2A God-View projection.

Author: Damon Li
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from agenticx.runtime.graph.events import graph_event
from agenticx.runtime.graph.models import (
    EdgeKind,
    GraphEdge,
    GraphNode,
    GraphRun,
    NodeKind,
    NodeStatus,
)
from agenticx.runtime.graph.store import GraphRunStore, get_default_store

HUMAN_NODE_ID = "human"
DEBATE_NUDGE_KEY = "debate_nudge_sent"
DEBATE_EDGES_KEY = "debate_message_edges"
DEBATE_WINDOW_SECONDS = 60
DEBATE_EDGE_THRESHOLD = 4
DEBATE_NUDGE_TEXT = (
    "讨论较热，可在右侧「运行图」框选相关成员并点「快速出结论」"
)


def _member_display_label(
    member_id: str,
    member_labels: Optional[Mapping[str, str]] = None,
) -> str:
    """Prefer human-readable avatar name; fall back to id."""
    mid = str(member_id or "").strip()
    if not mid:
        return ""
    if member_labels:
        name = str(member_labels.get(mid) or "").strip()
        if name:
            return name
    return mid


def ensure_presence_run(
    *,
    session_id: str,
    group_id: Optional[str],
    member_ids: Sequence[str],
    store: Optional[GraphRunStore] = None,
    existing_run_id: Optional[str] = None,
    member_labels: Optional[Mapping[str, str]] = None,
) -> GraphRun:
    """Return (create if needed) an ephemeral presence GraphRun for chat projection."""
    store = store or get_default_store()
    sid = str(session_id or "").strip()
    members = [str(x).strip() for x in member_ids if str(x).strip()]

    run: Optional[GraphRun] = None
    rid = str(existing_run_id or "").strip()
    if rid:
        run = store.load(rid)
    if run is None and sid:
        for candidate in store.list_by_session(sid):
            if bool((candidate.meta or {}).get("ephemeral")):
                run = candidate
                break

    if run is None:
        run = GraphRun(
            run_id=f"gr_pres_{uuid.uuid4().hex[:12]}",
            session_id=sid,
            group_id=(str(group_id) if group_id else None),
            nodes={},
            edges=[],
            status="open",
            version=0,
            meta={"source": "presence", "ephemeral": True},
        )
    elif sid and not str(run.session_id or "").strip():
        # Legacy presence runs were saved with empty session_id when
        # StudioSession had no bound UUID; backfill on reuse.
        run.session_id = sid

    if HUMAN_NODE_ID not in run.nodes:
        run.nodes[HUMAN_NODE_ID] = GraphNode(
            id=HUMAN_NODE_ID,
            kind=NodeKind.HUMAN,
            label="你",
            status=NodeStatus.READY,
            agent_id=None,
            meta={"view_role": "human"},
        )

    for mid in members:
        nid = f"agent:{mid}"
        label = _member_display_label(mid, member_labels)
        if nid not in run.nodes:
            run.nodes[nid] = GraphNode(
                id=nid,
                kind=NodeKind.AGENT,
                label=label,
                status=NodeStatus.READY,
                agent_id=mid,
                meta={"view_role": "agent"},
            )
        elif label and label != mid:
            # Refresh hex/id labels when display names become available.
            run.nodes[nid].label = label

    store.save(run, bump_version=True)
    return run


def upsert_message_edge(
    run: GraphRun,
    *,
    source: str,
    target: str,
    label: str = "mention",
) -> GraphEdge:
    """Reuse stable MESSAGE edge id between a pair; update label/meta."""
    src = str(source or "").strip()
    tgt = str(target or "").strip()
    edge_id = f"msg_{src}_{tgt}"
    existing = next((e for e in run.edges if e.id == edge_id), None)
    if existing is not None:
        existing.label = label or existing.label
        existing.meta["last_ts"] = time.time()
        return existing
    edge = GraphEdge(
        id=edge_id,
        kind=EdgeKind.MESSAGE,
        source=src,
        target=tgt,
        label=label or "mention",
        meta={"last_ts": time.time()},
    )
    run.edges.append(edge)
    return edge


def message_edge_events(
    run: GraphRun,
    edge: GraphEdge,
    *,
    summary: str = "",
) -> List[Dict[str, Any]]:
    """Build graph.edge_updated + graph.edge_flow payloads for SSE."""
    return [
        graph_event(
            "graph.edge_updated",
            run_id=run.run_id,
            version=run.version,
            edge=edge.to_dict(),
        ),
        graph_event(
            "graph.edge_flow",
            run_id=run.run_id,
            version=run.version,
            edge_id=edge.id,
            kind="message",
            intensity=1,
            summary=(summary or "")[:80],
        ),
    ]


def note_debate_edge(
    scratchpad: Dict[str, Any],
    *,
    source: str,
    target: str,
    now: Optional[float] = None,
) -> None:
    """Append a MESSAGE edge activity sample for debate heat detection."""
    ts = float(now if now is not None else time.time())
    rows = scratchpad.get(DEBATE_EDGES_KEY)
    if not isinstance(rows, list):
        rows = []
    rows.append({"ts": ts, "a": str(source), "b": str(target)})
    # Keep a short buffer
    cutoff = ts - DEBATE_WINDOW_SECONDS * 2
    rows = [r for r in rows if isinstance(r, dict) and float(r.get("ts") or 0) >= cutoff]
    scratchpad[DEBATE_EDGES_KEY] = rows[-40:]


def maybe_debate_nudge(
    scratchpad: Dict[str, Any],
    *,
    now: Optional[float] = None,
) -> Optional[str]:
    """Return nudge text once when debate is hot; None otherwise."""
    if scratchpad.get(DEBATE_NUDGE_KEY):
        return None
    # Respect active converge policy — no nudge while already converging.
    policy = scratchpad.get("graph_policy::converge")
    if isinstance(policy, dict) and policy:
        until = policy.get("until_ts")
        if until is None or float(until) > float(now if now is not None else time.time()):
            return None

    ts = float(now if now is not None else time.time())
    rows = scratchpad.get(DEBATE_EDGES_KEY)
    if not isinstance(rows, list):
        return None
    window = [
        r
        for r in rows
        if isinstance(r, dict) and (ts - float(r.get("ts") or 0)) <= DEBATE_WINDOW_SECONDS
    ]
    if len(window) < DEBATE_EDGE_THRESHOLD:
        return None
    agents: set[str] = set()
    for r in window:
        for key in ("a", "b"):
            v = str(r.get(key) or "").strip()
            if v and v != HUMAN_NODE_ID and not v.startswith("human"):
                agents.add(v.removeprefix("agent:"))
    if len(agents) < 2:
        return None
    scratchpad[DEBATE_NUDGE_KEY] = True
    return DEBATE_NUDGE_TEXT


def project_h2a_fanout(
    run: GraphRun,
    target_agent_ids: Sequence[str],
    member_labels: Optional[Mapping[str, str]] = None,
) -> Tuple[List[GraphEdge], List[Dict[str, Any]]]:
    """Create human→agent MESSAGE edges for each target; return edges + SSE events.

    Previous human→agent MESSAGE edges that are not in this turn's targets are
    removed so the God-View dashed line matches the current @ / route target.
    Agent↔agent MESSAGE edges are left untouched.
    """
    events: List[Dict[str, Any]] = []
    edges: List[GraphEdge] = []
    keep_targets: set[str] = set()
    for aid in target_agent_ids:
        tid = str(aid or "").strip()
        if not tid:
            continue
        node_id = tid if tid.startswith("agent:") else f"agent:{tid}"
        keep_targets.add(node_id)
        agent_id = tid.removeprefix("agent:")
        label = _member_display_label(agent_id, member_labels)
        if node_id not in run.nodes:
            run.nodes[node_id] = GraphNode(
                id=node_id,
                kind=NodeKind.AGENT,
                label=label,
                status=NodeStatus.READY,
                agent_id=agent_id,
                meta={"view_role": "agent"},
            )
        elif label and label != agent_id:
            run.nodes[node_id].label = label
        edge = upsert_message_edge(run, source=HUMAN_NODE_ID, target=node_id, label="user")
        edges.append(edge)
        events.extend(message_edge_events(run, edge, summary="user→agent"))

    stale = [
        e
        for e in list(run.edges)
        if e.kind == EdgeKind.MESSAGE
        and e.source == HUMAN_NODE_ID
        and e.target not in keep_targets
    ]
    if stale:
        stale_ids = {e.id for e in stale}
        run.edges = [e for e in run.edges if e.id not in stale_ids]
        for old in stale:
            events.append(
                graph_event(
                    "graph.edge_removed",
                    run_id=run.run_id,
                    version=run.version,
                    edge_id=old.id,
                    edge=old.to_dict(),
                )
            )
    return edges, events
