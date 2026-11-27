#!/usr/bin/env python3
"""Smoke tests for loop-halt progress signal fixes.

Covers:
- ``_tool_result_ok_flag`` JSON ``ok`` convention parsing.
- Successful meta-tool results (e.g. ``create_avatar`` with ``ok: true``)
  counting as progress so the no-progress loop detector does not fire.
- Repeated ``ok: false`` results still triggering the no-progress halt.
- ``_build_loop_halt_success_digest`` listing only confirmed successes.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.agent_runtime import (
    _build_loop_halt_success_digest,
    _eager_knowledge_search_events,
    _tool_result_ok_flag,
)
from agenticx.runtime.hooks import HookRegistry
from agenticx.runtime.loop_detector import LoopDetector


def test_ok_flag_true() -> None:
    result = json.dumps(
        {"ok": True, "avatar_id": "2027d8ea4ab4", "name": "程基岩"},
        ensure_ascii=False,
    )
    assert _tool_result_ok_flag(result) is True


def test_ok_flag_false() -> None:
    result = json.dumps(
        {"ok": False, "error": "avatar_exists", "message": "分身已存在"},
        ensure_ascii=False,
    )
    assert _tool_result_ok_flag(result) is False


def test_ok_flag_none_for_non_json_and_non_boolean() -> None:
    assert _tool_result_ok_flag("OK: wrote /tmp/a.txt") is None
    assert _tool_result_ok_flag("") is None
    assert _tool_result_ok_flag(None) is None
    assert _tool_result_ok_flag('{"ok": "yes"}') is None
    assert _tool_result_ok_flag('[{"ok": true}]') is None
    assert _tool_result_ok_flag('{"ok": true, "unterminated":') is None
    assert _tool_result_ok_flag('  {"ok": true}') is True


@pytest.mark.parametrize("ok", [True, False])
def test_ok_flag_reads_the_complete_long_json_result(ok) -> None:
    result = json.dumps({"payload": "synthetic data " * 500, "ok": ok})
    assert len(result) > 4000
    assert _tool_result_ok_flag(result) is ok


@pytest.mark.parametrize("ok", [True, False])
@pytest.mark.parametrize("preserve", [True, False])
def test_runtime_progress_and_result_preservation(ok, preserve, monkeypatch, tmp_path) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    monkeypatch.setenv("AGX_HOME", str(tmp_path))
    from pathlib import Path
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setenv("AGX_MICRO_COMPACT_BUDGET", "4000")
    raw_result = json.dumps({"payload": "synthetic data " * 500, "ok": ok})

    class Model:
        def __init__(self):
            self.calls = 0

        def invoke(self, messages, **kwargs):
            self.calls += 1
            if self.calls > 1:
                return SimpleNamespace(content="已完成本次数据查询。", tool_calls=[])
            return SimpleNamespace(content="", tool_calls=[{
                "id": "call-data", "type": "function",
                "function": {"name": "read_external_record", "arguments": '{"id": 1}'},
            }])

    class Gate(ConfirmGate):
        async def request_confirm(self, question, context=None):
            return True

    async def execute(*args, **kwargs):
        return raw_result

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", execute)
    runtime = AgentRuntime(Model(), Gate(),
                           preserve_tool_results={"read_external_record"} if preserve else None)
    runtime.hooks = HookRegistry()
    marks = []
    record_call = runtime.loop_detector.record_call

    def capture_progress(*args, **kwargs):
        marks.append(kwargs["has_progress"])
        return record_call(*args, **kwargs)

    monkeypatch.setattr(runtime.loop_detector, "record_call", capture_progress)
    session = StudioSession(provider_name="openai", model_name="test-model", workspace_dir=str(tmp_path))
    tool = {"type": "function", "function": {"name": "read_external_record",
            "description": "Query an external record", "parameters": {"type": "object"}}}

    async def collect():
        return [event async for event in runtime.run_turn(
            "查询这条合成数据。", session, tools=[tool], system_prompt="按需查询数据。")]

    events = asyncio.run(collect())
    results = [event.data["result"] for event in events if event.type == EventType.TOOL_RESULT.value]
    assert len(results) == 1
    if preserve:
        assert results[0] == raw_result
        assert json.loads(results[0])["ok"] is ok
    else:
        assert results[0].startswith("[micro-compact tool=read_external_record")
        assert len(results[0]) < len(raw_result)
    assert marks == [ok]


@pytest.mark.parametrize("preserve", [True, False])
def test_eager_knowledge_search_obeys_result_preservation(preserve, monkeypatch, tmp_path) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    monkeypatch.setenv("AGX_MICRO_COMPACT_BUDGET", "4000")
    from pathlib import Path
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    raw_result = json.dumps({"schema": "synthetic schema " * 500, "ok": True})

    async def execute(*args, **kwargs):
        return raw_result

    monkeypatch.setattr(runtime_module, "dispatch_tool_async", execute)
    runtime = AgentRuntime(SimpleNamespace(), SimpleNamespace(),
                           preserve_tool_results={"knowledge_search"} if preserve else None)
    runtime.hooks = HookRegistry()
    session = SimpleNamespace(agent_messages=[], chat_history=[])
    messages = []

    async def collect():
        return [event async for event in _eager_knowledge_search_events(
            runtime=runtime, session=session, user_input="查合成数据", messages=messages,
            agent_id="meta", executed_tool_names=[], is_system_trigger=False, team_manager=None)]

    asyncio.run(collect())
    result = next(message["content"] for message in messages if message["role"] == "tool")
    if preserve:
        assert result == raw_result
    else:
        assert result != raw_result
        assert "[micro-compact tool=knowledge_search" in result


def test_create_avatar_success_prevents_false_loop_halt() -> None:
    det = LoopDetector()
    for idx in range(12):
        result = json.dumps(
            {"ok": True, "avatar_id": f"id{idx}", "name": f"分身{idx}"},
            ensure_ascii=False,
        )
        ok_flag = _tool_result_ok_flag(result)
        det.record_call(
            "create_avatar",
            LoopDetector.args_signature({"name": f"分身{idx}"}),
            has_progress=(ok_flag is True),
            result_text=result,
        )
    result = det.check()
    assert result is None or not (
        result.level == "critical" and result.detector == "no_progress"
    )


def test_repeated_avatar_exists_still_halts() -> None:
    det = LoopDetector()
    for _ in range(15):
        result = json.dumps(
            {"ok": False, "error": "avatar_exists", "message": "分身已存在"},
            ensure_ascii=False,
        )
        ok_flag = _tool_result_ok_flag(result)
        det.record_call(
            "create_avatar",
            LoopDetector.args_signature({"name": "严守真"}),
            has_progress=(ok_flag is True),
            result_text=result,
        )
    outcome = det.check()
    assert outcome is not None
    assert outcome.level == "critical"
    assert outcome.detector in {"no_progress", "generic_repeat", "tool_saturation"}


def _fake_session(messages: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(agent_messages=messages)


def test_success_digest_lists_only_confirmed_successes() -> None:
    session = _fake_session(
        [
            {"role": "user", "content": "构建专家团"},
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a1", "name": "程基岩"},
                    ensure_ascii=False,
                ),
            },
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": False, "error": "avatar_exists"},
                    ensure_ascii=False,
                ),
            },
            {"role": "tool", "name": "bash_exec", "content": "some plain output"},
            # duplicate of the first success — must be de-duplicated
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a1", "name": "程基岩"},
                    ensure_ascii=False,
                ),
            },
            {
                "role": "tool",
                "name": "create_avatar",
                "content": json.dumps(
                    {"ok": True, "avatar_id": "a2", "name": "路远行"},
                    ensure_ascii=False,
                ),
            },
        ]
    )
    digest = _build_loop_halt_success_digest(session)
    assert "程基岩" in digest
    assert "路远行" in digest
    assert "avatar_exists" not in digest
    assert "bash_exec" not in digest
    assert digest.count("程基岩") == 1
    assert digest.startswith("- create_avatar 成功")


def test_success_digest_truncates_to_max_items() -> None:
    messages = [
        {
            "role": "tool",
            "name": "create_avatar",
            "content": json.dumps(
                {"ok": True, "avatar_id": f"id{i}", "name": f"分身{i}"},
                ensure_ascii=False,
            ),
        }
        for i in range(25)
    ]
    digest = _build_loop_halt_success_digest(_fake_session(messages))
    lines = [ln for ln in digest.splitlines() if ln.strip()]
    assert len(lines) == 20
    # keeps the most recent entries
    assert "分身24" in digest
    assert "分身0" not in digest


def test_success_digest_empty_session() -> None:
    assert _build_loop_halt_success_digest(_fake_session([])) == ""
    assert _build_loop_halt_success_digest(SimpleNamespace(agent_messages=None)) == ""
