"""Smoke tests for code_index (Semble backend)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

pytest.importorskip("semble")

from agenticx.code_index.backends.semble_backend import SembleCodeIndexBackend, format_error_summary
from agenticx.code_index.config import CodeIndexConfig
from agenticx.code_index import manager as code_index_manager
from agenticx.code_index.manager import CodeIndexManager
from agenticx.code_index.state import IndexStatus
from agenticx.code_index.tools import (
    dispatch_code_index_clear,
    dispatch_code_index_create,
    dispatch_code_index_status,
    dispatch_code_search,
)


class _FakeSession:
    def __init__(self, root: Path):
        self.taskspaces = [{"id": "ws", "path": str(root)}]


def test_format_error_summary_includes_type():
    try:
        raise ValueError("bad")
    except ValueError as exc:
        summary = format_error_summary(exc)
    assert "ValueError" in summary
    assert "bad" in summary


def test_build_and_search_hybrid(tiny_codebase, mock_encoder):
    backend = SembleCodeIndexBackend(encoder=mock_encoder, include_text_files=False)
    backend.build(tiny_codebase, on_progress=lambda d, t: None)
    hits = backend.search("delegate avatar session", top_k=5, strategy="hybrid")
    assert hits
    paths = {h.file_path for h in hits}
    assert any("main.py" in p for p in paths)


def test_search_three_modes(tiny_codebase, mock_encoder):
    backend = SembleCodeIndexBackend(encoder=mock_encoder, include_text_files=False)
    backend.build(tiny_codebase, on_progress=lambda d, t: None)
    for mode in ("hybrid", "semantic", "bm25"):
        hits = backend.search("helper", top_k=3, strategy=mode)
        assert isinstance(hits, list)


def test_manager_encoder_singleton(tiny_codebase, mock_encoder):
    mgr = CodeIndexManager.instance()
    cfg = CodeIndexConfig(enabled=True, semble_model="test-model")

    with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
        mgr._run_build(tiny_codebase, wait=True)
        mgr._run_build(tiny_codebase, wait=True)
    assert code_index_manager.encoder_load_count_for_tests() == 1


def test_dispatch_code_search_enabled(tiny_codebase, mock_encoder, monkeypatch):
    monkeypatch.setenv("AGX_DESKTOP_UNRESTRICTED_FS", "1")
    cfg = CodeIndexConfig(enabled=True)
    session = _FakeSession(tiny_codebase)

    with patch("agenticx.code_index.tools.is_enabled", return_value=True):
        with patch("agenticx.code_index.tools.load_code_index_config", return_value=cfg):
            with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
                raw = dispatch_code_search(
                    {"codebase_path": str(tiny_codebase), "query": "delegate_to_avatar"},
                    session,
                )
    data = json.loads(raw)
    assert "results" in data
    assert data["results"]


def test_code_index_create_and_status(tiny_codebase, mock_encoder, monkeypatch):
    monkeypatch.setenv("AGX_DESKTOP_UNRESTRICTED_FS", "1")
    cfg = CodeIndexConfig(enabled=True)
    session = _FakeSession(tiny_codebase)

    with patch("agenticx.code_index.tools.is_enabled", return_value=True):
        with patch("agenticx.code_index.tools.load_code_index_config", return_value=cfg):
            with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
                created = json.loads(
                    dispatch_code_index_create({"codebase_path": str(tiny_codebase)}, session)
                )
                assert "task_id" in created
                mgr = CodeIndexManager.instance()
                task = mgr.wait_until_indexed(tiny_codebase, timeout=60.0)
                assert task.status == IndexStatus.INDEXED
                status = json.loads(
                    dispatch_code_index_status({"codebase_path": str(tiny_codebase)}, session)
                )
                assert status["status"] == "indexed"
                assert status["total_chunks"] > 0


def test_clear_and_rebuild(tiny_codebase, mock_encoder, monkeypatch):
    monkeypatch.setenv("AGX_DESKTOP_UNRESTRICTED_FS", "1")
    cfg = CodeIndexConfig(enabled=True)
    session = _FakeSession(tiny_codebase)

    with patch("agenticx.code_index.tools.is_enabled", return_value=True):
        with patch("agenticx.code_index.tools.load_code_index_config", return_value=cfg):
            with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
                dispatch_code_search(
                    {"codebase_path": str(tiny_codebase), "query": "helper"},
                    session,
                )
                dispatch_code_index_clear({"codebase_path": str(tiny_codebase)}, session)
                status = json.loads(
                    dispatch_code_index_status({"codebase_path": str(tiny_codebase)}, session)
                )
                assert status["status"] == "pending"
                raw = dispatch_code_search(
                    {"codebase_path": str(tiny_codebase), "query": "helper"},
                    session,
                )
                data = json.loads(raw)
                assert data["results"]


def test_missing_codebase_path(tiny_codebase, monkeypatch):
    monkeypatch.setenv("AGX_DESKTOP_UNRESTRICTED_FS", "1")
    session = _FakeSession(tiny_codebase)
    with patch("agenticx.code_index.tools.is_enabled", return_value=True):
        raw = dispatch_code_search(
            {"codebase_path": str(tiny_codebase / "nope"), "query": "x"},
            session,
        )
    assert raw.startswith("ERROR:")


def test_large_file_skipped(tmp_path, mock_encoder):
    root = tmp_path / "big"
    root.mkdir()
    (root / "huge.py").write_text("x" * 2_000_000, encoding="utf-8")
    (root / "small.py").write_text("def ok(): pass\n", encoding="utf-8")
    backend = SembleCodeIndexBackend(encoder=mock_encoder)
    backend.build(root, on_progress=lambda d, t: None)
    hits = backend.search("ok", top_k=5, strategy="bm25")
    assert any("small.py" in h.file_path for h in hits)


def test_hf_offline_error_readable(monkeypatch, tiny_codebase):
    def _boom(_name: str):
        raise OSError("无法连接 Hugging Face")

    monkeypatch.setattr("agenticx.code_index.manager.load_encoder", _boom)
    cfg = CodeIndexConfig(enabled=True)
    with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
        mgr = CodeIndexManager.instance()
        task = mgr._run_build(tiny_codebase, wait=True)
    assert task.status == IndexStatus.INDEXFAILED
    assert task.error_summary
    assert "OSError" in task.error_summary or "Hugging" in task.error_summary


def test_workspace_isolation(tmp_path, mock_encoder, monkeypatch):
    monkeypatch.setenv("AGX_DESKTOP_UNRESTRICTED_FS", "1")
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir()
    b.mkdir()
    (a / "only_a.py").write_text("def only_in_a(): pass\n", encoding="utf-8")
    (b / "only_b.py").write_text("def only_in_b(): pass\n", encoding="utf-8")
    cfg = CodeIndexConfig(enabled=True)
    with patch("agenticx.code_index.manager.load_code_index_config", return_value=cfg):
        mgr = CodeIndexManager.instance()
        mgr._run_build(a, wait=True)
        mgr._run_build(b, wait=True)
        hits_a, _, _ = mgr.search(a, "only_in_a", wait_for_index=True)
        hits_b, _, _ = mgr.search(b, "only_in_b", wait_for_index=True)
    assert any("only_a" in h.file_path for h in hits_a)
    assert any("only_b" in h.file_path for h in hits_b)
