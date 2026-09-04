#!/usr/bin/env python3
"""Smoke tests for the local CodeBuddy (WB) bridge. No real codebuddy process.

Author: Damon Li
"""

from __future__ import annotations

import inspect
import io
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from agenticx.cc_bridge.settings import _DEFAULT_URL as CC_DEFAULT_URL
from agenticx.wb_bridge import settings as wb_settings
from agenticx.wb_bridge.session_manager import WbBridgeSession, WbBridgeSessionManager
from agenticx.wb_bridge.settings import (
    CODEBUDDY_PATH_CANDIDATES,
    CODEBUDDY_WHICH_NAMES,
    _DEFAULT_URL as WB_DEFAULT_URL,
    resolve_codebuddy_executable,
)

# E-2 captured stream-json lines (field names as measured).
_E2_SYSTEM_INIT = (
    '{"type":"system","subtype":"init","session_id":"8818e073-48bb-4863-a84e-b1ee1bcfc3f2",'
    '"apiKeySource":"copilot.tencent.com","model":"auto","permissionMode":"default",'
    '"tools":[],"mcp_servers":[]}'
)
_E2_ASSISTANT = (
    '{"type":"assistant","message":{"content":[{"type":"text","text":"OK"}],'
    '"model":"glm-5.3","role":"assistant"}}'
)
_E2_RESULT = (
    '{"type":"result","subtype":"success","is_error":false,"result":"OK",'
    '"uuid":"f5084950-a209-4b30-a579-a33856202f07",'
    '"session_id":"8818e073-48bb-4863-a84e-b1ee1bcfc3f2","duration_ms":9804,'
    '"duration_api_ms":9803,"num_turns":2,"total_cost_usd":0,'
    '"usage":{"input_tokens":24426,"output_tokens":3,'
    '"cache_creation_input_tokens":24234,"cache_read_input_tokens":192,'
    '"cache_creation":null,"server_tool_use":null,"service_tier":null},'
    '"permission_denials":[],'
    '"modelUsage":{"auto":{"inputTokens":0,"outputTokens":3,'
    '"cacheReadInputTokens":192,"cacheCreationInputTokens":24234,'
    '"contextWindow":168000,"maxOutputTokens":32000}},'
    '"_meta":{"traceparent":"00-8fbc6cd30ad8fa70289a235bd07f2de4-5b77bcffbd281904-01",'
    '"baggage":"codebuddy.session_id=8818e073-48bb-4863-a84e-b1ee1bcfc3f2,'
    'codebuddy.conversation_request_id=8fbc6cd30ad8fa70289a235bd07f2de4"},'
    '"__timestamp":"2026-09-03T04:08:28.157Z","_requestId":"8fbc6cd30ad8fa70289a235bd07f2de4"}'
)

# P0.5-A fixtures: tool activity + non-success terminal lines.
_E2_TOOL_USE = (
    '{"type":"assistant","message":{"role":"assistant","model":"glm-5.3",'
    '"content":[{"type":"tool_use","id":"toolu_1","name":"Write",'
    '"input":{"file_path":"/private/tmp/hello.py"}}]}}'
)
_E2_TOOL_USE_BASH = (
    '{"type":"assistant","message":{"role":"assistant","model":"glm-5.3",'
    '"content":[{"type":"tool_use","id":"toolu_2","name":"Bash",'
    '"input":{"command":"python3 /private/tmp/hello.py"}}]}}'
)
_RESULT_BLOCKED = (
    '{"type":"result","subtype":"error_during_execution","is_error":true,'
    '"result":null,"duration_ms":1200,"num_turns":3,'
    '"usage":{"input_tokens":10,"output_tokens":2,'
    '"cache_creation_input_tokens":0,"cache_read_input_tokens":5},'
    '"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_2"}]}'
)
_RESULT_ERROR = (
    '{"type":"result","subtype":"error_max_turns","is_error":true,"result":null,'
    '"duration_ms":900,"num_turns":9,"permission_denials":[]}'
)
_MALFORMED = '{"type":"result","subtype":'  # truncated JSON


class _FakeStream:
    def readline(self) -> str:
        return ""

    def close(self) -> None:
        return None


