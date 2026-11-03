#!/usr/bin/env python3
"""Append-only handoff store (SP4).

One JSONL file per AppThread under ``<agx-home>/handoffs/``. Records are
never rewritten in place (master-plan discipline: explicit graph data,
auditable, supersedable -- no silent mutation). Two record kinds:

- ``handoff``: a ContextHandoff as executed
- ``invalidation``: a rollback event covering a history position range;
  reading joins these to derive effective status (active / superseded /
  invalidated / expired) plus TTL expiry.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import ujson

from agenticx.harness.handoff.types import (
    HANDOFF_ACTIVE,
    HANDOFF_EXPIRED,
    HANDOFF_INVALIDATED,
    HANDOFF_SUPERSEDED,
    ContextHandoff,
)

_DEFAULT_RETENTION_DAYS = 30
_SECONDS_PER_DAY = 86400.0


@dataclass
class HandoffInvalidation:
    """A rollback-driven invalidation record (append-only)."""

    invalidation_id: str
    app_thread_id: str
    # All handoffs whose source_end_position > rollback_to_position are
    # covered (they describe state that the rollback reverted).
    rollback_to_position: int
    reason: str = ""
    created_at: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return dict(self.__dict__)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


class HandoffStore:
    """JSONL append-only store with derived lifecycle status."""

    def __init__(self, root_dir: str, retention_days: int = _DEFAULT_RETENTION_DAYS):
        """``retention_days`` > 0 enables TTL expiry; 0 keeps records forever."""
        self._root = root_dir
        self._retention_seconds = (
            retention_days * _SECONDS_PER_DAY if retention_days > 0 else 0.0
        )

    # ------------------------------------------------------------------
    # paths
    # ------------------------------------------------------------------
    def _thread_dir(self, app_thread_id: str) -> str:
        # One directory shard per thread id to keep names filesystem-safe.
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in app_thread_id)
        return os.path.join(self._root, safe[:120] or "default")

    def _thread_file(self, app_thread_id: str) -> str:
        return os.path.join(self._thread_dir(app_thread_id), "handoffs.jsonl")

    # ------------------------------------------------------------------
    # writes
    # ------------------------------------------------------------------
    def append_handoff(self, handoff: ContextHandoff) -> None:
        record = {"record_type": "handoff", **handoff.as_dict()}
        self._append(app_thread_id=handoff.app_thread_id, record=record)

    def append_invalidation(
        self, invalidation: HandoffInvalidation
    ) -> None:
        record = {
            "record_type": "invalidation",
            **invalidation.as_dict(),
        }
        self._append(
            app_thread_id=invalidation.app_thread_id, record=record
        )

    def _append(self, app_thread_id: str, record: Dict[str, Any]) -> None:
        directory = self._thread_dir(app_thread_id)
        os.makedirs(directory, exist_ok=True)
        path = self._thread_file(app_thread_id)
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # ------------------------------------------------------------------
    # reads
    # ------------------------------------------------------------------
    def _read_records(self, app_thread_id: str) -> List[Dict[str, Any]]:
        path = self._thread_file(app_thread_id)
        if not os.path.exists(path):
            return []
        out: List[Dict[str, Any]] = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(ujson.loads(line))
                except (ValueError, TypeError):
                    continue  # torn tail line: keep the readable prefix
        return out

    def list_handoffs(self, app_thread_id: str) -> List[ContextHandoff]:
        return [
            ContextHandoff.from_dict(rec)
            for rec in self._read_records(app_thread_id)
            if rec.get("record_type") == "handoff"
        ]

    def list_invalidations(
        self, app_thread_id: str
    ) -> List[HandoffInvalidation]:
        out: List[HandoffInvalidation] = []
        for rec in self._read_records(app_thread_id):
            if rec.get("record_type") != "invalidation":
                continue
            out.append(
                HandoffInvalidation(
                    invalidation_id=str(rec.get("invalidation_id") or ""),
                    app_thread_id=str(rec.get("app_thread_id") or ""),
                    rollback_to_position=int(
                        rec.get("rollback_to_position") or 0
                    ),
                    reason=str(rec.get("reason") or ""),
                    created_at=str(rec.get("created_at") or ""),
                )
            )
        return out

    def _handoff_status(
        self,
        handoff: ContextHandoff,
        all_handoffs: List[ContextHandoff],
        invalidations: List[HandoffInvalidation],
        now: Optional[float] = None,
    ) -> str:
        for invalidation in invalidations:
            if handoff.source_end_position > invalidation.rollback_to_position:
                return HANDOFF_INVALIDATED
        if any(
            newer.supersedes == handoff.handoff_id
            for newer in all_handoffs
        ):
            return HANDOFF_SUPERSEDED
        if self._retention_seconds > 0:
            created = _parse_iso_ts(handoff.created_at)
            if created is not None:
                reference = now if now is not None else time.time()
                if reference - created > self._retention_seconds:
                    return HANDOFF_EXPIRED
        return HANDOFF_ACTIVE

    def active_handoff(self, app_thread_id: str) -> Optional[ContextHandoff]:
        """Latest handoff that is still active (no supersede/invalidations
        beyond its coverage, not TTL-expired)."""
        handoffs = self.list_handoffs(app_thread_id)
        if not handoffs:
            return None
        invalidations = self.list_invalidations(app_thread_id)
        for handoff in reversed(handoffs):
            status = self._handoff_status(handoff, handoffs, invalidations)
            if status == HANDOFF_ACTIVE:
                return handoff
        return None

    def handoff_statuses(
        self, app_thread_id: str
    ) -> List[Dict[str, Any]]:
        """Audit view: every handoff with its derived status."""
        handoffs = self.list_handoffs(app_thread_id)
        invalidations = self.list_invalidations(app_thread_id)
        out: List[Dict[str, Any]] = []
        for handoff in handoffs:
            status = self._handoff_status(handoff, handoffs, invalidations)
            out.append({"handoff": handoff.as_dict(), "status": status})
        return out

    # ------------------------------------------------------------------
    # rollback linkage
    # ------------------------------------------------------------------
    def invalidate_covering(
        self,
        app_thread_id: str,
        rollback_to_position: int,
        reason: str = "session rollback",
    ) -> List[str]:
        """Invalidate every handoff whose source context the rollback
        reverted. Returns the invalidated handoff ids (append-only: an
        invalidation record is appended even when the list is empty, so
        the audit trail stays complete)."""
        import uuid

        invalidated: List[str] = []
        for handoff in self.list_handoffs(app_thread_id):
            if handoff.source_end_position > rollback_to_position:
                invalidated.append(handoff.handoff_id)
        self.append_invalidation(
            HandoffInvalidation(
                invalidation_id=f"inv_{uuid.uuid4().hex[:12]}",
                app_thread_id=app_thread_id,
                rollback_to_position=rollback_to_position,
                reason=reason,
                created_at=_now_iso(),
            )
        )
        return invalidated


def _parse_iso_ts(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        from datetime import datetime

        return datetime.strptime(
            value, "%Y-%m-%dT%H:%M:%SZ"
        ).timestamp()
    except ValueError:
        return None
