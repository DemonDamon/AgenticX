#!/usr/bin/env python3
"""Unified memory recall for chat: WorkspaceMemoryStore + optional memory graph.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from agenticx.memory.workspace_memory import WorkspaceMemoryStore


@dataclass
class MemoryRecallResult:
    """Combined recall output for tools and auto-recall injection."""

    matches: List[Dict[str, Any]]
    graph_skipped_reason: Optional[str] = None


def _rrf_score(rank: int) -> float:
    return round(1.0 / (rank + 1), 4)


def _graph_view_to_recall_rows(view: Dict[str, Any]) -> List[Dict[str, Any]]:
    nodes = list(view.get("nodes") or [])
    edges = list(view.get("edges") or [])
    labels = {str(n.get("id", "")): str(n.get("label") or n.get("id") or "") for n in nodes}
    rows: List[Dict[str, Any]] = []
    for node in nodes:
        node_id = str(node.get("id") or "")
        if not node_id:
            continue
        label = str(node.get("label") or node_id)
        summary = str(node.get("summary") or "").strip()
        text = f"[graph] 节点: {label}"
        if summary:
            text += f" | 摘要: {summary[:200]}"
        rows.append(
            {
                "id": f"graph-node-{node_id}",
                "path": "",
                "source": "graph",
                "graph_kind": "node",
                "start_line": 0,
                "end_line": 0,
                "model": "",
                "text": text,
                "created_at": "",
                "score": 0.0,
            }
        )
    for edge in edges:
        edge_id = str(edge.get("id") or "")
        if not edge_id:
            continue
        src = labels.get(str(edge.get("source") or ""), str(edge.get("source") or ""))
        tgt = labels.get(str(edge.get("target") or ""), str(edge.get("target") or ""))
        rel = str(edge.get("label") or "relates_to")
        text = f"[graph] 关系: {src} -[{rel}]-> {tgt}"
        rows.append(
            {
                "id": f"graph-edge-{edge_id}",
                "path": "",
                "source": "graph",
                "graph_kind": "edge",
                "start_line": 0,
                "end_line": 0,
                "model": "",
                "text": text,
                "created_at": "",
                "score": 0.0,
            }
        )
    return rows


def _merge_recall_results(
    workspace_rows: List[Dict[str, Any]],
    graph_rows: List[Dict[str, Any]],
    *,
    limit: int,
    graph_limit: int,
) -> List[Dict[str, Any]]:
    n = max(1, int(limit))
    g_cap = max(0, min(int(graph_limit), n))
    ws_cap = max(1, n - g_cap) if workspace_rows else 0

    scored: Dict[str, Dict[str, Any]] = {}
    for rank, row in enumerate(workspace_rows):
        item = dict(row)
        item["source"] = "workspace"
        item["score"] = _rrf_score(rank)
        scored[item["id"]] = item
    for rank, row in enumerate(graph_rows):
        item = dict(row)
        item["score"] = _rrf_score(rank)
        existing = scored.get(item["id"])
        if existing is None:
            scored[item["id"]] = item
            continue
        existing["score"] = max(float(existing.get("score", 0.0)), float(item["score"]))

    ranked = sorted(scored.values(), key=lambda row: float(row.get("score", 0.0)), reverse=True)
    workspace_pick = [row for row in ranked if row.get("source") == "workspace"][:ws_cap]
    graph_pick = [row for row in ranked if row.get("source") == "graph"][:g_cap]
    combined = workspace_pick + graph_pick
    combined.sort(key=lambda row: float(row.get("score", 0.0)), reverse=True)
    if not combined:
        return ranked[:n]
    return combined[:n]


async def search_memory_for_chat(
    query: str,
    *,
    limit: int = 5,
    mode: str = "hybrid",
    avatar_id: Optional[str] = None,
    session_id: Optional[str] = None,
    include_graph: Optional[bool] = None,
) -> MemoryRecallResult:
    """Search workspace memory and optionally merge graph facts for the current pane."""
    q = (query or "").strip()
    if not q:
        return MemoryRecallResult(matches=[])

    store = WorkspaceMemoryStore()
    workspace_rows = store.search_sync(query=q, mode=mode, limit=max(1, limit))
    for row in workspace_rows:
        row["source"] = "workspace"

    from agenticx.memory.graph.config import load_memory_graph_config

    cfg = load_memory_graph_config()
    use_graph = cfg.search_in_chat if include_graph is None else bool(include_graph)
    graph_skipped_reason: Optional[str] = None
    graph_rows: List[Dict[str, Any]] = []

    if cfg.enabled and use_graph:
        try:
            from agenticx.memory.graph.group_id import derive_group_id_from_avatar_id
            from agenticx.memory.graph.store import MemoryGraphStore, MemoryGraphUnavailableError

            group_id = derive_group_id_from_avatar_id(avatar_id, session_id=session_id)
            graph_store = MemoryGraphStore()
            view = await graph_store.search_subgraph(
                group_id,
                q,
                limit_nodes=20,
                limit_edges=30,
            )
            graph_rows = _graph_view_to_recall_rows(view)
        except MemoryGraphUnavailableError as exc:
            graph_skipped_reason = str(exc)
        except Exception as exc:
            graph_skipped_reason = f"graph search failed: {exc}"

    merged = _merge_recall_results(
        workspace_rows,
        graph_rows,
        limit=max(1, limit),
        graph_limit=cfg.search_in_chat_graph_limit,
    )
    return MemoryRecallResult(matches=merged, graph_skipped_reason=graph_skipped_reason)


def search_memory_for_chat_sync(
    query: str,
    *,
    limit: int = 5,
    mode: str = "hybrid",
    avatar_id: Optional[str] = None,
    session_id: Optional[str] = None,
    include_graph: Optional[bool] = None,
) -> MemoryRecallResult:
    """Sync wrapper for prompt injection paths."""
    coro = search_memory_for_chat(
        query,
        limit=limit,
        mode=mode,
        avatar_id=avatar_id,
        session_id=session_id,
        include_graph=include_graph,
    )
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()
