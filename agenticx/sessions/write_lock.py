#!/usr/bin/env python3
"""File-based session write lock.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import os
import time


class SessionWriteLockError(RuntimeError):
    """Base error for session write lock failures."""


class SessionWriteLockTimeout(SessionWriteLockError):
    """Raised when lock acquisition timed out."""


@dataclass
class SessionWriteLock:
    """Exclusive write lock implemented via atomic lock file creation."""

    lock_file: Path
    timeout_seconds: float = 1.0
    poll_interval_seconds: float = 0.05
    _fd: Optional[int] = None

    def acquire(self) -> None:
        start = time.monotonic()
        while True:
            try:
                self.lock_file.parent.mkdir(parents=True, exist_ok=True)
                self._fd = os.open(
                    str(self.lock_file),
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                    0o644,
                )
                os.write(self._fd, str(os.getpid()).encode("utf-8"))
                return
            except FileExistsError:
                if (time.monotonic() - start) >= self.timeout_seconds:
                    raise SessionWriteLockTimeout(
                        f"Timed out waiting for lock: {self.lock_file}"
                    )
                time.sleep(self.poll_interval_seconds)

    def release(self) -> None:
        owned = self._fd is not None
        if owned:
            os.close(self._fd)
            self._fd = None
        if owned and self.lock_file.exists():
            self.lock_file.unlink()

    def __enter__(self) -> "SessionWriteLock":
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()
