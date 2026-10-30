"""Factory for GraphStore backends."""

from __future__ import annotations

from typing import Any, Optional

from agenticx.knowledge.graphers.store.memory import InMemoryGraphStore
from agenticx.knowledge.graphers.store.neo4j_store import (
    Neo4jGraphStore,
    neo4j_env_configured,
    neo4j_settings_from_env,
)


def create_graph_store(
    backend: Optional[str] = None,
    **kwargs: Any,
):
    """Create a GraphStore.

    - ``backend="neo4j"`` or ``NEO4J_URI`` set → Neo4jGraphStore
    - otherwise → InMemoryGraphStore

    File backend is intentionally not the default (non-production).
    """
    choice = (backend or "").strip().lower()
    if not choice:
        choice = "neo4j" if neo4j_env_configured() else "memory"

    if choice in ("neo4j", "graphdb"):
        settings = neo4j_settings_from_env()
        settings.update({k: v for k, v in kwargs.items() if v is not None})
        return Neo4jGraphStore(**settings)

    if choice == "memory":
        return InMemoryGraphStore()

    if choice == "file":
        from agenticx.knowledge.graphers.store.file import FileGraphStore

        path = kwargs.get("path")
        if not path:
            raise ValueError("FileGraphStore requires path=")
        return FileGraphStore(path)

    raise ValueError(f"Unknown graph store backend: {backend!r}")
