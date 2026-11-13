#!/usr/bin/env python3
"""Unit tests for unified harness settings sync dispatcher."""

from __future__ import annotations

from pathlib import Path

from agenticx.harness.harness_settings_sync import maybe_sync_harness_settings


def test_builtin_never_syncs(monkeypatch, tmp_path: Path) -> None:
    called = {"n": 0}

    def boom(*_a, **_k):
        called["n"] += 1
        raise AssertionError("should not sync")

    monkeypatch.setattr(
        "agenticx.harness.claude_code_settings.maybe_sync_claude_code_settings",
        boom,
        raising=False,
    )
    assert maybe_sync_harness_settings("python-agent", "openai", "gpt") is None
    assert maybe_sync_harness_settings("builtin", "openai", "gpt") is None
    assert called["n"] == 0


def test_dispatches_codex(monkeypatch) -> None:
    seen = {}

    def fake(hid, provider, model, **kwargs):
        seen["args"] = (hid, provider, model)
        return {"model": model}

    monkeypatch.setattr(
        "agenticx.harness.codex_settings.maybe_sync_codex_settings",
        fake,
    )
    out = maybe_sync_harness_settings("codex", "bailian", "qwen3.7-plus")
    assert out == {"model": "qwen3.7-plus"}
    assert seen["args"][0] == "codex"
