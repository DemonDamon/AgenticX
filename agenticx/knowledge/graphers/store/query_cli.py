"""CLI bridge: JSON GraphStore queries for admin explorer (Neo4j path).

Usage:
  echo '{"op":"stats"}' | python -m agenticx.knowledge.graphers.store.query_cli
  echo '{"op":"subgraph","limit_nodes":200}' | python -m ...
  echo '{"op":"neighborhood","entity_id":"...", "depth":1}' | python -m ...
  echo '{"op":"seed_brand_a"}' | python -m ...
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store import create_graph_store


def seed_brand_a(store: Any) -> Dict[str, Any]:
    entities = [
        Entity(
            id="brand-a-entity-pump-01",
            name="Pump 01",
            entity_type=EntityType.UNKNOWN,
            attributes={"site": "plant-a", "kind": "pump", "brand": "brand-a"},
        ),
        Entity(
            id="brand-a-site-plant-a",
            name="Plant A",
            entity_type=EntityType.UNKNOWN,
            attributes={"kind": "site", "brand": "brand-a"},
        ),
        Entity(
            id="brand-a-entity-valve-01",
            name="Valve 01",
            entity_type=EntityType.UNKNOWN,
            attributes={"site": "plant-a", "kind": "valve", "brand": "brand-a"},
        ),
    ]
    rels = [
        Relationship(
            id="brand-a-rel-pump-at-plant",
            source_entity_id="brand-a-entity-pump-01",
            target_entity_id="brand-a-site-plant-a",
            relation_type=RelationType.RELATED_TO,
            description="Pump located at Plant A",
        ),
        Relationship(
            id="brand-a-rel-valve-at-plant",
            source_entity_id="brand-a-entity-valve-01",
            target_entity_id="brand-a-site-plant-a",
            relation_type=RelationType.RELATED_TO,
            description="Valve located at Plant A",
        ),
    ]
    for e in entities:
        store.upsert_entity(e)
    for r in rels:
        store.upsert_relationship(r)
    return store.stats()


def main() -> int:
    raw = sys.stdin.read() or "{}"
    req = json.loads(raw)
    op = str(req.get("op") or "stats")
    backend = req.get("backend")
    kwargs = {}
    if req.get("path"):
        kwargs["path"] = req["path"]
    store = create_graph_store(backend=backend, **kwargs) if backend or kwargs else create_graph_store()

    if op == "stats":
        out = {"ok": True, "data": store.stats()}
    elif op == "subgraph":
        out = {
            "ok": True,
            "data": store.subgraph(
                entity_ids=req.get("entity_ids"),
                limit_nodes=int(req.get("limit_nodes") or 200),
            ),
        }
        out["data"]["backend"] = store.backend_name
    elif op == "neighborhood":
        out = {
            "ok": True,
            "data": store.neighborhood(
                str(req.get("entity_id") or ""),
                depth=int(req.get("depth") or 1),
                limit=int(req.get("limit") or 200),
            ),
        }
        out["data"]["backend"] = store.backend_name
    elif op == "seed_brand_a":
        stats = seed_brand_a(store)
        out = {"ok": True, "data": {"stats": stats, "backend": store.backend_name}}
    else:
        out = {"ok": False, "error": f"unknown op {op}"}
        print(json.dumps(out), flush=True)
        return 1

    print(json.dumps(out, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
