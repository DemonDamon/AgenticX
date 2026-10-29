"""Disambiguation confirm protocol (R2) — extension beyond boolean ConfirmGate.

Three generic modes shared by rules NL and retrieval object disambiguation:

* ``candidate_select`` — user picks among candidates (候选选择)
* ``info_supplement`` — user supplies missing free-text (信息补充)
* ``conflict_resolve`` — user adjudicates side-by-side conflicts (冲突裁决)

Boolean risk confirm stays in ``confirm.py``; open-ended Desktop transport stays
in ``clarify.py``. This module models *what* to ask and multi-turn session state.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field as dc_field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union


class DisambiguationMode(str, Enum):
    """Confirm-protocol modes beyond boolean approve/reject."""

    CANDIDATE_SELECT = "candidate_select"
    INFO_SUPPLEMENT = "info_supplement"
    CONFLICT_RESOLVE = "conflict_resolve"


class DisambiguationSessionStatus(str, Enum):
    OPEN = "open"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class DisambiguationError(ValueError):
    """Invalid disambiguation request or response."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class DisambiguationCandidate:
    id: str
    label: str
    score: Optional[float] = None
    meta: Dict[str, Any] = dc_field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "score": self.score,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisambiguationCandidate":
        return cls(
            id=str(data["id"]),
            label=str(data.get("label") or data["id"]),
            score=data.get("score"),
            meta=dict(data.get("meta") or {}),
        )


@dataclass
class DisambiguationConflict:
    field: str
    values: List[Any]
    sources: List[str] = dc_field(default_factory=list)
    reason: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "field": self.field,
            "values": list(self.values),
            "sources": list(self.sources),
            "reason": self.reason,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisambiguationConflict":
        return cls(
            field=str(data.get("field") or ""),
            values=list(data.get("values") or []),
            sources=[str(s) for s in (data.get("sources") or [])],
            reason=str(data.get("reason") or ""),
        )


@dataclass
class DisambiguationRequest:
    id: str
    mode: DisambiguationMode
    prompt: str
    field: str = ""
    candidates: List[DisambiguationCandidate] = dc_field(default_factory=list)
    conflicts: List[DisambiguationConflict] = dc_field(default_factory=list)
    allow_free_text: bool = False
    context: Dict[str, Any] = dc_field(default_factory=dict)
    session_id: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "mode": self.mode.value,
            "prompt": self.prompt,
            "field": self.field,
            "candidates": [c.to_dict() for c in self.candidates],
            "conflicts": [c.to_dict() for c in self.conflicts],
            "allow_free_text": bool(self.allow_free_text),
            "context": dict(self.context),
            "session_id": self.session_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisambiguationRequest":
        mode_raw = data.get("mode")
        mode = (
            mode_raw
            if isinstance(mode_raw, DisambiguationMode)
            else DisambiguationMode(str(mode_raw))
        )
        return cls(
            id=str(data["id"]),
            mode=mode,
            prompt=str(data.get("prompt") or ""),
            field=str(data.get("field") or ""),
            candidates=[DisambiguationCandidate.from_dict(c) for c in (data.get("candidates") or [])],
            conflicts=[DisambiguationConflict.from_dict(c) for c in (data.get("conflicts") or [])],
            allow_free_text=bool(data.get("allow_free_text", False)),
            context=dict(data.get("context") or {}),
            session_id=str(data.get("session_id") or ""),
        )


@dataclass
class DisambiguationResponse:
    request_id: str
    selected_ids: List[str] = dc_field(default_factory=list)
    free_text: Optional[str] = None
    cancelled: bool = False
    meta: Dict[str, Any] = dc_field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "selected_ids": list(self.selected_ids),
            "free_text": self.free_text,
            "cancelled": bool(self.cancelled),
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisambiguationResponse":
        return cls(
            request_id=str(data["request_id"]),
            selected_ids=[str(x) for x in (data.get("selected_ids") or [])],
            free_text=data.get("free_text"),
            cancelled=bool(data.get("cancelled", False)),
            meta=dict(data.get("meta") or {}),
        )


def validate_request(req: DisambiguationRequest) -> None:
    if not req.id:
        raise DisambiguationError("request.id is required")
    if not isinstance(req.mode, DisambiguationMode):
        raise DisambiguationError(f"invalid mode: {req.mode!r}")
    if req.mode is DisambiguationMode.CANDIDATE_SELECT:
        if not req.candidates:
            raise DisambiguationError("candidate_select requires ≥1 candidate")
    elif req.mode is DisambiguationMode.INFO_SUPPLEMENT:
        if not req.allow_free_text:
            raise DisambiguationError("info_supplement requires allow_free_text=True")
    elif req.mode is DisambiguationMode.CONFLICT_RESOLVE:
        if not req.conflicts and not req.candidates:
            raise DisambiguationError(
                "conflict_resolve requires ≥1 conflict or candidate encoding of values"
            )


