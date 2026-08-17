#!/usr/bin/env python3
"""Smoke tests: file read/edit staleness guard (module 4).

Author: Damon Li
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.runtime.file_state import FileStateTracker


@pytest.fixture
def auto_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _yes(*_a: object, **_k: object) -> bool:
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _yes)


def _session_for(tmp_path: Path) -> StudioSession:
    session = StudioSession()
    session.workspace_dir = str(tmp_path)
    return session


def test_tracker_detects_mtime_change() -> None:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "f.txt"
        p.write_text("hello", encoding="utf-8")
        tr = FileStateTracker()
        tr.record_read(str(p), "hello")
        p.write_text("world", encoding="utf-8")
        err = tr.check_staleness(str(p))
        assert err is not None
        assert "file_read" in err


def test_refresh_from_disk_clears_staleness_after_own_write() -> None:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "f.txt"
        p.write_text("hello", encoding="utf-8")
        tr = FileStateTracker()
        tr.record_read(str(p), "hello")
        p.write_text("world", encoding="utf-8")
        assert tr.check_staleness(str(p)) is not None
        tr.refresh_from_disk(str(p))
        assert tr.check_staleness(str(p)) is None


def test_sliced_file_read_refreshes_snapshot(tmp_path: Path) -> None:
    target = tmp_path / "report.md"
    target.write_text("line1\nline2\nline3\n", encoding="utf-8")
    session = _session_for(tmp_path)
    session.file_state_tracker.record_read(str(target), "line1\nline2\nline3\n")
    target.write_text("line1\nCHANGED\nline3\n", encoding="utf-8")
    assert session.file_state_tracker.check_staleness(str(target)) is not None

    out = agent_tools.dispatch_tool(
        "file_read",
        {"path": str(target), "start_line": 2, "end_line": 2},
        session,
    )
    assert "CHANGED" in out
    assert session.file_state_tracker.check_staleness(str(target)) is None


def test_consecutive_file_edits_same_file_not_stale(
    auto_confirm: None, tmp_path: Path
) -> None:
    target = tmp_path / "report.md"
    target.write_text("# Title\n\nbody\n\n## 3.1\nflow\n", encoding="utf-8")
    session = _session_for(tmp_path)

    read = agent_tools.dispatch_tool("file_read", {"path": str(target)}, session)
    assert "Title" in read

    first = agent_tools.dispatch_tool(
        "file_edit",
        {
            "path": str(target),
            "old_text": "# Title\n",
            "new_text": "# Title\n\n## Executive Summary\nsummary\n",
        },
        session,
    )
    assert first.startswith("OK:"), first

    second = agent_tools.dispatch_tool(
        "file_edit",
        {
            "path": str(target),
            "old_text": "## 3.1\nflow\n",
            "new_text": "## 3.1\n![flow](flow.gif)\n",
        },
        session,
    )
    assert second.startswith("OK:"), second
    assert "Executive Summary" in target.read_text(encoding="utf-8")
    assert "flow.gif" in target.read_text(encoding="utf-8")


def test_file_write_then_file_edit_not_stale(auto_confirm: None, tmp_path: Path) -> None:
    target = tmp_path / "report.md"
    target.write_text("alpha\nbeta\n", encoding="utf-8")
    session = _session_for(tmp_path)

    read = agent_tools.dispatch_tool("file_read", {"path": str(target)}, session)
    assert "alpha" in read

    wrote = agent_tools.dispatch_tool(
        "file_write",
        {"path": str(target), "content": "alpha\nbeta\ngamma\n"},
        session,
    )
    assert wrote.startswith("OK:"), wrote

    edited = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "gamma\n", "new_text": "gamma\ndelta\n"},
        session,
    )
    assert edited.startswith("OK:"), edited
    assert target.read_text(encoding="utf-8") == "alpha\nbeta\ngamma\ndelta\n"


def test_external_change_still_rejected_after_refresh_fix(
    auto_confirm: None, tmp_path: Path
) -> None:
    target = tmp_path / "report.md"
    target.write_text("keep\n", encoding="utf-8")
    session = _session_for(tmp_path)
    agent_tools.dispatch_tool("file_read", {"path": str(target)}, session)
    target.write_text("externally changed\n", encoding="utf-8")

    result = agent_tools.dispatch_tool(
        "file_edit",
        {"path": str(target), "old_text": "keep\n", "new_text": "mine\n"},
        session,
    )
    assert result.startswith("ERROR:")
    assert "file_read" in result
    assert target.read_text(encoding="utf-8") == "externally changed\n"
