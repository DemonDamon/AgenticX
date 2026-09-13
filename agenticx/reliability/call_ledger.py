#!/usr/bin/env python3
"""Append-only per-session ledger for tool-call identity.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Literal

from agenticx.reliability.call_identity import (
    canonical_call_key,
    diff_canonical_fields,
)
from agenticx.reliability.errors import LedgerCorruptError, ToolCallIdentityError
from agenticx.utils.agx_home import agx_home

logger = logging.getLogger(__name__)

CallState = Literal["dispatched", "completed", "failed"]


class Verdict(str, Enum):
    FRESH = "fresh"
    REPLAY_SKIP = "replay_skip"
    AMBIGUOUS = "ambiguous"
    IDENTITY_CONFLICT = "identity_conflict"


@dataclass
class CallRecord:
    call_id: str
    canonical_key: str
    tool_name: str
    state: CallState
    dispatched_at: float
    completed_at: float | None = None
    result_digest: str | None = None
    result_payload: str | None = None
    error: str | None = None
    replay_safety: str = "unknown"
    arguments: Any = field(default=None)


@dataclass
class Reconciliation:
    verdict: Verdict
    record: CallRecord | None = None
    replay_result: str | None = None


def _validate_session_id(session_id: str) -> str:
    value = str(session_id or "").strip()
    if (
        not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or ".." in value
    ):
        raise ValueError(f"invalid session_id: {session_id!r}")
    return value


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class CallLedger:
    """Per-session append-only ledger of dispatched tool calls."""

    def __init__(
        self,
        session_id: str,
        *,
        root: str | Path | None = None,
        max_inline_result_bytes: int = 65536,
    ) -> None:
        self.session_id = _validate_session_id(session_id)
        parent = Path(root) if root is not None else agx_home() / "sessions"
        self._dir = parent / self.session_id
        self._path = self._dir / "call_ledger.jsonl"
        self.max_inline_result_bytes = max_inline_result_bytes
        self._lock = threading.RLock()
        self._records: dict[str, CallRecord] = {}
        self._fh: Any = None
        self._replay_existing()

    @classmethod
    def load(cls, session_id: str, *, root: str | Path | None = None) -> "CallLedger":
        """Rebuild in-memory index by replaying the JSONL file."""
        return cls(session_id, root=root)

    def close(self) -> None:
        with self._lock:
            if self._fh is not None:
                self._fh.close()
                self._fh = None

    def lookup(self, call_id: str) -> CallRecord | None:
        with self._lock:
            record = self._records.get(call_id)
            if record is None:
                return None
            return CallRecord(**record.__dict__)

    def pending_call_ids(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(
                call_id
                for call_id, record in self._records.items()
                if record.state == "dispatched"
            )

    def record_dispatch(
        self,
        call_id: str,
        tool_name: str,
        arguments: Any,
        *,
        replay_safety: str = "unknown",
    ) -> CallRecord:
        record = CallRecord(
            call_id=str(call_id),
            canonical_key=canonical_call_key(tool_name, arguments),
            tool_name=tool_name,
            state="dispatched",
            dispatched_at=time.time(),
            replay_safety=replay_safety,
            arguments=arguments,
        )
        self._append(
            {
                "v": 1,
                "op": "dispatch",
                "ts": record.dispatched_at,
                "call_id": record.call_id,
                "canonical_key": record.canonical_key,
                "tool_name": record.tool_name,
                "state": record.state,
                "dispatched_at": record.dispatched_at,
                "replay_safety": record.replay_safety,
                "arguments": arguments,
            }
        )
        with self._lock:
            self._records[record.call_id] = record
        return record

    def record_result(self, call_id: str, result: str, *, success: bool = True) -> None:
        if success:
            payload, digest = self._store_result(result)
            completed_at = time.time()
            self._append(
                {
                    "v": 1,
                    "op": "result",
                    "ts": completed_at,
                    "call_id": call_id,
                    "state": "completed",
                    "completed_at": completed_at,
                    "result_digest": digest,
                    "result_payload": payload,
                    "error": None,
                }
            )
            with self._lock:
                record = self._records.get(call_id)
                if record is None:
                    return
                record.state = "completed"
                record.completed_at = completed_at
                record.result_digest = digest
                record.result_payload = payload
                record.error = None
            return
        self.record_failure(call_id, result)

    def record_failure(self, call_id: str, error: str) -> None:
        completed_at = time.time()
        self._append(
            {
                "v": 1,
                "op": "failure",
                "ts": completed_at,
                "call_id": call_id,
                "state": "failed",
                "completed_at": completed_at,
                "error": error,
            }
        )
        with self._lock:
            record = self._records.get(call_id)
            if record is None:
                return
            record.state = "failed"
            record.completed_at = completed_at
            record.error = error
            record.result_payload = None

    def reconcile(self, call_id: str, tool_name: str, arguments: Any) -> Reconciliation:
        key = canonical_call_key(tool_name, arguments)
        rec = self.lookup(call_id)
        if rec is None:
            return Reconciliation(verdict=Verdict.FRESH)
        if rec.canonical_key != key:
            raise ToolCallIdentityError(
                call_id,
                recorded_key=rec.canonical_key,
                incoming_key=key,
                changed_fields=diff_canonical_fields(rec.arguments, arguments),
            )
        if rec.state == "completed" and rec.result_payload is not None:
            return Reconciliation(
                verdict=Verdict.REPLAY_SKIP,
                record=rec,
                replay_result=rec.result_payload,
            )
        if rec.state == "failed":
            return Reconciliation(verdict=Verdict.FRESH, record=rec)
        return Reconciliation(verdict=Verdict.AMBIGUOUS, record=rec)

    def reconcile_safe(
        self, call_id: str, tool_name: str, arguments: Any
    ) -> Reconciliation:
        """Like reconcile() but returns IDENTITY_CONFLICT instead of raising."""
        try:
            return self.reconcile(call_id, tool_name, arguments)
        except ToolCallIdentityError:
            return Reconciliation(
                verdict=Verdict.IDENTITY_CONFLICT,
                record=self.lookup(call_id),
            )

    def _store_result(self, result: str) -> tuple[str | None, str]:
        text = str(result)
        digest = _digest(text)
        encoded = text.encode("utf-8")
        if len(encoded) > self.max_inline_result_bytes:
            return None, digest
        return text, digest

    def _append(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._dir.mkdir(parents=True, exist_ok=True)
            if self._fh is None:
                self._fh = open(self._path, "a", encoding="utf-8")
            self._fh.write(line + "\n")
            self._fh.flush()
            os.fsync(self._fh.fileno())

    def _replay_existing(self) -> None:
        if not self._path.exists():
            return
        raw = self._path.read_text(encoding="utf-8")
        if not raw.strip():
            return
        parsed_any = False
        usable = False
        for line in raw.splitlines():
            if not line.strip():
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("skipping corrupt ledger line session=%s", self.session_id)
                continue
            parsed_any = True
            if not isinstance(data, dict):
                continue
            version = int(data.get("v", 1) or 1)
            if version > 1:
                logger.warning(
                    "skipping ledger line with schema v=%s session=%s",
                    version,
                    self.session_id,
                )
                continue
            if self._apply_line(data):
                usable = True
        if not parsed_any and raw.strip():
            raise LedgerCorruptError(
                f"ledger file is unparseable: {self._path}"
            )
        _ = usable

    def _apply_line(self, data: dict[str, Any]) -> bool:
        op = str(data.get("op", "") or "")
        call_id = str(data.get("call_id", "") or "")
        if not call_id:
            return False
        if op == "dispatch":
            self._records[call_id] = CallRecord(
                call_id=call_id,
                canonical_key=str(data.get("canonical_key", "") or ""),
                tool_name=str(data.get("tool_name", "") or ""),
                state="dispatched",
                dispatched_at=float(data.get("dispatched_at", data.get("ts", 0.0)) or 0.0),
                replay_safety=str(data.get("replay_safety", "unknown") or "unknown"),
                arguments=data.get("arguments"),
            )
            return True
        record = self._records.get(call_id)
        if record is None:
            return False
        if op == "result":
            record.state = "completed"
            record.completed_at = float(
                data.get("completed_at", data.get("ts", 0.0)) or 0.0
            )
            record.result_digest = (
                str(data["result_digest"]) if data.get("result_digest") else None
            )
            payload = data.get("result_payload")
            record.result_payload = str(payload) if payload is not None else None
            record.error = None
            return True
        if op == "failure":
            record.state = "failed"
            record.completed_at = float(
                data.get("completed_at", data.get("ts", 0.0)) or 0.0
            )
            record.error = str(data.get("error", "") or "")
            record.result_payload = None
            return True
        return False
