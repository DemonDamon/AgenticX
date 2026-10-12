#!/usr/bin/env python3
"""SQLite persistence for ActionProposal records.

Author: Damon Li
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from agenticx.utils.agx_home import agx_home

ProposalStatus = Literal[
    "awaiting_review",
    "executing",
    "succeeded",
    "failed",
    "outcome_unknown",
    "denied",
    "expired",
]

TERMINAL_STATUSES: frozenset[str] = frozenset(
    {
        "succeeded",
        "failed",
        "outcome_unknown",
        "denied",
        "expired",
    }
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS action_proposals (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    expires_at REAL NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    result TEXT,
    session_id TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_action_proposals_status
    ON action_proposals(status);
CREATE INDEX IF NOT EXISTS idx_action_proposals_session
    ON action_proposals(session_id, created_at);
"""


@dataclass(frozen=True)
class ActionProposalRecord:
    """Immutable snapshot of a persisted action proposal."""

    id: str
    hash: str
    expires_at: float
    payload: dict[str, Any]
    status: ProposalStatus
    error: str | None
    result: str | None
    session_id: str
    created_at: float
    updated_at: float


def default_db_path() -> Path:
    """Independent SQLite file under ``~/.agenticx`` (not shared with jobs)."""
    return agx_home() / "action_proposals.sqlite"


class ActionProposalStore:
    """Thread-safe SQLite store for ActionProposal rows."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self._path = Path(db_path) if db_path is not None else default_db_path()
        self._lock = threading.RLock()
        self._ensure_schema()

    @property
    def path(self) -> Path:
        return self._path

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self._path), timeout=60.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _ensure_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(_SCHEMA)
                conn.commit()
            finally:
                conn.close()

    def put(self, record: ActionProposalRecord) -> ActionProposalRecord:
        payload_json = json.dumps(record.payload, ensure_ascii=False, separators=(",", ":"))
        now = float(record.updated_at)
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    INSERT INTO action_proposals (
                        id, hash, expires_at, payload, status, error, result,
                        session_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        hash=excluded.hash,
                        expires_at=excluded.expires_at,
                        payload=excluded.payload,
                        status=excluded.status,
                        error=excluded.error,
                        result=excluded.result,
                        session_id=excluded.session_id,
                        updated_at=excluded.updated_at
                    """,
                    (
                        record.id,
                        record.hash,
                        float(record.expires_at),
                        payload_json,
                        record.status,
                        record.error,
                        record.result,
                        record.session_id,
                        float(record.created_at),
                        now,
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        return record

    def get(self, proposal_id: str) -> ActionProposalRecord | None:
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT * FROM action_proposals WHERE id = ?",
                    (proposal_id,),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return None
        return _row_to_record(row)

    def claim(
        self,
        proposal_id: str,
        *,
        expected_status: ProposalStatus,
        expected_hash: str,
        new_status: ProposalStatus,
        now: float | None = None,
        error: str | None = None,
        result: str | None = None,
    ) -> ActionProposalRecord | None:
        """CAS transition ``expected_status`` → ``new_status`` when hash matches."""
        ts = time.time() if now is None else float(now)
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    """
                    UPDATE action_proposals
                    SET status = ?, updated_at = ?, error = ?, result = ?
                    WHERE id = ? AND status = ? AND hash = ?
                    """,
                    (
                        new_status,
                        ts,
                        error,
                        result,
                        proposal_id,
                        expected_status,
                        expected_hash,
                    ),
                )
                conn.commit()
                if cur.rowcount != 1:
                    return None
                row = conn.execute(
                    "SELECT * FROM action_proposals WHERE id = ?",
                    (proposal_id,),
                ).fetchone()
            finally:
                conn.close()
        if row is None:
            return None
        return _row_to_record(row)

    def list_by_status(self, status: ProposalStatus) -> list[ActionProposalRecord]:
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT * FROM action_proposals WHERE status = ? ORDER BY created_at ASC",
                    (status,),
                ).fetchall()
            finally:
                conn.close()
        return [_row_to_record(r) for r in rows]

    def recover_executing(
        self,
        *,
        error: str,
        now: float | None = None,
    ) -> list[ActionProposalRecord]:
        """Mark leftover ``executing`` rows as ``outcome_unknown`` (startup recovery)."""
        ts = time.time() if now is None else float(now)
        with self._lock:
            conn = self._connect()
            try:
                rows = conn.execute(
                    "SELECT id FROM action_proposals WHERE status = 'executing'"
                ).fetchall()
                ids = [str(r["id"]) for r in rows]
                if ids:
                    conn.execute(
                        """
                        UPDATE action_proposals
                        SET status = 'outcome_unknown', error = ?, updated_at = ?, result = NULL
                        WHERE status = 'executing'
                        """,
                        (error, ts),
                    )
                    conn.commit()
                recovered: list[ActionProposalRecord] = []
                for pid in ids:
                    row = conn.execute(
                        "SELECT * FROM action_proposals WHERE id = ?",
                        (pid,),
                    ).fetchone()
                    if row is not None:
                        recovered.append(_row_to_record(row))
            finally:
                conn.close()
        return recovered


def _row_to_record(row: sqlite3.Row) -> ActionProposalRecord:
    raw_payload = row["payload"]
    try:
        payload = json.loads(raw_payload) if isinstance(raw_payload, str) else {}
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    status = str(row["status"] or "failed")
    return ActionProposalRecord(
        id=str(row["id"]),
        hash=str(row["hash"]),
        expires_at=float(row["expires_at"] or 0.0),
        payload=payload,
        status=status,  # type: ignore[arg-type]
        error=str(row["error"]) if row["error"] is not None else None,
        result=str(row["result"]) if row["result"] is not None else None,
        session_id=str(row["session_id"] or ""),
        created_at=float(row["created_at"] or 0.0),
        updated_at=float(row["updated_at"] or 0.0),
    )
