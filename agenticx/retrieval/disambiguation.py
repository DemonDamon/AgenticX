"""Object-hit disambiguation via the shared R2 confirm protocol.

When retrieval returns multiple near-score hits or conflicting attribute
values across sources, emit the same ``DisambiguationRequest`` types used by
rules NL — so agents share one interaction surface.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional, Tuple

from agenticx.runtime.disambiguation import (
    DisambiguationCandidate,
    DisambiguationConflict,
    DisambiguationFileStore,
    DisambiguationGate,
    DisambiguationMode,
    DisambiguationRequest,
    DisambiguationResponse,
    DisambiguationSession,
    DisambiguationSessionStatus,
    apply_response_to_session,
    new_request_id,
)


@dataclass
class ObjectHit:
    id: str
    label: str
    score: Optional[float] = None
    attrs: Dict[str, Any] = dc_field(default_factory=dict)
    sources: List[str] = dc_field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "score": self.score,
            "attrs": dict(self.attrs),
            "sources": list(self.sources),
        }


def needs_object_disambiguation(
    hits: List[ObjectHit], *, score_margin: float = 0.05
) -> bool:
    """True when ≥2 hits and top scores within margin, or identical labels."""
    if len(hits) < 2:
        return False
    labels = {(h.label or "").strip().lower() for h in hits}
    if len(labels) == 1 and list(labels)[0]:
        return True
    scored = [h for h in hits if h.score is not None]
    if len(scored) >= 2:
        ranked = sorted(scored, key=lambda h: float(h.score or 0.0), reverse=True)
        top = float(ranked[0].score or 0.0)
        second = float(ranked[1].score or 0.0)
        if abs(top - second) <= score_margin:
            return True
        # Also treat as ambiguous when ≥2 sit within margin of top.
        near = [h for h in ranked if abs(top - float(h.score or 0.0)) <= score_margin]
        return len(near) >= 2
    # No scores: multiple hits are ambiguous by default.
    return True


def object_hits_to_request(
    hits: List[ObjectHit],
    *,
    prompt: str = "",
    session_id: str = "",
    field: str = "object_id",
) -> DisambiguationRequest:
    return DisambiguationRequest(
        id=new_request_id(),
        mode=DisambiguationMode.CANDIDATE_SELECT,
        prompt=prompt or "Multiple objects matched; pick one",
        field=field,
        candidates=[
            DisambiguationCandidate(
                id=h.id,
                label=h.label or h.id,
                score=h.score,
                meta={"sources": list(h.sources), "attrs": dict(h.attrs)},
            )
            for h in hits
        ],
        allow_free_text=False,
        context={"hit_count": len(hits)},
        session_id=session_id,
    )


def attribute_conflicts_to_request(
    field: str,
    values_by_source: Dict[str, Any],
    *,
    session_id: str = "",
    prompt: str = "",
) -> DisambiguationRequest:
    sources = list(values_by_source.keys())
    values = [values_by_source[s] for s in sources]
    candidates = [
        DisambiguationCandidate(
            id=f"{src}::{val}",
            label=f"{val} ({src})",
            meta={"source": src, "value": val},
        )
        for src, val in values_by_source.items()
    ]
    return DisambiguationRequest(
        id=new_request_id(),
        mode=DisambiguationMode.CONFLICT_RESOLVE,
        prompt=prompt or f"Conflicting values for {field}; choose one",
        field=field,
        conflicts=[
            DisambiguationConflict(
                field=field,
                values=values,
                sources=sources,
                reason="multi-source attribute disagree",
            )
        ],
        candidates=candidates,
        allow_free_text=False,
        session_id=session_id,
    )


def _pick_clear_hit(
    hits: List[ObjectHit], *, score_margin: float
) -> Optional[ObjectHit]:
    if not hits:
        return None
    if not needs_object_disambiguation(hits, score_margin=score_margin):
        scored = [h for h in hits if h.score is not None]
        if scored:
            return max(scored, key=lambda h: float(h.score or 0.0))
        return hits[0]
    return None


async def resolve_object_hits(
    hits: List[ObjectHit],
    *,
    gate: Optional[DisambiguationGate] = None,
    store: Optional[DisambiguationFileStore] = None,
    score_margin: float = 0.05,
    prompt: str = "",
) -> Tuple[Optional[ObjectHit], Optional[DisambiguationSession]]:
    """Return the chosen hit; open a session when disambiguation is needed."""
    clear = _pick_clear_hit(hits, score_margin=score_margin)
    if clear is not None:
        return clear, None
    if not hits:
        return None, None

    req = object_hits_to_request(hits, prompt=prompt)
    if store is not None:
        session = store.create_session(source="retrieval.object", pending=[req])
    else:
        session = DisambiguationSession(
            id=f"das-{uuid.uuid4().hex[:12]}",
            status=DisambiguationSessionStatus.OPEN,
            source="retrieval.object",
            pending=[req],
            resolved=[],
            slots={},
            created_at="",
            updated_at="",
            meta={},
        )
        req.session_id = session.id

    if gate is None:
        return None, session

    resp = await gate.request(session.pending[0])
    session = apply_response_to_session(session, resp)
    if store is not None:
        store.upsert_session(session)
    if session.status is DisambiguationSessionStatus.CANCELLED:
        return None, session
    chosen_id = (resp.selected_ids or [None])[0]
    by_id = {h.id: h for h in hits}
    return by_id.get(str(chosen_id)) if chosen_id else None, session


def resolve_attribute_conflict(
    field: str,
    values_by_source: Dict[str, Any],
    resp: DisambiguationResponse,
) -> Any:
    """Extract chosen attribute value from a conflict_resolve response."""
    if resp.cancelled:
        return None
    if resp.free_text:
        return resp.free_text.strip()
    if not resp.selected_ids:
        return None
    pick = resp.selected_ids[0]
    # id format source::value
    if "::" in pick:
        return pick.split("::", 1)[1]
    return pick
