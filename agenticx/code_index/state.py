"""In-memory index task state."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class IndexStatus(str, Enum):
    PENDING = "pending"
    INDEXING = "indexing"
    INDEXED = "indexed"
    INDEXFAILED = "indexfailed"


class IndexCancelledError(Exception):
    """Raised when a build is cancelled cooperatively."""


@dataclass
class IndexTask:
    codebase_path: str
    status: IndexStatus = IndexStatus.PENDING
    files_total: int = 0
    files_done: int = 0
    total_chunks: int = 0
    languages: dict[str, int] = field(default_factory=dict)
    last_progress_at: float = field(default_factory=time.time)
    error_summary: Optional[str] = None
    task_id: str = ""
    cancel_event: threading.Event = field(default_factory=threading.Event)
    lock: threading.RLock = field(default_factory=threading.RLock)
    backend_stats: dict[str, Any] = field(default_factory=dict)

    def touch_progress(self, files_done: int, files_total: int) -> None:
        self.files_done = files_done
        self.files_total = max(files_total, files_done)
        self.last_progress_at = time.time()

    def to_status_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "files_total": self.files_total,
            "files_done": self.files_done,
            "total_chunks": self.total_chunks,
            "languages": dict(self.languages),
            "last_progress_at": self.last_progress_at,
            "error_summary": self.error_summary,
            "task_id": self.task_id,
            "codebase_path": self.codebase_path,
        }
