#!/usr/bin/env python3
"""Tests for dynamic KB retrieval policy prompt block."""

from __future__ import annotations

from types import SimpleNamespace

import agenticx.studio.kb as kb_mod
from agenticx.runtime.prompts.meta_agent import _build_kb_retrieval_policy_block


def test_kb_policy_block_respects_enabled_false(monkeypatch) -> None:
    class _DummyManager:
        @staticmethod
        def instance():
            return _DummyManager()

        def read_config(self):
            return SimpleNamespace(
                enabled=False,
                retrieval=SimpleNamespace(top_k=20, mode="always"),
            )

    monkeypatch.setattr(kb_mod, "KBManager", _DummyManager)
    block = _build_kb_retrieval_policy_block()
    assert "禁用状态" in block
    assert "不要主动调用 `knowledge_search`" in block


def test_kb_policy_block_renders_auto_mode_and_top_k(monkeypatch) -> None:
    class _DummyManager:
        @staticmethod
        def instance():
            return _DummyManager()

        def read_config(self):
            return SimpleNamespace(
                enabled=True,
                retrieval=SimpleNamespace(top_k=17, mode="auto"),
            )

    monkeypatch.setattr(kb_mod, "KBManager", _DummyManager)
    block = _build_kb_retrieval_policy_block()
    assert "当前检索模式：`auto`" in block
    assert "默认 Top-K：`17`" in block
    assert "智能检索（auto）" in block
    # Manual mode has been folded into auto; prompt must never emit it.
    assert "manual" not in block.lower().replace("knowledge_search", "")


def test_kb_policy_block_folds_legacy_manual_into_auto(monkeypatch) -> None:
    class _DummyManager:
        @staticmethod
        def instance():
            return _DummyManager()

        def read_config(self):
            return SimpleNamespace(
                enabled=True,
                retrieval=SimpleNamespace(top_k=9, mode="manual"),
            )

    monkeypatch.setattr(kb_mod, "KBManager", _DummyManager)
    block = _build_kb_retrieval_policy_block()
    assert "当前检索模式：`auto`" in block
    assert "智能检索（auto）" in block


def test_kb_policy_block_renders_always_mode(monkeypatch) -> None:
    class _DummyManager:
        @staticmethod
        def instance():
            return _DummyManager()

        def read_config(self):
            return SimpleNamespace(
                enabled=True,
                retrieval=SimpleNamespace(top_k=12, mode="always"),
            )

    monkeypatch.setattr(kb_mod, "KBManager", _DummyManager)
    block = _build_kb_retrieval_policy_block()
    assert "当前检索模式：`always`" in block
    assert "始终检索（always）" in block