def validate_response(req: DisambiguationRequest, resp: DisambiguationResponse) -> None:
    if resp.request_id != req.id:
        raise DisambiguationError(
            f"response.request_id {resp.request_id!r} != request.id {req.id!r}"
        )
    if resp.cancelled:
        return
    if req.mode is DisambiguationMode.CANDIDATE_SELECT:
        if not resp.selected_ids:
            raise DisambiguationError("candidate_select response needs selected_ids")
        known = {c.id for c in req.candidates}
        unknown = [i for i in resp.selected_ids if i not in known]
        if unknown:
            raise DisambiguationError(f"unknown selected_ids: {unknown}")
    elif req.mode is DisambiguationMode.INFO_SUPPLEMENT:
        text = (resp.free_text or "").strip()
        if not text:
            raise DisambiguationError("info_supplement response needs free_text")
    elif req.mode is DisambiguationMode.CONFLICT_RESOLVE:
        has_pick = bool(resp.selected_ids) or bool((resp.free_text or "").strip())
        if not has_pick:
            raise DisambiguationError(
                "conflict_resolve response needs selected_ids or free_text"
            )
        if resp.selected_ids and req.candidates:
            known = {c.id for c in req.candidates}
            unknown = [i for i in resp.selected_ids if i not in known]
            if unknown:
                raise DisambiguationError(f"unknown selected_ids: {unknown}")


def request_to_dict(req: DisambiguationRequest) -> Dict[str, Any]:
    return req.to_dict()


def request_from_dict(data: Dict[str, Any]) -> DisambiguationRequest:
    return DisambiguationRequest.from_dict(data)


def response_to_dict(resp: DisambiguationResponse) -> Dict[str, Any]:
    return resp.to_dict()


def response_from_dict(data: Dict[str, Any]) -> DisambiguationResponse:
    return DisambiguationResponse.from_dict(data)


def new_request_id() -> str:
    return f"daq-{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Session + store + gate (R2-2)
# ---------------------------------------------------------------------------


@dataclass
class DisambiguationSession:
    id: str
    status: DisambiguationSessionStatus
    source: str
    pending: List[DisambiguationRequest] = dc_field(default_factory=list)
    resolved: List[Dict[str, Any]] = dc_field(default_factory=list)
    slots: Dict[str, Any] = dc_field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    meta: Dict[str, Any] = dc_field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status.value,
            "source": self.source,
            "pending": [r.to_dict() for r in self.pending],
            "resolved": list(self.resolved),
            "slots": dict(self.slots),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "meta": dict(self.meta),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisambiguationSession":
        status_raw = data.get("status", DisambiguationSessionStatus.OPEN.value)
        status = (
            status_raw
            if isinstance(status_raw, DisambiguationSessionStatus)
            else DisambiguationSessionStatus(str(status_raw))
        )
        return cls(
            id=str(data["id"]),
            status=status,
            source=str(data.get("source") or ""),
            pending=[DisambiguationRequest.from_dict(r) for r in (data.get("pending") or [])],
            resolved=list(data.get("resolved") or []),
            slots=dict(data.get("slots") or {}),
            created_at=str(data.get("created_at") or ""),
            updated_at=str(data.get("updated_at") or ""),
            meta=dict(data.get("meta") or {}),
        )


_DEFAULT_REL = Path(".runtime") / "disambiguation"


def resolve_store_dir(root: Optional[Union[str, Path]] = None) -> Path:
    if root is not None:
        return Path(root)
    env = os.environ.get("AGX_DISAMBIGUATION_STORE_DIR", "").strip()
    if env:
        return Path(env)
    return Path.cwd() / _DEFAULT_REL


