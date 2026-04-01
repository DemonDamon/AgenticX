#!/usr/bin/env python3
"""Smoke tests for skill directory watcher.

Author: Damon Li
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from agenticx.extensions.skill_watcher import SkillDirWatcher


def test_skill_watcher_triggers_on_skill_md(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    calls: list[str] = []
    done = threading.Event()

    def _on_change(path: str) -> None:
        calls.append(path)
        done.set()

    watcher = SkillDirWatcher(skills_root, _on_change, debounce_s=0.1)
    watcher.start()
    try:
        target = skills_root / "demo" / "SKILL.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("---\nname: demo\ndescription: demo\n---\n", encoding="utf-8")
        assert done.wait(timeout=3.0)
        assert calls
        assert calls[-1].endswith("SKILL.md")
    finally:
        watcher.stop()


def test_skill_watcher_ignores_non_skill_files(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    calls: list[str] = []
    watcher = SkillDirWatcher(skills_root, lambda path: calls.append(path), debounce_s=0.1)
    watcher.start()
    try:
        data = skills_root / "demo" / "README.md"
        data.parent.mkdir(parents=True, exist_ok=True)
        data.write_text("# ignore", encoding="utf-8")
        time.sleep(0.4)
        assert calls == []
    finally:
        watcher.stop()


def test_skill_watcher_debounce_merges_rapid_writes(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    count = {"n": 0}
    done = threading.Event()

    def _on_change(path: str) -> None:
        count["n"] += 1
        done.set()

    watcher = SkillDirWatcher(skills_root, _on_change, debounce_s=0.2)
    watcher.start()
    try:
        target = skills_root / "demo" / "SKILL.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        for idx in range(3):
            target.write_text(
                f"---\nname: demo\ndescription: d{idx}\n---\n",
                encoding="utf-8",
            )
            time.sleep(0.05)
        assert done.wait(timeout=3.0)
        time.sleep(0.35)
        assert count["n"] == 1
    finally:
        watcher.stop()


def test_skill_watcher_triggers_on_deleted_skill_md(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    done = threading.Event()

    def _on_change(path: str) -> None:
        if path.endswith("SKILL.md"):
            done.set()

    watcher = SkillDirWatcher(skills_root, _on_change, debounce_s=0.1)
    watcher.start()
    try:
        target = skills_root / "demo" / "SKILL.md"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("---\nname: demo\ndescription: d\n---\n", encoding="utf-8")
        assert done.wait(timeout=3.0)
        done.clear()
        target.unlink()
        assert done.wait(timeout=3.0)
    finally:
        watcher.stop()
