"""Pluggable GraphStore protocol — publish target / source of truth for K3."""

from __future__ import annotations

from typing import Any, Dict, Optional, Protocol, runtime_checkable

from agenticx.knowledge.graphers.models import Entity, Relationship


@runtime_checkable
class GraphStore(Protocol):
    """Backend-agnostic graph persistence for incremental publish.

    Production default is Neo4j. In-memory / file backends are for tests
    and offline fixtures — file/JSON must not be treated as production SoT.
    """

    @property
    def backend_name(self) -> str:
        """Stable backend identifier (e.g. ``memory``, ``file``, ``neo4j``)."""
        ...

    def upsert_entity(self, entity: Entity) -> None:
        """Insert or replace an entity by id."""
        ...

    def upsert_relationship(self, relationship: Relationship) -> None:
        """Insert or replace a relationship by id."""
        ...

    def delete_entity(self, entity_id: str) -> bool:
        """Remove entity by id. Returns True if something was deleted."""
        ...

    def delete_relationship(self, relationship_id: str) -> bool:
        """Remove relationship by id. Returns True if something was deleted."""
        ...

    def get_entity(self, entity_id: str) -> Optional[Entity]:
        """Fetch entity by id, or None."""
        ...

    def get_relationship(self, relationship_id: str) -> Optional[Relationship]:
        """Fetch relationship by id, or None."""
        ...

    def stats(self) -> Dict[str, Any]:
        """Return ``entity_count``, ``relationship_count``, ``backend`` (+ optional extras)."""
        ...
