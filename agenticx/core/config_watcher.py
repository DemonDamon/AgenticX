#!/usr/bin/env python3
"""Config file watcher with debounce callbacks.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set

from watchdog.events import FileSystemEvent
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

ConfigChangeCallback = Callable[[Path], None]


class _DebouncedEventHandler(FileSystemEventHandler):
    """Watchdog handler delegating events to ConfigWatcher."""

    def __init__(self, watcher: "ConfigWatcher") -> None:
        super().__init__()
        self._watcher = watcher

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        if event.event_type == "opened":
            return
        self._watcher._schedule_event(Path(event.src_path))


class ConfigWatcher:
    """Watch config files/directories and dispatch debounced callbacks."""

    def __init__(
        self,
        watch_paths: List[Path],
        debounce_ms: int = 500,
        event_loop: Optional[asyncio.AbstractEventLoop] = None,
    ) -> None:
        self.watch_paths = [Path(p) for p in watch_paths]
        self.debounce_ms = debounce_ms
        self._event_loop = event_loop
        self._callbacks: List[ConfigChangeCallback] = []
        self._observer: Optional[Observer] = None
        self._handler = _DebouncedEventHandler(self)
        self._timer_by_path: Dict[Path, threading.Timer] = {}
        self._watched_dirs: Set[Path] = set()
        self._running = False
        self._lock = threading.RLock()

    def on_change(self, callback: ConfigChangeCallback) -> None:
        with self._lock:
            self._callbacks.append(callback)

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._observer = Observer()
            self._watched_dirs = self._resolve_watch_dirs()
            for directory in self._watched_dirs:
                if not directory.exists():
                    continue
                self._observer.schedule(self._handler, str(directory), recursive=True)
            self._observer.start()
            self._running = True
            logger.info("ConfigWatcher started for %d path(s)", len(self._watched_dirs))

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            for timer in self._timer_by_path.values():
                timer.cancel()
            self._timer_by_path.clear()
            if self._observer:
                self._observer.stop()
                self._observer.join(timeout=2)
            self._observer = None
            self._running = False
            logger.info("ConfigWatcher stopped")

    def __enter__(self) -> "ConfigWatcher":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        _ = exc_type, exc, tb
        self.stop()
        return False

    def _resolve_watch_dirs(self) -> Set[Path]:
        dirs: Set[Path] = set()
        for item in self.watch_paths:
            abs_item = item.resolve() if not item.is_absolute() else item
            if abs_item.is_dir():
                dirs.add(abs_item)
            else:
                dirs.add(abs_item.parent)
        return dirs

    def _is_relevant(self, changed_path: Path) -> bool:
        try:
            abs_changed = changed_path.resolve()
        except Exception:
            return False

        for watched in self.watch_paths:
            try:
                abs_watch = watched.resolve() if not watched.is_absolute() else watched
                if abs_watch.is_dir():
                    try:
                        abs_changed.relative_to(abs_watch)
                        return True
                    except ValueError:
                        continue
                if not abs_watch.is_dir() and abs_watch == abs_changed:
                    return True
            except Exception:
                continue
        return False

    def _schedule_event(self, changed_path: Path) -> None:
        if not self._is_relevant(changed_path):
            return
        with self._lock:
            existing = self._timer_by_path.get(changed_path)
            if existing:
                existing.cancel()
            timer = threading.Timer(
                self.debounce_ms / 1000.0,
                self._dispatch_change,
                args=(changed_path,),
            )
            self._timer_by_path[changed_path] = timer
            timer.start()

    def _dispatch_change(self, changed_path: Path) -> None:
        with self._lock:
            self._timer_by_path.pop(changed_path, None)
            callbacks = list(self._callbacks)

        for callback in callbacks:
            try:
                if self._event_loop and self._event_loop.is_running():
                    self._event_loop.call_soon_threadsafe(callback, changed_path)
                else:
                    callback(changed_path)
            except Exception as exc:
                logger.warning("ConfigWatcher callback failed for %s: %s", changed_path, exc)
