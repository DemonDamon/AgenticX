#!/usr/bin/env python3
"""E2E: config hot reload and skill bundle auto refresh.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path

from agenticx.core.config_watcher import ConfigWatcher
from agenticx.deploy.config import load_config
from agenticx.tools.skill_bundle import SkillBundleLoader


def _wait_until(predicate, timeout: float = 4.0, interval: float = 0.05) -> bool:  # noqa: ANN001
    start = time.time()
    while time.time() - start <= timeout:
        if predicate():
            return True
        time.sleep(interval)
    return False


def _write_skill(skill_root: Path, name: str) -> None:
    path = skill_root / name
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text(
        (
            "---\n"
            f"name: {name}\n"
            "description: hot reload test\n"
            "---\n\n"
            "# Skill\n"
            "Body.\n"
        ),
        encoding="utf-8",
    )


def test_e2e_config_hot_reload(tmp_path: Path):
    config_path = tmp_path / "agenticx.yaml"
    config_path.write_text(
        (
            "version: 1.0.0\n"
            "name: demo-a\n"
            "description: first\n"
            "deployments: []\n"
            "environments: {}\n"
            "variables: {}\n"
            "hooks: {}\n"
            "metadata: {}\n"
        ),
        encoding="utf-8",
    )
    config = load_config(path=config_path, auto_watch=True)
    assert config is not None
    assert config.name == "demo-a"

    try:
        config_path.write_text(
            (
                "version: 1.0.0\n"
                "name: demo-b\n"
                "description: second\n"
                "deployments: []\n"
                "environments: {}\n"
                "variables: {}\n"
                "hooks: {}\n"
                "metadata: {}\n"
            ),
            encoding="utf-8",
        )
        assert _wait_until(lambda: config.name == "demo-b")
    finally:
        config.unwatch()


def test_e2e_skill_bundle_auto_refresh(tmp_path: Path):
    skill_root = tmp_path / "skills"
    skill_root.mkdir(parents=True, exist_ok=True)
    _write_skill(skill_root, "skill-a")

    watcher = ConfigWatcher(watch_paths=[skill_root], debounce_ms=200)
    loader = SkillBundleLoader(search_paths=[skill_root], config_watcher=watcher)
    watcher.start()
    try:
        initial = [item.name for item in loader.scan()]
        assert "skill-a" in initial

        _write_skill(skill_root, "skill-b")
        assert _wait_until(lambda: loader.get_skill("skill-b") is not None)
    finally:
        watcher.stop()
