#!/usr/bin/env python3
from __future__ import annotations

import pytest

from agenticx.tools.lsp_manager import LSPManager, _DEFAULT_SERVER_MAP


def test_detect_language_python() -> None:
    mgr = LSPManager("/tmp/test")
    result = mgr._detect_language("/tmp/test/main.py")
    assert result is not None
    cmd, args, language_id = result
    assert language_id == "python"
    assert cmd == _DEFAULT_SERVER_MAP[".py"][0]
    assert args == _DEFAULT_SERVER_MAP[".py"][1]


def test_detect_language_unknown() -> None:
    mgr = LSPManager("/tmp/test")
    result = mgr._detect_language("/tmp/test/data.csv")
    assert result is None


@pytest.mark.asyncio
async def test_shutdown_all_empty_no_raise() -> None:
    mgr = LSPManager("/tmp/test")
    await mgr.shutdown_all()


def test_resolve_file_rejects_path_escape() -> None:
    mgr = LSPManager("/tmp/agx-workspace")
    result = mgr._resolve_file("nested/file.py")
    assert "agx-workspace" in result.parts


@pytest.mark.asyncio
async def test_tool_rejects_workspace_escape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    mgr = LSPManager("/tmp/agx-workspace")
    payload = await mgr.tool_hover("/etc/hosts", 1, 1)
    assert '"ok": false' in payload.lower()
    assert "path escapes workspace" in payload

