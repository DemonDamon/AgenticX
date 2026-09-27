#!/usr/bin/env python3
"""Tests for the robot_* Studio tools against a mocked robot bridge.

Author: Hongyi Zhao
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.robot_bridge import client as client_module
from agenticx.robot_bridge import tools
from agenticx.runtime.confirm import ConfirmGate

SID = "rs-0123456789ab"
PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


class _Gate(ConfirmGate):
    def __init__(self, approve: bool) -> None:
        self.approve = approve
        self.calls: list[dict[str, Any]] = []

    async def request_confirm(self, question: str, context=None) -> bool:
        self.calls.append(dict(context or {}))
        return self.approve


class _ForbiddenGate(ConfirmGate):
    async def request_confirm(self, question: str, context=None) -> bool:
        pytest.fail(f"confirmation must not be requested: {question}")


class FakeBridge:
    """Route table for MockTransport; a route's last response repeats once the queue drains."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.routes: dict[tuple[str, str], list[Any]] = {}

    def on(self, method: str, path: str, *responses: Any) -> None:
        self.routes[(method, path)] = list(responses)

    def paths(self) -> list[tuple[str, str]]:
        return [(r["method"], r["path"]) for r in self.requests]

    def handle(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append(
            {
                "method": request.method,
                "path": request.url.path,
                "raw_path": request.url.raw_path.decode(),
                "params": dict(request.url.params),
                "body": body,
                "headers": dict(request.headers),
            }
        )
        queue = self.routes.get((request.method, request.url.path))
        if not queue:
            return httpx.Response(
                404,
                json={
                    "ok": False,
                    "error_code": "not_found",
                    "error": "no route",
                    "hint": "",
                },
            )
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, Exception):
            raise item
        status, payload = item if isinstance(item, tuple) else (200, item)
        return httpx.Response(status, json=payload)


def _status(state: str, **extra: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "session_id": SID,
        "state": state,
        "task": "pick",
        "initial_task": "pick",
        "supports_text_queries": False,
        "cameras": ["front"],
        "events": [],
        "last_seq": 1,
        "pose_check": None,
        "error_code": None,
        "error": None,
        "hint": None,
        "failure_traceback": None,
        **extra,
    }


@pytest.fixture
def robot_env(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    global_path = tmp_path / "global.yaml"
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path)
    monkeypatch.setattr(
        ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml"
    )
    bridge = FakeBridge()
    monkeypatch.setattr(
        client_module, "_TRANSPORT_OVERRIDE", httpx.MockTransport(bridge.handle)
    )
    monkeypatch.setattr(tools, "_POLL_INTERVAL_S", 0.01)

    def configure(**robot: Any) -> None:
        section = {
            "enabled": True,
            "token": "test-token",
            "profiles": {
                "desk": {
                    "type": "so101_follower",
                    "port": "/dev/ttyUSB0",
                    "policy_path": "/models/p",
                }
            },
            **robot,
        }
        global_path.write_text(yaml.safe_dump({"robot": section}), encoding="utf-8")

    configure()
    return bridge, configure


async def _call(
    name: str, args: dict[str, Any], gate: ConfirmGate, session: Any = None
) -> str:
    return await tools.dispatch_robot_tool(
        name, args, session, confirm_gate=gate, emit_event=None
    )


# ---------------------------------------------------------------------- injection


def test_merge_disabled_enabled(monkeypatch):
    from agenticx.cli.agent_tools import STUDIO_TOOLS

    def _names(specs: list[dict[str, Any]]) -> list[str]:
        return [
            s["function"]["name"]
            for s in specs
            if isinstance(s, dict) and "function" in s
        ]

    monkeypatch.setattr(tools, "robot_config_enabled", lambda: False)
    assert not [
        n
        for n in _names(tools.merge_robot_tools_into(list(STUDIO_TOOLS)))
        if n.startswith("robot_")
    ]

    monkeypatch.setattr(tools, "robot_config_enabled", lambda: True)
    merged = tools.merge_robot_tools_into(list(STUDIO_TOOLS))
    twice = tools.merge_robot_tools_into(merged)
    for name in tools.ROBOT_TOOL_NAMES:
        assert _names(merged).count(name) == 1
        assert _names(twice).count(name) == 1
    assert len(tools.ROBOT_TOOL_NAMES) == 7


