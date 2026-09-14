#!/usr/bin/env python3
"""Runtime wiring tests for evidence-preserving tool observations.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.tool_result_budget import OBSERVATION_ID_RE, OBSERVATION_PREFIX


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _BashThenFinalLLM:
    def __init__(self) -> None:
        self.calls = 0
        self.messages_seen: List[List[Dict[str, Any]]] = []

    def invoke(self, messages, *_args, **_kwargs):
        self.calls += 1
        self.messages_seen.append([dict(row) for row in messages if isinstance(row, dict)])
        if self.calls == 1:
            return _FakeResponse(
                "need tool",
                [
                    {
                        "id": "call-bash-1",
                        "type": "function",
                        "function": {
                            "name": "bash_exec",
                            "arguments": {"command": "cat huge.log"},
                        },
                    }
                ],
            )
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield ""


def _huge_result() -> str:
    head = "HEAD_SENTINEL\n"
    tail = "\nTAIL_SENTINEL"
    middle = "MIDDLE_SENTINEL unique-evidence\n"
    filler_size = 64 * 1024 - len(head) - len(tail) - len(middle)
    return head + ("A" * (filler_size // 2)) + middle + ("B" * (filler_size - filler_size // 2)) + tail


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str):
    items = []
    async for event in runtime.run_turn(text, session):
        items.append(event)
    return items


def test_runtime_projects_observation_and_recalls_sentinel(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.runtime import agent_runtime as runtime_module
    from agenticx.runtime.tool_result_budget import recall_tool_observation

    raw = _huge_result()
    assert "MIDDLE_SENTINEL" in raw
    assert "MIDDLE_SENTINEL" not in raw[:200]
    assert "MIDDLE_SENTINEL" not in raw[-200:]
    assert len(raw.encode("utf-8")) >= 64 * 1024
    dispatch_names: List[str] = []

    async def _fake_dispatch(name, arguments, session, **_kwargs):
        dispatch_names.append(str(name))
        if name == "bash_exec":
            return raw
        raise AssertionError(f"unexpected dispatch {name}")

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)

    llm = _BashThenFinalLLM()
    runtime = AgentRuntime(llm, _ApproveGate())
    session = StudioSession()
    session._session_id = "sess-runtime-obs-001"
    events = asyncio.run(_collect(runtime, session, "inspect the log"))

    result_event = next(event for event in events if event.type == EventType.TOOL_RESULT.value)
    projected = str(result_event.data.get("result") or "")
    assert OBSERVATION_PREFIX in projected
    match = re.search(r"id=(obs_[a-f0-9]{64})", projected)
    assert match is not None
    observation_id = match.group(1)
    assert OBSERVATION_ID_RE.match(observation_id)
    assert "tool_result_recall" in projected
    assert "MIDDLE_SENTINEL" not in projected
    compact = runtime.compactor.micro_compact_tool_result("bash_exec", raw)
    assert len(projected) <= len(compact) + 768
    assert result_event.private_data["raw_result"] == raw

    tool_msgs = [row for row in session.agent_messages if row.get("role") == "tool"]
    assert tool_msgs
    assert tool_msgs[0]["content"] == projected
    history_tools = [row for row in session.chat_history if row.get("role") == "tool"]
    assert history_tools
    assert history_tools[0]["content"] == projected

    assert llm.calls >= 2
    second_round = llm.messages_seen[1]
    second_tools = [row.get("content", "") for row in second_round if row.get("role") == "tool"]
    assert any(observation_id in str(content) for content in second_tools)

    recalled = recall_tool_observation(
        session,
        observation_id,
        query="MIDDLE_SENTINEL",
        context_lines=2,
    )
    assert "MIDDLE_SENTINEL unique-evidence" in recalled
    from agenticx.cli.agent_tools import _tool_result_recall

    restarted = StudioSession()
    restarted._session_id = "sess-runtime-obs-001"
    product_recall = _tool_result_recall(
        {"id": observation_id, "query": "MIDDLE_SENTINEL", "context_lines": 2},
        restarted,
    )
    assert "MIDDLE_SENTINEL unique-evidence" in product_recall
    assert dispatch_names == ["bash_exec"]

    stats_events = [event for event in events if event.type == EventType.CONTEXT_STATS.value]
    assert stats_events
    payload = stats_events[-1].data
    original = int(payload["_tool_observation_bytes_original"])
    projected_bytes = int(payload["_tool_observation_bytes_projected"])
    assert payload["_tool_observations_created"] == 1
    assert original == len(raw.encode("utf-8"))
    assert projected_bytes == len(projected.encode("utf-8"))
    assert payload["tool_observation_bytes_avoided"] == original - projected_bytes
    assert payload["_tool_observation_recall_calls"] == 0


def test_runtime_does_not_wrap_tool_result_recall(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    page = "[tool_result_recall id=obs_abc offset=0 next_offset=10 eof=false]\n" + ("Z" * 5000)

    class _RecallThenFinalLLM:
        def __init__(self) -> None:
            self.calls = 0

        def invoke(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                return _FakeResponse(
                    "recall",
                    [
                        {
                            "id": "call-recall-1",
                            "type": "function",
                            "function": {
                                "name": "tool_result_recall",
                                "arguments": {"id": "obs_" + ("ab" * 32), "offset_bytes": 0},
                            },
                        }
                    ],
                )
            return _FakeResponse("done", [])

        def stream(self, *_args, **_kwargs):
            yield ""

    async def _fake_dispatch(name, arguments, session, **_kwargs):
        assert name == "tool_result_recall"
        return page

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    session = StudioSession()
    session._session_id = "sess-runtime-obs-002"
    events = asyncio.run(_collect(AgentRuntime(_RecallThenFinalLLM(), _ApproveGate()), session, "recall it"))
    result_event = next(event for event in events if event.type == EventType.TOOL_RESULT.value)
    projected = str(result_event.data.get("result") or "")
    assert projected == page
    assert OBSERVATION_PREFIX not in projected
    stats_events = [event for event in events if event.type == EventType.CONTEXT_STATS.value]
    assert stats_events
    assert stats_events[-1].data["_tool_observation_recall_calls"] == 1
    assert stats_events[-1].data["_tool_observations_created"] == 0


def test_archive_failure_does_not_increment_created(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from agenticx.runtime import agent_runtime as runtime_module

    raw = _huge_result()
    session_id = "sess-runtime-obs-fail"
    blocker = tmp_path / ".agenticx" / "sessions" / session_id / "tool_archives"
    blocker.parent.mkdir(parents=True, exist_ok=True)
    blocker.write_text("not-a-dir", encoding="utf-8")

    async def _fake_dispatch(name, arguments, session, **_kwargs):
        assert name == "bash_exec"
        return raw

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", _fake_dispatch)
    session = StudioSession()
    session._session_id = session_id
    events = asyncio.run(_collect(AgentRuntime(_BashThenFinalLLM(), _ApproveGate()), session, "inspect"))
    result_event = next(event for event in events if event.type == EventType.TOOL_RESULT.value)
    projected = str(result_event.data.get("result") or "")
    assert OBSERVATION_PREFIX not in projected
    stats_events = [event for event in events if event.type == EventType.CONTEXT_STATS.value]
    assert stats_events
    payload = stats_events[-1].data
    assert payload["_tool_observations_created"] == 0
    assert payload["_tool_observation_bytes_original"] == 0
    assert payload["_tool_observation_bytes_projected"] == 0
    assert payload["tool_observation_bytes_avoided"] == 0
