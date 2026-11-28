#!/usr/bin/env python3
"""Tests for the structured harness event outlet (runtime invariants 04).

Covers the outlet primitives on the adapter base class and the emit
wiring of all four builtin adapters (exec CLI engine, Codex app-server,
the two bridge adapters). No real CLI is spawned: exec paths run fake
executable stubs, bridges run fake subprocesses.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import queue
import stat
import subprocess
import threading
from typing import Any, Dict, List, Optional

import pytest

from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter
from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter
from agenticx.harness.adapters.opencode import OpenCodeAdapter
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.types import (
    HARNESS_EVENT_TURN_FINISHED,
    HARNESS_EVENT_TURN_STARTED,
    HarnessEvent,
    TurnRequest,
)


class RecordingSink:
    """Collect every event; optionally raise on call."""

    def __init__(self, *, raise_on_event: bool = False) -> None:
        self.events: List[HarnessEvent] = []
        self.raise_on_event = raise_on_event

    def __call__(self, event: HarnessEvent) -> None:
        if self.raise_on_event:
            raise RuntimeError("sink exploded")
        self.events.append(event)


# ----------------------------------------------------------------------
# outlet primitives
# ----------------------------------------------------------------------
def test_attach_and_roundtrip_emits_event() -> None:
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True

    adapter.emit_harness_event("sid-1", "turn_started", {"user_text": "hi"})

    assert len(sink.events) == 1
    event = sink.events[0]
    assert event.type == "turn_started"
    assert event.harness == "opencode"
    assert event.session_id == "sid-1"
    assert event.payload == {"user_text": "hi"}
    assert event.ts > 0.0


def test_attach_none_clears_the_sink() -> None:
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True
    assert adapter.attach_event_sink("sid-1", None) is True

    adapter.emit_harness_event("sid-1", "turn_started", {})

    assert sink.events == []


def test_attach_rejects_invalid_targets() -> None:
    adapter = OpenCodeAdapter()
    assert adapter.attach_event_sink("", RecordingSink()) is False
    assert adapter.attach_event_sink("sid-1", "not-callable") is False


def test_emit_without_sink_is_noop() -> None:
    adapter = OpenCodeAdapter()
    adapter.emit_harness_event("never-attached", "turn_started", {})
    # no sink, no raise, nothing to assert beyond survival


def test_emit_swallows_sink_errors() -> None:
    adapter = OpenCodeAdapter()
    adapter.attach_event_sink("sid-1", RecordingSink(raise_on_event=True))
    adapter.emit_harness_event("sid-1", "turn_started", {})
    # a broken sink must never propagate into the turn


def test_sink_registry_is_lazy_without_init() -> None:
    # The bridge adapters never run the harness-side __init__, so the
    # registry must rebuild itself lazily even when the attribute is
    # missing from __dict__.
    adapter = OpenCodeAdapter()
    adapter.__dict__.pop("_harness_event_sinks", None)
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True
    adapter.emit_harness_event("sid-1", "turn_started", {})
    assert len(sink.events) == 1


# ----------------------------------------------------------------------
# emit wiring: exec CLI engine (opencode), codex exec fallback,
# codex app-server, and the two bridge adapters
# ----------------------------------------------------------------------
_FAKE_OPENCODE_CLI = r'''#!/usr/bin/env python3
import json, sys
print(json.dumps({"type": "step_start", "sessionID": "ses_o1",
      "part": {"type": "step-start"}}))
print(json.dumps({"type": "tool_use", "sessionID": "ses_o1", "part": {
    "type": "tool", "tool": "write", "callID": "c1",
    "state": {"status": "completed", "input": {}, "output": "ok"}}}))
print(json.dumps({"type": "text", "sessionID": "ses_o1",
      "part": {"type": "text", "text": "Hello from opencode"}}))
print(json.dumps({"type": "step_finish", "sessionID": "ses_o1", "part": {
    "type": "step-finish", "reason": "stop",
    "tokens": {"total": 7814, "input": 5764, "output": 2}}}))
'''

_FAKE_CODEX_CLI = r'''#!/usr/bin/env python3
import json, os, sys, time

log_path = os.environ.get("FAKE_CLI_LOG")
if log_path:
    with open(log_path, "a") as f:
        f.write(json.dumps({"argv": sys.argv[1:]}) + "\n")

scenario = os.environ.get("FAKE_SCENARIO", "happy")


def emit(msg):
    print(json.dumps({"id": "e1", "msg": msg,
                      "timestamp": "2026-11-03T00:00:00Z"}), flush=True)


if scenario == "slow":
    time.sleep(60)
    sys.exit(0)
if scenario == "skip_git_denied":
    print("Reading additional input from stdin...", flush=True)
    print("Not inside a trusted directory and --skip-git-repo-check was not specified.", flush=True)
    sys.exit(1)
if scenario == "flat_v0167":
    # Codex 0.167+ emits flat events (no msg envelope).
    def emit_flat(obj):
        print(json.dumps(obj), flush=True)
    emit_flat({"type": "thread.started", "thread_id": "thr_flat167"})
    emit_flat({"type": "item.completed", "item": {
        "id": "item_0", "type": "error",
        "message": "Model metadata for `glm-5.3-flash` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."
    }})
    emit_flat({"type": "turn.started"})
    emit_flat({"type": "item.completed", "item": {
        "id": "item_1", "type": "agent_message", "text": "ok"
    }})
    emit_flat({"type": "turn.completed", "usage": {
        "input_tokens": 11611, "cached_input_tokens": 0,
        "cache_write_input_tokens": 0, "output_tokens": 3,
        "reasoning_output_tokens": 1
    }})
    sys.exit(0)

emit({"type": "thread.started", "thread_id": "thr_fake222"})
emit({"type": "task_started"})
if scenario == "error_event":
    emit({"type": "error", "message": "model unavailable"})
    sys.exit(1)
emit({"type": "agent_reasoning", "text": "thinking"})
emit({"type": "exec_command_begin", "command": ["ls", "-la"]})
emit({"type": "exec_command_end", "stdout": "file1\nfile2"})
emit({"type": "agent_message", "message": "Working on it. "})
emit({"type": "task_complete", "last_agent_message": "All done from codex"})
emit({"type": "token_count", "info": {"total_token_usage": {
    "last_token_usage": {"input": 100, "cached_input": 20, "output": 5}}}})
'''

_FAKE_APP_SERVER_CLI = r'''#!/usr/bin/env python3
import json, sys
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    msg = json.loads(raw)
    method = msg.get("method")
    msg_id = msg.get("id")
    if method == "initialize":
        print(json.dumps({"id": msg_id, "result": {"userAgent": "stub"}}),
              flush=True)
    elif method == "thread/start":
        print(json.dumps({"id": msg_id, "result": {"thread": {"id": "thr_1"}}}),
              flush=True)
    elif method == "turn/start":
        print(json.dumps({"id": msg_id, "result": {"turn": {
            "id": "turn_1", "status": "inProgress"}}}), flush=True)
        print(json.dumps({"method": "item/completed", "params": {
            "threadId": "thr_1", "turnId": "turn_1",
            "item": {"type": "agentMessage", "id": "i1",
                     "text": "app-server reply"}}}), flush=True)
        print(json.dumps({"method": "turn/completed", "params": {
            "threadId": "thr_1", "turn": {"id": "turn_1",
            "status": "completed", "error": None}}}), flush=True)
    elif msg_id is not None:
        print(json.dumps({"id": msg_id, "error": {"code": -32601,
                                                  "message": "unknown"}}),
              flush=True)
'''


class ScriptedStream:
    """stdout stand-in: blocks on readline until lines are emitted."""

    def __init__(self) -> None:
        self._lines: "queue.Queue[str]" = queue.Queue()

    def emit(self, line: str) -> None:
        self._lines.put(line)

    def close(self) -> None:
        self._lines.put("")

    def readline(self) -> str:
        try:
            return self._lines.get(timeout=10)
        except queue.Empty:  # pragma: no cover - keeps reader threads bounded
            return ""


class TriggeredStdin:
    """stdin stand-in: writing dispatches scripted response lines."""

    def __init__(self, stream: ScriptedStream, responses: List[str]) -> None:
        self._stream = stream
        self._responses = list(responses)

    def write(self, data: str) -> None:
        for line in self._responses:
            self._stream.emit(line)

    def flush(self) -> None:
        return None


class FakeProc:
    def __init__(self, stdout: ScriptedStream) -> None:
        self.pid = 4242
        self.stdout = stdout
        self.stderr = ScriptedStream()
        self._stdin: Optional[TriggeredStdin] = None
        self._code: Optional[int] = None
        self._exit = threading.Event()

    def attach_stdin(self, stdin: TriggeredStdin) -> None:
        self._stdin = stdin

    @property
    def stdin(self) -> Optional[TriggeredStdin]:
        return self._stdin

    def poll(self) -> Optional[int]:
        return self._code

    def wait(self, timeout: Optional[float] = None) -> int:
        if not self._exit.wait(timeout):
            raise subprocess.TimeoutExpired(cmd="fake-proc", timeout=timeout)
        return self._code if self._code is not None else 0

    def terminate(self) -> None:
        self._code = 0
        self._exit.set()

    def kill(self) -> None:
        self._code = 0
        self._exit.set()


def _fake_popen_factory(responses: List[str]):
    """Popen fake: every spawned child replies with ``responses`` on stdin write."""

    def fake_popen(args, **kwargs):
        stdout = ScriptedStream()
        proc = FakeProc(stdout)
        proc.attach_stdin(TriggeredStdin(stdout, responses))
        return proc

    return fake_popen


def _write_fake_cli(tmp_path, name: str, source: str) -> str:
    path = tmp_path / name
    path.write_text(source)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


_CC_RESULT = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"hello from claude","session_id":"abc","duration_ms":10}'
)

_WB_RESULT = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"OK","duration_ms":9804,"num_turns":2,'
    '"usage":{"input_tokens":100,"output_tokens":3,'
    '"cache_read_input_tokens":5,"cache_creation_input_tokens":0},'
    '"permission_denials":[]}'
)


def test_exec_cli_turn_emits_started_and_finished(tmp_path, monkeypatch) -> None:
    exe = _write_fake_cli(tmp_path, "fake-opencode", _FAKE_OPENCODE_CLI)
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", exe)
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    started = sink.events[0]
    assert started.payload["user_text"] == "hello"
    finished = sink.events[1]
    assert finished.payload["status"] == "success"
    assert finished.payload["result_text"] == "Hello from opencode"
    assert finished.payload["detail"]["tokens"]["input"] == 5764


def test_codex_exec_transport_emits_events(tmp_path, monkeypatch) -> None:
    from agenticx.harness.adapters.codex import CodexAdapter

    exe = _write_fake_cli(tmp_path, "fake-codex", _FAKE_CODEX_CLI)
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.setenv("AGX_CODEX_TRANSPORT", "exec")
    adapter = CodexAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "All done from codex"
    assert sink.events[1].payload["detail"]["tokens"]["input"] == 100


def test_codex_app_server_turn_emits_events(tmp_path, monkeypatch) -> None:
    from agenticx.harness.adapters.codex import CodexAdapter

    exe = _write_fake_cli(tmp_path, "fake-codex-app-server", _FAKE_APP_SERVER_CLI)
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.delenv("AGX_CODEX_TRANSPORT", raising=False)
    adapter = CodexAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "app-server reply"
    assert sink.events[1].payload["detail"]["transport"] == "app-server"


def test_claude_code_headless_turn_emits_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_CC_RESULT]),
    )
    adapter = ClaudeCodeAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"mode": "headless"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="say hello", wait_seconds=5.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[0].payload["user_text"] == "say hello"
    assert sink.events[1].payload["result_text"] == "hello from claude"


def test_codebuddy_turn_emits_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT]),
    )
    adapter = CodeBuddyAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"permission_mode": "default"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="do the thing", wait_seconds=5.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "OK"
    assert sink.events[1].payload["detail"]["turn_seq"] == 1


def test_codebuddy_dedup_turn_does_not_double_emit(
    tmp_path, monkeypatch
) -> None:
    # Reuse the surface-test idempotency fake: first turn sends a key,
    # second turn with the same key must dedup WITHOUT a second
    # turn_started (no new child turn actually ran).
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT]),
    )
    adapter = CodeBuddyAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"permission_mode": "default"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    first = adapter.turn(sid, TurnRequest(text="a", wait_seconds=5.0,
                                          idempotency_key="k1"))
    second = adapter.turn(sid, TurnRequest(text="a", wait_seconds=5.0,
                                           idempotency_key="k1"))

    assert first.status == "success" and second.deduplicated is True
    started = [e for e in sink.events if e.type == HARNESS_EVENT_TURN_STARTED]
    assert len(started) == 1