def test_tool_schemas_are_closed():
    for spec in tools.ROBOT_TOOLS:
        params = spec["function"]["parameters"]
        assert params["additionalProperties"] is False
        assert set(params["required"]) <= set(params["properties"])


async def test_disabled_returns_error_without_requests(robot_env):
    bridge, configure = robot_env
    configure(enabled=False)
    result = json.loads(
        await _call("robot_status", {"session_id": SID}, _ForbiddenGate())
    )
    assert result["ok"] is False and result["error_code"] == "robot_disabled"
    assert bridge.requests == []


# ---------------------------------------------------------------------- rollout start


async def test_rollout_start_happy_path(robot_env):
    bridge, _ = robot_env
    bridge.on(
        "POST", "/session", (202, {"ok": True, "session_id": SID, "state": "loading"})
    )
    bridge.on(
        "GET",
        f"/session/{SID}",
        _status("loading"),
        _status("idle"),
        _status("running"),
    )
    bridge.on("POST", f"/session/{SID}/start", {"ok": True, "accepted": True})
    gate = _Gate(approve=True)

    result = json.loads(
        await _call("robot_rollout_start", {"profile": "desk", "task": "pick"}, gate)
    )

    assert (
        result["ok"] is True
        and result["session_id"] == SID
        and result["state"] == "running"
    )
    assert result["cameras"] == ["front"]
    body = next(r["body"] for r in bridge.requests if r["path"] == "/session")
    assert body["robot"] == {
        "type": "so101_follower",
        "max_relative_target": 10.0,
        "port": "/dev/ttyUSB0",
    }
    assert body["offline_backbone"] is True and body["policy_path"] == "/models/p"
    assert body["home_tolerance"] == 5.0 and body["duration_s"] == 0.0
    assert len(gate.calls) == 1 and gate.calls[0]["risk"] == "robot"
    assert gate.calls[0]["max_relative_target"] == 10.0
    assert all(
        r["headers"]["authorization"] == "Bearer test-token" for r in bridge.requests
    )


@pytest.mark.parametrize(
    ("robot", "args", "code"),
    [
        ({}, {"profile": "nope", "task": "pick"}, "robot_unknown_profile"),
        (
            {
                "default_max_relative_target": None,
                "profiles": {"desk": {"type": "t", "policy_path": "/p"}},
            },
            {"profile": "desk", "task": "pick"},
            "max_relative_target_required",
        ),
        (
            {"profiles": {"desk": {"type": "t"}}},
            {"profile": "desk", "task": "pick"},
            "robot_policy_required",
        ),
        ({}, {"profile": "desk", "task": "  "}, "robot_invalid_args"),
        (
            {},
            {"profile": "desk", "task": "pick", "duration_s": -1},
            "robot_invalid_args",
        ),
        (
            {"token": "", "token_file": "/nonexistent/robot.token"},
            {"profile": "desk", "task": "pick"},
            "token_missing",
        ),
    ],
)
async def test_rollout_start_rejects(robot_env, robot, args, code):
    bridge, configure = robot_env
    configure(**robot)
    result = json.loads(await _call("robot_rollout_start", args, _ForbiddenGate()))
    assert result["ok"] is False and result["error_code"] == code, result
    assert bridge.requests == []


async def test_unknown_profile_hint_lists_profiles(robot_env):
    result = json.loads(
        await _call(
            "robot_rollout_start", {"profile": "x", "task": "pick"}, _ForbiddenGate()
        )
    )
    assert "desk" in result["hint"]


async def test_rollout_start_denied(robot_env):
    bridge, _ = robot_env
    result = await _call(
        "robot_rollout_start", {"profile": "desk", "task": "pick"}, _Gate(approve=False)
    )
    assert result.startswith("CANCELLED:")
    assert bridge.requests == []