class DisambiguationFileStore:
    """JSON persistence for multi-turn disambiguation sessions."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "sessions.json"
        self._sessions: Dict[str, DisambiguationSession] = {}
        self._load()

    def _load(self) -> None:
        self._sessions.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("sessions") or []:
            sess = DisambiguationSession.from_dict(row)
            self._sessions[sess.id] = sess

    def _save(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"sessions": [s.to_dict() for s in self._sessions.values()]}
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def create_session(
        self,
        *,
        source: str,
        pending: Optional[List[DisambiguationRequest]] = None,
        meta: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> DisambiguationSession:
        now = utc_now_iso()
        sid = session_id or f"das-{uuid.uuid4().hex[:12]}"
        reqs = list(pending or [])
        for r in reqs:
            if not r.session_id:
                r.session_id = sid
            validate_request(r)
        sess = DisambiguationSession(
            id=sid,
            status=DisambiguationSessionStatus.OPEN,
            source=source,
            pending=reqs,
            resolved=[],
            slots={},
            created_at=now,
            updated_at=now,
            meta=dict(meta or {}),
        )
        self._sessions[sid] = sess
        self._save()
        return sess

    def get_session(self, session_id: str) -> DisambiguationSession:
        if session_id not in self._sessions:
            raise KeyError(session_id)
        return self._sessions[session_id]

    def upsert_session(self, session: DisambiguationSession) -> DisambiguationSession:
        session.updated_at = utc_now_iso()
        self._sessions[session.id] = session
        self._save()
        return session

    def list_sessions(
        self,
        *,
        status: Optional[DisambiguationSessionStatus] = None,
        source: Optional[str] = None,
    ) -> List[DisambiguationSession]:
        out: List[DisambiguationSession] = []
        for s in self._sessions.values():
            if status is not None and s.status is not status:
                continue
            if source is not None and s.source != source:
                continue
            out.append(s)
        return sorted(out, key=lambda x: x.created_at)


def _slot_value_from_response(
    req: DisambiguationRequest, resp: DisambiguationResponse
) -> Any:
    if resp.cancelled:
        return None
    if resp.selected_ids:
        by_id = {c.id: c for c in req.candidates}
        picked = [by_id[i] for i in resp.selected_ids if i in by_id]
        if len(picked) == 1:
            # Prefer label as human/slot value; id when label empty.
            return picked[0].label or picked[0].id
        if picked:
            return [p.label or p.id for p in picked]
        return list(resp.selected_ids)
    if resp.free_text is not None:
        return str(resp.free_text).strip()
    return None


def apply_response_to_session(
    session: DisambiguationSession, resp: DisambiguationResponse
) -> DisambiguationSession:
    """Apply one response: move matching pending → resolved, update slots."""
    if session.status is not DisambiguationSessionStatus.OPEN:
        raise DisambiguationError(f"session {session.id} is {session.status.value}")
    match_idx = next(
        (i for i, r in enumerate(session.pending) if r.id == resp.request_id), None
    )
    if match_idx is None:
        raise DisambiguationError(f"no pending request {resp.request_id}")
    req = session.pending[match_idx]
    validate_response(req, resp)
    if resp.cancelled:
        session.status = DisambiguationSessionStatus.CANCELLED
        session.resolved.append(
            {"request": req.to_dict(), "response": resp.to_dict()}
        )
        session.pending = []
        return session
    value = _slot_value_from_response(req, resp)
    if req.field:
        session.slots[req.field] = value
    session.resolved.append({"request": req.to_dict(), "response": resp.to_dict()})
    session.pending.pop(match_idx)
    if not session.pending:
        session.status = DisambiguationSessionStatus.COMPLETED
    return session


class DisambiguationGate(ABC):
    """Abstract gate: present a structured disambiguation request, await response."""

    @abstractmethod
    async def request(self, req: DisambiguationRequest) -> DisambiguationResponse:
        raise NotImplementedError


class SyncDisambiguationGate(DisambiguationGate):
    """Resolver-callable gate for tests and scripted flows."""

    def __init__(
        self,
        resolver: Optional[
            Callable[[DisambiguationRequest], DisambiguationResponse]
        ] = None,
    ) -> None:
        self.resolver = resolver
        self.last_request: Optional[DisambiguationRequest] = None
        self.history: List[DisambiguationRequest] = []

    async def request(self, req: DisambiguationRequest) -> DisambiguationResponse:
        validate_request(req)
        self.last_request = req
        self.history.append(req)
        if self.resolver is None:
            raise DisambiguationError("SyncDisambiguationGate has no resolver")
        resp = self.resolver(req)
        validate_response(req, resp)
        return resp


class RecordingDisambiguationGate(DisambiguationGate):
    """Records requests; resolve via ``push_response`` (async wait optional via queue)."""

    def __init__(self) -> None:
        self.pending_requests: Dict[str, DisambiguationRequest] = {}
        self._responses: Dict[str, DisambiguationResponse] = {}
        self.last_request: Optional[DisambiguationRequest] = None
        self.history: List[DisambiguationRequest] = []

    def push_response(self, resp: DisambiguationResponse) -> None:
        self._responses[resp.request_id] = resp

    async def request(self, req: DisambiguationRequest) -> DisambiguationResponse:
        validate_request(req)
        self.last_request = req
        self.history.append(req)
        self.pending_requests[req.id] = req
        if req.id not in self._responses:
            raise DisambiguationError(
                f"no response pushed for request {req.id}; call push_response first"
            )
        resp = self._responses.pop(req.id)
        validate_response(req, resp)
        self.pending_requests.pop(req.id, None)
        return resp
