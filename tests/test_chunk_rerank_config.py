#!/usr/bin/env python3
"""Tests for chunk rerank configuration.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.memory.turn_archive_config import CHUNK_RERANK_DEFAULTS, load_chunk_rerank_config


def test_chunk_rerank_defaults_disabled(monkeypatch) -> None:
    monkeypatch.delenv("AGX_CHUNK_RERANK_ENABLED", raising=False)
    cfg = load_chunk_rerank_config()
    assert cfg["enabled"] is False
    assert cfg["halflife_days"] == CHUNK_RERANK_DEFAULTS["halflife_days"]


def test_chunk_rerank_env_override(monkeypatch) -> None:
    monkeypatch.setenv("AGX_CHUNK_RERANK_ENABLED", "1")
    cfg = load_chunk_rerank_config()
    assert cfg["enabled"] is True

    monkeypatch.setenv("AGX_CHUNK_RERANK_ENABLED", "0")
    cfg = load_chunk_rerank_config()
    assert cfg["enabled"] is False