async def test_rollout_start_reports_load_failure(robot_env):
    bridge, _ = robot_env
    traceback = "\n".join(f"line {i}" for i in range(30))
    failed = _status(
        "failed",
        error_code="calibration_required",
        error="robot is not calibrated",
        hint="lerobot-calibrate ...",
        failure_traceback=traceback,
    )
    bridge.on(
        "POST", "/session", (202, {"ok": True, "session_id": SID, "state": "loading"})
    )
    bridge.on("GET", f"/session/{SID}", _status("loading"), failed)

    result = json.loads(
        await _call(
            "robot_rollout_start", {"profile": "desk", "task": "pick"}, _Gate(True)
        )
    )

    assert result["ok"] is False and result["error_code"] == "calibration_required"
    assert result["session_id"] == SID and result["hint"].startswith(
        "lerobot-calibrate"
    )
    assert result["failure_traceback_tail"].splitlines() == [
        f"line {i}" for i in range(10, 30)
    ]
    assert ("POST", f"/session/{SID}/start") not in bridge.paths()


async def test_rollout_start_load_timeout_stops_session(robot_env):
    bridge, configure = robot_env
    configure(load_timeout_s=0.05)
    bridge.on(
        "POST", "/session", (202, {"ok": True, "session_id": SID, "state": "loading"})
    )
    bridge.on("GET", f"/session/{SID}", _status("loading"))
    bridge.on(
        "POST",
        f"/session/{SID}/stop",
        {"ok": True, "state": "stopping", "pose_check": None},
    )

    result = json.loads(
        await _call(
            "robot_rollout_start", {"profile": "desk", "task": "pick"}, _Gate(True)
        )
    )

    assert result["error_code"] == "robot_load_timeout" and result["session_id"] == SID
    assert ("POST", f"/session/{SID}/stop") in bridge.paths()
    assert ("POST", f"/session/{SID}/start") not in bridge.paths()


async def test_rollout_start_bridge_error_after_create_keeps_session_id(robot_env):
    bridge, _ = robot_env
    bridge.on(
        "POST", "/session", (202, {"ok": True, "session_id": SID, "state": "loading"})
    )
    bridge.on("GET", f"/session/{SID}", _status("idle"))
    bridge.on(
        "POST",
        f"/session/{SID}/start",
        (
            409,
            {
                "ok": False,
                "error_code": "invalid_state",
                "error": "cannot start",
                "hint": "",
            },
        ),
    )
    result = json.loads(
        await _call(
            "robot_rollout_start", {"profile": "desk", "task": "pick"}, _Gate(True)
        )
    )
    assert result["error_code"] == "invalid_state" and result["session_id"] == SID


# ---------------------------------------------------------------------- resume


async def test_resume_happy_path(robot_env):
    bridge, _ = robot_env
    bridge.on("GET", f"/session/{SID}", _status("idle"), _status("running"))
    bridge.on("POST", f"/session/{SID}/start", {"ok": True, "accepted": True})
    gate = _Gate(approve=True)

    result = json.loads(await _call("robot_resume", {"session_id": SID}, gate))

    assert result["ok"] is True and result["session_id"] == SID
    assert result["state"] == "running"
    assert len(gate.calls) == 1
    ctx = gate.calls[0]
    assert {k: ctx[k] for k in ("tool", "risk", "session_id", "task")} == {
        "tool": "robot_resume",
        "risk": "robot",
        "session_id": SID,
        "task": "pick",
    }
    assert ctx["protected_reason"] == "这条操作会让真实机器人运动"


@pytest.mark.parametrize(
    "state", ["running", "loading", "resetting", "failed", "stopped"]
)
async def test_resume_rejects_non_idle(robot_env, state):
    bridge, _ = robot_env
    bridge.on("GET", f"/session/{SID}", _status(state))

    result = json.loads(
        await _call("robot_resume", {"session_id": SID}, _ForbiddenGate())
    )

    assert result["ok"] is False and result["error_code"] == "robot_not_idle"
    assert result["session_id"] == SID
    assert ("POST", f"/session/{SID}/start") not in bridge.paths()


