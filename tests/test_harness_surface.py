#!/usr/bin/env python3
"""Unified harness control surface tests (SP1).

Covers the adapter registry, the claude-code / codebuddy adapters over
fake subprocesses, and the unified HTTP API. No real CLI is spawned here;
real-instance E2E runs against `agx harness-surface serve` separately.

Author: Damon Li
"""

from __future__ import annotations

import queue
import subprocess
import threading
import uuid
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

from agenticx.harness import http_app as ha
from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter
from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import UnknownHarnessError

_TOKEN = "test-surface-token"

_CC_RESULT_SUCCESS = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"hello from claude","session_id":"abc","duration_ms":10}'
)

_WB_RESULT_SUCCESS = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"OK","duration_ms":9804,"num_turns":2,'
    '"usage":{"input_tokens":100,"output_tokens":3,'
    '"cache_read_input_tokens":5,"cache_creation_input_tokens":0},'
    '"permission_denials":[]}'
)

_WB_RESULT_BLOCKED = (
    '{"type":"result","subtype":"error_during_execution","is_error":true,'
    '"result":null,"duration_ms":1200,"num_turns":3,'
    '"usage":{"input_tokens":10,"output_tokens":2},'
    '"permission_denials":[{"tool_name":"Bash","tool_use_id":"toolu_2"}]}'
)


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


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("HARNESS_SURFACE_TOKEN", _TOKEN)
    # Fresh registry per test so sessions never leak between tests.
    registry = HarnessRegistry()
    registry.register(ClaudeCodeAdapter())
    registry.register(CodeBuddyAdapter())
    monkeypatch.setattr(ha, "_registry", registry)
    return TestClient(ha.app)


def _auth() -> Dict[str, str]:
    return {"Authorization": f"Bearer {_TOKEN}"}


# ----------------------------------------------------------------------
# registry
# ----------------------------------------------------------------------
def test_default_registry_contains_builtin_adapters() -> None:
    from agenticx.harness.registry import default_registry

    registry = default_registry()
    ids = registry.list_ids()
    assert "claude-code" in ids
    assert "codebuddy" in ids

    cc = registry.require("claude-code")
    caps = cc.capabilities()
    assert caps.permission is True
    assert caps.pty is True
    assert caps.streaming is True
    assert caps.idempotency is False

    wb = registry.require("codebuddy")
    caps = wb.capabilities()
    assert caps.permission is False
    assert caps.turn_snapshots is True
    assert caps.idempotency is True


def test_registry_duplicate_register_rejected() -> None:
    registry = HarnessRegistry()
    registry.register(ClaudeCodeAdapter())
    with pytest.raises(ValueError, match="already registered"):
        registry.register(ClaudeCodeAdapter())


def test_registry_require_unknown_raises() -> None:
    registry = HarnessRegistry()
    with pytest.raises(UnknownHarnessError, match="no-such"):
        registry.require("no-such")


