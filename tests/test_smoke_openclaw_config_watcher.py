#!/usr/bin/env python3
"""Smoke tests for OpenClaw-inspired config watcher.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path

from agenticx.core.config_watcher import ConfigWatcher


def _wait_until(predicate, timeout: float = 3.0, interval: float = 0.05) -> bool:  # noqa: ANN001
    start = time.time()
    while time.time() - start <= timeout:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_config_watcher_triggers_callback_after_change(tmp_path: Path):
    config_path = tmp_path / "agenticx.yaml"
    config_path.write_text("name: demo\n", encoding="utf-8")

    changed: list[Path] = []
    watcher = ConfigWatcher(watch_paths=[config_path], debounce_ms=200)
    watcher.on_change(lambda path: changed.append(path))
    watcher.start()
    try:
        config_path.write_text("name: demo2\n", encoding="utf-8")
        assert _wait_until(lambda: len(changed) >= 1)
    finally:
        watcher.stop()

    assert any(p.resolve() == config_path.resolve() for p in changed)


def test_config_watcher_debounce_merges_rapid_writes(tmp_path: Path):
    config_path = tmp_path / "agenticx.yaml"
    config_path.write_text("name: demo\n", encoding="utf-8")

    changed: list[Path] = []
    watcher = ConfigWatcher(watch_paths=[config_path], debounce_ms=300)
    watcher.on_change(lambda path: changed.append(path))
    watcher.start()
    try:
        for i in range(5):
            config_path.write_text(f"name: demo{i}\n", encoding="utf-8")
            time.sleep(0.05)
        assert _wait_until(lambda: len(changed) >= 1)
        time.sleep(0.4)
    finally:
        watcher.stop()

    # Debounce should avoid callback storm for same file.
    assert len(changed) <= 2
