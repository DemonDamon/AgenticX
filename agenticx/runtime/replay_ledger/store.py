#!/usr/bin/env python3
"""Append-only local storage for replay runs.

Author: Damon Li
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import threading
import weakref
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

from agenticx.runtime.replay_ledger.contracts import (
    RUN_STATUSES,
    ReplayRunRecord,
    RunEvent,
    validate_ledger_id,
)
from agenticx.studio.storage.factory import _default_sessions_root


@dataclass
class _EventIndex:
    """Track durable event state without rescanning a stable JSONL file."""

    max_seq: int
    event_count: int
    event_ids: set[str]
    file_size: int
    file_mtime_ns: int


_SHARED_STATE_GUARD = threading.Lock()
_SHARED_RUN_LOCKS: weakref.WeakValueDictionary[tuple[str, str], threading.RLock] = (
    weakref.WeakValueDictionary()
)
_SHARED_EVENT_INDEXES: dict[tuple[str, str], _EventIndex] = {}
MAX_BLOB_UNCOMPRESSED_BYTES = 32 * 1024 * 1024


class ReplayLedgerStore:
    """Persist replay metadata, JSONL events, and content-addressed blobs."""

    def __init__(self, sessions_root: Path | None = None) -> None:
        if sessions_root is None:
            sessions_root = _default_sessions_root()
        self.sessions_root = Path(sessions_root)
        self._root_key = str(self.sessions_root.resolve())
        self._run_dirs: dict[str, Path] = {}

    def _run_dir(self, session_id: str, run_id: str) -> Path:
        safe_session_id = validate_ledger_id(session_id, "session_id")
        safe_run_id = validate_ledger_id(run_id, "run_id")
        return self.sessions_root / safe_session_id / "runs" / safe_run_id

    def _find_run_dir(self, run_id: str) -> Path | None:
        run_id = validate_ledger_id(run_id, "run_id")
        cached = self._run_dirs.get(run_id)
        if cached is not None and (cached / "run.json").exists():
            return cached
        if not self.sessions_root.exists():
            return None
        for path in self.sessions_root.glob(f"*/runs/{run_id}/run.json"):
            self._run_dirs[run_id] = path.parent
            return path.parent
        return None

    def _lock_for(self, run_id: str) -> threading.RLock:
        key = (self._root_key, run_id)
        with _SHARED_STATE_GUARD:
            return _SHARED_RUN_LOCKS.setdefault(key, threading.RLock())

    @staticmethod
    def _file_signature(path: Path) -> tuple[int, int]:
        if not path.exists():
            return 0, 0
        stat = path.stat()
        return stat.st_size, stat.st_mtime_ns

    def _scan_event_index(self, events_path: Path) -> _EventIndex:
        max_seq = 0
        event_count = 0
        event_ids: set[str] = set()
        if events_path.exists():
            with events_path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    try:
                        raw = json.loads(line)
                        event = RunEvent.from_dict(raw)
                    except Exception:
                        continue
                    max_seq = max(max_seq, event.seq)
                    event_count += 1
                    event_ids.add(event.event_id)
        file_size, file_mtime_ns = self._file_signature(events_path)
        return _EventIndex(
            max_seq=max_seq,
            event_count=event_count,
            event_ids=event_ids,
            file_size=file_size,
            file_mtime_ns=file_mtime_ns,
        )

    def _event_index(self, run_id: str, events_path: Path) -> _EventIndex:
        key = (self._root_key, run_id)
        file_size, file_mtime_ns = self._file_signature(events_path)
        with _SHARED_STATE_GUARD:
            cached = _SHARED_EVENT_INDEXES.get(key)
        if (
            cached is not None
            and cached.file_size == file_size
            and cached.file_mtime_ns == file_mtime_ns
        ):
            return cached
        rebuilt = self._scan_event_index(events_path)
        with _SHARED_STATE_GUARD:
            _SHARED_EVENT_INDEXES[key] = rebuilt
        return rebuilt

    def _cache_event_index(self, run_id: str, index: _EventIndex) -> None:
        with _SHARED_STATE_GUARD:
            _SHARED_EVENT_INDEXES[(self._root_key, run_id)] = index

    def _drop_event_index(self, run_id: str) -> None:
        with _SHARED_STATE_GUARD:
            _SHARED_EVENT_INDEXES.pop((self._root_key, run_id), None)

    @staticmethod
    def _find_event_by_id(events_path: Path, event_id: str) -> RunEvent | None:
        with events_path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    event = RunEvent.from_dict(json.loads(line))
                except Exception:
                    continue
                if event.event_id == event_id:
                    return event
        return None

    @contextmanager
    def _locked(self, run_dir: Path, run_id: str) -> Iterator[None]:
        run_dir.mkdir(parents=True, exist_ok=True)
        lock_path = run_dir / ".lock"
        thread_lock = self._lock_for(run_id)
        with thread_lock, lock_path.open("a+b") as handle:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            elif msvcrt is not None:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                elif msvcrt is not None:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)

    @staticmethod
    def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        with temp.open("w", encoding="utf-8") as handle:
            json.dump(
                value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)

    @staticmethod
    def _load_record(path: Path) -> ReplayRunRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return ReplayRunRecord.from_dict(raw) if isinstance(raw, dict) else None
        except Exception:
            return None

    @staticmethod
    def _partial_record_from_dir(run_dir: Path) -> ReplayRunRecord:
        run_path = run_dir / "run.json"
        timestamp = run_path.stat().st_mtime if run_path.exists() else 0.0
        event_count = 0
        last_seq = 0
        events_path = run_dir / "events.jsonl"
        if events_path.exists():
            with events_path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    try:
                        raw = json.loads(line)
                        seq = (
                            int(raw.get("seq", 0) or 0) if isinstance(raw, dict) else 0
                        )
                    except Exception:
                        continue
                    event_count += 1
                    last_seq = max(last_seq, seq)
        return ReplayRunRecord(
            run_id=run_dir.name,
            session_id=run_dir.parent.parent.name,
            turn_id="unknown",
            agent_id="meta",
            status="interrupted",
            created_at=timestamp,
            updated_at=timestamp,
            event_count=event_count,
            last_seq=last_seq,
            completeness="partial",
            gap_reason="corrupt_run_metadata",
        )

    @staticmethod
    def _reconcile_event_stats(
        run_dir: Path,
        record: ReplayRunRecord,
    ) -> bool:
        events_path = run_dir / "events.jsonl"
        if not events_path.exists():
            return False
        event_count = 0
        last_seq = 0
        with events_path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    raw = json.loads(line)
                    if not isinstance(raw, dict):
                        continue
                    last_seq = max(last_seq, int(raw.get("seq", 0) or 0))
                    event_count += 1
                except Exception:
                    continue
        reconciled_last_seq = max(record.last_seq, last_seq)
        reconciled_event_count = max(record.event_count, event_count)
        changed = (
            reconciled_last_seq != record.last_seq
            or reconciled_event_count != record.event_count
        )
        record.last_seq = reconciled_last_seq
        record.event_count = reconciled_event_count
        return changed

    def open_run(self, record: ReplayRunRecord) -> ReplayRunRecord:
        """Create a run unless it already exists."""
        run_dir = self._run_dir(record.session_id, record.run_id)
        with self._locked(run_dir, record.run_id):
            existing = self._load_record(run_dir / "run.json")
            if existing is not None:
                self._run_dirs[record.run_id] = run_dir
                return existing
            self._write_json_atomic(run_dir / "run.json", record.to_dict())
            self._run_dirs[record.run_id] = run_dir
            return record

    def append_event(self, run_id: str, event: RunEvent) -> RunEvent:
        """Append exactly one event while assigning a durable sequence."""
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            raise ValueError(f"unknown run_id: {run_id}")
        with self._locked(run_dir, run_id):
            record = self._load_record(run_dir / "run.json")
            if record is None:
                record = self._partial_record_from_dir(run_dir)
            events_path = run_dir / "events.jsonl"
            index = self._event_index(run_id, events_path)
            if event.event_id in index.event_ids:
                existing = self._find_event_by_id(events_path, event.event_id)
                if existing is not None:
                    return existing
            expected = max(record.last_seq, index.max_seq) + 1
            if event.seq not in (0, expected):
                raise ValueError(f"event seq must be {expected}")
            event.seq = expected
            event.run_id = record.run_id
            event.session_id = record.session_id
            event.turn_id = record.turn_id
            with events_path.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        event.to_dict(),
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    + "\n"
                )
                handle.flush()
                os.fsync(handle.fileno())
            file_size, file_mtime_ns = self._file_signature(events_path)
            index.max_seq = expected
            index.event_count += 1
            index.event_ids.add(event.event_id)
            index.file_size = file_size
            index.file_mtime_ns = file_mtime_ns
            self._cache_event_index(run_id, index)
            record.last_seq = expected
            record.event_count = max(record.event_count, index.event_count)
            record.updated_at = max(record.updated_at, event.ts)
            self._write_json_atomic(run_dir / "run.json", record.to_dict())
            return event

    def mark_partial(self, run_id: str, reason: str) -> ReplayRunRecord:
        """Mark a run as incomplete without hiding readable events."""
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            raise ValueError(f"unknown run_id: {run_id}")
        with self._locked(run_dir, run_id):
            record = self._load_record(run_dir / "run.json")
            if record is None:
                record = self._partial_record_from_dir(run_dir)
            record.completeness = "partial"
            record.gap_reason = str(reason or "unknown_gap")
            self._write_json_atomic(run_dir / "run.json", record.to_dict())
            return record

    def close_run(
        self, run_id: str, status: str, completed_at: float
    ) -> ReplayRunRecord:
        """Close a run with a terminal status."""
        if status not in RUN_STATUSES - {"running"}:
            raise ValueError(f"invalid terminal status: {status}")
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            raise ValueError(f"unknown run_id: {run_id}")
        with self._locked(run_dir, run_id):
            record = self._load_record(run_dir / "run.json")
            if record is None:
                record = self._partial_record_from_dir(run_dir)
            record.status = status
            record.completed_at = float(completed_at)
            record.updated_at = max(record.updated_at, float(completed_at))
            self._write_json_atomic(run_dir / "run.json", record.to_dict())
        self._drop_event_index(run_id)
        return record

    def get_run(self, run_id: str) -> ReplayRunRecord | None:
        """Read run metadata by id."""
        run_dir = self._find_run_dir(str(run_id or "").strip())
        if run_dir is None:
            return None
        with self._locked(run_dir, run_id):
            record = self._load_record(
                run_dir / "run.json"
            ) or self._partial_record_from_dir(run_dir)
            if self._reconcile_event_stats(run_dir, record):
                self._write_json_atomic(run_dir / "run.json", record.to_dict())
            return record

    def list_runs(self, session_id: str) -> list[ReplayRunRecord]:
        """List session runs in stable chronological order."""
        safe_session_id = validate_ledger_id(session_id, "session_id")
        root = self.sessions_root / safe_session_id / "runs"
        records = []
        if root.exists():
            for path in root.glob("*/run.json"):
                record = self._load_record(path) or self._partial_record_from_dir(
                    path.parent
                )
                self._reconcile_event_stats(path.parent, record)
                records.append(record)
        result = [record for record in records if record is not None]
        return sorted(result, key=lambda item: (item.created_at, item.run_id))

    def read_events(
        self,
        run_id: str,
        after_seq: int = 0,
        limit: int = 100,
        event_types: set[str] | None = None,
    ) -> tuple[list[RunEvent], bool]:
        """Read an ordered page while exposing corruption as partial metadata."""
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            return [], False
        events_path = run_dir / "events.jsonl"
        bounded = max(1, int(limit))
        with self._locked(run_dir, run_id):
            if not events_path.exists():
                return [], False
            rows: list[RunEvent] = []
            corrupt = False
            has_more = False
            with events_path.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    try:
                        raw = json.loads(line)
                        event = RunEvent.from_dict(raw)
                    except Exception:
                        corrupt = True
                        continue
                    if event.seq <= int(after_seq):
                        continue
                    if event_types is not None and event.type not in event_types:
                        continue
                    if len(rows) < bounded:
                        rows.append(event)
                    else:
                        has_more = True
            if corrupt:
                record = self._load_record(run_dir / "run.json")
                if record is None:
                    record = self._partial_record_from_dir(run_dir)
                record.completeness = "partial"
                record.gap_reason = "corrupt_event_line"
                self._write_json_atomic(run_dir / "run.json", record.to_dict())
        return rows, has_more

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        try:
            directory_fd = os.open(path, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(directory_fd)
        except OSError:
            pass
        finally:
            os.close(directory_fd)

    def write_blob(self, run_id: str, value: Any) -> str:
        """Write canonical JSON as a content-addressed gzip blob."""
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            raise ValueError(f"unknown run_id: {run_id}")
        raw = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
        digest = hashlib.sha256(raw).hexdigest()
        path = run_dir / "blobs" / f"{digest}.json.gz"
        if path.exists():
            return digest
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        with temp.open("wb") as raw_handle:
            with gzip.GzipFile(fileobj=raw_handle, mode="wb", mtime=0) as handle:
                handle.write(raw)
            raw_handle.flush()
            os.fsync(raw_handle.fileno())
        os.replace(temp, path)
        self._fsync_directory(path.parent)
        return digest

    def read_blob(
        self,
        run_id: str,
        blob_ref: str,
        *,
        max_uncompressed_bytes: int = MAX_BLOB_UNCOMPRESSED_BYTES,
    ) -> Any | None:
        """Read a content-addressed payload, returning None when unavailable."""
        run_dir = self._find_run_dir(run_id)
        if run_dir is None:
            return None
        expected_digest = str(blob_ref or "").strip()
        if re.fullmatch(r"[0-9a-f]{64}", expected_digest) is None:
            try:
                self.mark_partial(run_id, "invalid_payload_blob_ref")
            except Exception:
                pass
            return None
        path = run_dir / "blobs" / f"{expected_digest}.json.gz"
        if not path.exists():
            try:
                self.mark_partial(run_id, "payload_blob_missing")
            except Exception:
                pass
            return None
        try:
            with gzip.open(path, "rb") as handle:
                raw = bytearray()
                total = 0
                limit = max(0, int(max_uncompressed_bytes))
                while total <= limit:
                    chunk = handle.read(min(1024 * 1024, limit + 1 - total))
                    if not chunk:
                        break
                    raw.extend(chunk)
                    total += len(chunk)
                if total > limit:
                    self.mark_partial(run_id, "payload_blob_too_large")
                    return None
            if hashlib.sha256(raw).hexdigest() != expected_digest:
                raise ValueError("payload blob hash mismatch")
            return json.loads(raw)
        except Exception:
            try:
                self.mark_partial(run_id, "payload_blob_corrupt")
            except Exception:
                pass
            return None

    def delete_session_runs(self, session_id: str) -> None:
        """Delete only the replay subtree owned by a session."""
        normalized_session_id = validate_ledger_id(session_id, "session_id")
        runs_root = self.sessions_root / normalized_session_id / "runs"
        deleted_run_ids = (
            {run_dir.name for run_dir in runs_root.iterdir() if run_dir.is_dir()}
            if runs_root.exists()
            else set()
        )
        if runs_root.exists():
            shutil.rmtree(runs_root)
        with _SHARED_STATE_GUARD:
            stale_keys = [
                key
                for key in _SHARED_EVENT_INDEXES
                if key[0] == self._root_key and key[1] in deleted_run_ids
            ]
            for key in stale_keys:
                _SHARED_EVENT_INDEXES.pop(key, None)
            stale_lock_keys = [
                key
                for key in _SHARED_RUN_LOCKS
                if key[0] == self._root_key and key[1] in deleted_run_ids
            ]
            for key in stale_lock_keys:
                _SHARED_RUN_LOCKS.pop(key, None)
        self._run_dirs = {
            run_id: run_dir
            for run_id, run_dir in self._run_dirs.items()
            if run_dir.parent.parent.parent.name != normalized_session_id
        }
