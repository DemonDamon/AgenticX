"""Review transitions and publish lifecycle objects into KnowledgeGraph."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence

from agenticx.knowledge.graphers.models import (
    Entity,
    EntityType,
    KnowledgeGraph,
    RelationType,
    Relationship,
)
from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


def submit_for_review(
    store: KnowledgeObjectFileStore,
    object_ids: Sequence[str],
) -> List[KnowledgeObject]:
    out: List[KnowledgeObject] = []
    for oid in object_ids:
        obj = store.get_object(oid)
        if obj.status is KnowledgeStatus.DRAFT:
            out.append(store.transition(oid, KnowledgeStatus.PENDING_REVIEW))
        elif obj.status is KnowledgeStatus.PENDING_REVIEW:
            out.append(obj)
        else:
            out.append(obj)
    return out


def publish_objects(
    store: KnowledgeObjectFileStore,
    object_ids: Sequence[str],
) -> List[KnowledgeObject]:
    out: List[KnowledgeObject] = []
    for oid in object_ids:
        obj = store.get_object(oid)
        if obj.status is KnowledgeStatus.DRAFT:
            store.transition(oid, KnowledgeStatus.PENDING_REVIEW)
            obj = store.get_object(oid)
        if obj.status is KnowledgeStatus.PENDING_REVIEW:
            out.append(store.transition(oid, KnowledgeStatus.PUBLISHED))
        elif obj.status is KnowledgeStatus.PUBLISHED:
            out.append(obj)
        else:
            raise ValueError(
                f"cannot publish object {oid!r} from status {obj.status.value}"
            )
    return out


def _parse_entity_type(raw: str) -> EntityType:
    try:
        return EntityType(str(raw or "unknown"))
    except ValueError:
        return EntityType.UNKNOWN


def _parse_relation_type(raw: str):
    try:
        return RelationType(str(raw or "related_to"))
    except ValueError:
        return str(raw or "related_to")


def knowledge_object_to_entity(obj: KnowledgeObject) -> Entity:
    name = str(obj.attrs.get("name") or obj.id)
    et = _parse_entity_type(str(obj.attrs.get("entity_type") or "unknown"))
    attrs = {k: v for k, v in obj.attrs.items() if k not in ("name", "entity_type")}
    return Entity(
        id=obj.id,
        name=name,
        entity_type=et,
        attributes=attrs,
        source_chunks=set(obj.source_ids),
        confidence=float(obj.attrs.get("confidence", 1.0) or 1.0),
    )


def knowledge_object_to_relationship(obj: KnowledgeObject) -> Relationship:
    rel_meta = (obj.relations or [{}])[0] if obj.relations else {}
    src = str(
        rel_meta.get("source_entity_id")
        or obj.attrs.get("source_entity_id")
        or ""
    )
    tgt = str(
        rel_meta.get("target_entity_id")
        or rel_meta.get("target_id")
        or obj.attrs.get("target_entity_id")
        or ""
    )
    rtype = _parse_relation_type(
        str(obj.attrs.get("relation_type") or rel_meta.get("rel") or "related_to")
    )
    attrs = {
        k: v
        for k, v in obj.attrs.items()
        if k not in ("relation_type", "source_entity_id", "target_entity_id", "confidence")
    }
    return Relationship(
        id=obj.id,
        source_entity_id=src,
        target_entity_id=tgt,
        relation_type=rtype,
        attributes=attrs,
        source_chunks=set(obj.source_ids),
        confidence=float(obj.attrs.get("confidence", 1.0) or 1.0),
    )


def merge_published_into_graph(
    store: KnowledgeObjectFileStore,
    graph: KnowledgeGraph,
    *,
    object_ids: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """Merge published KnowledgeObjects into graph. Entities first, then relations."""
    if object_ids is None:
        candidates = store.list_objects(status=KnowledgeStatus.PUBLISHED)
    else:
        candidates = []
        for oid in object_ids:
            try:
                obj = store.get_object(oid)
            except KeyError:
                continue
            if obj.status is KnowledgeStatus.PUBLISHED:
                candidates.append(obj)

    entities = [o for o in candidates if o.kind == "entity"]
    relations = [o for o in candidates if o.kind == "relation"]
    others = [o for o in candidates if o.kind not in ("entity", "relation")]

    entities_added = 0
    relations_added = 0
    skipped = 0

    for obj in entities:
        try:
            graph.add_entity(knowledge_object_to_entity(obj))
            entities_added += 1
        except Exception:
            # update existing entity if id already present
            existing = graph.get_entity(obj.id)
            if existing is not None:
                existing.name = str(obj.attrs.get("name") or existing.name)
                existing.attributes.update(
                    {k: v for k, v in obj.attrs.items() if k not in ("name", "entity_type")}
                )
                existing.source_chunks.update(obj.source_ids)
                entities_added += 1
            else:
                skipped += 1

    for obj in relations:
        try:
            graph.add_relationship(knowledge_object_to_relationship(obj))
            relations_added += 1
        except Exception:
            existing = graph.get_relationship(obj.id)
            if existing is not None:
                existing.source_chunks.update(obj.source_ids)
                relations_added += 1
            else:
                skipped += 1

    skipped += len(others)
    return {
        "entities_added": entities_added,
        "relations_added": relations_added,
        "skipped": skipped,
        "published_considered": len(candidates),
    }
