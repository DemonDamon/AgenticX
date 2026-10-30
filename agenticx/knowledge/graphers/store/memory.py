"""In-memory GraphStore for unit tests and offline default."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

from agenticx.knowledge.graphers.models import Entity, Relationship
from agenticx.knowledge.graphers.store.query import build_neighborhood, build_subgraph


class InMemoryGraphStore:
    """Dict-backed GraphStore. Suitable for tests; not durable."""

    def __init__(self) -> None:
        self._entities: Dict[str, Entity] = {}
        self._relationships: Dict[str, Relationship] = {}

    @property
    def backend_name(self) -> str:
        return "memory"

    def upsert_entity(self, entity: Entity) -> None:
        self._entities[entity.id] = deepcopy(entity)

    def upsert_relationship(self, relationship: Relationship) -> None:
        self._relationships[relationship.id] = deepcopy(relationship)

    def delete_entity(self, entity_id: str) -> bool:
        if entity_id in self._entities:
            del self._entities[entity_id]
            # Drop relationships that reference the entity
            drop = [
                rid
                for rid, rel in self._relationships.items()
                if rel.source_entity_id == entity_id or rel.target_entity_id == entity_id
            ]
            for rid in drop:
                del self._relationships[rid]
            return True
        return False

    def delete_relationship(self, relationship_id: str) -> bool:
        if relationship_id in self._relationships:
            del self._relationships[relationship_id]
            return True
        return False

    def get_entity(self, entity_id: str) -> Optional[Entity]:
        ent = self._entities.get(entity_id)
        return deepcopy(ent) if ent is not None else None

    def get_relationship(self, relationship_id: str) -> Optional[Relationship]:
        rel = self._relationships.get(relationship_id)
        return deepcopy(rel) if rel is not None else None

    def stats(self) -> Dict[str, Any]:
        return {
            "backend": self.backend_name,
            "entity_count": len(self._entities),
            "relationship_count": len(self._relationships),
        }

    def list_entities(self, *, limit: int = 500) -> List[Entity]:
        limit = max(1, int(limit))
        return [deepcopy(self._entities[k]) for k in sorted(self._entities.keys())[:limit]]

    def list_relationships(self, *, limit: int = 1000) -> List[Relationship]:
        limit = max(1, int(limit))
        return [
            deepcopy(self._relationships[k]) for k in sorted(self._relationships.keys())[:limit]
        ]

    def neighborhood(
        self,
        entity_id: str,
        *,
        depth: int = 1,
        limit: int = 200,
    ) -> Dict[str, Any]:
        return build_neighborhood(
            center_id=entity_id,
            entities=self._entities,
            relationships=self._relationships,
            depth=depth,
            limit=limit,
        )

    def subgraph(
        self,
        *,
        entity_ids: Optional[List[str]] = None,
        limit_nodes: int = 200,
    ) -> Dict[str, Any]:
        return build_subgraph(
            entities=self._entities,
            relationships=self._relationships,
            entity_ids=entity_ids,
            limit_nodes=limit_nodes,
            backend=self.backend_name,
        )
