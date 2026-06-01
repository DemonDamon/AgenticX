#!/usr/bin/env python3
"""Stable DTOs for memory graph API responses.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _iso(dt: Any) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


def _node_kind(node: Any) -> str:
    name = type(node).__name__
    if name == "EpisodicNode":
        return "episode"
    if name == "CommunityNode":
        return "community"
    return "entity"


def _node_label(node: Any) -> str:
    for attr in ("name", "content"):
        val = getattr(node, attr, None)
        if val:
            text = str(val).strip()
            if text:
                return text[:120]
    return str(getattr(node, "uuid", ""))[:36]


def _edge_status(edge: Any) -> str:
    invalid_at = getattr(edge, "invalid_at", None)
    expired_at = getattr(edge, "expired_at", None)
    if invalid_at is not None or expired_at is not None:
        return "invalidated"
    return "active"


def map_node(node: Any) -> Dict[str, Any]:
    """Map Graphiti node to GraphNodeDTO dict."""
    return {
        "id": str(getattr(node, "uuid", "")),
        "kind": _node_kind(node),
        "label": _node_label(node),
        "summary": (getattr(node, "summary", None) or getattr(node, "content", None) or "")[:500] or None,
        "validAt": _iso(getattr(node, "valid_at", None)),
        "invalidAt": _iso(getattr(node, "invalid_at", None)),
    }


def map_edge(edge: Any) -> Dict[str, Any]:
    """Map Graphiti EntityEdge to GraphEdgeDTO dict."""
    label = getattr(edge, "fact", None) or getattr(edge, "name", None) or "relates_to"
    return {
        "id": str(getattr(edge, "uuid", "")),
        "source": str(getattr(edge, "source_node_uuid", "")),
        "target": str(getattr(edge, "target_node_uuid", "")),
        "label": str(label)[:200],
        "status": _edge_status(edge),
        "validAt": _iso(getattr(edge, "valid_at", None)),
        "invalidAt": _iso(getattr(edge, "invalid_at", None)),
    }


def build_graph_view(
    *,
    group_id: str,
    nodes: List[Any],
    edges: List[Any],
    truncated: bool = False,
) -> Dict[str, Any]:
    """Build GraphViewDTO dict."""
    node_dtos = [map_node(n) for n in nodes if getattr(n, "uuid", None)]
    edge_dtos = [map_edge(e) for e in edges if getattr(e, "uuid", None)]
    return {
        "nodes": node_dtos,
        "edges": edge_dtos,
        "meta": {
            "groupId": group_id,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "truncated": truncated,
            "nodeCount": len(node_dtos),
            "edgeCount": len(edge_dtos),
        },
    }


def map_episode_timeline_item(episode: Any) -> Dict[str, Any]:
    """Compact episode row for timeline API."""
    return {
        "id": str(getattr(episode, "uuid", "")),
        "name": str(getattr(episode, "name", "") or "")[:200],
        "referenceTime": _iso(getattr(episode, "valid_at", None) or getattr(episode, "created_at", None)),
        "sourceDescription": str(getattr(episode, "source_description", "") or "")[:200],
        "preview": str(getattr(episode, "content", "") or "")[:280],
    }
