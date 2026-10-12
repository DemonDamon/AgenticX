#!/usr/bin/env python3
"""Tests for unattended approval parking.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.runtime.confirm import (
    AsyncConfirmGate,
    ParkedApprovalConfirmGate,
    confirm_denial_note,
)
from agenticx.runtime.parked_approvals import (
    ParkedApproval,
    approval_parking_enabled,
    approval_timeout_seconds,
    list_pending,
    register,
)


@pytest.fixture(autouse=True)
def _clear_parked_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.runtime import parked_approvals

    monkeypatch.delenv("AGX_UNATTENDED_APPROVAL_PARKING", raising=False)
    monkeypatch.delenv("AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC", raising=False)
    with parked_approvals._lock:
        parked_approvals._items.clear()
    yield
    with parked_approvals._lock:
        parked_approvals._items.clear()


def _parked_gate(
    *,
    timeout_seconds: float,
    session_id: str = "sess-1",
    agent_id: str = "meta",
    delegate_timeout: float = 30,
) -> tuple[ParkedApprovalConfirmGate, AsyncConfirmGate]:
    delegate = AsyncConfirmGate(timeout_seconds=delegate_timeout)
    gate = ParkedApprovalConfirmGate(
        delegate,
        session_id=session_id,
        agent_id=agent_id,
        timeout_seconds=timeout_seconds,
        label="automation:atask_test",
    )
    return gate, delegate


@pytest.mark.asyncio
async def test_ac1_low_risk_auto_approves_without_parking() -> None:
    gate, _delegate = _parked_gate(timeout_seconds=5)
    assert await gate.request_confirm("write?", {"risk": "low"}) is True
    assert list_pending() == []


@pytest.mark.asyncio
async def test_ac2_protected_request_is_visible_while_waiting() -> None:
    gate, _delegate = _parked_gate(
        timeout_seconds=5,
        session_id="sess-ac2",
        agent_id="agent-ac2",
    )
    task = asyncio.create_task(
        gate.request_confirm(
            "push?",
            {"risk": "high", "tool": "bash_exec"},
        )
    )
    await asyncio.sleep(0)
    items = list_pending()
    assert len(items) == 1
    item = items[0]
    assert item["tool"] == "bash_exec"
    assert item["session_id"] == "sess-ac2"
    assert item["agent_id"] == "agent-ac2"
    assert item["protected_reason"]
    assert 0 <= item["remaining_seconds"] <= 5
    assert gate.resolve(item["request_id"], False) is True
    assert await task is False


@pytest.mark.asyncio
async def test_ac3_gate_resolve_approves_and_clears_registry() -> None:
    gate, _delegate = _parked_gate(timeout_seconds=5)
    task = asyncio.create_task(
        gate.request_confirm(
            "push?",
            {"risk": "high", "tool": "bash_exec", "request_id": "req-ac3"},
        )
    )
    await asyncio.sleep(0)
    assert list_pending()[0]["request_id"] == "req-ac3"
    assert gate.resolve("req-ac3", True) is True
    assert await task is True
    assert list_pending() == []


@pytest.mark.asyncio
async def test_ac4_delegate_resolve_rejects_and_clears_registry() -> None:
    gate, delegate = _parked_gate(timeout_seconds=5)
    task = asyncio.create_task(
        gate.request_confirm(
            "push?",
            {"risk": "high", "tool": "bash_exec", "request_id": "req-ac4"},
        )
    )
    await asyncio.sleep(0)
    assert len(list_pending()) == 1
    assert delegate.resolve("req-ac4", False) is True
    assert await task is False
    assert list_pending() == []


@pytest.mark.asyncio
async def test_ac5_parked_timeout_denial_note_and_clears_registry() -> None:
    gate, _delegate = _parked_gate(timeout_seconds=0.05, delegate_timeout=30)
    result = await asyncio.wait_for(
        gate.request_confirm("push?", {"risk": "high", "tool": "git_push"}),
        timeout=2,
    )
    assert result is False
    assert gate.last_request is not None
    request_id = str(gate.last_request["id"])
    assert (
        confirm_denial_note(gate, request_id)
        == "无人值守等待审批超时（1 分钟）"
    )
    assert list_pending() == []


def test_ac6_approval_timeout_seconds_env_clamp_and_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC", "10")
    assert approval_timeout_seconds() == 60
    monkeypatch.setenv("AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC", "99999")
    assert approval_timeout_seconds() == 7200
    monkeypatch.setenv("AGX_UNATTENDED_APPROVAL_TIMEOUT_SEC", "abc")
    assert approval_timeout_seconds() == 1200


def test_ac7_approval_parking_disabled_by_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGX_UNATTENDED_APPROVAL_PARKING", "0")
    assert approval_parking_enabled() is False


@pytest.mark.asyncio
async def test_ac8_async_gate_keeps_instance_timeout_without_override() -> None:
    gate = AsyncConfirmGate(timeout_seconds=0.05)
    result = await asyncio.wait_for(
        gate.request_confirm("danger?", {"risk": "high"}),
        timeout=2,
    )
    assert result is False
    assert gate.last_timeout_info is not None
    assert gate.last_timeout_info["timeout_seconds"] == 0.05


def test_ac9_list_pending_drops_expired_items() -> None:
    created = 1_000.0
    expires = created + 10
    register(
        ParkedApproval(
            request_id="req-expired",
            session_id="sess-ac9",
            agent_id="meta",
            question="push?",
            tool="bash_exec",
            risk="high",
            protected_reason="protected",
            label="",
            created_at=created,
            expires_at=expires,
        )
    )
    register(
        ParkedApproval(
            request_id="req-live",
            session_id="sess-ac9",
            agent_id="meta",
            question="later?",
            tool="file_write",
            risk="high",
            protected_reason="protected",
            label="",
            created_at=created + 1,
            expires_at=expires + 50,
        )
    )
    rows = list_pending(now=expires + 1)
    assert [row["request_id"] for row in rows] == ["req-live"]
    assert rows[0]["remaining_seconds"] == max(0, int((expires + 50) - (expires + 1)))
    assert list_pending(now=expires + 1)[0]["request_id"] == "req-live"
