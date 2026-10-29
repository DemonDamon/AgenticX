"""File/JSON GraphStore — test / offline fixtures only (NOT production SoT)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.knowledge.graphers.models import Entity, KnowledgeGraph, Relationship
from agenticx.knowledge.graphers.store.memory import InMemoryGraphStore


class FileGraphStore:
    """Persist entities/relationships as a KnowledgeGraph JSON file.

    Explicitly **non-production**. Prefer Neo4jGraphStore for publish SoT.
    Kept for deterministic unit/integration fixtures without a DB.
    """

    def __init__(self, path: Union[str, Path]) -> None:
        self.path = Path(path)
        self._mem = InMemoryGraphStore()
        self._load()

    @property
    def backend_name(self) -> str:
        return "file"

    def _load(self) -> None:
        if not self.path.is_file():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        graph = KnowledgeGraph.from_dict(raw)
        for ent in graph.entities.values():
            self._mem.upsert_entity(ent)
        for rel in graph.relationships.values():
            self._mem.upsert_relationship(rel)

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        graph = KnowledgeGraph(name="file-graph-store")
        for ent in self._mem._entities.values():  # noqa: SLF001 — mirror for persist
            graph.entities[ent.id] = ent
        for rel in self._mem._relationships.values():  # noqa: SLF001
            graph.relationships[rel.id] = rel
        self.path.write_text(
            json.dumps(graph.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def upsert_entity(self, entity: Entity) -> None:
        self._mem.upsert_entity(entity)
        self._persist()

    def upsert_relationship(self, relationship: Relationship) -> None:
        self._mem.upsert_relationship(relationship)
        self._persist()

    def delete_entity(self, entity_id: str) -> bool:
        ok = self._mem.delete_entity(entity_id)
        if ok:
            self._persist()
        return ok

    def delete_relationship(self, relationship_id: str) -> bool:
        ok = self._mem.delete_relationship(relationship_id)
        if ok:
            self._persist()
        return ok

    def get_entity(self, entity_id: str) -> Optional[Entity]:
        return self._mem.get_entity(entity_id)

    def get_relationship(self, relationship_id: str) -> Optional[Relationship]:
        return self._mem.get_relationship(relationship_id)

    def stats(self) -> Dict[str, Any]:
        s = self._mem.stats()
        s["backend"] = self.backend_name
        s["path"] = str(self.path)
        return s

    def list_entities(self, *, limit: int = 500) -> List[Entity]:
        return self._mem.list_entities(limit=limit)

    def list_relationships(self, *, limit: int = 1000) -> List[Relationship]:
        return self._mem.list_relationships(limit=limit)

    def neighborhood(
        self,
        entity_id: str,
        *,
        depth: int = 1,
        limit: int = 200,
    ) -> Dict[str, Any]:
        return self._mem.neighborhood(entity_id, depth=depth, limit=limit)

    def subgraph(
        self,
        *,
        entity_ids: Optional[List[str]] = None,
        limit_nodes: int = 200,
    ) -> Dict[str, Any]:
        out = self._mem.subgraph(entity_ids=entity_ids, limit_nodes=limit_nodes)
        out["stats"]["backend"] = self.backend_name
        out["stats"]["path"] = str(self.path)
        return out
