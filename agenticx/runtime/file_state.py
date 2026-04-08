#!/usr/bin/env python3
"""Track file read snapshots to guard against stale file_edit operations.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class FileReadState:
    """Snapshot of a file at read time."""

    path: str
    content_hash: str
    mtime: float
    read_at: float


class FileStateTracker:
    """Per-session tracker: file_read records state; file_edit checks staleness."""

    def __init__(self) -> None:
        self._states: dict[str, FileReadState] = {}

    def record_read(self, path: str, content: str) -> None:
        """Record logical content returned to the model (after line slicing, etc.)."""
        key = self._normalize_path(path)
        if not key:
            return
        raw = content.encode("utf-8", errors="replace")
        digest = hashlib.sha256(raw).hexdigest()
        mtime = 0.0
        try:
            st = os.stat(key)
            mtime = float(st.st_mtime)
        except OSError:
            pass
        self._states[key] = FileReadState(
            path=key,
            content_hash=digest,
            mtime=mtime,
            read_at=time.time(),
        )

    def check_staleness(self, path: str) -> Optional[str]:
        """Return error message if file on disk no longer matches last read snapshot."""
        key = self._normalize_path(path)
        if not key or key not in self._states:
            return None
        state = self._states[key]
        try:
            p = Path(key)
            if not p.is_file():
                return None
            st = p.stat()
            current_mtime = float(st.st_mtime)
            if abs(current_mtime - state.mtime) > 1e-6:
                return (
                    "ERROR: file was modified on disk after your last file_read "
                    f"({key}). Please call file_read again before editing."
                )
            raw = p.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest != state.content_hash:
                return (
                    "ERROR: file content changed since your last file_read "
                    f"({key}). Please call file_read again before editing."
                )
        except OSError:
            return None
        return None

    def clear(self) -> None:
        self._states.clear()

    @staticmethod
    def _normalize_path(path: str) -> str:
        text = str(path or "").strip()
        if not text:
            return ""
        try:
            return str(Path(text).expanduser().resolve(strict=False))
        except Exception:
            return text