# ----------------------------------------------------------------------
# HTTP: meta + auth
# ----------------------------------------------------------------------
def test_health_unauthenticated(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "harness-surface"
    assert body["schema"] == "harness-surface-1"


def test_harnesses_requires_auth(client: TestClient) -> None:
    assert client.get("/v1/harnesses").status_code == 401
    assert client.get(
        "/v1/harnesses", headers={"Authorization": "Bearer wrong"}
    ).status_code == 403


def test_harnesses_lists_builtin_capabilities(client: TestClient) -> None:
    r = client.get("/v1/harnesses", headers=_auth())
    assert r.status_code == 200
    harnesses = {h["harness_id"]: h for h in r.json()["harnesses"]}
    assert set(harnesses) >= {"claude-code", "codebuddy"}
    assert harnesses["claude-code"]["capabilities"]["permission"] is True
    assert harnesses["codebuddy"]["capabilities"]["turn_snapshots"] is True
    # availability is reported even when the CLI is missing (graying signal)
    assert isinstance(harnesses["claude-code"]["available"], bool)


# ----------------------------------------------------------------------
# HTTP: spawn
# ----------------------------------------------------------------------
def test_spawn_unknown_harness_404(client: TestClient) -> None:
    r = client.post(
        "/v1/harnesses/nope/sessions", headers=_auth(), json={"cwd": "/tmp"}
    )
    assert r.status_code == 404
    assert "unknown harness" in r.json()["detail"]


def test_spawn_claude_code_headless(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    r = client.post(
        "/v1/harnesses/claude-code/sessions",
        headers=_auth(),
        json={"cwd": str(tmp_path), "options": {"mode": "headless"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["harness"] == "claude-code"
    assert body["mode"] == "headless"
    assert body["state"] == "running"
    assert body["cwd"] == str(tmp_path)
    assert body["raw"]["mode"] == "headless"
    # cleanup
    assert client.delete(
        f"/v1/harnesses/claude-code/sessions/{body['session_id']}",
        headers=_auth(),
    ).status_code == 200


def test_spawn_claude_code_invalid_mode_400(
    client: TestClient, tmp_path: Any
) -> None:
    r = client.post(
        "/v1/harnesses/claude-code/sessions",
        headers=_auth(),
        json={"cwd": str(tmp_path), "options": {"mode": "bogus"}},
    )
    assert r.status_code == 400
    assert "mode" in r.json()["detail"]


def test_spawn_claude_code_unknown_option_400(
    client: TestClient, tmp_path: Any
) -> None:
    r = client.post(
        "/v1/harnesses/claude-code/sessions",
        headers=_auth(),
        json={"cwd": str(tmp_path), "options": {"wat": 1}},
    )
    assert r.status_code == 400
    assert "unknown spawn options" in r.json()["detail"]


def test_spawn_codebuddy(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    r = client.post(
        "/v1/harnesses/codebuddy/sessions",
        headers=_auth(),
        json={"cwd": str(tmp_path), "options": {"permission_mode": "acceptEdits"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["harness"] == "codebuddy"
    assert body["permission_mode"] == "acceptEdits"
    assert body["turn_state"] == "idle"
    assert client.delete(
        f"/v1/harnesses/codebuddy/sessions/{body['session_id']}",
        headers=_auth(),
    ).status_code == 200


def test_spawn_codebuddy_invalid_permission_mode_400(
    client: TestClient, tmp_path: Any
) -> None:
    r = client.post(
        "/v1/harnesses/codebuddy/sessions",
        headers=_auth(),
        json={"cwd": str(tmp_path), "options": {"permission_mode": "yolo"}},
    )
    assert r.status_code == 400
    assert "permission_mode" in r.json()["detail"]


# ----------------------------------------------------------------------
# HTTP: turns
# ----------------------------------------------------------------------
def _spawn(
    client: TestClient,
    harness: str,
    cwd: str,
    options: Dict[str, Any],
) -> str:
    r = client.post(
        f"/v1/harnesses/{harness}/sessions",
        headers=_auth(),
        json={"cwd": cwd, "options": options},
    )
    assert r.status_code == 200, r.text
    return r.json()["session_id"]


def test_turn_claude_code_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_CC_RESULT_SUCCESS]),
    )
    sid = _spawn(client, "claude-code", str(tmp_path), {"mode": "headless"})
    r = client.post(
        f"/v1/harnesses/claude-code/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "say hello", "wait_seconds": 5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "success"
    assert body["ok"] is True
    assert body["result_text"] == "hello from claude"
    assert body["detail"]["mode"] == "headless"
    client.delete(f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth())


def test_turn_claude_code_timeout(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),  # never answers
    )
    sid = _spawn(client, "claude-code", str(tmp_path), {"mode": "headless"})
    r = client.post(
        f"/v1/harnesses/claude-code/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "stall", "wait_seconds": 0.5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "timeout"
    assert body["ok"] is False
    client.delete(f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth())


def test_turn_codebuddy_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT_SUCCESS]),
    )
    sid = _spawn(client, "codebuddy", str(tmp_path), {"permission_mode": "default"})
    r = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "do the thing", "wait_seconds": 5},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "success"
    assert body["result_text"] == "OK"
    assert body["detail"]["turn_seq"] == 1
    assert body["detail"]["turns_completed"] == 1
    assert "input_tokens" in body["detail"]["usage_totals"]
    client.delete(f"/v1/harnesses/codebuddy/sessions/{sid}", headers=_auth())


def test_turn_codebuddy_blocked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT_BLOCKED]),
    )
    sid = _spawn(client, "codebuddy", str(tmp_path), {"permission_mode": "default"})
    r = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "run blocked op", "wait_seconds": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "blocked"
    assert "Bash" in body["detail"]["terminal_detail"]
    client.delete(f"/v1/harnesses/codebuddy/sessions/{sid}", headers=_auth())