class _FakeProc:
    def __init__(self, *, running: bool = True) -> None:
        self.pid = 4242
        self.stdin = io.StringIO()
        self.stdout = _FakeStream()
        self.stderr = _FakeStream()
        self._code = None if running else 0

    def poll(self):
        return self._code

    def wait(self, timeout=None):
        self._code = 0
        return 0

    def terminate(self) -> None:
        self._code = 0

    def kill(self) -> None:
        self._code = 0


def test_ac1_resolve_executable_env_and_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_WB_BRIDGE_EXECUTABLE", "/tmp/fake-cb")
    assert resolve_codebuddy_executable() == "/tmp/fake-cb"

    monkeypatch.delenv("AGX_WB_BRIDGE_EXECUTABLE", raising=False)
    monkeypatch.setattr(wb_settings.ConfigManager, "get_value", lambda key: None)
    monkeypatch.setattr(wb_settings.os, "access", lambda *a, **k: False)
    monkeypatch.setattr(wb_settings.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="AGX_WB_BRIDGE_EXECUTABLE"):
        resolve_codebuddy_executable()


def test_ac2_never_uses_wb_as_executable_name() -> None:
    assert "wb" not in CODEBUDDY_WHICH_NAMES
    names = {Path(p).name for p in CODEBUDDY_PATH_CANDIDATES}
    assert "wb" not in names
    src = inspect.getsource(wb_settings)
    assert not re.search(r"""which\(\s*['\"]wb['\"]\s*\)""", src)
    assert "wb" not in resolve_codebuddy_executable.__code__.co_consts


def test_ac3_and_ac4_headless_argv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, list[str]] = {}

    def fake_popen(args, **kwargs):
        captured["args"] = list(args)
        return _FakeProc()

    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        fake_popen,
    )
    monkeypatch.setenv("WB_BRIDGE_LOG_DIR", str(tmp_path / "logs"))

    mgr = WbBridgeSessionManager()
    s = mgr.start_session(str(tmp_path / "cwd"), permission_mode="default")
    argv = captured["args"]
    assert argv[0] == "/tmp/fake-cb"
    assert "--input-format" in argv and argv[argv.index("--input-format") + 1] == "stream-json"
    assert "--output-format" in argv and argv[argv.index("--output-format") + 1] == "stream-json"
    assert "--permission-mode" in argv and argv[argv.index("--permission-mode") + 1] == "default"
    assert "--permission-prompt-tool" not in argv
    mgr.stop_session(s.session_id)

    s2 = mgr.start_session(str(tmp_path / "cwd"), permission_mode="nonsense")
    argv2 = captured["args"]
    assert argv2[argv2.index("--permission-mode") + 1] == "default"
    mgr.stop_session(s2.session_id)

    s3 = mgr.start_session(str(tmp_path / "cwd"), permission_mode="acceptEdits")
    argv3 = captured["args"]
    assert argv3[argv3.index("--permission-mode") + 1] == "acceptEdits"
    mgr.stop_session(s3.session_id)


def test_ac5_wait_for_success_result_uses_e2_fixture() -> None:
    mgr = WbBridgeSessionManager()
    sid = str(uuid.uuid4())
    session = WbBridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=True))
    session.append_line(_E2_SYSTEM_INIT)
    session.append_line(_E2_ASSISTANT)
    session.append_line(_E2_RESULT)
    with mgr._global_lock:
        mgr._sessions[sid] = session
    ok, tail = mgr.wait_for_success_result(sid, 2.0)
    assert ok is True
    assert _E2_RESULT in tail

    sid2 = str(uuid.uuid4())
    session2 = WbBridgeSession(session_id=sid2, cwd="/tmp", proc=_FakeProc(running=True))
    session2.append_line(_E2_SYSTEM_INIT)
    session2.append_line(_E2_ASSISTANT)
    with mgr._global_lock:
        mgr._sessions[sid2] = session2
    ok2, tail2 = mgr.wait_for_success_result(sid2, 0.45, poll_interval=0.1)
    assert ok2 is False
    assert "timeout" in tail2


def test_ac6_default_url_isolated_from_cc_bridge() -> None:
    assert WB_DEFAULT_URL == "http://127.0.0.1:9743"
    assert CC_DEFAULT_URL == "http://127.0.0.1:9742"
    assert WB_DEFAULT_URL != CC_DEFAULT_URL


