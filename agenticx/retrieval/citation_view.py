"""Citation / conflict view-model for portal and admin (K1-3).

Pure serializer: EvidenceBundle -> JSON-friendly dict shared by web-portal
and admin-console. No UI framework dependency. Desensitized samples only.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from agenticx.retrieval.evidence import EvidenceBundle, EvidenceItem


_KIND_LABELS = {
    "ledger_attr": "Ledger attribute",
    "related_record": "Related record",
    "graph_edge": "Graph edge",
    "document_clause": "Document clause",
}


def _excerpt_from_item(item: EvidenceItem, *, max_len: int = 240) -> str:
    payload = item.payload or {}
    for key in ("excerpt", "text", "clause", "value", "summary"):
        if key in payload and payload[key] is not None:
            text = str(payload[key]).strip()
            if text:
                if len(text) > max_len:
                    return text[: max_len - 1] + "…"
                return text
    attr = payload.get("attr") or payload.get("field") or payload.get("key") or payload.get("name")
    if attr is not None:
        return f"{attr}"
    return ""


def _label_from_item(item: EvidenceItem) -> str:
    kind_label = _KIND_LABELS.get(item.kind, item.kind.replace("_", " ").title())
    payload = item.payload or {}
    attr = payload.get("attr") or payload.get("field") or payload.get("key") or payload.get("name")
    if attr is not None:
        return f"{kind_label}: {attr}"
    return kind_label


def _citation_from_item(item: EvidenceItem) -> Dict[str, Any]:
    prov = item.provenance
    return {
        "label": _label_from_item(item),
        "kind": item.kind,
        "source_type": prov.source_type.value if hasattr(prov.source_type, "value") else str(prov.source_type),
        "source_id": prov.source_id,
        "excerpt": _excerpt_from_item(item),
        "confidence": prov.confidence,
        "data_time": prov.data_time,
        "context_ptr": prov.context_ptr,
    }


def _conflict_view(conflict: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "identity": conflict.get("identity"),
        "kind": conflict.get("kind"),
        "values": [
            {
                "value": v.get("value"),
                "source_id": v.get("source_id"),
                "source_type": v.get("source_type"),
                "confidence": v.get("confidence"),
                "data_time": v.get("data_time"),
            }
            for v in (conflict.get("values") or [])
        ],
    }


def to_citation_view(
    bundle: Union[EvidenceBundle, Dict[str, Any]],
    *,
    include_summary: bool = True,
) -> Dict[str, Any]:
    """Serialize an EvidenceBundle into a shared citation/conflict view-model.

    Shape::

        {
          "entity_id": str,
          "citations": [
            {"label", "kind", "source_type", "source_id", "excerpt",
             "confidence", "data_time", "context_ptr"},
            ...
          ],
          "conflicts": [{"identity", "kind", "values": [...]}],
          "missing": [str, ...],
          "summary": str,   # optional
        }
    """
    if isinstance(bundle, dict):
        entity_id = str(bundle.get("entity_id") or "")
        items_raw = bundle.get("items") or []
        items = [EvidenceItem.from_dict(it) for it in items_raw]
        conflicts = list(bundle.get("conflicts") or [])
        missing = list(bundle.get("missing") or [])
        summary = str(bundle.get("summary") or "")
    elif isinstance(bundle, EvidenceBundle):
        entity_id = bundle.entity_id
        items = list(bundle.items)
        conflicts = list(bundle.conflicts)
        missing = list(bundle.missing)
        summary = bundle.summary
    else:
        raise TypeError("bundle must be EvidenceBundle or dict")

    if not entity_id:
        raise ValueError("bundle.entity_id is required")

    view: Dict[str, Any] = {
        "entity_id": entity_id,
        "citations": [_citation_from_item(it) for it in items],
        "conflicts": [_conflict_view(c) for c in conflicts],
        "missing": list(missing),
    }
    if include_summary:
        view["summary"] = summary
    return view


# Stable top-level keys expected by portal/admin consumers (snapshot contract).
CITATION_VIEW_KEYS = ("entity_id", "citations", "conflicts", "missing", "summary")
CITATION_ITEM_KEYS = (
    "label",
    "kind",
    "source_type",
    "source_id",
    "excerpt",
    "confidence",
    "data_time",
    "context_ptr",
)
