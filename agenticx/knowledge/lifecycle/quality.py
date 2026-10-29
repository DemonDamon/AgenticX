"""Pure quality checkers over KnowledgeObject collections."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from agenticx.knowledge.lifecycle.model import KnowledgeObject, KnowledgeStatus


@dataclass
class QualityFinding:
    code: str
    severity: str
    object_id: str
    message: str
    detail: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.code = str(self.code or "").strip()
        self.severity = str(self.severity or "error").strip().lower() or "error"
        if self.severity not in {"error", "warning"}:
            raise ValueError(f"invalid severity: {self.severity!r}")
        self.object_id = str(self.object_id or "").strip()
        self.message = str(self.message or "")
        self.detail = dict(self.detail or {})

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "object_id": self.object_id,
            "message": self.message,
            "detail": dict(self.detail),
        }


_DEFAULT_POLICY: Dict[str, Any] = {
    "required_attrs": {},
    "relation_targets_must_exist": True,
    "duplicate_keys": ["kind", "attrs.name"],
    "stale_if_status": ["retired"],
    "require_source_ids": False,
}


def run_quality_checks(
    objects: Sequence[KnowledgeObject],
    *,
    policy: Optional[Dict[str, Any]] = None,
) -> List[QualityFinding]:
    """Run configured checks; return findings (stable order by object id, code)."""
    pol = {**_DEFAULT_POLICY, **(policy or {})}
    objs = list(objects)
    by_id = {o.id: o for o in objs}
    findings: List[QualityFinding] = []

    findings.extend(_check_id_link(objs, pol))
    findings.extend(_check_required_attrs(objs, pol))
    findings.extend(_check_relation_integrity(objs, by_id, pol))
    findings.extend(_check_duplicates(objs, pol))
    findings.extend(_check_conflicts(objs, pol))
    findings.extend(_check_stale(objs, by_id, pol))

    findings.sort(key=lambda f: (f.object_id, f.code, f.message))
    return findings


def _check_id_link(objs: List[KnowledgeObject], pol: Dict[str, Any]) -> List[QualityFinding]:
    out: List[QualityFinding] = []
    require = bool(pol.get("require_source_ids"))
    for o in objs:
        if require and not o.source_ids:
            out.append(
                QualityFinding(
                    code="id_link",
                    severity="error",
                    object_id=o.id,
                    message="missing source_ids for identifier linkage",
                    detail={"kind": o.kind},
                )
            )
        # Soft check: empty source_ids warned when multi-source expected via meta
        elif not o.source_ids and o.meta.get("expect_sources"):
            out.append(
                QualityFinding(
                    code="id_link",
                    severity="warning",
                    object_id=o.id,
                    message="expected source_ids but none set",
                    detail={"kind": o.kind},
                )
            )
    return out


def _check_required_attrs(objs: List[KnowledgeObject], pol: Dict[str, Any]) -> List[QualityFinding]:
    out: List[QualityFinding] = []
    required_map: Dict[str, List[str]] = dict(pol.get("required_attrs") or {})
    for o in objs:
        needed = list(required_map.get(o.kind) or [])
        missing = [k for k in needed if o.attrs.get(k) in (None, "")]
        if missing:
            out.append(
                QualityFinding(
                    code="required_attrs",
                    severity="error",
                    object_id=o.id,
                    message=f"missing required attrs: {', '.join(missing)}",
                    detail={"missing": missing, "kind": o.kind},
                )
            )
    return out


def _check_relation_integrity(
    objs: List[KnowledgeObject],
    by_id: Dict[str, KnowledgeObject],
    pol: Dict[str, Any],
) -> List[QualityFinding]:
    out: List[QualityFinding] = []
    if not pol.get("relation_targets_must_exist", True):
        return out
    for o in objs:
        for rel in o.relations:
            target = str(rel.get("target_id") or "").strip()
            if not target:
                out.append(
                    QualityFinding(
                        code="relation_integrity",
                        severity="error",
                        object_id=o.id,
                        message="relation missing target_id",
                        detail={"rel": dict(rel)},
                    )
                )
            elif target not in by_id:
                out.append(
                    QualityFinding(
                        code="relation_integrity",
                        severity="error",
                        object_id=o.id,
                        message=f"relation target not found: {target}",
                        detail={"rel": rel.get("rel"), "target_id": target},
                    )
                )
    return out


def _attr_path(obj: KnowledgeObject, path: str) -> Any:
    if path.startswith("attrs."):
        return obj.attrs.get(path[len("attrs.") :])
    if path == "kind":
        return obj.kind
    if path == "id":
        return obj.id
    return obj.meta.get(path)


def _check_duplicates(objs: List[KnowledgeObject], pol: Dict[str, Any]) -> List[QualityFinding]:
    out: List[QualityFinding] = []
    keys: List[str] = list(pol.get("duplicate_keys") or [])
    if not keys:
        return out
    groups: Dict[tuple, List[str]] = defaultdict(list)
    for o in objs:
        parts = []
        skip = False
        for k in keys:
            v = _attr_path(o, k)
            if v in (None, ""):
                skip = True
                break
            parts.append((k, v))
        if skip:
            continue
        groups[tuple(parts)].append(o.id)
    for key, ids in groups.items():
        if len(ids) < 2:
            continue
        for oid in ids:
            out.append(
                QualityFinding(
                    code="duplicate",
                    severity="warning",
                    object_id=oid,
                    message=f"duplicate key group size={len(ids)}",
                    detail={"keys": dict(key), "peers": [i for i in ids if i != oid]},
                )
            )
    return out


def _check_conflicts(objs: List[KnowledgeObject], pol: Dict[str, Any]) -> List[QualityFinding]:
    """Same source_id attached to multiple objects → conflict."""
    out: List[QualityFinding] = []
    by_source: Dict[str, List[str]] = defaultdict(list)
    for o in objs:
        for sid in o.source_ids:
            by_source[sid].append(o.id)
    for sid, ids in by_source.items():
        uniq = sorted(set(ids))
        if len(uniq) < 2:
            continue
        for oid in uniq:
            out.append(
                QualityFinding(
                    code="conflict",
                    severity="error",
                    object_id=oid,
                    message=f"source_id {sid!r} linked to multiple objects",
                    detail={"source_id": sid, "peers": [i for i in uniq if i != oid]},
                )
            )
    return out


def _check_stale(
    objs: List[KnowledgeObject],
    by_id: Dict[str, KnowledgeObject],
    pol: Dict[str, Any],
) -> List[QualityFinding]:
    stale_statuses: Set[str] = {str(s) for s in (pol.get("stale_if_status") or ["retired"])}
    out: List[QualityFinding] = []
    for o in objs:
        for rel in o.relations:
            target = str(rel.get("target_id") or "").strip()
            if not target or target not in by_id:
                continue
            tgt = by_id[target]
            if tgt.status.value in stale_statuses:
                out.append(
                    QualityFinding(
                        code="stale",
                        severity="warning",
                        object_id=o.id,
                        message=f"relation points to {tgt.status.value} object {target}",
                        detail={"target_id": target, "target_status": tgt.status.value},
                    )
                )
    return out
