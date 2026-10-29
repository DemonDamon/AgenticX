"""Object-centric evidence bundles for retrieval (K1-2).

Aggregates multi-source EvidenceItems (ledger attrs, related records,
graph edges, document clauses) into a sorted EvidenceBundle with
missing / conflict hints. Payloads stay free of customer-specific names.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from agenticx.retrieval.provenance import Provenance, SourceType


# Canonical kind labels used by assemble policy / tests.
KIND_LEDGER_ATTR = "ledger_attr"
KIND_RELATED_RECORD = "related_record"
KIND_GRAPH_EDGE = "graph_edge"
KIND_DOCUMENT_CLAUSE = "document_clause"


@dataclass
class EvidenceItem:
    """One piece of evidence tied to an entity."""

    kind: str
    payload: Dict[str, Any]
    provenance: Provenance

    def __post_init__(self) -> None:
        self.kind = str(self.kind or "").strip()
        if not self.kind:
            raise ValueError("evidence.kind is required")
        if not isinstance(self.payload, dict):
            raise TypeError("evidence.payload must be a dict")
        if isinstance(self.provenance, dict):
            parsed = Provenance.from_dict(self.provenance)
            if parsed is None:
                raise ValueError("evidence.provenance is required")
            self.provenance = parsed
        elif not isinstance(self.provenance, Provenance):
            raise TypeError("evidence.provenance must be Provenance")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "payload": dict(self.payload),
            "provenance": self.provenance.to_dict(),
        }

    @classmethod
    def from_dict(cls, raw: Union[Dict[str, Any], "EvidenceItem"]) -> "EvidenceItem":
        if isinstance(raw, EvidenceItem):
            return raw
        if not isinstance(raw, dict):
            raise TypeError("EvidenceItem must be a mapping")
        return cls(
            kind=str(raw.get("kind") or ""),
            payload=dict(raw.get("payload") or {}),
            provenance=Provenance.from_dict(raw.get("provenance")) or Provenance(
                source_type=SourceType.DOCUMENT,
                source_id="unknown",
            ),
        )


@dataclass
class EvidenceBundle:
    """Object-centric aggregation of evidence for one entity."""

    entity_id: str
    items: List[EvidenceItem] = field(default_factory=list)
    summary: str = ""
    missing: List[str] = field(default_factory=list)
    conflicts: List[Dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.entity_id = str(self.entity_id or "").strip()
        if not self.entity_id:
            raise ValueError("evidence_bundle.entity_id is required")
        self.items = list(self.items or [])
        self.missing = list(self.missing or [])
        self.conflicts = list(self.conflicts or [])
        self.summary = str(self.summary or "")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "items": [item.to_dict() for item in self.items],
            "summary": self.summary,
            "missing": list(self.missing),
            "conflicts": [dict(c) for c in self.conflicts],
        }


def _sort_key(item: EvidenceItem) -> tuple:
    """Higher confidence first; newer data_time first; empty time last; stable kind/source."""
    conf = item.provenance.confidence
    conf_key = conf if conf is not None else -1.0
    time_key = item.provenance.data_time or ""
    # Lexicographic invert so ISO-8601 timestamps sort newest-first when ascending.
    time_rank = "".join(chr(255 - ord(c)) for c in time_key) if time_key else ""
    empty_time = 1 if not time_key else 0
    return (-float(conf_key), empty_time, time_rank, item.kind, item.provenance.source_id)


def _conflict_identity(item: EvidenceItem, policy: Dict[str, Any]) -> Optional[str]:
    """Build a conflict-group key from payload fields (default: attr/field/key).

    ``policy["group_by"] == "attr"`` drops kind from the identity so ledger vs
    document clauses on the same attribute can conflict.
    """
    keys: Sequence[str] = policy.get("conflict_keys") or ("attr", "field", "key", "name")
    payload = item.payload
    group_by = str(policy.get("group_by") or "kind_attr").strip().lower()
    for k in keys:
        if k in payload and payload[k] is not None:
            if group_by in ("attr", "field", "key"):
                return f"{k}:{payload[k]}"
            return f"{item.kind}:{k}:{payload[k]}"
    return None


def _conflict_value(item: EvidenceItem, policy: Dict[str, Any]) -> Any:
    value_keys: Sequence[str] = policy.get("value_keys") or ("value", "val", "status", "text")
    for k in value_keys:
        if k in item.payload:
            return item.payload[k]
    # Fall back to a stable subset of payload excluding identity keys
    skip = set(policy.get("conflict_keys") or ("attr", "field", "key", "name"))
    return {k: v for k, v in item.payload.items() if k not in skip}


def _detect_conflicts(items: List[EvidenceItem], policy: Dict[str, Any]) -> List[Dict[str, Any]]:
    groups: Dict[str, List[EvidenceItem]] = {}
    for item in items:
        ident = _conflict_identity(item, policy)
        if ident is None:
            continue
        groups.setdefault(ident, []).append(item)

    conflicts: List[Dict[str, Any]] = []
    for ident, group in groups.items():
        if len(group) < 2:
            continue
        values = []
        seen = set()
        for it in group:
            val = _conflict_value(it, policy)
            # hashable fingerprint
            try:
                fp = (type(val).__name__, repr(val))
            except Exception:
                fp = (type(val).__name__, str(val))
            if fp not in seen:
                seen.add(fp)
                values.append(
                    {
                        "value": val,
                        "source_id": it.provenance.source_id,
                        "source_type": it.provenance.source_type.value,
                        "confidence": it.provenance.confidence,
                        "data_time": it.provenance.data_time,
                    }
                )
        if len(values) >= 2:
            conflicts.append(
                {
                    "identity": ident,
                    "kind": group[0].kind,
                    "values": values,
                }
            )
    return conflicts


def _detect_missing(items: List[EvidenceItem], policy: Dict[str, Any]) -> List[str]:
    required: Iterable[str] = policy.get("required_kinds") or ()
    present = {it.kind for it in items}
    missing = [kind for kind in required if kind not in present]

    required_attrs: Iterable[str] = policy.get("required_attrs") or ()
    if required_attrs:
        seen_attrs = set()
        for it in items:
            for k in ("attr", "field", "key", "name"):
                if k in it.payload and it.payload[k] is not None:
                    seen_attrs.add(str(it.payload[k]))
        for attr in required_attrs:
            label = f"attr:{attr}"
            if attr not in seen_attrs and label not in missing:
                missing.append(label)
    return missing


def _build_summary(
    entity_id: str,
    items: List[EvidenceItem],
    missing: List[str],
    conflicts: List[Dict[str, Any]],
) -> str:
    kind_counts: Dict[str, int] = {}
    for it in items:
        kind_counts[it.kind] = kind_counts.get(it.kind, 0) + 1
    parts = [f"entity={entity_id}", f"items={len(items)}"]
    if kind_counts:
        kinds = ",".join(f"{k}:{v}" for k, v in sorted(kind_counts.items()))
        parts.append(f"kinds=[{kinds}]")
    if missing:
        parts.append(f"missing={len(missing)}")
    if conflicts:
        parts.append(f"conflicts={len(conflicts)}")
    return "; ".join(parts)


def assemble_evidence(
    entity_id: str,
    sources: List[EvidenceItem],
    *,
    policy: Optional[Dict[str, Any]] = None,
) -> EvidenceBundle:
    """Assemble an object-centric EvidenceBundle from multi-source items.

    Sorting: confidence desc, then data_time desc (newer first, empty last), then kind/source.
    Missing: ``policy.required_kinds`` / ``policy.required_attrs`` not present.
    Conflicts: same conflict identity (kind+attr key) with disagreeing values.
    """
    entity_id = str(entity_id or "").strip()
    if not entity_id:
        raise ValueError("entity_id is required")

    policy = dict(policy or {})
    items = [EvidenceItem.from_dict(s) if not isinstance(s, EvidenceItem) else s for s in (sources or [])]
    items = sorted(items, key=_sort_key)

    conflicts = _detect_conflicts(items, policy)
    missing = _detect_missing(items, policy)
    summary = _build_summary(entity_id, items, missing, conflicts)

    return EvidenceBundle(
        entity_id=entity_id,
        items=items,
        summary=summary,
        missing=missing,
        conflicts=conflicts,
    )