async def test_resume_denied(robot_env):
    bridge, _ = robot_env
    bridge.on("GET", f"/session/{SID}", _status("idle"))

    result = await _call("robot_resume", {"session_id": SID}, _Gate(approve=False))

    assert result.startswith("CANCELLED:")
    assert ("POST", f"/session/{SID}/start") not in bridge.paths()


async def test_resume_confirms_without_confirm_each_task(robot_env):
    bridge, configure = robot_env
    configure(confirm_each_task=False)
    bridge.on("GET", f"/session/{SID}", _status("idle"), _status("running"))
    bridge.on("POST", f"/session/{SID}/start", {"ok": True, "accepted": True})
    gate = _Gate(approve=True)

    result = json.loads(await _call("robot_resume", {"session_id": SID}, gate))

    assert result["ok"] is True and len(gate.calls) == 1


async def test_resume_bridge_error_keeps_session_id(robot_env):
    bridge, _ = robot_env
    bridge.on("GET", f"/session/{SID}", _status("idle"))
    bridge.on(
        "POST",
        f"/session/{SID}/start",
        (
            409,
            {
                "ok": False,
                "error_code": "invalid_state",
                "error": "cannot start",
                "hint": "",
            },
        ),
    )

    result = json.loads(
        await _call("robot_resume", {"session_id": SID}, _Gate(approve=True))
    )

    assert result["error_code"] == "invalid_state" and result["session_id"] == SID


# ---------------------------------------------------------------------- other tools


async def test_stop_no_confirm(robot_env):
    bridge, _ = robot_env
    pose = {
        "context": "stop",
        "verified": False,
        "max_abs_err": 9.0,
        "tolerance": 5.0,
        "error": None,
    }
    bridge.on(
        "POST",
        f"/session/{SID}/stop",
        {"ok": True, "state": "stopped", "pose_check": pose},
    )

    result = json.loads(
        await _call("robot_stop", {"session_id": SID}, _ForbiddenGate())
    )

    assert result["ok"] is True and result["state"] == "stopped"
    assert result["pose_check"]["verified"] is False and "warning" in result


async def test_stop_waits_while_stopping(robot_env):
    bridge, _ = robot_env
    pose = {
        "context": "stop",
        "verified": True,
        "max_abs_err": 0.1,
        "tolerance": 5.0,
        "error": None,
    }
    bridge.on(
        "POST",
        f"/session/{SID}/stop",
        {"ok": True, "state": "stopping", "pose_check": None},
    )
    bridge.on(
        "GET",
        f"/session/{SID}",
        _status("stopping"),
        _status("stopped", pose_check=pose),
    )

    result = json.loads(
        await _call("robot_stop", {"session_id": SID}, _ForbiddenGate())
    )

    assert result["state"] == "stopped" and result["pose_check"]["verified"] is True
    assert "warning" not in result


@pytest.mark.parametrize(
    ("confirm_each_task", "expected_calls"), [(True, 1), (False, 0)]
)
async def test_set_task_confirm_toggle(robot_env, confirm_each_task, expected_calls):
    bridge, configure = robot_env
    configure(confirm_each_task=confirm_each_task)
    bridge.on(
        "POST", f"/session/{SID}/task", {"ok": True, "changed": True, "task": "place"}
    )
    gate = _Gate(approve=True)

    result = json.loads(
        await _call("robot_set_task", {"session_id": SID, "task": "place"}, gate)
    )

    assert (
        result["ok"] is True and result["changed"] is True and result["task"] == "place"
    )
    assert len(gate.calls) == expected_calls
    if expected_calls:
        assert gate.calls[0]["risk"] == "robot" and gate.calls[0]["task"] == "place"


