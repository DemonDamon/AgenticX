#!/usr/bin/env python3
"""Watch skill directory changes and emit debounced callbacks.

Author: Damon Li
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

_log = logging.getLogger(__name__)


class _SkillFileHandler(FileSystemEventHandler):
    """Internal watchdog handler that tracks SKILL.md changes only."""

    def __init__(self, callback: Callable[[str], Any]) -> None:
        super().__init__()
        self._callback = callback

    def on_created(self, event: FileSystemEvent) -> None:  # noqa: N802
        self._emit(event)

    def on_modified(self, event: FileSystemEvent) -> None:  # noqa: N802
        self._emit(event)

    def on_moved(self, event: FileSystemEvent) -> None:  # noqa: N802
        self._emit(event)

    def on_deleted(self, event: FileSystemEvent) -> None:  # noqa: N802
        self._emit(event)

    def _emit(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        src_path = str(getattr(event, "src_path", "") or "")
        dest_path = str(getattr(event, "dest_path", "") or "")
        changed_path = dest_path or src_path
        if not changed_path:
            return
        if Path(changed_path).name != "SKILL.md":
            return
        self._callback(changed_path)


class SkillDirWatcher:
    """Watch a skills root directory and trigger debounced callbacks."""

    def __init__(
        self,
        skills_root: str | Path,
        on_change: Callable[[str], Any],
        debounce_s: float = 1.0,
    ) -> None:
        self._skills_root = str(Path(skills_root).expanduser())
        self._on_change = on_change
        self._debounce_s = max(0.0, float(debounce_s))
        self._observer: Observer | None = None
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._pending_path: str | None = None

    def start(self) -> None:
        """Start file watching. Safe to call multiple times."""
        with self._lock:
            if self._observer is not None:
                return
            Path(self._skills_root).mkdir(parents=True, exist_ok=True)
            observer = Observer()
            observer.schedule(
                _SkillFileHandler(self._queue_change),
                self._skills_root,
                recursive=True,
            )
            observer.start()
            self._observer = observer

    def stop(self) -> None:
        """Stop file watching. Safe to call multiple times."""
        observer: Observer | None
        timer: threading.Timer | None
        with self._lock:
            observer = self._observer
            self._observer = None
            timer = self._timer
            self._timer = None
            self._pending_path = None
        if timer is not None:
            timer.cancel()
        if observer is not None:
            observer.stop()
            observer.join()

    def _queue_change(self, changed_path: str) -> None:
        with self._lock:
            self._pending_path = changed_path
            if self._timer is not None:
                self._timer.cancel()
            timer = threading.Timer(self._debounce_s, self._flush_pending)
            timer.daemon = True
            timer.start()
            self._timer = timer

    def _flush_pending(self) -> None:
        callback_path: str | None
        with self._lock:
            callback_path = self._pending_path
            self._pending_path = None
            self._timer = None
        if not callback_path:
            return
        try:
            self._on_change(callback_path)
        except Exception as exc:
            _log.warning("SkillDirWatcher callback failed for %s: %s", callback_path, exc)
