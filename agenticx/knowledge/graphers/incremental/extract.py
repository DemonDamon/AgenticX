"""Pluggable extraction into K2 lifecycle drafts + source index updates."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from agenticx.knowledge.graphers.incremental.index import SourceObjectIndex
from agenticx.knowledge.graphers.incremental.sources import SourceDocument
from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


@dataclass
class ExtractedEntity:
    id: str
    name: str
    entity_type: str = "unknown"
    attrs: Dict[str, Any] = field(default_factory=dict)
    source_id: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        self.name = str(self.name or "").strip()
        if not self.id:
            raise ValueError("ExtractedEntity.id is required")
        if not self.name:
            raise ValueError("ExtractedEntity.name is required")
        self.entity_type = str(self.entity_type or "unknown")
        self.attrs = dict(self.attrs or {})
        self.source_id = str(self.source_id or "")


@dataclass
class ExtractedRelation:
    id: str
    source_entity_id: str
    target_entity_id: str
    relation_type: str = "related_to"
    attrs: Dict[str, Any] = field(default_factory=dict)
    source_id: str = ""

    def __post_init__(self) -> None:
        self.id = str(self.id or "").strip()
        self.source_entity_id = str(self.source_entity_id or "").strip()
        self.target_entity_id = str(self.target_entity_id or "").strip()
        if not self.id:
            raise ValueError("ExtractedRelation.id is required")
        if not self.source_entity_id or not self.target_entity_id:
            raise ValueError("ExtractedRelation endpoints are required")
        self.relation_type = str(self.relation_type or "related_to")
        self.attrs = dict(self.attrs or {})
        self.source_id = str(self.source_id or "")


@dataclass
class ExtractedGraph:
    entities: List[ExtractedEntity] = field(default_factory=list)
    relations: List[ExtractedRelation] = field(default_factory=list)


@runtime_checkable
class Extractor(Protocol):
    def extract(self, doc: SourceDocument) -> ExtractedGraph: ...


def _entity_to_object(ent: ExtractedEntity, source_id: str) -> KnowledgeObject:
    attrs = {"name": ent.name, "entity_type": ent.entity_type, **dict(ent.attrs)}
    return KnowledgeObject(
        id=ent.id,
        kind="entity",
        status=KnowledgeStatus.DRAFT,
        attrs=attrs,
        source_ids=[source_id],
        meta={"origin": "graph_incremental_extract"},
    )


def _relation_to_object(rel: ExtractedRelation, source_id: str) -> KnowledgeObject:
    attrs = {"relation_type": rel.relation_type, **dict(rel.attrs)}
    return KnowledgeObject(
        id=rel.id,
        kind="relation",
        status=KnowledgeStatus.DRAFT,
        attrs=attrs,
        relations=[
            {
                "rel": rel.relation_type,
                "source_entity_id": rel.source_entity_id,
                "target_entity_id": rel.target_entity_id,
                "target_id": rel.target_entity_id,
            }
        ],
        source_ids=[source_id],
        meta={"origin": "graph_incremental_extract"},
    )


def apply_extraction(
    docs: List[SourceDocument],
    *,
    extractor: Extractor,
    object_store: KnowledgeObjectFileStore,
    index: SourceObjectIndex,
    actor: str = "extractor",
) -> List[KnowledgeObject]:
    """Extract each document; upsert drafts; replace source→object links."""
    if not hasattr(extractor, "extract"):
        raise TypeError("extractor must implement extract(doc) -> ExtractedGraph")
    # actor reserved for future trail tagging on extract events
    _ = actor
    upserted: List[KnowledgeObject] = []
    for doc in docs:
        if not isinstance(doc, SourceDocument):
            raise TypeError("docs must contain SourceDocument instances")
        graph = extractor.extract(doc)
        if not isinstance(graph, ExtractedGraph):
            raise TypeError("extractor.extract must return ExtractedGraph")
        linked_ids: List[str] = []
        for ent in graph.entities or []:
            if not ent.source_id:
                ent.source_id = doc.id
            obj = _entity_to_object(ent, doc.id)
            stored = object_store.upsert_object(obj, bump_version=True)
            upserted.append(stored)
            linked_ids.append(stored.id)
        for rel in graph.relations or []:
            if not rel.source_id:
                rel.source_id = doc.id
            obj = _relation_to_object(rel, doc.id)
            stored = object_store.upsert_object(obj, bump_version=True)
            upserted.append(stored)
            linked_ids.append(stored.id)
        index.replace_links(doc.id, linked_ids)
    return upserted
