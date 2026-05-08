#!/usr/bin/env python3
"""Smoke: bash_exec cd-prefix peel vs shell metachars (FR-6 / FR-7).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession


@pytest.fixture
def auto_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _yes(*_a: object, **_k: object) -> bool:
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _yes)


def test_cd_prefix_blocked_unit() -> None:
    assert agent_tools._command_blocks_cd_prefix_peel("cd /x && ls 2>&1") is True
    assert agent_tools._command_blocks_cd_prefix_peel("cd /x && ls | tail") is True
    assert agent_tools._command_blocks_cd_prefix_peel("cd /x && ls > o") is True
    assert agent_tools._command_blocks_cd_prefix_peel("cd /x && ls") is False


def test_cd_prefix_kept_when_redirect(auto_confirm: None, tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    sub = workspace / "sub"
    sub.mkdir()
    session = StudioSession()
    session.workspace_dir = str(workspace)
    cmd = f'cd "{sub.resolve()}" && printf ready 2>&1'
    out = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, session)
    assert "exit_code=0" in out
    assert "ready" in out


def test_cd_prefix_kept_when_pipe(auto_confirm: None, tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    sub = workspace / "sub"
    sub.mkdir()
    session = StudioSession()
    session.workspace_dir = str(workspace)
    cmd = f'cd "{sub.resolve()}" && printf "a\\nb\\n" | wc -l'
    out = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, session)
    assert "exit_code=0" in out


def test_cd_prefix_kept_when_outfile(auto_confirm: None, tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    sub = workspace / "sub"
    sub.mkdir()
    out_file = workspace / "out.txt"
    session = StudioSession()
    session.workspace_dir = str(workspace)
    cmd = f'cd "{sub.resolve()}" && echo hi > "{out_file}"'
    out = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, session)
    assert "exit_code=0" in out
    assert out_file.read_text().strip() == "hi"


def test_cd_prefix_peeled_when_no_metachar(auto_confirm: None, tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    sub = workspace / "sub"
    sub.mkdir()
    (sub / "marker.txt").write_text("ok", encoding="utf-8")
    session = StudioSession()
    session.workspace_dir = str(workspace)
    cmd = f'cd "{sub.name}" && ls marker.txt'
    out = agent_tools.dispatch_tool("bash_exec", {"command": cmd}, session)
    assert "exit_code=0" in out
    assert "marker.txt" in out


@pytest.mark.asyncio
async def test_redirect_error_hint_appended_on_argparse_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def _yes(*_a: object, **_k: object) -> bool:
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _yes)

    class _Stream:
        def __init__(self, chunks: list[bytes]) -> None:
            self._chunks = chunks

        def __aiter__(self) -> "_Stream":
            self._it = iter(self._chunks)
            return self

        async def __anext__(self) -> bytes:
            try:
                return next(self._it)
            except StopIteration as exc:
                raise StopAsyncIteration from exc

    async def fake_exec(*_a: object, **kwargs: object) -> MagicMock:
        _ = kwargs
        proc = MagicMock()
        proc.returncode = 2
        proc.stdout = _Stream([])
        proc.stderr = _Stream([b"usage: tool [-h]\n", b"unrecognized arguments: 2>&1\n"])

        async def _wait() -> int:
            return 2

        proc.wait = _wait
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    session = StudioSession()
    session.workspace_dir = str(tmp_path)
    out = await agent_tools._tool_bash_exec(
        {"command": "echo x"},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    assert "exit_code=2" in out
    assert "[HINT]" in out
    assert "shell 元字符" in out
