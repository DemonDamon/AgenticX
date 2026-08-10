#!/usr/bin/env python3
"""Stable graph.* SSE / event payload helpers.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional


GRAPH_EVENT_TYPES = frozenset(
    {
        "graph.run_created",
        "graph.node_updated",
        "graph.edge_updated",
        "graph.edge_removed",
        "graph.edge_flow",
        "graph.intervention_applied",
        "graph.run_status",
    }
)


def graph_event(
    type: str,
    *,
    run_id: str,
    version: Optional[int] = None,
    **data: Any,
) -> Dict[str, Any]:
    """Build a normalized graph event dict for SSE / GroupReply content."""
    et = str(type or "").strip()
    if not et.startswith("graph."):
        et = f"graph.{et}"
    payload: Dict[str, Any] = {
        "type": et,
        "run_id": str(run_id or ""),
    }
    if version is not None:
        payload["version"] = int(version)
    for key, value in data.items():
        if value is not None:
            payload[key] = value
    return payload