async def test_reset_reports_only_the_new_pose_check(robot_env):
    bridge, configure = robot_env
    configure(confirm_each_task=False)
    stale = {
        "context": "reset",
        "verified": False,
        "max_abs_err": 9.0,
        "tolerance": 5.0,
        "error": None,
    }
    fresh = {
        "context": "reset",
        "verified": True,
        "max_abs_err": 0.2,
        "tolerance": 5.0,
        "error": None,
    }
    bridge.on(
        "GET",
        f"/session/{SID}",
        _status("running", last_seq=7, pose_check=stale),
        _status(
            "resetting",
            last_seq=8,
            pose_check=stale,
            events=[{"seq": 8, "type": "reset_started", "detail": {}}],
        ),
        _status(
            "idle",
            last_seq=10,
            pose_check=fresh,
            events=[{"seq": 10, "type": "pose_check", "detail": fresh}],
        ),
    )
    bridge.on(
        "POST",
        f"/session/{SID}/reset",
        {"ok": True, "accepted": True, "restored": True},
    )

    result = json.loads(
        await _call("robot_reset", {"session_id": SID}, _ForbiddenGate())
    )

    assert result["ok"] is True and result["restored"] is True
    assert result["pose_check"] == fresh and "warning" not in result
    polls = [r["params"].get("since") for r in bridge.requests if r["method"] == "GET"]
    assert polls[:2] == ["0", "7"]


async def test_status_trims_traceback(robot_env):
    bridge, _ = robot_env
    bridge.on(
        "GET",
        f"/session/{SID}",
        _status("failed", failure_traceback="\n".join(str(i) for i in range(50))),
    )
    result = json.loads(
        await _call("robot_status", {"session_id": SID, "since": 3}, _ForbiddenGate())
    )
    assert "failure_traceback" not in result
    assert result["failure_traceback_tail"].splitlines() == [
        str(i) for i in range(30, 50)
    ]
    assert bridge.requests[0]["params"] == {"since": "3"}


async def test_snapshot_attaches_image(robot_env):
    bridge, _ = robot_env
    bridge.on(
        "GET",
        f"/session/{SID}/snapshot",
        {
            "ok": True,
            "camera": "front",
            "width": 1,
            "height": 1,
            "png_base64": PNG_1X1,
            "path": "/tmp/snap.png",
        },
    )
    session = StudioSession(provider_name="openai", model_name="gpt-4o")

    result_text = await _call(
        "robot_snapshot", {"session_id": SID}, _ForbiddenGate(), session
    )

    result = json.loads(result_text)
    assert result["ok"] is True and result["camera"] == "front"
    assert "png_base64" not in result_text
    from agenticx.cli.agent_tools import _pending_visual_attachments

    pending = _pending_visual_attachments(session)
    assert len(pending) == 1
    assert pending[0]["data_url"].startswith("data:image/png;base64,")
    assert pending[0]["name"] == "snap.png" and pending[0]["mime_type"] == "image/png"
    assert set(pending[0]) == {
        "name",
        "data_url",
        "mime_type",
        "size",
        "source",
        "note",
    }


async def test_snapshot_requires_vision_model(robot_env):
    bridge, _ = robot_env
    session = StudioSession(provider_name="zhipu", model_name="glm-5")
    result = json.loads(
        await _call("robot_snapshot", {"session_id": SID}, _ForbiddenGate(), session)
    )
    assert result["error_code"] == "robot_vision_unavailable"
    assert bridge.requests == []


# ---------------------------------------------------------------------- client


async def test_bridge_unreachable(robot_env):
    bridge, _ = robot_env
    bridge.on("GET", f"/session/{SID}", httpx.ConnectError("connection refused"))
    result = json.loads(
        await _call("robot_status", {"session_id": SID}, _ForbiddenGate())
    )
    assert result["error_code"] == "bridge_unreachable"
    assert "agx-robot-bridge serve" in result["hint"]


async def test_client_ignores_proxy_env_and_quotes_session_id(robot_env, monkeypatch):
    bridge, _ = robot_env
    seen: dict[str, Any] = {}
    real_client = httpx.AsyncClient

    def _recording_client(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        seen.update(kwargs)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(client_module.httpx, "AsyncClient", _recording_client)
    await _call("robot_status", {"session_id": "../health"}, _ForbiddenGate())
    assert seen["trust_env"] is False
    assert bridge.requests[0]["raw_path"].startswith("/session/..%2Fhealth")
