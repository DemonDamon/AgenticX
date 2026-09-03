#!/usr/bin/env python3
"""Smoke tests for the local CodeBuddy (WB) bridge. No real codebuddy process.

Author: Damon Li
"""

from __future__ import annotations

import inspect
import io
import re
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

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
