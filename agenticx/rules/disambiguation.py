"""Map R1 NL ambiguities onto the R2 disambiguation confirm protocol.

Does not replace ``draft_rule_from_nl`` — wraps it so candidate / supplement
turns share the same ``DisambiguationRequest`` types as retrieval.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from agenticx.runtime.disambiguation import (
    DisambiguationCandidate,
    DisambiguationFileStore,
    DisambiguationGate,
    DisambiguationMode,
    DisambiguationRequest,
    DisambiguationSession,
    DisambiguationSessionStatus,
    apply_response_to_session,
    new_request_id,
)
from agenticx.rules.nl import NlAmbiguity, NlRuleDraft, draft_rule_from_nl


def ambiguities_to_requests(
    ambiguities: List[NlAmbiguity],
    *,
    session_id: str = "",
    context: Optional[Dict[str, Any]] = None,
) -> List[DisambiguationRequest]:
    """Convert NL ambiguities into protocol requests.

    Non-empty ``candidates`` → ``candidate_select``; otherwise ``info_supplement``.
    """
    ctx = dict(context or {})
    out: List[DisambiguationRequest] = []
    for amb in ambiguities:
        cands = [str(c) for c in (amb.candidates or []) if str(c).strip()]
        if cands:
            out.append(
                DisambiguationRequest(
                    id=new_request_id(),
                    mode=DisambiguationMode.CANDIDATE_SELECT,
                    prompt=amb.reason or f"Select a value for {amb.field}",
                    field=amb.field,
                    candidates=[
                        DisambiguationCandidate(id=c, label=c) for c in cands
                    ],
                    allow_free_text=False,
                    context=dict(ctx),
                    session_id=session_id,
                )
            )
        else:
            out.append(
                DisambiguationRequest(
                    id=new_request_id(),
                    mode=DisambiguationMode.INFO_SUPPLEMENT,
                    prompt=amb.reason or f"Provide a value for {amb.field}",
                    field=amb.field,
                    candidates=[],
                    allow_free_text=True,
                    context=dict(ctx),
                    session_id=session_id,
                )
            )
    return out


def _merge_slots_into_text(text: str, slots: Dict[str, Any]) -> str:
    """Deterministically enrich NL text with resolved slots (no LLM)."""
    t = (text or "").strip()
    obj = slots.get("object")
    if obj and not re.search(rf"\b{re.escape(str(obj))}\b", t, flags=re.I):
        # Insert object after "when " if present, else prefix.
        if re.search(r"\bwhen\b", t, flags=re.I):
            t = re.sub(r"\bwhen\b", f"when {obj}", t, count=1, flags=re.I)
        else:
            t = f"{t} for {obj}"

    threshold = slots.get("threshold") or slots.get("condition.value")
    if threshold is not None:
        thr = str(threshold).strip()
        if re.search(r"\b(high|low|critical|elevated)\b", t, flags=re.I):
            t = re.sub(
                r"\b(high|low|critical|elevated)\b",
                f"greater than {thr}",
                t,
                count=1,
                flags=re.I,
            )
        elif not re.search(r"\b\d+(\.\d+)?\b", t):
            t = f"{t} threshold {thr}"

    field = slots.get("condition.field")
    if field and not re.search(rf"\b{re.escape(str(field))}\b", t, flags=re.I):
        t = f"{t} metric {field}"

    target = slots.get("action.target")
    if target and not re.search(rf"\b{re.escape(str(target))}\b", t, flags=re.I):
        if re.search(r"\bnotify\b", t, flags=re.I):
            t = re.sub(r"\bnotify\b.*$", f"notify {target}", t, count=1, flags=re.I)
        else:
            t = f"{t} then notify {target}"
    return t


def _merge_slots_into_lexicon(
    lexicon: Optional[Dict[str, Any]], slots: Dict[str, Any]
) -> Dict[str, Any]:
    lex = dict(lexicon or {})
    obj = slots.get("object")
    if obj:
        # Prefer resolved object as sole lexicon object so extractor locks it.
        lex["objects"] = [str(obj)]
    target = slots.get("action.target")
    if target:
        lex["channels"] = [str(target)]
    return lex


async def resolve_nl_draft(
    text: str,
    *,
    lexicon: Optional[Dict[str, Any]] = None,
    slots: Optional[Dict[str, Any]] = None,
    gate: Optional[DisambiguationGate] = None,
    store: Optional[DisambiguationFileStore] = None,
) -> Tuple[NlRuleDraft, Optional[DisambiguationSession]]:
    """Draft from NL; if ambiguous, open a session and optionally drive the gate.

    When ``slots`` are provided (prior answers), merge into text/lexicon and re-draft.
    When ``gate`` is provided, walk pending requests, apply responses into slots,
    and re-draft until clear or cancelled.
    """
    working_slots: Dict[str, Any] = dict(slots or {})
    working_text = _merge_slots_into_text(text, working_slots) if working_slots else text
    working_lex = _merge_slots_into_lexicon(lexicon, working_slots)

    draft = draft_rule_from_nl(working_text, lexicon=working_lex or None)
    if not draft.ambiguities:
        return draft, None

    session: Optional[DisambiguationSession] = None
    if store is not None:
        reqs = ambiguities_to_requests(
            draft.ambiguities,
            context={"intent": getattr(draft.intent, "value", str(draft.intent))},
        )
        session = store.create_session(source="rules.nl", pending=reqs)
        for r in session.pending:
            r.session_id = session.id
    else:
        # Ephemeral session object (not persisted).
        reqs = ambiguities_to_requests(
            draft.ambiguities,
            context={"intent": getattr(draft.intent, "value", str(draft.intent))},
        )
        session = DisambiguationSession(
            id=f"das-{uuid.uuid4().hex[:12]}",
            status=DisambiguationSessionStatus.OPEN,
            source="rules.nl",
            pending=reqs,
            resolved=[],
            slots=dict(working_slots),
            created_at="",
            updated_at="",
            meta={},
        )
        for r in session.pending:
            r.session_id = session.id

    if gate is None:
        return draft, session

    # Drive gate until completed/cancelled or no pending.
    safety = 0
    while (
        session.status is DisambiguationSessionStatus.OPEN
        and session.pending
        and safety < 16
    ):
        safety += 1
        req = session.pending[0]
        resp = await gate.request(req)
        session = apply_response_to_session(session, resp)
        if store is not None:
            store.upsert_session(session)
        if session.status is DisambiguationSessionStatus.CANCELLED:
            return draft, session
        working_slots = dict(session.slots)
        working_text = _merge_slots_into_text(text, working_slots)
        working_lex = _merge_slots_into_lexicon(lexicon, working_slots)
        draft = draft_rule_from_nl(working_text, lexicon=working_lex or None)
        if not draft.ambiguities:
            session.status = DisambiguationSessionStatus.COMPLETED
            session.pending = []
            if store is not None:
                store.upsert_session(session)
            return draft, session
        # If still ambiguous with new fields, append remaining requests.
        existing_fields = {r.field for r in session.pending} | {
            (row.get("request") or {}).get("field") for row in session.resolved
        }
        extra = [
            a
            for a in draft.ambiguities
            if a.field not in existing_fields and a.field not in working_slots
        ]
        if extra:
            more = ambiguities_to_requests(extra, session_id=session.id)
            session.pending.extend(more)
            if store is not None:
                store.upsert_session(session)

    return draft, session


# Sync helper for unit tests that prefer no async caller.
def resolve_nl_draft_sync(
    text: str,
    *,
    lexicon: Optional[Dict[str, Any]] = None,
    slots: Optional[Dict[str, Any]] = None,
    store: Optional[DisambiguationFileStore] = None,
) -> Tuple[NlRuleDraft, Optional[DisambiguationSession]]:
    """Open session from ambiguities without driving a gate (sync)."""
    working_slots: Dict[str, Any] = dict(slots or {})
    working_text = _merge_slots_into_text(text, working_slots) if working_slots else text
    working_lex = _merge_slots_into_lexicon(lexicon, working_slots)
    draft = draft_rule_from_nl(working_text, lexicon=working_lex or None)
    if not draft.ambiguities:
        return draft, None
    reqs = ambiguities_to_requests(
        draft.ambiguities,
        context={"intent": getattr(draft.intent, "value", str(draft.intent))},
    )
    if store is not None:
        session = store.create_session(source="rules.nl", pending=reqs)
    else:
        session = DisambiguationSession(
            id=f"das-{uuid.uuid4().hex[:12]}",
            status=DisambiguationSessionStatus.OPEN,
            source="rules.nl",
            pending=reqs,
            resolved=[],
            slots=dict(working_slots),
            created_at="",
            updated_at="",
            meta={},
        )
        for r in session.pending:
            r.session_id = session.id
    return draft, session
