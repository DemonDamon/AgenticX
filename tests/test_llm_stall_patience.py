#!/usr/bin/env python3
"""Smoke tests for LLM stall patience mode (auto wait + resume on timeout).

Author: Damon Li
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from agenticx.cli import agent_loop
from agenticx.cli.studio import StudioSession
from agenticx.runtime import agent_runtime as runtime_module
from agenticx.runtime.agent_runtime import (
    _reset_stall_patience,
    _resolve_stall_patience_config,
    _stall_patience_state,
)


@pytest.fixture(autouse=True)
def _neutralize_config_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tests hermetic: never read the real ~/.agenticx/config.yaml."""
    from agenticx.cli.config_manager import ConfigManager

    monkeypatch.setattr(ConfigManager, "get_value", staticmethod(lambda *_a, **_k: None))


@pytest.fixture()
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "AGX_LLM_STALL_PATIENCE_ENABLED",
        "AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS",
        "AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS",
        "AGX_LLM_STALL_PATIENCE_BASE_SECONDS",
    ):
        monkeypatch.delenv(key, raising=False)


def test_resolve_stall_patience_defaults(_clean_env: None) -> None:
    cfg = _resolve_stall_patience_config(SimpleNamespace())
    assert cfg["enabled"] is True
    assert cfg["max_attempts"] == 3
    assert cfg["budget_seconds"] == 900.0
    assert cfg["base_seconds"] == 15.0


def test_resolve_stall_patience_env_override(_clean_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_ENABLED", "0")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS", "5")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS", "300")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BASE_SECONDS", "7")
    cfg = _resolve_stall_patience_config(SimpleNamespace())
    assert cfg["enabled"] is False
    assert cfg["max_attempts"] == 5
    assert cfg["budget_seconds"] == 300.0
    assert cfg["base_seconds"] == 7.0


def test_resolve_stall_patience_invalid_env_falls_back(
    _clean_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS", "abc")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS", "-5")
    cfg = _resolve_stall_patience_config(SimpleNamespace())
    assert cfg["max_attempts"] == 3
    assert cfg["budget_seconds"] == 900.0


def test_patience_state_bump_and_reset() -> None:
    session = SimpleNamespace()
    st = _stall_patience_state(session)
    assert st["attempts"] == 0
    st["attempts"] += 1
    st["started_at"] = 123.0
    again = _stall_patience_state(session)
    assert again["attempts"] == 1
    assert again["started_at"] == 123.0
    _reset_stall_patience(session)
    assert _stall_patience_state(session)["attempts"] == 0


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _FlakyTimeoutLLM:
    """First ``fail_rounds`` invoke calls hang past the invoke timeout; then succeed.

    The main round path calls ``llm.invoke`` (not ``stream``), so the hang must
    live here. The runtime cancels the invoke task at the invoke timeout; the
    worker thread still finishes in the background, which is harmless for the
    call-count assertions.
    """

    def __init__(self, fail_rounds: int, hang_seconds: float) -> None:
        self.calls = 0
        self._fail_rounds = fail_rounds
        self._hang_seconds = hang_seconds

    def invoke(self, *_args, **_kwargs):
        self.calls += 1
        if self.calls <= self._fail_rounds:
            time.sleep(self._hang_seconds)
        return _FakeResponse("恢复正常", [])

    def stream(self, *_args, **_kwargs):
        yield "恢复正常"


@pytest.fixture()
def _tiny_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_LLM_INVOKE_TIMEOUT_SECONDS", "0.2")
    monkeypatch.setenv("AGX_LLM_HEARTBEAT_TIMEOUT_SECONDS", "0.2")
    monkeypatch.setenv("AGX_LLM_ROUND_TIMEOUT_SECONDS", "0.3")
    monkeypatch.setenv("AGX_LLM_HARD_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BASE_SECONDS", "0.05")
    # Isolate from the provider-fallback mechanism: streak>=2 would swap the
    # session to a real fallback model and break the fake-LLM call counting.
    monkeypatch.setenv("AGX_LLM_FALLBACK_ENABLED", "0")


def test_patient_retry_recovers(
    _clean_env: None, _tiny_timeouts: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_ENABLED", "1")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS", "60")
    llm = _FlakyTimeoutLLM(fail_rounds=2, hang_seconds=0.6)
    session = StudioSession()

    result = agent_loop.run_agent_loop(session, llm, "测试耐心恢复")

    assert "恢复正常" in result
    assert llm.calls == 3
    events = getattr(session, "last_agent_events", []) or []
    wait_events = [
        e for e in events
        if e.get("type") == "tool_progress" and e.get("data", {}).get("phase") == "stall_patient_wait"
    ]
    assert wait_events, "expected at least one stall_patient_wait event"
    assert wait_events[0]["data"]["attempt"] == 1
    assert wait_events[0]["data"]["next_retry_in_seconds"] >= 0
    recovered = [
        e for e in events
        if e.get("type") == "tool_progress" and e.get("data", {}).get("phase") == "stall_patient_recovered"
    ]
    assert recovered, "expected a stall_patient_recovered event after successful retry"


def test_patience_disabled_keeps_old_death(
    _clean_env: None, _tiny_timeouts: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_ENABLED", "0")
    llm = _FlakyTimeoutLLM(fail_rounds=99, hang_seconds=0.6)
    session = StudioSession()

    result = agent_loop.run_agent_loop(session, llm, "测试关闭耐心模式")

    # Old behavior: one immediate retry then the turn dies with the failure notice.
    assert llm.calls == 2
    assert "请检查网络与模型配置" in result
    events = getattr(session, "last_agent_events", []) or []
    assert not [
        e for e in events
        if e.get("type") == "tool_progress" and e.get("data", {}).get("phase") == "stall_patient_wait"
    ]


def test_patience_budget_exhaustion_falls_back_to_death(
    _clean_env: None, _tiny_timeouts: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_ENABLED", "1")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS", "1")
    monkeypatch.setenv("AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS", "60")
    llm = _FlakyTimeoutLLM(fail_rounds=99, hang_seconds=0.6)
    session = StudioSession()

    result = agent_loop.run_agent_loop(session, llm, "测试预算耗尽")

    # 1 immediate retry + 1 patient attempt, then the classic death path.
    assert llm.calls == 3
    assert "请检查网络与模型配置" in result
    events = getattr(session, "last_agent_events", []) or []
    wait_events = [
        e for e in events
        if e.get("type") == "tool_progress" and e.get("data", {}).get("phase") == "stall_patient_wait"
    ]
    assert len(wait_events) == 1
    assert any(e.get("type") == "stall" for e in events)
