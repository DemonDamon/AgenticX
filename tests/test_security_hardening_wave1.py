#!/usr/bin/env python3
"""Wave-1 checks for taskspace writes, mount files, and MCP confirmation.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Optional
from unittest.mock import MagicMock

import pytest

from agenticx.cli import agent_tools as at
from agenticx.cli.studio import StudioSession
from agenticx.runtime.confirm import ConfirmGate
from agenticx.runtime.meta_tools import dispatch_meta_tool_async


class _RejectGate(ConfirmGate):
    def __init__(self) -> None:
        self.asked = 0

    async def request_confirm(self, question: str, context: Optional[dict[str, Any]] = None) -> bool:
        del question, context
        self.asked += 1
        return False


def test_set_taskspace_is_read_only(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    ws = tmp_path / "ws"
    extra = tmp_path / "extra"
    ws.mkdir()
    extra.mkdir()
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.scratchpad = {}
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    raw = asyncio.run(
        dispatch_meta_tool_async(
            "set_taskspace",
            {"path": str(extra)},
            team_manager=MagicMock(),
            session=session,
        )
    )
    assert json.loads(raw)["ok"] is True
    read_roots, write_roots = at._session_workspace_root_sets(session)
    assert extra.resolve() in read_roots
    assert extra.resolve() not in write_roots


def test_mounts_file_is_protected_and_home_link_is_not_writable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    assert at._is_protected_path(tmp_path / ".agx-mounts.json") is True
    ws = tmp_path / "ws"
    ws.mkdir()
    home = Path.home().resolve()
    (ws / ".agx-mounts.json").write_text(
        json.dumps({"version": 1, "mounts": [{"mode": "link", "source_path": str(home)}]}),
        encoding="utf-8",
    )
    session = StudioSession()
    session.workspace_dir = str(ws)
    session.taskspaces = [
        {"id": "default", "label": "默认工作区", "path": str(ws), "mount_mode": "link"},
    ]
    _read_roots, write_roots = at._session_workspace_root_sets(session)
    assert home not in {path.resolve() for path in write_roots}


def test_mcp_connect_denial_does_not_launch(monkeypatch: pytest.MonkeyPatch) -> None:
    session = StudioSession()
    session.mcp_configs = {}
    called = {"n": 0}

    def _fake(_arguments: dict[str, Any], _session: StudioSession) -> str:
        called["n"] += 1
        return "OK"

    monkeypatch.setattr(at, "_tool_mcp_connect", _fake)
    monkeypatch.setattr(at, "_mcp_auto_connect_names", lambda: set())
    gate = _RejectGate()
    result = asyncio.run(
        at._tool_mcp_connect_confirmed({"name": "evil"}, session, confirm_gate=gate)
    )
    assert called["n"] == 0
    assert gate.asked == 1
    assert "未授权启动 MCP 服务" in result


def test_mcp_connect_auto_connect_skips_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    session = StudioSession()
    called = {"n": 0}

    def _fake(_arguments: dict[str, Any], _session: StudioSession) -> str:
        called["n"] += 1
        return "OK"

    monkeypatch.setattr(at, "_tool_mcp_connect", _fake)
    monkeypatch.setattr(at, "_mcp_auto_connect_names", lambda: {"trusted"})
    gate = _RejectGate()
    result = asyncio.run(
        at._tool_mcp_connect_confirmed({"name": "trusted"}, session, confirm_gate=gate)
    )
    assert result == "OK"
    assert called["n"] == 1
    assert gate.asked == 0
