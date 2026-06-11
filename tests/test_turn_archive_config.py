#!/usr/bin/env python3
"""Tests for turn archive configuration.

Author: Damon Li
"""

from __future__ import annotations

import os

from agenticx.memory.turn_archive_config import DEFAULTS, is_turn_archive_enabled, load_turn_archive_config


def test_turn_archive_defaults_disabled(monkeypatch) -> None:
    monkeypatch.delenv("AGX_TURN_ARCHIVE_ENABLED", raising=False)
    cfg = load_turn_archive_config()
    assert cfg["enabled"] is False
    assert cfg["min_chunk_chars"] == DEFAULTS["min_chunk_chars"]
    assert is_turn_archive_enabled() is False


def test_turn_archive_env_override(monkeypatch) -> None:
    monkeypatch.setenv("AGX_TURN_ARCHIVE_ENABLED", "1")
    assert is_turn_archive_enabled() is True
