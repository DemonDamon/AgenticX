#!/usr/bin/env python3
"""Smoke tests for SessionManager atomic snapshot writes.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.studio.session_manager import SessionManager


@pytest.fixture
def manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SessionManager:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    m = SessionManager()
    m._sessions_root = str(tmp_path / ".agenticx" / "sessions")
    m._taskspaces_root = str(tmp_path / ".agenticx" / "taskspaces")
    return m


def test_atomic_snapshot_writes_and_cleanup(manager: SessionManager, tmp_path: Path) -> None:
    sid = "s1"
    managed = manager.create(session_id=sid)
    managed.studio_session.context_files = {str(tmp_path / "a.txt"): "a"}

    manager._save_messages_snapshot(sid, [{"role": "user", "content": "hello"}])
    manager._save_agent_messages_snapshot(sid, [{"x": i} for i in range(50)])
    manager._save_context_refs(sid, managed.studio_session)
    manager._save_global_taskspaces([{"id": "d", "label": "default", "path": str(tmp_path)}])

    messages_path = Path(manager._messages_path(sid))
    agent_messages_path = Path(manager._agent_messages_path(sid))
    refs_path = Path(manager._context_refs_path(sid))
    global_path = Path(manager._global_taskspaces_path())

    assert json.loads(messages_path.read_text(encoding="utf-8")) == [{"role": "user", "content": "hello"}]
    assert len(json.loads(agent_messages_path.read_text(encoding="utf-8"))) == 40
    assert json.loads(refs_path.read_text(encoding="utf-8")) == [str(tmp_path / "a.txt")]
    payload = json.loads(global_path.read_text(encoding="utf-8"))
    scopes = payload.get("scopes", {}) if isinstance(payload, dict) else {}
    meta_rows = scopes.get("meta", [])
    assert meta_rows and meta_rows[0]["id"] == "d"

    tmp_files = list(Path(manager._sessions_root).rglob("*.agx.tmp"))
    assert not tmp_files


def test_context_refs_restore_binary_document_as_read_only_reference(
    manager: SessionManager, tmp_path: Path
) -> None:
    sid = "binary-ref"
    document = tmp_path / "manual.docx"
    document.write_bytes(b"PK\x03\x04\xff\xfe")
    source = manager.create(session_id=sid).studio_session
    source.context_files = {str(document): "parsed body"}
    manager._save_context_refs(sid, source)

    restored = manager.create(session_id="restored").studio_session
    manager._load_context_refs(sid, restored)

    assert restored.context_files == {
        str(document): f"[文件引用] {document}",
    }
