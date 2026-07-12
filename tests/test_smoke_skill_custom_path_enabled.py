#!/usr/bin/env python3
"""Smoke tests for skills.custom_paths enabled toggle.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import agenticx.tools.skill_bundle as skill_bundle


def test_normalize_custom_paths_legacy_strings_and_dicts():
    rows = skill_bundle._normalize_custom_paths_from_config(
        [
            "~/a/skills",
            {"path": "~/b/skills", "enabled": False},
            {"path": "~/a/skills", "enabled": False},  # dup ignored
            "  ",
        ]
    )
    assert rows == [
        {"path": "~/a/skills", "enabled": True},
        {"path": "~/b/skills", "enabled": False},
    ]


def test_build_skill_search_paths_skips_disabled_custom(monkeypatch, tmp_path: Path):
    enabled = tmp_path / "on"
    disabled = tmp_path / "off"
    enabled.mkdir()
    disabled.mkdir()

    monkeypatch.setattr(
        skill_bundle,
        "get_skill_scan_settings_from_config",
        lambda: (
            [],
            [
                {"path": str(enabled), "enabled": True},
                {"path": str(disabled), "enabled": False},
            ],
            {},
            [],
        ),
    )
    paths = skill_bundle.build_skill_search_paths()
    resolved = {str(p.resolve(strict=False)) for p in paths}
    assert str(enabled.resolve()) in resolved
    assert str(disabled.resolve()) not in resolved
