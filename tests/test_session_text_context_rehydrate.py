#!/usr/bin/env python3
"""Retry rehydration of text context_files from session uploads / history.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.studio.chat_attachments import (
    materialize_session_text_context_files,
    patch_chat_history_attachment_source_paths,
    rehydrate_session_text_context_files,
    session_uploads_dir,
)


def test_materialize_keeps_original_basename(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    sid = "sess-name"
    body = "<html>todo</html>"
    out = materialize_session_text_context_files(
        sid, {"断舍离待办清单.html": body}
    )
    key = next(iter(out))
    assert Path(key).name == "断舍离待办清单.html"
    assert Path(key).read_text(encoding="utf-8") == body


def test_rehydrate_placeholder_from_uploads_by_basename(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    sid = "sess-retry"
    body = "<html>persisted</html>"
    materialized = materialize_session_text_context_files(
        sid, {"断舍离待办清单.html": body}
    )
    assert len(materialized) == 1

    # Retry payload: Desktop only has metadata → placeholder body.
    rehydrated = rehydrate_session_text_context_files(
        sid,
        {"断舍离待办清单.html": "[附件] 断舍离待办清单.html"},
    )
    assert len(rehydrated) == 1
    key = next(iter(rehydrated))
    assert Path(key).is_file()
    assert rehydrated[key] == body
    assert key.startswith(str(session_uploads_dir(sid)))


def test_rehydrate_from_history_source_path(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    sid = "sess-hist"
    uploads = session_uploads_dir(sid)
    uploads.mkdir(parents=True)
    dest = uploads / "page.html"
    dest.write_text("<html>from-history</html>", encoding="utf-8")
    history = [
        {
            "role": "user",
            "content": "beautify",
            "attachments": [
                {
                    "name": "page.html",
                    "source_path": str(dest),
                    "kind": "context_file",
                }
            ],
        }
    ]
    out = rehydrate_session_text_context_files(
        sid,
        {"page.html": "[附件] page.html"},
        chat_history=history,
    )
    assert out[str(dest)] == "<html>from-history</html>"


def test_patch_chat_history_source_paths(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.studio.chat_attachments._SESSIONS_ROOT",
        tmp_path / "sessions",
    )
    sid = "sess-patch"
    body = "<html>x</html>"
    cf = materialize_session_text_context_files(sid, {"a.html": body})
    history = [
        {
            "role": "user",
            "content": "go",
            "attachments": [
                {"name": "a.html", "source_path": "", "kind": "context_file"}
            ],
        }
    ]
    assert patch_chat_history_attachment_source_paths(history, cf) is True
    assert history[0]["attachments"][0]["source_path"] == next(iter(cf))
