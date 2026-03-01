#!/usr/bin/env python3
"""Smoke tests for tool policy YAML hot reload.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path

from agenticx.core.config_watcher import ConfigWatcher
from agenticx.core.hooks.tool_hooks import enable_policy_hot_reload
from agenticx.core.hooks.tool_hooks import load_policy_from_yaml
from agenticx.tools.policy import ToolPolicyStack
import pytest


def _wait_until(predicate, timeout: float = 3.0, interval: float = 0.05) -> bool:  # noqa: ANN001
    start = time.time()
    while time.time() - start <= timeout:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_load_policy_from_yaml_and_hot_reload(tmp_path: Path):
    policy_path = tmp_path / "tool-policy.yaml"
    policy_path.write_text(
        (
            "default_allow: false\n"
            "layers:\n"
            "  - name: base\n"
            "    allow: [web_search]\n"
            "    deny: [dangerous_*]\n"
        ),
        encoding="utf-8",
    )

    stack = load_policy_from_yaml(policy_path)
    assert stack.is_allowed("web_search") is True
    assert stack.is_allowed("dangerous_delete") is False

    watcher = ConfigWatcher(watch_paths=[policy_path], debounce_ms=200)
    enable_policy_hot_reload(policy_stack=stack, policy_yaml_path=policy_path, watcher=watcher)
    watcher.start()
    try:
        policy_path.write_text(
            (
                "default_allow: false\n"
                "layers:\n"
                "  - name: base\n"
                "    allow: [web_fetch]\n"
                "    deny: [dangerous_*]\n"
            ),
            encoding="utf-8",
        )
        assert _wait_until(lambda: stack.is_allowed("web_fetch") is True)
    finally:
        watcher.stop()

    assert stack.is_allowed("web_search") is False
    assert stack.is_allowed("web_fetch") is True


def test_invalid_policy_yaml_keeps_previous_stack(tmp_path: Path):
    policy_path = tmp_path / "tool-policy.yaml"
    policy_path.write_text(
        "layers:\n  - name: base\n    allow: [web_search]\n",
        encoding="utf-8",
    )
    stack: ToolPolicyStack = load_policy_from_yaml(policy_path)
    assert stack.is_allowed("web_search") is True

    watcher = ConfigWatcher(watch_paths=[policy_path], debounce_ms=200)
    enable_policy_hot_reload(policy_stack=stack, policy_yaml_path=policy_path, watcher=watcher)
    watcher.start()
    try:
        policy_path.write_text("layers: [\n", encoding="utf-8")
        time.sleep(0.5)
    finally:
        watcher.stop()

    # Existing stack should still be valid after broken reload.
    assert stack.is_allowed("web_search") is True


def test_invalid_policy_field_type_raises(tmp_path: Path):
    policy_path = tmp_path / "tool-policy.yaml"
    policy_path.write_text(
        (
            "layers:\n"
            "  - name: base\n"
            "    allow: web_search\n"
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        load_policy_from_yaml(policy_path)


def test_invalid_default_allow_type_raises(tmp_path: Path):
    policy_path = tmp_path / "tool-policy.yaml"
    policy_path.write_text(
        (
            "default_allow: \"false\"\n"
            "layers:\n"
            "  - name: base\n"
            "    allow: [web_search]\n"
        ),
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        load_policy_from_yaml(policy_path)


def test_list_top_level_policy_is_supported(tmp_path: Path):
    policy_path = tmp_path / "tool-policy.yaml"
    policy_path.write_text(
        (
            "- name: base\n"
            "  allow: [web_search]\n"
            "  deny: [dangerous_*]\n"
        ),
        encoding="utf-8",
    )
    stack = load_policy_from_yaml(policy_path)
    assert stack.is_allowed("web_search") is True
    assert stack.is_allowed("dangerous_run") is False
