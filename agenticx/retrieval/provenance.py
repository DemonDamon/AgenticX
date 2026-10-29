"""Standard provenance fields for retrieval evidence (K1-1).

Source types cover structured records, graph relations, document clauses,
and inference summaries. Keep payloads free of customer-specific names.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
from typing import Any, Dict, Optional, Union


class SourceType(str, Enum):
    STRUCTURED = "structured"
    GRAPH = "graph"
    DOCUMENT = "document"
    INFERENCE = "inference"


@dataclass
class Provenance:
    source_type: SourceType
    source_id: str
    data_time: Optional[str] = None
    confidence: Optional[float] = None
    context_ptr: Optional[str] = None  # chunk / row / edge pointer

    def __post_init__(self) -> None:
        if not isinstance(self.source_type, SourceType):
            self.source_type = SourceType(str(self.source_type).strip().lower())
        self.source_id = str(self.source_id or "").strip()
        if not self.source_id:
            raise ValueError("provenance.source_id is required")
        if self.confidence is not None:
            self.confidence = float(self.confidence)
            if not 0.0 <= self.confidence <= 1.0:
                raise ValueError("provenance.confidence must be in [0, 1]")
        if self.data_time is not None:
            self.data_time = str(self.data_time)
        if self.context_ptr is not None:
            self.context_ptr = str(self.context_ptr)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_type": self.source_type.value,
            "source_id": self.source_id,
            "data_time": self.data_time,
            "confidence": self.confidence,
            "context_ptr": self.context_ptr,
        }

    @classmethod
    def from_dict(cls, raw: Union[Dict[str, Any], "Provenance", None]) -> Optional["Provenance"]:
        if raw is None:
            return None
        if isinstance(raw, Provenance):
            return raw
        if not isinstance(raw, dict):
            raise TypeError("provenance must be a mapping")
        return cls(
            source_type=SourceType(str(raw.get("source_type") or SourceType.DOCUMENT.value)),
            source_id=str(raw.get("source_id") or ""),
            data_time=raw.get("data_time"),
            confidence=raw.get("confidence"),
            context_ptr=raw.get("context_ptr"),
        )


def attach_provenance(result: Any, provenance: Union[Provenance, Dict[str, Any]]) -> Any:
    """Return a copy of ``RetrievalResult`` with provenance set (immutable-friendly)."""
    prov = Provenance.from_dict(provenance)
    if prov is None:
        raise ValueError("provenance is required")
    if hasattr(result, "provenance"):
        return replace(result, provenance=prov)
    raise TypeError("result must be a RetrievalResult-like dataclass")


def provenance_from_legacy(
    *,
    source: Optional[str] = None,
    chunk_id: Optional[str] = None,
    source_type: Union[SourceType, str] = SourceType.DOCUMENT,
    confidence: Optional[float] = None,
    data_time: Optional[str] = None,
) -> Optional[Provenance]:
    """Build provenance from legacy RetrievalResult.source / chunk_id fields."""
    source_id = (source or chunk_id or "").strip()
    if not source_id:
        return None
    return Provenance(
        source_type=source_type if isinstance(source_type, SourceType) else SourceType(str(source_type)),
        source_id=source_id,
        data_time=data_time,
        confidence=confidence,
        context_ptr=chunk_id,
    )
