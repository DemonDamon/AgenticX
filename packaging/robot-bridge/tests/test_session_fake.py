#!/usr/bin/env python3
"""Session state machine tests driven through the HTTP API with the fake backend.

Author: Hongyi Zhao
"""

from __future__ import annotations

import time

from agx_robot_bridge.fake_backend import FakeBackend


def _is_subsequence(needles: list[str], haystack: list[str]) -> bool:
    it = iter(haystack)
    return all(needle in it for needle in needles)


def _create(client, body) -> str:
    resp = client.post("/session", json=body)
    assert resp.status_code == 202, resp.text
    assert resp.json()["state"] == "loading"
    return resp.json()["session_id"]


def test_full_command_chain(make_client, session_body, wait_state):
    client = make_client()
    sid = _create(client, session_body())
    ready = wait_state(client, sid, "idle")
    assert ready["cameras"] == ["front"]
    assert ready["supports_text_queries"] is False

    assert client.post(f"/session/{sid}/start").json()["accepted"] is True
    wait_state(client, sid, "running")

    update = client.post(f"/session/{sid}/task", json={"task": "B"}).json()
    assert update["changed"] is True and update["task"] == "B"

    reset = client.post(f"/session/{sid}/reset").json()
    assert reset["accepted"] is True and reset["restored"] is True
    idle = wait_state(client, sid, "idle")
    assert idle["task"] == idle["initial_task"] == "pick the cube"

    stop = client.post(f"/session/{sid}/stop")
    assert stop.status_code == 200 and stop.json()["state"] == "stopped"

    final = client.get(f"/session/{sid}").json()
    types = [e["type"] for e in final["events"]]
    assert _is_subsequence(
        ["session_loading", "session_ready", "segment_started", "reset_started", "reset_done", "session_stopped"],
        types,
    ), types
    assert final["state"] == "stopped"


def test_strategy_failure(make_client, session_body, wait_state):
    client = make_client(lambda: FakeBackend(fail_on_start=True))
    sid = _create(client, session_body())
    wait_state(client, sid, "idle")
    assert client.post(f"/session/{sid}/start").json()["accepted"] is True

    failed = wait_state(client, sid, "failed")
    assert failed["failure_traceback"]
    assert failed["error_code"] == "internal_error"

    again = client.post(f"/session/{sid}/start")
    assert again.status_code == 409 and again.json()["error_code"] == "invalid_state"

    stop = client.post(f"/session/{sid}/stop")
    assert stop.status_code == 200 and stop.json()["state"] == "stopped"


def test_stop_while_loading(make_client, session_body, wait_state):
    client = make_client(lambda: FakeBackend(load_delay_s=0.5))
    sid = _create(client, session_body())
    stop = client.post(f"/session/{sid}/stop")
    assert stop.status_code == 202 and stop.json()["state"] == "stopping"

    second = client.post(f"/session/{sid}/stop")
    assert second.status_code == 202 and second.json()["state"] == "stopping"

    final = wait_state(client, sid, "stopped", timeout=3.0)
    assert [e["type"] for e in final["events"]].count("session_stopped") == 1


def test_stop_idempotent(make_client, session_body, wait_state):
    client = make_client()
    sid = _create(client, session_body())
    wait_state(client, sid, "idle")
    first = client.post(f"/session/{sid}/stop")
    second = client.post(f"/session/{sid}/stop")
    assert first.status_code == second.status_code == 200
    assert first.json()["state"] == second.json()["state"] == "stopped"
    assert first.json()["pose_check"] == second.json()["pose_check"]
    assert first.json()["pose_check"]["context"] == "stop"


def test_calibration_required(make_client, session_body, wait_state):
    client = make_client(lambda: FakeBackend(calibrated=False))
    sid = _create(client, session_body())
    failed = wait_state(client, sid, "failed")
    assert failed["error_code"] == "calibration_required"
    assert failed["hint"].startswith("lerobot-calibrate")
    assert "--robot.port=/dev/fake0" in failed["hint"] and "--robot.id=arm1" in failed["hint"]

    retry = client.post("/session", json=session_body())
    assert retry.status_code == 202


def test_pose_check_reset_and_stop(make_client, session_body, wait_state):
    client = make_client(lambda: FakeBackend(pose_error=0.0))
    sid = _create(client, session_body())
    wait_state(client, sid, "idle")
    client.post(f"/session/{sid}/start")
    wait_state(client, sid, "running")
    since = client.get(f"/session/{sid}").json()["last_seq"]
    client.post(f"/session/{sid}/reset")

    deadline = time.monotonic() + 2.0
    checks: list[dict] = []
    while time.monotonic() < deadline and not checks:
        status = client.get(f"/session/{sid}", params={"since": since}).json()
        checks = [e for e in status["events"] if e["type"] == "pose_check"]
        time.sleep(0.05)
    assert checks, "no pose_check event within 2s after reset"
    assert checks[0]["detail"]["context"] == "reset"
    assert checks[0]["detail"]["verified"] is True
    client.post(f"/session/{sid}/stop")

    client2 = make_client(lambda: FakeBackend(pose_error=9.0))
    sid2 = _create(client2, session_body(home_tolerance=5.0))
    wait_state(client2, sid2, "idle")
    client2.post(f"/session/{sid2}/start")
    wait_state(client2, sid2, "running")
    stop = client2.post(f"/session/{sid2}/stop").json()
    assert stop["pose_check"]["verified"] is False
    assert stop["pose_check"]["max_abs_err"] == 9.0
    assert stop["pose_check"]["tolerance"] == 5.0


def test_late_reset_check_does_not_replace_stop_result(make_client, session_body, wait_state):
    client = make_client(lambda: FakeBackend(pose_error=9.0))
    sid = _create(client, session_body(home_tolerance=5.0))
    wait_state(client, sid, "idle")
    client.post(f"/session/{sid}/start")
    wait_state(client, sid, "running")
    client.post(f"/session/{sid}/reset")
    wait_state(client, sid, "idle")
    stop = client.post(f"/session/{sid}/stop").json()
    assert stop["pose_check"]["context"] == "stop"

    time.sleep(0.8)
    status = client.get(f"/session/{sid}").json()
    assert status["pose_check"]["context"] == "stop"
    assert not [e for e in status["events"] if e["type"] == "pose_check"]


def test_commands_rejected_while_loading(make_client, session_body):
    client = make_client(lambda: FakeBackend(load_delay_s=0.5))
    sid = _create(client, session_body())
    for path in ("start", "reset"):
        resp = client.post(f"/session/{sid}/{path}")
        assert resp.status_code == 409 and resp.json()["error_code"] == "invalid_state"
    resp = client.post(f"/session/{sid}/task", json={"task": "x"})
    assert resp.status_code == 409
    status = client.get(f"/session/{sid}").json()
    assert status["task"] == status["initial_task"] == "pick the cube"


def test_segment_duration_returns_to_idle(make_client, session_body, wait_state):
    client = make_client()
    sid = _create(client, session_body(duration_s=0.2))
    wait_state(client, sid, "idle")
    client.post(f"/session/{sid}/start")

    deadline = time.monotonic() + 3.0
    status: dict = {}
    while time.monotonic() < deadline:
        status = client.get(f"/session/{sid}").json()
        if "segment_ended" in [e["type"] for e in status["events"]]:
            break
        time.sleep(0.02)
    types = [e["type"] for e in status["events"]]
    assert _is_subsequence(["segment_started", "segment_ended"], types), types
    assert status["state"] == "idle"
