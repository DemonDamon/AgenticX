"""CLI bridge: JSON GraphStore queries for admin explorer (Neo4j path).

Usage:
  echo '{"op":"stats"}' | python -m agenticx.knowledge.graphers.store.query_cli
  echo '{"op":"subgraph","limit_nodes":200}' | python -m ...
  echo '{"op":"neighborhood","entity_id":"...", "depth":1}' | python -m ...
  echo '{"op":"seed_brand_a"}' | python -m ...
  echo '{"op":"publish_touch","object_ids":["..."],"meta":{...}}' | python -m ...
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from agenticx.knowledge.graphers.models import Entity, EntityType, Relationship, RelationType
from agenticx.knowledge.graphers.store import create_graph_store


def seed_brand_a(store: Any) -> Dict[str, Any]:
    """Seed 示例化工厂·冷却回路 demo graph (op name kept for bridge compat)."""
    entities = [
        Entity(
            id="device-pump-01",
            name="1号循环泵",
            entity_type=EntityType.UNKNOWN,
            attributes={"site": "一车间冷却区", "kind": "pump", "scenario": "cooling-loop"},
        ),
        Entity(
            id="site-cooling-zone-1",
            name="一车间冷却区",
            entity_type=EntityType.UNKNOWN,
            attributes={"kind": "site", "scenario": "cooling-loop"},
        ),
        Entity(
            id="device-valve-01",
            name="回路切断阀",
            entity_type=EntityType.UNKNOWN,
            attributes={"site": "一车间冷却区", "kind": "valve", "scenario": "cooling-loop"},
        ),
    ]
    rels = [
        Relationship(
            id="rel-pump01-in-zone1",
            source_entity_id="device-pump-01",
            target_entity_id="site-cooling-zone-1",
            relation_type=RelationType.RELATED_TO,
            description="1号循环泵位于一车间冷却区",
        ),
        Relationship(
            id="rel-valve01-in-zone1",
            source_entity_id="device-valve-01",
            target_entity_id="site-cooling-zone-1",
            relation_type=RelationType.RELATED_TO,
            description="回路切断阀位于一车间冷却区",
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
    elif op == "publish_touch":
        # Incremental publish: stamp last_synced_* on touched entities (cooling-loop demo).
        object_ids = [str(x) for x in (req.get("object_ids") or []) if x]
        meta = req.get("meta") or {}
        synced_at = str(meta.get("synced_at") or "")
        run_id = str(meta.get("run_id") or "")
        actor = str(meta.get("actor") or "")
        source_ids = [str(x) for x in (meta.get("source_ids") or []) if x]
        updated = []
        for oid in object_ids:
            # Prefer neighborhood depth-0 to fetch existing attrs when available.
            existing = None
            try:
                nb = store.neighborhood(oid, depth=0, limit=1)
                for n in nb.get("nodes") or []:
                    if str(n.get("id")) == oid:
                        existing = n
                        break
            except Exception:
                existing = None
            attrs = dict((existing or {}).get("attributes") or {})
            if synced_at:
                attrs["last_synced_at"] = synced_at
            if run_id:
                attrs["last_sync_run_id"] = run_id
            if actor:
                attrs["last_sync_actor"] = actor
            if source_ids:
                attrs["last_sync_source_ids"] = source_ids
            name = str((existing or {}).get("name") or oid)
            et_raw = (existing or {}).get("entity_type") or "unknown"
            try:
                et = EntityType(str(et_raw))
            except Exception:
                et = EntityType.UNKNOWN
            store.upsert_entity(
                Entity(
                    id=oid,
                    name=name,
                    entity_type=et,
                    description=(existing or {}).get("description"),
                    attributes=attrs,
                )
            )
            updated.append(oid)
        out = {
            "ok": True,
            "data": {
                "backend": store.backend_name,
                "updated_object_ids": updated,
                "stats": store.stats(),
            },
        }
    else:
        out = {"ok": False, "error": f"unknown op {op}"}
        print(json.dumps(out), flush=True)
        return 1

    print(json.dumps(out, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
