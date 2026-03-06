#!/usr/bin/env python3
"""Smoke test for custom workspace hook template.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.hooks.loader import discover_hooks


def test_workspace_hook_template_is_discoverable():
    repo_root = Path(__file__).resolve().parents[1]
    source_hook = (
        repo_root
        / "examples"
        / "hooks_custom_template"
        / "hooks"
        / "notify-on-new"
    )
    assert (source_hook / "HOOK.yaml").exists()
    assert (source_hook / "handler.py").exists()

    entries = discover_hooks(repo_root / "examples" / "hooks_custom_template")
    names = {entry.name for entry in entries}
    assert "notify-on-new" in names

