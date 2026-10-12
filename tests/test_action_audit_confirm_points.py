#!/usr/bin/env python3
"""Audit points on confirmation and enterprise policy denial.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from agenticx.cli import agent_tools as at
from agenticx.cli.agent_tools import _confirm, dispatch_tool_async
from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.confirm import AsyncConfirmGate, RiskAwareAutoConfirmGate


def _install_signed_in(monkeypatch: pytest.MonkeyPatch) -> None:
    values = {
        "enterprise.enabled": True,
        "enterprise.token": "agx-pat-test",
        "enterprise.agent_action_policy": {"denied_tools": ["file_read"]},
    }

    def get_value(cls: object, key: str) -> object:
        del cls
        return values.get(key)

    monkeypatch.setattr(ConfigManager, "get_value", classmethod(get_value))


def _events() -> list[dict[str, Any]]:
    path = Path.home() / ".agenticx" / "action_audit" / "outbox.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class _Session:
    def __init__(self) -> None:
        self._session_id = "sess-audit"
        self.sticky_allowed_tools: set[str] = set()


class _CountingGate(AsyncConfirmGate):
    def __init__(self) -> None:
        super().__init__(timeout_seconds=5)
        self.calls = 0

    async def request_confirm(self, question: str, context: dict[str, Any] | None = None) -> bool:
        self.calls += 1
        return await super().request_confirm(question, context)


async def _wait_pending(gate: AsyncConfirmGate, timeout: float = 5.0) -> str:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        if gate._pending:
            return next(iter(gate._pending))
        await asyncio.sleep(0.01)
    raise AssertionError("timed out waiting for a confirmation")


def test_protected_human_approval_writes_one_event(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_signed_in(monkeypatch)
    gate = _CountingGate()

    async def run() -> bool:
        task = asyncio.create_task(
            _confirm(
                "push origin?",
                confirm_gate=gate,
                context={"tool": "bash_exec", "risk": "high", "command": "git push"},
                session=_Session(),  # type: ignore[arg-type]
            )
        )
        request_id = await _wait_pending(gate)
        assert gate.resolve(request_id, True)
        return await task

    assert asyncio.run(run()) is True
    events = _events()
    assert len(events) == 1
    assert events[0]["kind"] == "confirm_resolved"
    assert events[0]["outcome"] == "approved"
    assert events[0]["decision_source"] == "human"
    assert events[0]["session_id"] == "sess-audit"
    assert events[0]["summary"] == "push origin?"


def test_low_risk_auto_approval_writes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_signed_in(monkeypatch)
    monkeypatch.setattr(at, "tool_allowed_without_confirm", lambda *_a, **_k: True)
    gate = _CountingGate()
    approved = asyncio.run(
        _confirm(
            "write note?",
            confirm_gate=gate,
            context={"tool": "file_write", "risk": "low"},
            session=_Session(),  # type: ignore[arg-type]
        )
    )
    assert approved is True
    assert gate.calls == 0
    assert _events() == []


def test_unattended_block_is_audited(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_signed_in(monkeypatch)
    gate = RiskAwareAutoConfirmGate(unattended=True)
    approved = asyncio.run(
        _confirm(
            "push origin?",
            confirm_gate=gate,
            context={"tool": "bash_exec", "risk": "high", "command": "git push"},
            session=_Session(),  # type: ignore[arg-type]
        )
    )
    assert approved is False
    events = _events()
    assert len(events) == 1
    assert events[0]["kind"] == "confirm_resolved"
    assert events[0]["outcome"] == "denied"
    assert events[0]["decision_source"] == "blocked_unattended"


def test_enterprise_preconfirm_skip_does_not_emit(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_signed_in(monkeypatch)
    session = _Session()
    session._enterprise_ask_satisfied_tool = "bash_exec"  # type: ignore[attr-defined]
    gate = _CountingGate()
    approved = asyncio.run(
        _confirm(
            "run bash?",
            confirm_gate=gate,
            context={"tool": "bash_exec", "risk": "high", "command": "git push"},
            session=session,  # type: ignore[arg-type]
        )
    )
    assert approved is True
    assert gate.calls == 0
    assert _events() == []
    assert getattr(session, "_enterprise_ask_satisfied_tool", None) is None


def test_enterprise_denial_writes_policy_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_signed_in(monkeypatch)
    session = _Session()
    text = asyncio.run(
        dispatch_tool_async("file_read", {"path": "/tmp/nope.txt"}, session)  # type: ignore[arg-type]
    )
    assert text.startswith("ERROR: 企业策略禁止执行")
    events = _events()
    assert len(events) == 1
    assert events[0]["kind"] == "policy_denied"
    assert events[0]["outcome"] == "denied"
    assert events[0]["decision_source"] == "enterprise_policy"
    assert events[0]["subject"] == "file_read"
    assert events[0]["tool_name"] == "file_read"
    assert events[0]["session_id"] == "sess-audit"
    assert events[0]["summary"] == "file_read"
    assert len(str(events[0]["args_digest"])) == 64
