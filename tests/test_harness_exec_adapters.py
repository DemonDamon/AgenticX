#!/usr/bin/env python3
"""Tests for the SP2 exec-CLI harness adapters (Codex / OpenCode).

The engine spawns real child processes, so the fakes here are executable
stub CLIs that replay the recorded protocol streams (master-plan
discipline #6: recorded/stubbed protocol replay, no real subscription):

- OpenCode events observed on the real 1.18.20 CLI (``run --format json``)
- Codex ``exec --json`` envelope events

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import stat
import threading
import time
from typing import Any, Dict, List

import pytest

from agenticx.harness.adapters.codex import CodexAdapter
from agenticx.harness.adapters.opencode import OpenCodeAdapter
from agenticx.harness.registry import default_registry
from agenticx.harness.types import TurnInProgressError, TurnRequest

_FAKE_OPENCODE = r'''#!/usr/bin/env python3
import json, os, sys, time

log_path = os.environ.get("FAKE_CLI_LOG")
if log_path:
    with open(log_path, "a") as f:
        f.write(json.dumps({"argv": sys.argv[1:]}) + "\n")

scenario = os.environ.get("FAKE_SCENARIO", "happy")
sid = os.environ.get("FAKE_SESSION_ID", "ses_fake111")


def emit(obj):
    print(json.dumps(obj), flush=True)


if scenario == "slow":
    time.sleep(60)
    sys.exit(0)
if scenario == "fail":
    emit({"type": "step_start", "sessionID": sid,
          "part": {"type": "step-start"}})
    print("plain noise line", flush=True)
    sys.exit(1)

emit({"type": "step_start", "timestamp": 1, "sessionID": sid,
      "part": {"type": "step-start"}})
if scenario == "tool_error":
    emit({"type": "tool_use", "sessionID": sid, "part": {
        "type": "tool", "tool": "bash",
        "state": {"status": "error", "output": "boom"}}})
    emit({"type": "text", "sessionID": sid,
          "part": {"type": "text", "text": "failed"}})
    emit({"type": "step_finish", "sessionID": sid, "part": {
        "type": "step-finish", "reason": "stop"}})
    sys.exit(0)
if scenario == "tools":
    emit({"type": "tool_use", "sessionID": sid, "part": {
        "type": "tool", "tool": "write", "callID": "c1",
        "state": {"status": "completed", "input": {}, "output": "ok",
                  "title": "hello.txt"}}})
emit({"type": "text", "sessionID": sid,
      "part": {"type": "text", "text": "Hello from opencode"}})
emit({"type": "step_finish", "sessionID": sid, "part": {
    "type": "step-finish", "reason": "stop",
    "tokens": {"total": 7814, "input": 5764, "output": 2}, "cost": 0}})
'''

_FAKE_CODEX = r'''#!/usr/bin/env python3
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


def _write_fake_cli(tmp_path, name: str, source: str) -> str:
    path = tmp_path / name
    path.write_text(source)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


def _read_log(log_path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(log_path):
        return []
    with open(log_path) as f:
        return [json.loads(line) for line in f if line.strip()]


@pytest.fixture()
def fake_opencode(tmp_path, monkeypatch):
    exe = _write_fake_cli(tmp_path, "fake-opencode", _FAKE_OPENCODE)
    log = str(tmp_path / "oc-log.jsonl")
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", exe)
    monkeypatch.setenv("FAKE_CLI_LOG", log)
    if os.path.exists(log):
        os.remove(log)
    return {"exe": exe, "log": log, "adapter": OpenCodeAdapter()}


@pytest.fixture()
def fake_codex(tmp_path, monkeypatch):
    exe = _write_fake_cli(tmp_path, "fake-codex", _FAKE_CODEX)
    log = str(tmp_path / "cx-log.jsonl")
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.setenv("FAKE_CLI_LOG", log)
    if os.path.exists(log):
        os.remove(log)
    return {"exe": exe, "log": log, "adapter": CodexAdapter()}


def _turn(text: str = "hello", wait: float = 30.0) -> TurnRequest:
    return TurnRequest(text=text, wait_seconds=wait)


# ----------------------------------------------------------------------
# registry
# ----------------------------------------------------------------------
def test_registry_includes_codex_and_opencode():
    ids = default_registry().list_ids()
    assert "codex" in ids
    assert "opencode" in ids


# ----------------------------------------------------------------------
# OpenCode adapter
# ----------------------------------------------------------------------
def test_opencode_spawn_describe(fake_opencode):
    adapter = fake_opencode["adapter"]
    view = adapter.spawn(os.getcwd())
    assert view["harness"] == "opencode"
    assert view["state"] == "idle"
    assert view["turn_count"] == 0
    # session ids are UUIDs (unified-surface contract)
    import uuid as _uuid

    _uuid.UUID(view["session_id"])


def test_opencode_spawn_rejects_unknown_options(fake_opencode):
    adapter = fake_opencode["adapter"]
    with pytest.raises(ValueError, match="unknown spawn options"):
        adapter.spawn(os.getcwd(), options={"mode": "headless"})


def test_opencode_spawn_rejects_missing_cwd(fake_opencode):
    adapter = fake_opencode["adapter"]
    with pytest.raises(ValueError, match="cwd"):
        adapter.spawn("/definitely/not/a/real/dir")


def test_opencode_turn_success(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    result = adapter.turn(sid, _turn())
    assert result.ok
    assert result.status == "success"
    assert result.result_text == "Hello from opencode"
    assert result.detail["native_thread_id"] == "ses_fake111"
    assert result.detail["tokens"]["total"] == 7814
    assert result.detail["finish_reason"] == "stop"
    assert result.detail["turn_count"] == 1
    # session view carries the native thread id for later resume
    assert adapter.describe(sid)["native_thread_id"] == "ses_fake111"


def test_opencode_turn_tool_events(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "tools"
    try:
        result = adapter.turn(sid, _turn())
    finally:
        os.environ.pop("FAKE_SCENARIO", None)
    assert result.ok
    assert result.detail["observed_tools"] == ["write"]
    events = result.detail["tool_events"]
    assert events and events[0]["tool"] == "write"
    assert events[0]["status"] == "completed"


def test_opencode_turn_tool_error_maps_to_error(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "tool_error"
    try:
        result = adapter.turn(sid, _turn())
    finally:
        os.environ.pop("FAKE_SCENARIO", None)
    assert result.status == "error"
    assert "bash: boom" in result.detail["error"]


def test_opencode_turn_exit_nonzero_maps_to_error(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "fail"
    try:
        result = adapter.turn(sid, _turn())
    finally:
        os.environ.pop("FAKE_SCENARIO", None)
    assert result.status == "error"
    assert result.detail["exit_code"] == 1


def test_opencode_resume_passes_session_flag(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    adapter.turn(sid, _turn())
    adapter.turn(sid, _turn("second"))
    argvs = _read_log(fake_opencode["log"])
    assert len(argvs) == 2
    first, second = argvs[0]["argv"], argvs[1]["argv"]
    assert first[0] == "run"
    assert "-s" not in first
    assert second[0] == "run"
    # second turn resumes the native thread observed in turn 1
    i = second.index("-s")
    assert second[i + 1] == "ses_fake111"
    assert "second" in second


def test_opencode_turn_timeout(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "slow"
    try:
        started = time.monotonic()
        result = adapter.turn(sid, _turn(wait=0.5))
        elapsed = time.monotonic() - started
    finally:
        os.environ.pop("FAKE_SCENARIO", None)
    assert result.status == "timeout"
    assert elapsed < 15
    # session survives a timeout; state returns to idle
    assert adapter.describe(sid)["state"] == "idle"


def test_opencode_inflight_conflict(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "slow"
    try:
        outcome: Dict[str, Any] = {}

        def _run_first() -> None:
            outcome["result"] = adapter.turn(sid, _turn(wait=0))

        worker = threading.Thread(target=_run_first, daemon=True)
        worker.start()
        time.sleep(0.8)  # let the first turn register as in-flight
        with pytest.raises(TurnInProgressError):
            adapter.turn(sid, _turn())
        assert adapter.stop(sid) is True
        worker.join(timeout=10)
        assert not worker.is_alive()
        first = outcome["result"]
        assert first.status in ("timeout", "error")
    finally:
        os.environ.pop("FAKE_SCENARIO", None)


def test_opencode_stop_unknown_session(fake_opencode):
    adapter = fake_opencode["adapter"]
    assert adapter.stop("00000000-0000-0000-0000-000000000000") is False


def test_opencode_available_flag(fake_opencode, monkeypatch):
    adapter = fake_opencode["adapter"]
    assert adapter.available() is True
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", "/no/such/opencode")
    assert adapter.available() is False


def test_opencode_spawn_options_forwarded(fake_opencode):
    adapter = fake_opencode["adapter"]
    sid = adapter.spawn(
        os.getcwd(),
        options={"model": "anthropic/claude-sonnet-4", "auto_approve": True},
    )["session_id"]
    adapter.turn(sid, _turn())
    argv = _read_log(fake_opencode["log"])[0]["argv"]
    i = argv.index("-m")
    assert argv[i + 1] == "anthropic/claude-sonnet-4"
    assert "--auto" in argv


# ----------------------------------------------------------------------
# Codex adapter
# ----------------------------------------------------------------------
def test_codex_spawn_and_turn_success(fake_codex):
    adapter = fake_codex["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    result = adapter.turn(sid, _turn())
    assert result.ok
    assert result.result_text == "All done from codex"
    assert result.detail["native_thread_id"] == "thr_fake222"
    assert result.detail["observed_tools"] == ["bash"]
    assert result.detail["commands"] == ["ls -la"]
    assert result.detail["tokens"]["input"] == 100
    assert result.detail["task_complete"] is True


def test_codex_spawn_rejects_invalid_sandbox(fake_codex):
    adapter = fake_codex["adapter"]
    with pytest.raises(ValueError, match="sandbox"):
        adapter.spawn(os.getcwd(), options={"sandbox": "yolo"})


def test_codex_spawn_rejects_unknown_options(fake_codex):
    adapter = fake_codex["adapter"]
    with pytest.raises(ValueError, match="unknown spawn options"):
        adapter.spawn(os.getcwd(), options={"mode": "whatever"})


def test_codex_resume_args(fake_codex):
    adapter = fake_codex["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    adapter.turn(sid, _turn())
    adapter.turn(sid, _turn("again"))
    argvs = _read_log(fake_codex["log"])
    second = argvs[1]["argv"]
    assert second[:3] == ["exec", "resume", "thr_fake222"]
    assert "--json" in second


def test_codex_sandbox_and_model_args(fake_codex):
    adapter = fake_codex["adapter"]
    sid = adapter.spawn(
        os.getcwd(),
        options={"model": "gpt-5.2-codex", "sandbox": "workspace-write"},
    )["session_id"]
    adapter.turn(sid, _turn())
    argv = _read_log(fake_codex["log"])[0]["argv"]
    assert argv[0] == "exec"
    assert argv[argv.index("--sandbox") + 1] == "workspace-write"
    assert argv[argv.index("-m") + 1] == "gpt-5.2-codex"
    i = argv.index("-C")
    assert argv[i + 1] == os.getcwd()


def test_codex_error_event_maps_to_error(fake_codex):
    adapter = fake_codex["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    os.environ["FAKE_SCENARIO"] = "error_event"
    try:
        result = adapter.turn(sid, _turn())
    finally:
        os.environ.pop("FAKE_SCENARIO", None)
    assert result.status == "error"
    assert "model unavailable" in result.detail["error"]


def test_codex_capabilities_declared(fake_codex):
    caps = fake_codex["adapter"].capabilities()
    assert caps.resume is True
    assert caps.permission is False
    assert caps.pty is False
    assert caps.turn_snapshots is True


def test_opencode_capabilities_declared(fake_opencode):
    caps = fake_opencode["adapter"].capabilities()
    assert caps.resume is True
    assert caps.permission is False
    assert caps.pty is False
    assert caps.turn_snapshots is True