def test_turn_codebuddy_inflight_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),  # never answers -> turn stays running
    )
    sid = _spawn(client, "codebuddy", str(tmp_path), {"permission_mode": "default"})
    first = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "slow op", "wait_seconds": 0},
    )
    assert first.status_code == 200
    assert first.json()["status"] == "running"

    second = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={"text": "resend", "wait_seconds": 0},
    )
    assert second.status_code == 409
    assert "in flight" in second.json()["detail"]
    client.delete(f"/v1/harnesses/codebuddy/sessions/{sid}", headers=_auth())


def test_turn_codebuddy_idempotency_dedup(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    sid = _spawn(client, "codebuddy", str(tmp_path), {"permission_mode": "default"})
    first = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={
            "text": "slow op",
            "wait_seconds": 0,
            "idempotency_key": "k-123",
        },
    )
    assert first.status_code == 200
    assert first.json()["deduplicated"] is False

    retry = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/turn",
        headers=_auth(),
        json={
            "text": "slow op",
            "wait_seconds": 0,
            "idempotency_key": "k-123",
        },
    )
    assert retry.status_code == 200
    body = retry.json()
    assert body["deduplicated"] is True
    client.delete(f"/v1/harnesses/codebuddy/sessions/{sid}", headers=_auth())


# ----------------------------------------------------------------------
# HTTP: permission / PTY capability gating + lifecycle
# ----------------------------------------------------------------------
def test_permission_codebuddy_400_with_hint(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    sid = _spawn(client, "codebuddy", str(tmp_path), {"permission_mode": "default"})
    r = client.post(
        f"/v1/harnesses/codebuddy/sessions/{sid}/permission",
        headers=_auth(),
        json={"request_id": "req-1", "allow": True},
    )
    assert r.status_code == 400
    assert "approval channel" in r.json()["detail"]
    client.delete(f"/v1/harnesses/codebuddy/sessions/{sid}", headers=_auth())


def test_stream_on_headless_claude_code_400(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    sid = _spawn(client, "claude-code", str(tmp_path), {"mode": "headless"})
    r = client.get(
        f"/v1/harnesses/claude-code/sessions/{sid}/stream", headers=_auth()
    )
    assert r.status_code == 400
    assert "visible_tui" in r.json()["detail"]
    client.delete(f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth())


def test_session_lifecycle_describe_stop_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([]),
    )
    sid = _spawn(client, "claude-code", str(tmp_path), {"mode": "headless"})

    got = client.get(
        f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth()
    )
    assert got.status_code == 200
    assert got.json()["harness"] == "claude-code"

    listed = client.get(
        "/v1/harnesses/claude-code/sessions", headers=_auth()
    )
    assert listed.status_code == 200
    assert sid in [s["session_id"] for s in listed.json()["sessions"]]

    assert client.delete(
        f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth()
    ).status_code == 200
    assert client.get(
        f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth()
    ).status_code == 404
    assert client.delete(
        f"/v1/harnesses/claude-code/sessions/{sid}", headers=_auth()
    ).status_code == 404


def test_session_bad_uuid_400(client: TestClient) -> None:
    r = client.get(
        "/v1/harnesses/claude-code/sessions/not-a-uuid", headers=_auth()
    )
    assert r.status_code == 400
    assert "UUID" in r.json()["detail"]


def test_turn_unknown_session_404(client: TestClient) -> None:
    missing = str(uuid.uuid4())
    r = client.post(
        f"/v1/harnesses/claude-code/sessions/{missing}/turn",
        headers=_auth(),
        json={"text": "hi"},
    )
    assert r.status_code == 404


# ----------------------------------------------------------------------
# adapter.available() signal for UI graying (SP5a)
# ----------------------------------------------------------------------
def test_adapter_available_reflects_executable_presence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cc = ClaudeCodeAdapter()
    monkeypatch.setenv("CC_BRIDGE_EXECUTABLE", "/definitely/not/installed-claude")
    assert cc.available() is False
    monkeypatch.setenv("CC_BRIDGE_EXECUTABLE", "python3")  # anything on PATH
    assert cc.available() is True

    wb = CodeBuddyAdapter()
    monkeypatch.setattr(
        "agenticx.harness.adapters.codebuddy.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    assert wb.available() is True

    def _raise() -> None:
        raise RuntimeError("未找到 codebuddy 可执行文件")

    monkeypatch.setattr(
        "agenticx.harness.adapters.codebuddy.resolve_codebuddy_executable",
        _raise,
    )
    assert wb.available() is False