def test_ac7_http_auth_and_create(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.wb_bridge import http_app as ha

    monkeypatch.delenv("WB_BRIDGE_TOKEN", raising=False)
    client = TestClient(ha.app)
    r = client.post("/v1/sessions", json={"cwd": "/tmp"})
    assert r.status_code == 503

    monkeypatch.setenv("WB_BRIDGE_TOKEN", "test-secret-token")
    r = client.post("/v1/sessions", json={"cwd": "/tmp"})
    assert r.status_code == 401

    r = client.post(
        "/v1/sessions",
        json={"cwd": "/tmp"},
        headers={"Authorization": "Bearer xxxx-secret-token"},
    )
    assert r.status_code == 403

    sid = str(uuid.uuid4())

    def fake_start(cwd: str, *, permission_mode: str = "default"):
        return SimpleNamespace(
            session_id=sid,
            cwd=cwd,
            proc=SimpleNamespace(pid=99),
        )

    monkeypatch.setattr(ha._manager, "start_session", fake_start)
    r = client.post(
        "/v1/sessions",
        json={"cwd": "/tmp"},
        headers={"Authorization": "Bearer test-secret-token"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("session_id") == sid


def test_ac8_no_cc_bridge_diff() -> None:
    root = Path(__file__).resolve().parents[1]
    proc = subprocess.run(
        ["git", "diff", "--name-only"],
        cwd=str(root),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    names = [n.strip() for n in proc.stdout.splitlines() if n.strip()]
    leaked = [n for n in names if n.startswith("agenticx/cc_bridge/")]
    assert leaked == [], f"cc_bridge files were modified: {leaked}"


def test_ac9_cli_help_registers_wb_bridge() -> None:
    help_proc = subprocess.run(
        [sys.executable, "-m", "agenticx.cli.main", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert help_proc.returncode == 0
    assert "wb-bridge" in (help_proc.stdout + help_proc.stderr)

    serve_help = subprocess.run(
        [sys.executable, "-m", "agenticx.cli.main", "wb-bridge", "serve", "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert serve_help.returncode == 0


def test_wb_bridge_config_api_roundtrip(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from agenticx.wb_bridge import http_app as ha

    monkeypatch.setenv("WB_BRIDGE_TOKEN", "cfg-test-token")
    client = TestClient(ha.app)

    get_res = client.get(
        "/v1/sessions",
        headers={"Authorization": "Bearer cfg-test-token"},
    )
    assert get_res.status_code == 200

    # Studio config endpoints live in server.py; smoke the settings helper instead.
    from agenticx.wb_bridge.settings import wb_bridge_base_url

    assert wb_bridge_base_url().endswith("9743") or "9743" in wb_bridge_base_url()


def test_health_unauthenticated() -> None:
    from agenticx.wb_bridge import http_app as ha

    client = TestClient(ha.app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json().get("ok") is True
    assert r.json().get("service") == "wb-bridge"


def test_parse_wb_bridge_url_default_port() -> None:
    from agenticx.wb_bridge.settings import parse_wb_bridge_url

    loopback, host, port = parse_wb_bridge_url("http://127.0.0.1")
    assert loopback is True
    assert host == "127.0.0.1"
    assert port == 9743


def test_probe_wb_bridge_when_down() -> None:
    from agenticx.wb_bridge.settings import probe_wb_bridge

    out = probe_wb_bridge(url="http://127.0.0.1:59991", token="unused")
    assert out.get("ok") is True
    assert out.get("reachable") is False
    assert out.get("ready") is False
    assert "refused" in str(out.get("detail", "")).lower() or out.get("detail")


def test_ensure_skips_nonlocal_url() -> None:
    from agenticx.wb_bridge.process import ensure_wb_bridge_local_process

    ok, detail = ensure_wb_bridge_local_process("http://10.0.0.8:9743", "tok")
    assert ok is False
    assert "non-loopback" in detail


def test_ensure_spawns_popen(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.wb_bridge import process as procmod

    procmod._WB_BRIDGE_AUTO_PROC = None

    class _FakeProc:
        pid = 7

        def poll(self):
            return None

    monkeypatch.setattr(procmod.subprocess, "Popen", lambda *a, **k: _FakeProc())
    ok, detail = procmod.ensure_wb_bridge_local_process("http://127.0.0.1:9743", "tok")
    assert ok is True
    assert "started pid=7" in detail
    procmod._WB_BRIDGE_AUTO_PROC = None


def test_studio_wb_bridge_status_when_down(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from agenticx.cli.config_manager import ConfigManager
    from agenticx.studio.server import create_studio_app

    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    monkeypatch.setenv("AGX_WB_BRIDGE_URL", "http://127.0.0.1:59991")
    client = TestClient(create_studio_app())
    r = client.get("/api/wb-bridge/status")
    assert r.status_code == 200
    body = r.json()
    assert body.get("reachable") is False
    assert body.get("ready") is False


def test_studio_wb_bridge_ensure_already_ready(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from agenticx.cli.config_manager import ConfigManager
    from agenticx.studio.server import create_studio_app

    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", tmp_path / "global.yaml")
    monkeypatch.setattr(ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / "project.yaml")
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    monkeypatch.setattr(
        "agenticx.wb_bridge.settings.probe_wb_bridge",
        lambda **_kw: {
            "ok": True,
            "url": "http://127.0.0.1:9743",
            "reachable": True,
            "auth_ok": True,
            "ready": True,
            "detail": "ready",
        },
    )
    client = TestClient(create_studio_app())
    r = client.post("/api/wb-bridge/ensure")
    assert r.status_code == 200
    body = r.json()
    assert body.get("ready") is True
    assert body.get("autostart") == "already_ready"


# ---------------------------------------------------------------------------
# P0.5-A: turn semantics (events.py + session state machine)
# ---------------------------------------------------------------------------


def _make_running_session(mgr: WbBridgeSessionManager) -> str:
    sid = str(uuid.uuid4())
    session = WbBridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=True))
    with mgr._global_lock:
        mgr._sessions[sid] = session
    return sid


def test_events_classify_result() -> None:
    from agenticx.wb_bridge import events as wb_events

    assert wb_events.classify_result(wb_events.parse_stream_line(_E2_RESULT)) == (
        "success",
        "",
    )
    kind_b, detail_b = wb_events.classify_result(wb_events.parse_stream_line(_RESULT_BLOCKED))
    assert kind_b == "blocked"
    assert "Bash" in detail_b
    kind_e, _detail_e = wb_events.classify_result(wb_events.parse_stream_line(_RESULT_ERROR))
    assert kind_e == "error"
    assert wb_events.classify_result(None) == ("error", "unparseable result")

    for line in (_E2_RESULT, _RESULT_BLOCKED, _RESULT_ERROR):
        assert wb_events.line_is_turn_terminal(line) is True
    for line in (_E2_ASSISTANT, _E2_SYSTEM_INIT, _E2_TOOL_USE):
        assert wb_events.line_is_turn_terminal(line) is False


def test_events_extract_usage_and_activity() -> None:
    from agenticx.wb_bridge import events as wb_events

    usage = wb_events.extract_usage(wb_events.parse_stream_line(_E2_RESULT))
    assert usage["input_tokens"] == 24426
    assert usage["output_tokens"] == 3
    assert usage["cache_read_input_tokens"] == 192
    assert usage["cache_creation_input_tokens"] == 24234

    zero_none = wb_events.extract_usage(None)
    zero_empty = wb_events.extract_usage({})
    for d in (zero_none, zero_empty):
        assert d["input_tokens"] == 0
        assert d["output_tokens"] == 0
        assert d["cache_read_input_tokens"] == 0
        assert d["cache_creation_input_tokens"] == 0

    assert wb_events.extract_tool_activity(_E2_TOOL_USE) == "Write"
    assert wb_events.extract_tool_activity(_E2_ASSISTANT) is None
    assert wb_events.extract_tool_activity(_MALFORMED) is None


def test_wait_for_turn_blocked_returns_fast() -> None:
    mgr = WbBridgeSessionManager()
    sid = _make_running_session(mgr)
    session = mgr.get(sid)
    assert session is not None
    session.observe_line(_E2_TOOL_USE)
    session.observe_line(_E2_TOOL_USE_BASH)
    session.observe_line(_RESULT_BLOCKED)

    t0 = time.monotonic()
    status, snap = mgr.wait_for_turn(sid, 5.0)
    elapsed = time.monotonic() - t0
    assert elapsed < 1.0
    assert status == "blocked"
    assert snap.get("blocked_count") == 1
    assert snap.get("last_activity") == "Bash"
    assert snap.get("observed_tools") == ["Write", "Bash"]
    assert "Bash" in str(snap.get("terminal_detail", ""))


def test_observe_line_never_raises_on_malformed() -> None:
    mgr = WbBridgeSessionManager()
    sid = _make_running_session(mgr)
    session = mgr.get(sid)
    assert session is not None
    session.observe_line(_MALFORMED)
    session.observe_line("")
    session.observe_line("not json at all")
    session.observe_line(_E2_RESULT)
    assert session.last_terminal_kind == "success"


def test_wait_for_turn_running_and_zero_timeout() -> None:
    mgr = WbBridgeSessionManager()
    sid = _make_running_session(mgr)
    session = mgr.get(sid)
    assert session is not None
    session.append_line(_E2_SYSTEM_INIT)
    session.append_line(_E2_TOOL_USE)
    session.observe_line(_E2_SYSTEM_INIT)
    session.observe_line(_E2_TOOL_USE)

    status, snap = mgr.wait_for_turn(sid, 0.45, poll_interval=0.1)
    assert status == "running"
    assert str(snap.get("tail", "")).strip() != ""

    t0 = time.monotonic()
    status2, _snap2 = mgr.wait_for_turn(sid, 0)
    assert (time.monotonic() - t0) < 0.1
    assert status2 == "running"


def test_wait_for_turn_exited() -> None:
    mgr = WbBridgeSessionManager()
    sid = str(uuid.uuid4())
    session = WbBridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=False))
    with mgr._global_lock:
        mgr._sessions[sid] = session
    t0 = time.monotonic()
    status, _snap = mgr.wait_for_turn(sid, 2.0)
    assert (time.monotonic() - t0) < 1.0
    assert status == "exited"


def test_usage_totals_accumulate_across_turns() -> None:
    mgr = WbBridgeSessionManager()
    sid = _make_running_session(mgr)
    session = mgr.get(sid)
    assert session is not None
    session.observe_line(_E2_RESULT)
    session.observe_line(_E2_RESULT)
    snap = mgr.describe_session(sid)
    assert snap is not None
    assert snap["usage_totals"]["input_tokens"] == 24426 * 2
    assert snap["turns_completed"] == 2


def test_session_to_dict_full_field_set() -> None:
    mgr = WbBridgeSessionManager()
    sid = _make_running_session(mgr)
    snap = mgr.describe_session(sid)
    assert snap is not None
    for key in (
        "session_id",
        "cwd",
        "pid",
        "poll",
        "log_path",
        "state",
        "permission_mode",
        "turn_state",
        "turn_seq",
        "turns_completed",
        "last_activity",
        "observed_tools",
        "usage_totals",
        "last_terminal_kind",
        "terminal_detail",
        "first_activity_lag_sec",
    ):
        assert key in snap, key


def test_send_resets_turn_and_records_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured: dict[str, list[str]] = {}

    def fake_popen(args, **kwargs):
        captured["args"] = list(args)
        return _FakeProc()

    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        fake_popen,
    )
    monkeypatch.setenv("WB_BRIDGE_LOG_DIR", str(tmp_path / "logs"))

    mgr = WbBridgeSessionManager()
    s = mgr.start_session(str(tmp_path / "cwd"), permission_mode="acceptEdits")
    snap0 = mgr.describe_session(s.session_id)
    assert snap0 is not None
    assert snap0["permission_mode"] == "acceptEdits"

    session = mgr.get(s.session_id)
    assert session is not None
    session.observe_line(_E2_TOOL_USE)
    mgr.send_user_message(s.session_id, "next")
    assert session.observed_tools == []
    assert session.last_activity == ""
    assert session.turn_state == "running"
    assert session.turn_seq == 1
    assert session.turns_completed == 0
    mgr.stop_session(s.session_id)


def test_wb_bridge_module_boundaries() -> None:
    import agenticx.wb_bridge.events as wb_events_mod

    events_src = inspect.getsource(wb_events_mod)
    assert "cc_bridge" not in events_src

    pkg_dir = Path(wb_events_mod.__file__).resolve().parent
    for py in pkg_dir.glob("*.py"):
        src = py.read_text(encoding="utf-8")
        assert "agenticx.studio" not in src, py.name

    import agenticx.wb_bridge.session_manager as sm_mod

    sm_src = inspect.getsource(sm_mod)
    assert not re.search(r"open\(\s*(self\.)?log_path", sm_src)
    assert "read_text" not in sm_src


# ---------------------------------------------------------------------------
# P0.5-B: HTTP control plane
# ---------------------------------------------------------------------------

_AUTH = {"Authorization": "Bearer test-secret-token"}


def _auth_client(monkeypatch: pytest.MonkeyPatch):
    from agenticx.wb_bridge import http_app as ha

    monkeypatch.setenv("WB_BRIDGE_TOKEN", "test-secret-token")
    return ha, TestClient(ha.app)


def test_http_describe_passthrough_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())

    def fake_describe(session_id: str):
        return {
            "session_id": session_id,
            "cwd": "/tmp",
            "pid": 1,
            "poll": None,
            "log_path": "",
            "state": "running",
            "usage_totals": {"input_tokens": 3},
            "observed_tools": ["Write"],
            "turn_state": "idle",
        }

    monkeypatch.setattr(ha._manager, "describe_session", fake_describe)
    r = client.get(f"/v1/sessions/{sid}", headers=_AUTH)
    assert r.status_code == 200
    body = r.json()
    for key in ("session_id", "cwd", "pid", "poll", "log_path", "state"):
        assert key in body
    assert body["usage_totals"]["input_tokens"] == 3
    assert body["observed_tools"] == ["Write"]
    assert body["turn_state"] == "idle"


def test_message_body_wait_seconds_zero() -> None:
    from pydantic import ValidationError
    from agenticx.wb_bridge.http_app import MessageBody

    MessageBody(text="x", wait_seconds=0)
    with pytest.raises(ValidationError):
        MessageBody(text="x", wait_seconds=-1)


def _patch_idle_send_wait(monkeypatch, ha, wait_status: str, wait_snap: dict) -> dict:
    sent: dict[str, Any] = {"called": False}

    monkeypatch.setattr(ha._manager, "get", lambda _sid: object())
    monkeypatch.setattr(
        ha._manager,
        "describe_session",
        lambda _sid: {"turn_state": "idle"},
    )

    def fake_send(*_a, **_k):
        sent["called"] = True

    def fake_wait(_sid, _timeout, poll_interval=0.2):
        return wait_status, dict(wait_snap)

    monkeypatch.setattr(ha._manager, "send_user_message", fake_send)
    monkeypatch.setattr(ha._manager, "wait_for_turn", fake_wait)
    return sent


def test_http_message_running_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())
    _patch_idle_send_wait(
        monkeypatch,
        ha,
        "running",
        {
            "tail": "partial",
            "observed_tools": ["Write"],
            "usage_totals": {"input_tokens": 1},
            "turn_seq": 2,
        },
    )
    r = client.post(
        f"/v1/sessions/{sid}/message",
        json={"text": "go", "wait_seconds": 0},
        headers=_AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "running"
    assert body["ok"] is False
    assert body["result_text"] == ""
    assert "do NOT resend" in body["next_action"]
    assert "409" in body["next_action"]


def test_http_message_success_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())
    _patch_idle_send_wait(
        monkeypatch,
        ha,
        "success",
        {"last_result_text": "Hello, World!", "tail": "ok", "turn_seq": 1},
    )
    r = client.post(
        f"/v1/sessions/{sid}/message",
        json={"text": "go"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["result_text"] == "Hello, World!"
    assert body["next_action"] == "done"


def test_http_message_blocked_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())
    _patch_idle_send_wait(
        monkeypatch,
        ha,
        "blocked",
        {
            "observed_tools": ["Write", "Bash"],
            "terminal_detail": "Bash",
            "tail": "blocked",
        },
    )
    r = client.post(
        f"/v1/sessions/{sid}/message",
        json={"text": "go"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["observed_tools"] == ["Write", "Bash"]
    assert "side effects" in body["next_action"]
    assert "acceptEdits" in body["next_action"]


def test_http_message_in_flight_409(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())
    monkeypatch.setattr(ha._manager, "get", lambda _sid: object())
    monkeypatch.setattr(
        ha._manager,
        "describe_session",
        lambda _sid: {
            "turn_state": "running",
            "turn_seq": 1,
            "turn_elapsed_sec": 12.3,
            "last_activity": "Bash",
        },
    )

    def boom(*_a, **_k):
        raise AssertionError("send_user_message must not be called")

    monkeypatch.setattr(ha._manager, "send_user_message", boom)
    r = client.post(
        f"/v1/sessions/{sid}/message",
        json={"text": "again"},
        headers=_AUTH,
    )
    assert r.status_code == 409
    detail = str(r.json().get("detail", ""))
    assert "already in flight" in detail
    assert "turn_seq=1" in detail


def test_http_message_idempotency_before_409(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)
    sid = str(uuid.uuid4())
    monkeypatch.setattr(ha._manager, "get", lambda _sid: object())
    monkeypatch.setattr(ha._manager, "turn_matches_idempotency_key", lambda _sid, key: key == "k1")
    monkeypatch.setattr(
        ha._manager,
        "describe_session",
        lambda _sid: {"turn_state": "running", "turn_seq": 1},
    )

    def boom(*_a, **_k):
        raise AssertionError("send_user_message must not be called")

    monkeypatch.setattr(ha._manager, "send_user_message", boom)
    monkeypatch.setattr(
        ha._manager,
        "wait_for_turn",
        lambda *_a, **_k: ("running", {"tail": "still", "turn_seq": 1}),
    )
    r = client.post(
        f"/v1/sessions/{sid}/message",
        json={"text": "again", "idempotency_key": "k1"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deduplicated"] is True
    assert body["status"] == "running"


def test_idempotency_key_stored(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_popen(args, **kwargs):
        return _FakeProc()

    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        fake_popen,
    )
    monkeypatch.setenv("WB_BRIDGE_LOG_DIR", str(tmp_path / "logs"))
    mgr = WbBridgeSessionManager()
    s = mgr.start_session(str(tmp_path / "cwd"), permission_mode="acceptEdits")
    mgr.send_user_message(s.session_id, "t", idempotency_key="k1")
    assert mgr.turn_matches_idempotency_key(s.session_id, "k1") is True
    assert mgr.turn_matches_idempotency_key(s.session_id, "k2") is False
    assert mgr.turn_matches_idempotency_key(s.session_id, "") is False
    assert mgr.turn_matches_idempotency_key(str(uuid.uuid4()), "k1") is False
    mgr.stop_session(s.session_id)


def test_create_session_unattended_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    ha, client = _auth_client(monkeypatch)

    def fake_start(cwd: str, *, permission_mode: str = "default"):
        return SimpleNamespace(
            session_id=str(uuid.uuid4()),
            cwd=cwd,
            proc=SimpleNamespace(pid=7),
            permission_mode=permission_mode,
        )

    monkeypatch.setattr(ha._manager, "start_session", fake_start)
    r = client.post(
        "/v1/sessions",
        json={"cwd": "/tmp", "permission_mode": "default"},
        headers=_AUTH,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["unattended_ok"] is False
    assert "--permission-prompt-tool" in body["hint"]
    assert "default" in body["hint"]

    r2 = client.post(
        "/v1/sessions",
        json={"cwd": "/tmp", "permission_mode": "acceptEdits"},
        headers=_AUTH,
    )
    assert r2.json()["unattended_ok"] is True
    assert r2.json()["hint"] == ""

    r3 = client.post(
        "/v1/sessions",
        json={"cwd": "/tmp", "permission_mode": "plan"},
        headers=_AUTH,
    )
    assert r3.json()["unattended_ok"] is False


def test_http_app_no_inline_ujson_or_cc_bridge() -> None:
    from agenticx.wb_bridge import http_app as ha

    src = inspect.getsource(ha)
    assert "import ujson" not in src
    assert "wb_bridge import events" in src or "wb_bridge.events" in src
    assert "from agenticx.cc_bridge" not in src
    assert "import agenticx.cc_bridge" not in src


# ---------------------------------------------------------------------------
# P0.5-C: tool contract + meta/automation
# ---------------------------------------------------------------------------

def _studio_fn(name: str) -> dict:
    from agenticx.cli.agent_tools import STUDIO_TOOLS

    for item in STUDIO_TOOLS:
        fn = item.get("function") or {}
        if fn.get("name") == name:
            return fn
    raise AssertionError(f"missing studio tool {name}")


def test_wb_bridge_start_unattended_contract() -> None:
    fn = _studio_fn("wb_bridge_start")
    desc = fn["description"]
    assert "acceptEdits" in desc
    assert "cc_bridge_permission" in desc
    assert "unattended_ok" in desc
    assert "Do NOT start serve via bash" in desc
    mode = fn["parameters"]["properties"]["permission_mode"]
    assert "NOT usable for unattended" in mode["description"]
    assert len(mode["enum"]) == 6


def test_wb_bridge_send_contract() -> None:
    fn = _studio_fn("wb_bridge_send")
    desc = fn["description"]
    assert "409" in desc
    assert "never resend" in desc
    assert "side effects" in desc
    assert "idempotency_key" in desc
    props = fn["parameters"]["properties"]
    assert "idempotency_key" in props
    assert fn["parameters"]["required"] == ["session_id", "text"]
    assert "Pass 0" in props["wait_seconds"]["description"]


def test_wb_bridge_describe_contract() -> None:
    fn = _studio_fn("wb_bridge_describe")
    desc = fn["description"]
    assert "Do NOT try to read" in desc
    assert "observed_tools" in desc


@pytest.mark.asyncio
async def test_wb_bridge_send_wait_and_idempotency(monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib

    from agenticx.cli import agent_tools as at

    captured: dict[str, Any] = {}

    async def fake_http(_session, _method, _path, json_body, *, timeout_sec=0.0):
        captured["body"] = json_body
        captured["timeout"] = timeout_sec
        return "{}"

    monkeypatch.setattr(at, "_tool_wb_bridge_http", fake_http)
    sid = str(uuid.uuid4())

    await at._tool_wb_bridge_send({"session_id": sid, "text": "hi", "wait_seconds": 0}, object())
    assert captured["body"]["wait_seconds"] == 0.0

    await at._tool_wb_bridge_send({"session_id": sid, "text": "hi", "wait_seconds": "abc"}, object())
    assert captured["body"]["wait_seconds"] == 180.0

    await at._tool_wb_bridge_send({"session_id": sid, "text": "hi", "wait_seconds": 9999}, object())
    assert captured["body"]["wait_seconds"] == 3600.0

    await at._tool_wb_bridge_send(
        {"session_id": sid, "text": "hi", "idempotency_key": "k1"},
        object(),
    )
    assert captured["body"]["idempotency_key"] == "k1"

    await at._tool_wb_bridge_send({"session_id": sid, "text": "same-text"}, object())
    expected = f"{sid}:{hashlib.sha1(b'same-text').hexdigest()[:12]}"
    assert captured["body"]["idempotency_key"] == expected


def test_cc_bridge_send_untouched() -> None:
    fn = _studio_fn("cc_bridge_send")
    assert "observed_tools" not in fn["description"]


def test_meta_agent_wb_discipline() -> None:
    from agenticx.runtime.prompts import meta_agent as meta_mod

    src = Path(meta_mod.__file__).read_text(encoding="utf-8")
    assert "wb_bridge 无人值守强约束" in src
    assert "wb_bridge 重发禁令" in src
    assert "wb_bridge 证据门禁" in src
    assert "cc_bridge 可见模式强约束" in src


def test_automation_blocks_wb_mutate_tools() -> None:
    from agenticx.studio import server as studio_server

    src = inspect.getsource(studio_server)
    assert "wb_bridge_start" in src
    assert "wb_bridge_send" in src
    assert "wb_bridge_stop" in src


def test_wb_bridge_stop_warns_incomplete() -> None:
    fn = _studio_fn("wb_bridge_stop")
    assert "in-flight file writes may be incomplete" in fn["description"]
    assert "force" in fn["parameters"]["properties"]


@pytest.mark.asyncio
async def test_wb_bridge_stop_requires_force_when_running(monkeypatch: pytest.MonkeyPatch) -> None:
    from agenticx.cli import agent_tools as at

    calls: list[str] = []

    async def fake_http(_session, method, path, json_body, *, timeout_sec=0.0):
        calls.append(method.upper())
        if method.upper() == "GET":
            return json.dumps({"turn_state": "running"})
        return '{"status":"stopped"}'

    monkeypatch.setattr(at, "_tool_wb_bridge_http", fake_http)
    sid = str(uuid.uuid4())
    out = await at._tool_wb_bridge_stop({"session_id": sid}, object())
    assert "force=true" in out
    assert "DELETE" not in calls

    calls.clear()
    out2 = await at._tool_wb_bridge_stop({"session_id": sid, "force": True}, object())
    assert "DELETE" in calls
    assert "stopped" in out2
