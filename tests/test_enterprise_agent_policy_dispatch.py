#!/usr/bin/env python3
"""Dispatch enforcement for the enterprise agent-action policy.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, Optional

import pytest

from agenticx.cli import agent_tools as at
from agenticx.cli.agent_tools import _confirm, dispatch_tool_async
from agenticx.cli.studio import StudioSession
from agenticx.runtime.confirm import AsyncConfirmGate, RiskAwareAutoConfirmGate
from agenticx.runtime.enterprise_agent_policy import EnterpriseAgentPolicy


class _StubSession:
    def __init__(self) -> None:
        self.scratchpad: Dict[str, Any] = {}
        self.sticky_allowed_tools: set[str] = set()


class _CountingGate(AsyncConfirmGate):
    def __init__(self) -> None:
        super().__init__(timeout_seconds=8)
        self.calls = 0

    async def request_confirm(self, question: str, context: Optional[Dict[str, Any]] = None) -> bool:
        self.calls += 1
        return await super().request_confirm(question, context)


def _use_policy(monkeypatch: pytest.MonkeyPatch, policy: EnterpriseAgentPolicy) -> None:
    monkeypatch.setattr(at, "tool_denied_by_session_permissions", lambda _name: None)
    monkeypatch.setattr(at, "tool_allowed_without_confirm", lambda *_a, **_k: False)
    monkeypatch.setattr(
        "agenticx.runtime.enterprise_agent_policy.load_enterprise_agent_policy",
        lambda: policy,
    )


def _workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[StudioSession, Path]:
    monkeypatch.delenv("AGX_DESKTOP_UNRESTRICTED_FS", raising=False)
    workspace = tmp_path / "ws"
    workspace.mkdir()
    monkeypatch.setenv("AGX_WORKSPACE_ROOT", str(workspace))
    session = StudioSession()
    session.workspace_dir = str(workspace)
    session.taskspaces = [
        {"id": "default", "label": "workspace", "path": str(workspace), "mount_mode": "link"},
    ]
    return session, workspace


async def _wait_pending(gate: AsyncConfirmGate, timeout: float = 5.0) -> str:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if gate._pending:
            return next(iter(gate._pending))
        await asyncio.sleep(0.01)
    raise AssertionError("timed out waiting for a confirmation")


def test_denied_tool_is_not_executed(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy(denied=("file_read",)))
    called = {"n": 0}

    def _read(*_args: Any, **_kwargs: Any) -> str:
        called["n"] += 1
        return "READ"

    monkeypatch.setattr(at, "_tool_file_read", _read)
    text = asyncio.run(
        dispatch_tool_async("file_read", {"path": "/tmp/nope.txt"}, _StubSession())  # type: ignore[arg-type]
    )
    assert text.startswith("ERROR: 企业策略禁止执行")
    assert "file_read" in text
    assert called["n"] == 0


def test_always_ask_under_auto_mode_confirms_once_then_runs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy(always_ask=("file_write",)))
    session, workspace = _workspace(tmp_path, monkeypatch)
    delegate = _CountingGate()
    gate = RiskAwareAutoConfirmGate(delegate=delegate)
    target = workspace / "note.txt"

    async def run() -> str:
        task = asyncio.create_task(
            dispatch_tool_async(
                "file_write",
                {"path": str(target), "content": "hello"},
                session,
                confirm_gate=gate,
            )
        )
        request_id = await _wait_pending(delegate)
        assert delegate.calls == 1
        assert len(delegate._pending) == 1
        meta = delegate._pending_meta[request_id]
        assert meta["context"]["risk"] == "policy"
        assert meta["context"]["enterprise_policy"] is True
        assert delegate.resolve(request_id, True)
        return await task

    text = asyncio.run(run())
    assert text.startswith("OK: wrote")
    assert target.read_text(encoding="utf-8") == "hello"
    assert delegate.calls == 1


def test_always_ask_reject_is_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy(always_ask=("file_read",)))
    called = {"n": 0}

    def _read(*_args: Any, **_kwargs: Any) -> str:
        called["n"] += 1
        return "READ"

    monkeypatch.setattr(at, "_tool_file_read", _read)
    delegate = _CountingGate()

    async def run() -> str:
        task = asyncio.create_task(
            dispatch_tool_async(
                "file_read",
                {"path": "/tmp/nope.txt"},
                _StubSession(),  # type: ignore[arg-type]
                confirm_gate=delegate,
            )
        )
        request_id = await _wait_pending(delegate)
        assert delegate.resolve(request_id, False)
        return await task

    text = asyncio.run(run())
    assert text.startswith("CANCELLED: 企业策略要求的确认未通过")
    assert called["n"] == 0


def test_disable_session_allow_still_confirms_file_write(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy(disable_session_allow=True))
    session = _StubSession()
    session.sticky_allowed_tools.add("file_write")
    gate = _CountingGate()

    async def run() -> bool:
        task = asyncio.create_task(
            _confirm(
                "write?",
                confirm_gate=gate,
                context={"tool": "file_write", "risk": "low"},
                session=session,  # type: ignore[arg-type]
            )
        )
        request_id = await _wait_pending(gate)
        assert gate.resolve(request_id, True)
        return await task

    assert asyncio.run(run()) is True
    assert gate.calls == 1


def test_sticky_still_skips_when_session_allow_is_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy(disable_session_allow=False))
    session = _StubSession()
    session.sticky_allowed_tools.add("file_write")
    gate = _CountingGate()
    approved = asyncio.run(
        _confirm(
            "write?",
            confirm_gate=gate,
            context={"tool": "file_write", "risk": "low"},
            session=session,  # type: ignore[arg-type]
        )
    )
    assert approved is True
    assert gate.calls == 0


def test_empty_policy_keeps_existing_empty_args_message(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_policy(monkeypatch, EnterpriseAgentPolicy())
    text = asyncio.run(dispatch_tool_async("file_write", {}, _StubSession()))  # type: ignore[arg-type]
    assert text.startswith("ERROR: file_write() called with empty arguments.")
    assert "立即重新调用" in text
    assert "path" in text and "content" in text
