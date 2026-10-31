"""Shared GraphStore query helpers (neighborhood / subgraph).

These pure builders back the **sole recommended GraphStore read facade**.
Product code should call ``GraphStore.neighborhood`` / ``GraphStore.subgraph``
(which delegate here) rather than reimplementing traversal or talking to a
backend driver directly. See ``store/README.md``.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Set

from agenticx.knowledge.graphers.models import Entity, Relationship


def entity_to_node(entity: Entity) -> Dict[str, Any]:
    return entity.to_dict()


def relationship_to_edge(rel: Relationship) -> Dict[str, Any]:
    return rel.to_dict()


def build_neighborhood(
    *,
    center_id: str,
    entities: Mapping[str, Entity],
    relationships: Mapping[str, Relationship],
    depth: int = 1,
    limit: int = 200,
) -> Dict[str, Any]:
    """BFS neighborhood around ``center_id`` (depth hops)."""
    depth = max(0, int(depth))
    limit = max(1, int(limit))
    if center_id not in entities:
        return {"center_id": center_id, "nodes": [], "edges": []}

    frontier: Set[str] = {center_id}
    seen_nodes: Set[str] = {center_id}
    seen_edges: Set[str] = set()

    for _ in range(depth):
        if len(seen_nodes) >= limit:
            break
        nxt: Set[str] = set()
        for rid, rel in relationships.items():
            if rid in seen_edges:
                continue
            src, tgt = rel.source_entity_id, rel.target_entity_id
            if src in frontier or tgt in frontier:
                seen_edges.add(rid)
                for nid in (src, tgt):
                    if nid in entities and nid not in seen_nodes and len(seen_nodes) < limit:
                        seen_nodes.add(nid)
                        nxt.add(nid)
        frontier = nxt
        if not frontier:
            break

    nodes = [entity_to_node(entities[nid]) for nid in sorted(seen_nodes) if nid in entities]
    edges = [
        relationship_to_edge(relationships[rid])
        for rid in sorted(seen_edges)
        if rid in relationships
        and relationships[rid].source_entity_id in seen_nodes
        and relationships[rid].target_entity_id in seen_nodes
    ]
    return {"center_id": center_id, "nodes": nodes, "edges": edges}


def build_subgraph(
    *,
    entities: Mapping[str, Entity],
    relationships: Mapping[str, Relationship],
    entity_ids: Optional[Iterable[str]] = None,
    limit_nodes: int = 200,
    backend: str = "memory",
) -> Dict[str, Any]:
    """Export a capped subgraph; optional filter by entity id set."""
    limit_nodes = max(1, int(limit_nodes))
    if entity_ids is None:
        chosen = sorted(entities.keys())[:limit_nodes]
    else:
        wanted = {str(x) for x in entity_ids}
        chosen = [eid for eid in sorted(entities.keys()) if eid in wanted][:limit_nodes]
    node_set = set(chosen)
    nodes = [entity_to_node(entities[eid]) for eid in chosen if eid in entities]
    edges = [
        relationship_to_edge(rel)
        for rid, rel in sorted(relationships.items(), key=lambda kv: kv[0])
        if rel.source_entity_id in node_set and rel.target_entity_id in node_set
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "stats": {
            "backend": backend,
            "entity_count": len(nodes),
            "relationship_count": len(edges),
            "store_entity_count": len(entities),
            "store_relationship_count": len(relationships),
        },
    }
