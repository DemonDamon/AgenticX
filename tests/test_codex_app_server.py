#!/usr/bin/env python3
"""Tests for the Codex app-server streaming path.

``codex exec --json`` cannot emit token deltas; these tests replay the
0.167 app-server JSON-RPC notifications (and a stub ``codex app-server``
CLI) to prove mid-turn items arrive as small chunks before the turn
returns. Existing exec --json coverage lives in
``test_harness_exec_adapters.py`` with ``AGX_CODEX_TRANSPORT=exec``.

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

from agenticx.harness.adapters._codex_app_server import (
    build_app_server_argv,
    consume_app_server_message,
    preferred_transport,
    sandbox_policy_params,
    thread_resume_params,
    thread_start_params,
    turn_start_params,
)
from agenticx.harness.adapters.codex import CodexAdapter
from agenticx.harness.types import TurnRequest

_FAKE_APP_SERVER = r'''#!/usr/bin/env python3
import json, os, sys, time

log_path = os.environ.get("FAKE_CLI_LOG")
if log_path:
    with open(log_path, "a") as f:
        f.write(json.dumps({"argv": sys.argv[1:]}) + "\n")

# exec --json fallback path used by handshake-failure tests
if len(sys.argv) > 1 and sys.argv[1] == "exec":
    print(json.dumps({
        "type": "thread.started", "thread_id": "thr_exec_fallback"
    }), flush=True)
    print(json.dumps({
        "type": "item.completed",
        "item": {"type": "agent_message", "text": "fallback ok"}
    }), flush=True)
    print(json.dumps({"type": "turn.completed", "usage": {
        "input_tokens": 1, "output_tokens": 1
    }}), flush=True)
    sys.exit(0)

scenario = os.environ.get("FAKE_SCENARIO", "happy")
thread_id = os.environ.get("FAKE_THREAD_ID", "thr_app_1")


def emit(obj):
    print(json.dumps(obj), flush=True)


if scenario == "handshake_fail":
    sys.stderr.write("app-server exploded\n")
    sys.exit(1)

# JSON-RPC stdio loop
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    try:
        msg = json.loads(raw)
    except Exception:
        continue
    method = msg.get("method")
    msg_id = msg.get("id")
    params = msg.get("params") or {}
    if log_path and method:
        with open(log_path, "a") as f:
            f.write(json.dumps({"rpc": method, "params": params}) + "\n")
    if method == "initialize":
        emit({"id": msg_id, "result": {
            "userAgent": "codex-stub",
            "codexHome": "/tmp",
            "platformFamily": "unix",
            "platformOs": "macos",
        }})
        continue
    if method == "initialized":
        continue
    if method == "thread/start":
        emit({"id": msg_id, "result": {"thread": {"id": thread_id}}})
        emit({"method": "thread/started", "params": {"thread": {"id": thread_id}}})
        continue
    if method == "thread/resume":
        tid = params.get("threadId") or thread_id
        emit({"id": msg_id, "result": {"thread": {"id": tid}}})
        continue
    if method == "turn/start":
        emit({"id": msg_id, "result": {"turn": {
            "id": "turn_1", "status": "inProgress", "items": [], "error": None
        }}})
        emit({"method": "turn/started", "params": {
            "threadId": thread_id,
            "turn": {"id": "turn_1", "status": "inProgress"}
        }})
        if scenario == "warning_then_ok":
            emit({"method": "item/completed", "params": {
                "threadId": thread_id, "turnId": "turn_1",
                "item": {"type": "error", "id": "item_0",
                         "message": "Model metadata for `glm-5.3-flash` not found."}
            }})
        chunks = os.environ.get("FAKE_CHUNKS", "黑,色,四,叶,草").split(",")
        delay = float(os.environ.get("FAKE_DELTA_DELAY", "0"))
        emit({"method": "item/started", "params": {
            "threadId": thread_id, "turnId": "turn_1",
            "item": {"type": "agentMessage", "id": "item_1", "text": ""}
        }})
        acc = ""
        for chunk in chunks:
            if delay:
                time.sleep(delay)
            acc += chunk
            emit({"method": "item/agentMessage/delta", "params": {
                "threadId": thread_id, "turnId": "turn_1",
                "itemId": "item_1", "delta": chunk
            }})
        emit({"method": "item/completed", "params": {
            "threadId": thread_id, "turnId": "turn_1",
            "item": {"type": "agentMessage", "id": "item_1", "text": acc}
        }})
        emit({"method": "thread/tokenUsage/updated", "params": {
            "threadId": thread_id, "turnId": "turn_1",
            "tokenUsage": {"last": {
                "inputTokens": 11, "cachedInputTokens": 0, "outputTokens": 4
            }}
        }})
        emit({"method": "turn/completed", "params": {
            "threadId": thread_id,
            "turn": {"id": "turn_1", "status": "completed", "error": None}
        }})
        continue
    if method == "turn/interrupt":
        emit({"id": msg_id, "result": {}})
        continue
    if msg_id is not None:
        emit({"id": msg_id, "error": {"code": -32601, "message": "unknown"}})
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


def _turn(text: str = "hello", wait: float = 30.0) -> TurnRequest:
    return TurnRequest(text=text, wait_seconds=wait)


@pytest.fixture()
def fake_app_server(tmp_path, monkeypatch):
    exe = _write_fake_cli(tmp_path, "fake-codex-app-server", _FAKE_APP_SERVER)
    log = str(tmp_path / "as-log.jsonl")
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.setenv("FAKE_CLI_LOG", log)
    monkeypatch.delenv("AGX_CODEX_TRANSPORT", raising=False)
    if os.path.exists(log):
        os.remove(log)
    return {"exe": exe, "log": log, "adapter": CodexAdapter()}


def test_preferred_transport_defaults_to_app_server(monkeypatch):
    monkeypatch.delenv("AGX_CODEX_TRANSPORT", raising=False)
    assert preferred_transport() == "app-server"
    monkeypatch.setenv("AGX_CODEX_TRANSPORT", "exec")
    assert preferred_transport() == "exec"


def test_build_app_server_argv_skips_git_and_omits_provider():
    argv = build_app_server_argv("/usr/bin/codex")
    assert argv == ["/usr/bin/codex", "app-server", "--stdio"]
    assert "model_provider" not in argv
    assert "skip_git_repo_check" not in " ".join(argv)
    assert "--sandbox" not in argv
    assert "-C" not in argv
    assert "-m" not in argv


def test_thread_resume_params_omit_cwd_and_sandbox():
    params = thread_resume_params("thr_123")
    assert params == {"threadId": "thr_123", "excludeTurns": True}
    start = thread_start_params(
        cwd="/tmp/task", model="qwen-plus", sandbox="workspace-write"
    )
    assert start["cwd"] == "/tmp/task"
    assert start["model"] == "qwen-plus"
    assert start["sandbox"] == "workspace-write"
    assert start["approvalPolicy"] == "never"
    assert "config" not in start


def test_thread_start_params_auto_enables_workspace_write_network():
    start = thread_start_params(
        cwd="/tmp/task",
        sandbox="workspace-write",
        network_access=True,
    )
    assert start["sandbox"] == "workspace-write"
    assert start["approvalPolicy"] == "never"
    assert start["config"] == {
        "sandbox_workspace_write": {"network_access": True}
    }
    # 「全部允许」must not silently open the full disk.
    assert start["sandbox"] != "danger-full-access"
    loose = thread_start_params(cwd="/tmp/task", full_auto=True)
    assert loose["sandbox"] == "danger-full-access"
    assert "config" not in loose


def test_thread_start_params_ask_stays_read_only_without_network():
    start = thread_start_params(
        cwd="/tmp/task",
        sandbox="read-only",
        network_access=False,
    )
    assert start["sandbox"] == "read-only"
    assert start["approvalPolicy"] == "never"
    assert "config" not in start


def test_turn_start_params_include_sandbox_policy_for_resume():
    auto = turn_start_params(
        "thr_123",
        "hello",
        model="glm-5.3-flash",
        sandbox="workspace-write",
        network_access=True,
    )
    assert auto["threadId"] == "thr_123"
    assert auto["model"] == "glm-5.3-flash"
    assert auto["sandboxPolicy"] == {
        "type": "workspaceWrite",
        "networkAccess": True,
    }
    allowlist = turn_start_params(
        "thr_123", "hello", sandbox="workspace-write", network_access=False
    )
    assert allowlist["sandboxPolicy"] == {"type": "workspaceWrite"}
    ask = turn_start_params(
        "thr_123", "hello", sandbox="read-only", network_access=False
    )
    assert ask["sandboxPolicy"] == {"type": "readOnly"}
    assert sandbox_policy_params("danger-full-access") == {
        "type": "dangerFullAccess"
    }


def test_consume_deltas_are_incremental_not_one_blob():
    acc: Dict[str, Any] = {"result_text": "", "detail": {}}
    items: List[Dict[str, Any]] = []

    def enqueue(item: Dict[str, Any]) -> None:
        items.append(item)

    chunks = ["黑", "色", "四", "叶", "草"]
    for chunk in chunks:
        consume_app_server_message(
            {
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "t",
                    "turnId": "u",
                    "itemId": "i",
                    "delta": chunk,
                },
            },
            acc,
            enqueue,
        )
    consume_app_server_message(
        {
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "agentMessage",
                    "id": "i",
                    "text": "".join(chunks),
                }
            },
        },
        acc,
        enqueue,
    )
    consume_app_server_message(
        {
            "method": "turn/completed",
            "params": {"turn": {"id": "u", "status": "completed"}},
        },
        acc,
        enqueue,
    )
    text_items = [row["text"] for row in items if row.get("kind") == "text"]
    assert text_items == chunks
    assert all(len(piece) < len("".join(chunks)) for piece in text_items)
    assert acc["result_text"] == "黑色四叶草"
    assert acc["detail"]["task_complete"] is True
    # Completed item must not replay the full blob after deltas streamed.
    assert "".join(text_items) == "黑色四叶草"


def test_consume_error_item_is_warning_not_fatal():
    acc: Dict[str, Any] = {"result_text": "", "detail": {}}
    consume_app_server_message(
        {
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "error",
                    "id": "e",
                    "message": "Model metadata for `glm-5.3-flash` not found.",
                }
            },
        },
        acc,
        None,
    )
    consume_app_server_message(
        {
            "method": "item/agentMessage/delta",
            "params": {"delta": "ok", "itemId": "i", "threadId": "t", "turnId": "u"},
        },
        acc,
        None,
    )
    consume_app_server_message(
        {
            "method": "turn/completed",
            "params": {"turn": {"id": "u", "status": "completed"}},
        },
        acc,
        None,
    )
    assert acc["result_text"] == "ok"
    assert acc.get("error") in {None, ""}
    assert any("Model metadata" in w for w in acc["detail"]["warnings"])


def test_consume_tool_lifecycle_and_usage():
    acc: Dict[str, Any] = {"result_text": "", "detail": {}}
    items: List[Dict[str, Any]] = []
    consume_app_server_message(
        {
            "method": "item/started",
            "params": {
                "item": {
                    "type": "commandExecution",
                    "id": "cmd1",
                    "command": "ls -la",
                    "status": "inProgress",
                }
            },
        },
        acc,
        items.append,
    )
    consume_app_server_message(
        {
            "method": "item/completed",
            "params": {
                "item": {
                    "type": "commandExecution",
                    "id": "cmd1",
                    "command": "ls -la",
                    "status": "completed",
                    "exitCode": 0,
                }
            },
        },
        acc,
        items.append,
    )
    consume_app_server_message(
        {
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "last": {
                        "inputTokens": 12,
                        "cachedInputTokens": 3,
                        "outputTokens": 5,
                    }
                }
            },
        },
        acc,
        items.append,
    )
    assert items[0]["kind"] == "tool_start"
    assert items[0]["name"] == "bash"
    assert items[1]["kind"] == "tool_end"
    assert items[1]["is_error"] is False
    assert acc["detail"]["tokens"]["input"] == 12
    assert acc["detail"]["commands"] == ["ls -la"]


def test_app_server_turn_streams_incremental_tokens(fake_app_server, monkeypatch):
    monkeypatch.setenv("FAKE_DELTA_DELAY", "0.25")
    monkeypatch.setenv("FAKE_CHUNKS", "黑,色,四,叶,草")
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    drained: List[str] = []
    batches: List[int] = []
    stop = threading.Event()

    def _pump() -> None:
        while not stop.is_set():
            items = adapter.drain_midturn_stream_items(sid)
            texts = [str(it.get("text") or "") for it in items if it.get("kind") == "text"]
            if texts:
                batches.append(len(texts))
                drained.extend(texts)
            time.sleep(0.05)

    worker = threading.Thread(target=_pump, daemon=True)
    worker.start()
    result = adapter.turn(sid, _turn("我想知道黑色四叶草好看吗"))
    stop.set()
    worker.join(timeout=5)
    leftover = adapter.drain_midturn_stream_items(sid)
    drained.extend(
        str(it.get("text") or "")
        for it in leftover
        if it.get("kind") == "text"
    )
    assert result.ok
    assert result.result_text == "黑色四叶草"
    assert result.detail["transport"] == "app-server"
    assert result.detail["native_thread_id"] == "thr_app_1"
    assert result.detail["tokens"]["output"] == 4
    assert "".join(drained) == "黑色四叶草"
    assert len(drained) >= 5
    assert max(len(piece) for piece in drained) < len("黑色四叶草")
    # At least one mid-turn pump saw text before the final drain.
    assert batches, "expected mid-turn drain batches before turn() returned"


def test_app_server_followup_reuses_thread_without_cwd(fake_app_server):
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(
        os.getcwd(),
        options={"model": "qwen-plus", "sandbox": "workspace-write"},
    )["session_id"]
    first = adapter.turn(sid, _turn("第一轮"))
    second = adapter.turn(sid, _turn("第二轮"))
    assert first.ok and second.ok
    assert adapter.describe(sid)["native_thread_id"] == "thr_app_1"
    argvs = [row["argv"] for row in _read_log(fake_app_server["log"]) if "argv" in row]
    # One long-lived app-server process for both turns.
    assert len(argvs) == 1
    argv = argvs[0]
    assert argv[0] == "app-server"
    assert "--stdio" in argv
    assert "skip_git_repo_check" not in " ".join(argv)
    assert "-C" not in argv
    assert "--sandbox" not in argv
    assert "model_provider" not in argv


def test_app_server_sends_networked_sandbox_on_start_and_turn(fake_app_server):
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(
        os.getcwd(),
        options={
            "model": "glm-5.3-flash",
            "sandbox": "workspace-write",
            "network_access": True,
            "full_auto": False,
        },
    )["session_id"]
    result = adapter.turn(sid, _turn("搜一下"))
    assert result.ok
    rows = _read_log(fake_app_server["log"])
    starts = [row for row in rows if row.get("rpc") == "thread/start"]
    turns = [row for row in rows if row.get("rpc") == "turn/start"]
    assert len(starts) == 1
    assert starts[0]["params"]["sandbox"] == "workspace-write"
    assert starts[0]["params"]["approvalPolicy"] == "never"
    assert starts[0]["params"]["config"] == {
        "sandbox_workspace_write": {"network_access": True}
    }
    assert starts[0]["params"]["sandbox"] != "danger-full-access"
    assert turns and turns[0]["params"]["sandboxPolicy"] == {
        "type": "workspaceWrite",
        "networkAccess": True,
    }


def test_app_server_resume_after_restart_omits_cwd(fake_app_server):
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(os.getcwd(), options={"model": "qwen-plus"})["session_id"]
    first = adapter.turn(sid, _turn("第一轮"))
    assert first.ok
    session = adapter._get(sid)
    adapter._close_app_server(session)
    # Same provider follow-up after the process dropped: thread/resume,
    # not a new thread, and not exec resume -C/--sandbox.
    second = adapter.turn(sid, _turn("继续"))
    assert second.ok
    assert second.detail["native_thread_id"] == "thr_app_1"
    argvs = [row["argv"] for row in _read_log(fake_app_server["log"]) if "argv" in row]
    assert len(argvs) == 2
    for argv in argvs:
        assert argv[0] == "app-server"
        assert "-C" not in argv
        assert "--sandbox" not in argv


def test_app_server_strips_model_provider_from_argv(fake_app_server):
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(
        os.getcwd(),
        options={"model": "qwen-plus", "model_provider": "agenticx-bailian"},
    )["session_id"]
    result = adapter.turn(sid, _turn())
    assert result.ok
    argv = _read_log(fake_app_server["log"])[0]["argv"]
    assert "model_provider" not in argv
    assert "agenticx-bailian" not in argv
    assert "skip_git_repo_check" not in " ".join(argv)


def test_app_server_metadata_warning_is_not_fatal(fake_app_server, monkeypatch):
    monkeypatch.setenv("FAKE_SCENARIO", "warning_then_ok")
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    result = adapter.turn(sid, _turn())
    assert result.ok
    assert result.result_text == "黑色四叶草"
    warnings = result.detail.get("warnings") or []
    assert any("Model metadata" in w for w in warnings)


def test_app_server_handshake_failure_falls_back_to_exec(fake_app_server, monkeypatch):
    monkeypatch.setenv("FAKE_SCENARIO", "handshake_fail")
    adapter = fake_app_server["adapter"]
    sid = adapter.spawn(os.getcwd())["session_id"]
    result = adapter.turn(sid, _turn())
    assert result.ok
    assert result.result_text == "fallback ok"
    assert result.detail["native_thread_id"] == "thr_exec_fallback"
    argvs = [row["argv"] for row in _read_log(fake_app_server["log"]) if "argv" in row]
    assert argvs[0][0] == "app-server"
    assert argvs[-1][0] == "exec"
    assert "--skip-git-repo-check" in argvs[-1]


def test_codex_capabilities_enable_streaming(fake_app_server):
    caps = fake_app_server["adapter"].capabilities()
    assert caps.streaming is True
    assert caps.resume is True
    assert caps.permission is False
