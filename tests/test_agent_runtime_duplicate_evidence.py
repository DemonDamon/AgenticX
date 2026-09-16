#!/usr/bin/env python3
"""Runtime tests: duplicate read-only evidence does not refresh progress.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any, Dict, List

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AgentRuntime, ConfirmGate, EventType
from agenticx.runtime.tool_result_budget import (
    ToolResultBudgetConfig,
    prepare_tool_result_observation,
    recall_tool_observation,
)


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _ApproveGate(ConfirmGate):
    async def request_confirm(self, question: str, context: Dict[str, Any] | None = None) -> bool:
        return True


class _ScriptedLLM:
    def __init__(self, calls: List[List[Dict[str, Any]]]) -> None:
        self._calls = list(calls)
        self.round = 0

    def invoke(self, *_args, **_kwargs):
        self.round += 1
        if self._calls:
            return _FakeResponse("need tool", self._calls.pop(0))
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield ""


def _call(name: str, arguments: Dict[str, Any], call_id: str) -> Dict[str, Any]:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments},
    }


async def _collect(runtime: AgentRuntime, session: StudioSession, text: str):
    return [event async for event in runtime.run_turn(text, session)]


def _progress_marks(runtime: AgentRuntime) -> List[bool]:
    return list(runtime.loop_detector._progress_marks)


def _run_scripted(
    monkeypatch,
    tmp_path: Path,
    script: List[List[Dict[str, Any]]],
    dispatch,
    session_id: str = "sess-dup-001",
) -> tuple[AgentRuntime, StudioSession, List[Any]]:
    from agenticx.runtime import agent_runtime as runtime_module

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(runtime_module, "dispatch_tool_async", dispatch)
    runtime = AgentRuntime(_ScriptedLLM(script), _ApproveGate())
    session = StudioSession()
    session._session_id = session_id
    events = asyncio.run(_collect(runtime, session, "go"))
    return runtime, session, events


def test_duplicate_file_read_is_not_progress(tmp_path, monkeypatch) -> None:
    raw = "FILEBODY\n" + ("Q" * 6000)

    async def _dispatch(name, arguments, session, **_kwargs):
        assert name == "file_read"
        return raw

    runtime, _session, events = _run_scripted(
        monkeypatch,
        tmp_path,
        [
            [
                _call("file_read", {"path": "/tmp/a.txt"}, "c1"),
                _call("file_read", {"path": "/tmp/a.txt"}, "c2"),
            ]
        ],
        _dispatch,
    )
    marks = _progress_marks(runtime)
    assert marks[0] is True
    assert marks[1] is False
    nudge = getattr(runtime, "_pending_loop_nudge", None) or ""
    assert "tool_result_recall" in nudge
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert f"obs_{digest}" in nudge
    tool_results = [e for e in events if e.type == EventType.TOOL_RESULT.value]
    assert len(tool_results) == 2
    assert all("[tool-result-observation]" in str(e.data.get("result") or "") for e in tool_results)


def test_changed_file_read_is_progress(tmp_path, monkeypatch) -> None:
    payloads = ["FIRST\n" + ("A" * 5000), "SECOND\n" + ("B" * 5000)]

    async def _dispatch(name, arguments, session, **_kwargs):
        return payloads.pop(0)

    runtime, _session, _events = _run_scripted(
        monkeypatch,
        tmp_path,
        [
            [
                _call("file_read", {"path": "/tmp/a.txt"}, "c1"),
                _call("file_read", {"path": "/tmp/a.txt"}, "c2"),
            ]
        ],
        _dispatch,
    )
    marks = _progress_marks(runtime)
    assert marks[0] is True
    assert marks[1] is True


def test_duplicate_readonly_bash_is_not_progress(tmp_path, monkeypatch) -> None:
    raw = "LISTING\n" + ("L" * 5000)

    async def _dispatch(name, arguments, session, **_kwargs):
        assert name == "bash_exec"
        return raw

    runtime, _session, _events = _run_scripted(
        monkeypatch,
        tmp_path,
        [
            [
                _call("bash_exec", {"command": "ls"}, "b1"),
                _call("bash_exec", {"command": "ls"}, "b2"),
            ]
        ],
        _dispatch,
    )
    marks = _progress_marks(runtime)
    assert marks[0] is True
    assert marks[1] is False


def test_write_tools_are_not_downgraded(tmp_path, monkeypatch) -> None:
    async def _dispatch(name, arguments, session, **_kwargs):
        if name == "file_write":
            return "OK: wrote /tmp/out.txt"
        if name == "bash_exec":
            return "removed /tmp/demo"
        raise AssertionError(name)

    runtime, _session, _events = _run_scripted(
        monkeypatch,
        tmp_path,
        [
            [
                _call("file_write", {"path": "/tmp/out.txt", "content": "same"}, "w1"),
                _call("file_write", {"path": "/tmp/out.txt", "content": "same"}, "w2"),
                _call("bash_exec", {"command": "rm -rf /tmp/demo"}, "rm1"),
                _call("bash_exec", {"command": "rm -rf /tmp/demo"}, "rm2"),
            ]
        ],
        _dispatch,
    )
    marks = _progress_marks(runtime)
    assert marks[0] is True
    assert marks[1] is True
    assert marks[2] is True
    assert marks[3] is True


def test_recall_pages_are_progress_until_repeated(tmp_path, monkeypatch) -> None:
    raw = "HEAD\n" + ("M" * 8000) + "\nTAIL"
    session_for_archive = StudioSession()
    session_for_archive._session_id = "sess-dup-recall"
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    obs = prepare_tool_result_observation(
        session_for_archive,
        round_idx=1,
        tool_call_id="prep",
        tool_name="bash_exec",
        raw_text=raw,
        compacted_text=raw[:200] + "\n...\n" + raw[-200:],
        cfg=ToolResultBudgetConfig(enabled=True, archive_batch_tokens=0),
    )
    assert obs.observation_id is not None
    first = recall_tool_observation(session_for_archive, obs.observation_id, offset_bytes=0)
    next_offset = int(first.split("next_offset=", 1)[1].split()[0])
    second = recall_tool_observation(
        session_for_archive, obs.observation_id, offset_bytes=next_offset
    )

    pages = [first, second, first]

    async def _dispatch(name, arguments, session, **_kwargs):
        assert name == "tool_result_recall"
        return pages.pop(0)

    runtime, _session, _events = _run_scripted(
        monkeypatch,
        tmp_path,
        [
            [
                _call("tool_result_recall", {"id": obs.observation_id, "offset_bytes": 0}, "r1"),
                _call(
                    "tool_result_recall",
                    {"id": obs.observation_id, "offset_bytes": next_offset},
                    "r2",
                ),
                _call("tool_result_recall", {"id": obs.observation_id, "offset_bytes": 0}, "r3"),
            ]
        ],
        _dispatch,
        session_id="sess-dup-recall",
    )
    marks = _progress_marks(runtime)
    assert marks[0] is True
    assert marks[1] is True
    assert marks[2] is False
