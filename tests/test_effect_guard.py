#!/usr/bin/env python3
"""Dispatch-time effect guard for the product runtime.

Author: Damon Li
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from agenticx.reliability.call_ledger import CallLedger
from agenticx.runtime import effect_guard
from agenticx.runtime.effect_guard import (
    LEDGER_FAIL_TEXT,
    ORPHAN_TEXT,
    REUSED_PREFIX,
    EffectGuard,
    effect_guard_enabled,
    is_guarded_call,
    register_interrupted_sessions,
)

_PUSH = {"command": "git push origin main"}


@pytest.fixture(autouse=True)
def _reset_interrupted_sessions() -> Iterator[None]:
    effect_guard._INTERRUPTED_SESSIONS.clear()
    yield
    effect_guard._INTERRUPTED_SESSIONS.clear()


def _guard(tmp_path: Path, session_id: str) -> EffectGuard:
    return EffectGuard(session_id, root=str(tmp_path))


def _advance_process_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(effect_guard, "PROCESS_START_TS", time.time() + 1)


def test_ac7_read_and_local_write_skip_the_ledger(tmp_path: Path) -> None:
    guard = _guard(tmp_path, "ac7")
    read = guard.before_dispatch(
        tool_call_id="r",
        tool_name="file_read",
        arguments={"path": "a.txt"},
    )
    todo = guard.before_dispatch(
        tool_call_id="t",
        tool_name="todo_write",
        arguments={"todos": []},
    )
    assert read.action == "dispatch"
    assert read.ledger_call_id is None
    assert todo.action == "dispatch"
    assert todo.ledger_call_id is None
    assert not (tmp_path / "ac7" / "call_ledger.jsonl").exists()


def test_ac8_records_completed_external_write(tmp_path: Path) -> None:
    guard = _guard(tmp_path, "ac8")
    decision = guard.before_dispatch(
        tool_call_id="push-1",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert decision.action == "dispatch"
    assert decision.ledger_call_id
    guard.after_result(decision.ledger_call_id, "ok", is_error=False)
    restored = CallLedger("ac8", root=tmp_path)
    record = restored.lookup(decision.ledger_call_id)
    assert record is not None
    assert record.state == "completed"


def test_ac9_orphan_intercepted_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    guard1 = _guard(tmp_path, "ac9")
    first_dispatch = guard1.before_dispatch(
        tool_call_id="push-1",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert first_dispatch.action == "dispatch"
    _advance_process_start(monkeypatch)
    guard2 = _guard(tmp_path, "ac9")
    intercepted = guard2.before_dispatch(
        tool_call_id="push-2",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert intercepted.action == "prefilled"
    assert intercepted.text == ORPHAN_TEXT
    again = guard2.before_dispatch(
        tool_call_id="push-3",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert again.action == "dispatch"
    assert again.ledger_call_id


def test_ac10_reuses_completed_result_when_interrupted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    guard1 = _guard(tmp_path, "ac10")
    done = guard1.before_dispatch(
        tool_call_id="push-1",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert done.ledger_call_id
    guard1.after_result(done.ledger_call_id, "sent ok", is_error=False)
    register_interrupted_sessions(["ac10"])
    _advance_process_start(monkeypatch)
    guard2 = _guard(tmp_path, "ac10")
    reused = guard2.before_dispatch(
        tool_call_id="push-2",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert reused.action == "prefilled"
    assert reused.text == REUSED_PREFIX + "sent ok"
    again = guard2.before_dispatch(
        tool_call_id="push-3",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert again.action == "dispatch"
    assert again.ledger_call_id


def test_ac11_completed_result_not_reused_without_interrupt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    guard1 = _guard(tmp_path, "ac11")
    done = guard1.before_dispatch(
        tool_call_id="push-1",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert done.ledger_call_id
    guard1.after_result(done.ledger_call_id, "sent ok", is_error=False)
    _advance_process_start(monkeypatch)
    guard2 = _guard(tmp_path, "ac11")
    decision = guard2.before_dispatch(
        tool_call_id="push-2",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert decision.action == "dispatch"
    assert decision.ledger_call_id is not None
    assert decision.text is None


def test_ac12_runtime_keys_do_not_change_canonical_key(tmp_path: Path) -> None:
    guard = _guard(tmp_path, "ac12")
    with_runtime = guard.before_dispatch(
        tool_call_id="a",
        tool_name="bash_exec",
        arguments={
            "command": "git push origin main",
            "__tool_call_id": "x",
            "__agent_id": "y",
        },
    )
    plain = guard.before_dispatch(
        tool_call_id="b",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert with_runtime.ledger_call_id
    assert plain.ledger_call_id
    restored = CallLedger("ac12", root=tmp_path)
    left = restored.lookup(with_runtime.ledger_call_id)
    right = restored.lookup(plain.ledger_call_id)
    assert left is not None and right is not None
    assert left.canonical_key == right.canonical_key


def test_ac13_guarded_tool_selection() -> None:
    assert is_guarded_call("mcp_call", {"server": "demo", "tool": "click"}) is True
    assert is_guarded_call("near_browser_click", {"selector": "#go"}) is True
    assert is_guarded_call("query_subagent_status", {}) is False
    assert is_guarded_call("delegate_to_avatar", {"avatar_id": "a"}) is False


def test_ac14_ledger_write_failure_follows_posture(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    guard = _guard(tmp_path, "ac14")

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(CallLedger, "record_dispatch", _boom)
    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "strict")
    blocked = guard.before_dispatch(
        tool_call_id="push-1",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert blocked.action == "prefilled"
    assert blocked.text == LEDGER_FAIL_TEXT
    assert blocked.ledger_call_id is None

    monkeypatch.setenv("AGX_RELIABILITY_POSTURE", "legacy")
    allowed = guard.before_dispatch(
        tool_call_id="push-2",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    assert allowed.action == "dispatch"
    assert allowed.ledger_call_id is None


def test_ac15_env_zero_disables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_EFFECT_GUARD", "0")
    assert effect_guard_enabled() is False


def test_ac16_reused_tool_call_id_keeps_both_rows(tmp_path: Path) -> None:
    guard = _guard(tmp_path, "ac16")
    first = guard.before_dispatch(
        tool_call_id="call_0",
        tool_name="bash_exec",
        arguments=_PUSH,
    )
    second = guard.before_dispatch(
        tool_call_id="call_0",
        tool_name="bash_exec",
        arguments={"command": "git push origin other"},
    )
    assert first.ledger_call_id
    assert second.ledger_call_id
    assert first.ledger_call_id != second.ledger_call_id
    assert first.ledger_call_id.startswith("call_0:")
    assert second.ledger_call_id.startswith("call_0:")
    restored = CallLedger("ac16", root=tmp_path)
    assert restored.lookup(first.ledger_call_id) is not None
    assert restored.lookup(second.ledger_call_id) is not None
