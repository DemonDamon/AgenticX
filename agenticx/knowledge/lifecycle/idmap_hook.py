"""Optional adapter: IdMappingEngine merge → KnowledgeObject upserts + conflict findings."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from agenticx.data_suite.idmapping.engine import IdMappingEngine, MergeResult
from agenticx.knowledge.lifecycle.model import KnowledgeObject
from agenticx.knowledge.lifecycle.quality import QualityFinding
from agenticx.knowledge.lifecycle.store import KnowledgeObjectFileStore


@dataclass
class IngestResult:
    objects: List[KnowledgeObject] = field(default_factory=list)
    merge: Optional[MergeResult] = None
    findings: List[QualityFinding] = field(default_factory=list)


def conflicts_to_findings(merge: MergeResult) -> List[QualityFinding]:
    """Map idmapping conflict rows to QualityFinding(code=conflict)."""
    out: List[QualityFinding] = []
    for c in merge.conflicts or []:
        id_type = str(c.get("id_type") or "")
        values = list(c.get("values") or [])
        rows = list(c.get("rows") or [])
        # Attach finding to each subject produced for those rows when possible
        subjects: List[str] = []
        for i in rows:
            if isinstance(i, int) and 0 <= i < len(merge.records):
                sid = str(merge.records[i].get("subject_id") or f"row-{i}")
                subjects.append(sid)
        if not subjects:
            subjects = [f"conflict:{id_type}"]
        for sid in sorted(set(subjects)):
            out.append(
                QualityFinding(
                    code="conflict",
                    severity="error",
                    object_id=sid,
                    message=f"idmapping conflict on {id_type}",
                    detail={"id_type": id_type, "values": values, "rows": rows},
                )
            )
    return out


def records_to_objects(
    merge: MergeResult,
    *,
    kind: str = "entity",
    id_types: Optional[Sequence[str]] = None,
) -> List[KnowledgeObject]:
    """Build KnowledgeObjects from merge records (one object per subject_id)."""
    by_subject: Dict[str, Dict[str, Any]] = {}
    for rec in merge.records:
        sid = str(rec.get("subject_id") or "")
        if not sid:
            continue
        bucket = by_subject.setdefault(
            sid,
            {"attrs": {}, "source_ids": [], "meta": {"subject_id": sid}},
        )
        # attrs: keep first non-empty scalar fields excluding id types / subject_id
        skip = set(id_types or []) | {"subject_id"}
        for k, v in rec.items():
            if k in skip:
                continue
            if v in (None, ""):
                continue
            if k not in bucket["attrs"]:
                bucket["attrs"][k] = v
        for t in id_types or []:
            val = rec.get(t)
            if val not in (None, ""):
                token = f"{t}:{val}"
                if token not in bucket["source_ids"]:
                    bucket["source_ids"].append(token)
    objects: List[KnowledgeObject] = []
    for sid, data in sorted(by_subject.items()):
        objects.append(
            KnowledgeObject(
                id=sid,
                kind=kind,
                attrs=dict(data["attrs"]),
                source_ids=list(data["source_ids"]),
                meta=dict(data["meta"]),
            )
        )
    return objects


def ingest_with_idmapping(
    records: Sequence[Dict[str, Any]],
    engine: IdMappingEngine,
    store: KnowledgeObjectFileStore,
    *,
    kind: str = "entity",
) -> IngestResult:
    """Merge records via idmapping, upsert KnowledgeObjects, return conflict findings."""
    merge = engine.merge(list(records))
    id_types = [t.name for t in engine.profile.id_types]
    objects = records_to_objects(merge, kind=kind, id_types=id_types)
    stored: List[KnowledgeObject] = []
    for obj in objects:
        stored.append(store.upsert_object(obj))
    findings = conflicts_to_findings(merge)
    return IngestResult(objects=stored, merge=merge, findings=findings)
