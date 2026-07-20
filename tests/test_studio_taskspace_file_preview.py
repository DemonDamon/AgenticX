#!/usr/bin/env python3
"""Tests for taskspace file preview classification.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.memory.session_store import SessionStore
from agenticx.studio.session_manager import SessionManager, classify_taskspace_file


def test_classify_python_as_code(tmp_path: Path) -> None:
    file_path = tmp_path / "main.py"
    file_path.write_text("print('hello')\n", encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "code"
    assert info["is_binary"] is False
    assert info["preview_supported"] is True


def test_classify_markdown(tmp_path: Path) -> None:
    file_path = tmp_path / "README.md"
    file_path.write_text("# Title\n\nBody\n", encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "markdown"
    assert info["is_binary"] is False
    assert info["preview_supported"] is True


def test_classify_png_as_image(tmp_path: Path) -> None:
    file_path = tmp_path / "logo.png"
    file_path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "image"
    assert info["is_binary"] is True
    assert info["preview_supported"] is True


def test_classify_pdf(tmp_path: Path) -> None:
    file_path = tmp_path / "doc.pdf"
    file_path.write_bytes(b"%PDF-1.4\n" + b"\x00" * 32)
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "pdf"
    assert info["is_binary"] is True
    assert info["preview_supported"] is True


def test_classify_xlsx_as_office(tmp_path: Path) -> None:
    file_path = tmp_path / "sheet.xlsx"
    file_path.write_bytes(b"PK\x03\x04" + b"\x00" * 32)
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "office"
    assert info["is_binary"] is True
    assert info["preview_supported"] is True


def test_classify_svg_as_image(tmp_path: Path) -> None:
    file_path = tmp_path / "chart.svg"
    file_path.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>\n', encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "image"
    assert info["mime_type"] == "image/svg+xml"
    assert info["preview_supported"] is True


def test_classify_mmd_as_markdown(tmp_path: Path) -> None:
    file_path = tmp_path / "flow.mmd"
    file_path.write_text("flowchart LR\n  A --> B\n", encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "markdown"
    assert info["is_binary"] is False
    assert info["preview_supported"] is True


def test_classify_jsonl_as_textual(tmp_path: Path) -> None:
    file_path = tmp_path / "submission.jsonl"
    file_path.write_text('{"id": 1}\n', encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "text"
    assert info["is_binary"] is False
    assert info["preview_supported"] is True


def test_classify_rust_as_code(tmp_path: Path) -> None:
    file_path = tmp_path / "main.rs"
    file_path.write_text("fn main() {}\n", encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "code"
    assert info["is_binary"] is False


def test_classify_log_as_text(tmp_path: Path) -> None:
    file_path = tmp_path / "app.log"
    file_path.write_text("2026-06-17 INFO started\n", encoding="utf-8")
    info = classify_taskspace_file(file_path)
    assert info["preview_kind"] == "text"
    assert info["is_binary"] is False


@pytest.fixture()
def preview_manager(tmp_path: Path) -> tuple[SessionManager, str, str]:
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    taskspaces_root = tmp_path / "taskspaces"
    manager = SessionManager()
    manager._session_store = store  # test override
    manager._sessions_root = str(sessions_root)
    manager._taskspaces_root = str(taskspaces_root)
    sid = "preview-session"
    manager.create(session_id=sid)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    taskspace = manager.add_taskspace(sid, path=str(workspace), label="ws")
    return manager, sid, taskspace["id"]


def test_read_taskspace_file_text_has_content(
    preview_manager: tuple[SessionManager, str, str], tmp_path: Path
) -> None:
    manager, sid, taskspace_id = preview_manager
    workspace = tmp_path / "workspace"
    (workspace / "main.py").write_text("x = 1\n", encoding="utf-8")
    payload = manager.read_taskspace_file(sid, taskspace_id, "main.py")
    assert payload["preview_kind"] == "code"
    assert payload["is_binary"] is False
    assert payload["content"] == "x = 1\n"


def test_read_taskspace_file_markdown_has_content(
    preview_manager: tuple[SessionManager, str, str], tmp_path: Path
) -> None:
    manager, sid, taskspace_id = preview_manager
    workspace = tmp_path / "workspace"
    (workspace / "notes.md").write_text("# Hi\n", encoding="utf-8")
    payload = manager.read_taskspace_file(sid, taskspace_id, "notes.md")
    assert payload["preview_kind"] == "markdown"
    assert payload["is_binary"] is False
    assert "content" in payload
    assert payload["content"] == "# Hi\n"


def test_read_taskspace_file_png_has_no_content(
    preview_manager: tuple[SessionManager, str, str], tmp_path: Path
) -> None:
    manager, sid, taskspace_id = preview_manager
    workspace = tmp_path / "workspace"
    (workspace / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16)
    payload = manager.read_taskspace_file(sid, taskspace_id, "pic.png")
    assert payload["preview_kind"] == "image"
    assert payload["is_binary"] is True
    assert "content" not in payload


def test_read_taskspace_file_pdf_has_no_content(
    preview_manager: tuple[SessionManager, str, str], tmp_path: Path
) -> None:
    manager, sid, taskspace_id = preview_manager
    workspace = tmp_path / "workspace"
    (workspace / "paper.pdf").write_bytes(b"%PDF-1.4\n" + b"\x00" * 16)
    payload = manager.read_taskspace_file(sid, taskspace_id, "paper.pdf")
    assert payload["preview_kind"] == "pdf"
    assert payload["is_binary"] is True
    assert "content" not in payload


def test_read_taskspace_file_xlsx_has_no_content(
    preview_manager: tuple[SessionManager, str, str], tmp_path: Path
) -> None:
    manager, sid, taskspace_id = preview_manager
    workspace = tmp_path / "workspace"
    (workspace / "book.xlsx").write_bytes(b"PK\x03\x04" + b"\x00" * 16)
    payload = manager.read_taskspace_file(sid, taskspace_id, "book.xlsx")
    assert payload["preview_kind"] == "office"
    assert payload["is_binary"] is True
    assert "content" not in payload
