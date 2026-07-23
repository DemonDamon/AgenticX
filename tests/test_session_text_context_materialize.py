#!/usr/bin/env python3
"""Tests for session text context_files materialization.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.studio.chat_attachments import (
    materialize_session_text_context_files,
    session_uploads_dir,
)


def test_materialize_bare_html_name_to_session_uploads(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    sid = "sess-html-1"
    body = "<!DOCTYPE html><html><body>todo</body></html>"
    out = materialize_session_text_context_files(
        sid,
        {"断舍离待办清单.html": body},
    )
    assert len(out) == 1
    key = next(iter(out))
    assert key != "断舍离待办清单.html"
    dest = Path(key)
    assert dest.name == "断舍离待办清单.html"
    assert dest.is_file()
    assert dest.read_text(encoding="utf-8") == body
    assert out[key] == body
    assert dest.parent == session_uploads_dir(sid)


def test_skip_readable_absolute_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    src = tmp_path / "existing.html"
    src.write_text("<html>ok</html>", encoding="utf-8")
    body = src.read_text(encoding="utf-8")
    out = materialize_session_text_context_files(
        "sess-2",
        {str(src): body},
    )
    assert list(out.keys()) == [str(src)]
    assert not (session_uploads_dir("sess-2")).exists() or not any(
        session_uploads_dir("sess-2").iterdir()
    )


def test_skip_placeholders_and_skill_keys(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    payload = {
        "doc.pdf": "[附件] doc.pdf",
        "skill:demo": "skill body",
        "@dir:workspace:/tmp/ws": "",
        "pic.png": "[图片文件]",
    }
    out = materialize_session_text_context_files("sess-3", payload)
    assert out["doc.pdf"] == "[附件] doc.pdf"
    assert out["skill:demo"] == "skill body"
    assert "pic.png" in out
    uploads = session_uploads_dir("sess-3")
    assert not uploads.exists() or not any(uploads.iterdir())
