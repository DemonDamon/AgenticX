#!/usr/bin/env python3
"""Real rollout backend tests: argv construction always, simulated-robot integration when available.

Integration cases need the ``lerobot`` extra, the simulated robot plugin
(``pip install -e sim/lerobot_robot_agx_sim``) and ``AGX_ROBOT_BRIDGE_POLICY_PATH``
pointing at a local SO-101 ACT checkpoint; otherwise they are skipped.

Author: Hongyi Zhao
"""

from __future__ import annotations

import base64
import builtins
import io
import os
import time

import pytest
from PIL import Image

from agx_robot_bridge.lerobot_backend import LeRobotBackend, build_argv
from agx_robot_bridge.models import SessionCreate
from agx_robot_bridge.security import _blocked_input

POLICY_PATH = os.environ.get("AGX_ROBOT_BRIDGE_POLICY_PATH", "").strip()
DEVICE = os.environ.get("AGX_ROBOT_BRIDGE_DEVICE", "cpu")


def _spec(**robot: object) -> SessionCreate:
    return SessionCreate.model_validate(
        {
            "robot": {"type": "so101_follower", "max_relative_target": 10.0, **robot},
            "policy_path": "/models/act",
            "task": "pick up the cube",
        }
    )


def test_build_argv():
    spec = _spec(
        port="/dev/tty.usb1",
        id="arm1",
        cameras={"front": {"type": "opencv", "index_or_path": 0, "width": 640, "height": 480, "fps": 30}},
        extra={"calibrated": False, "use_degrees": True, "gains": [1, 2]},
    )
    argv = build_argv(spec)
    assert "--strategy.type=base" in argv
    assert "--policy.path=/models/act" in argv
    assert "--robot.type=so101_follower" in argv
    assert "--task=pick up the cube" in argv
    assert "--interactive=true" in argv
    assert "--play_sounds=false" in argv
    assert "--display_data=false" in argv
    assert "--return_to_initial_position=false" in argv
    assert "--robot.max_relative_target=10.0" in argv
    assert "--fps=30.0" in argv and "--duration=0.0" in argv
    assert "--robot.port=/dev/tty.usb1" in argv and "--robot.id=arm1" in argv
    assert (
        '--robot.cameras={"front": {"type": "opencv", "index_or_path": 0, "width": 640, "height": 480, "fps": 30}}'
        in argv
    )
    assert "--robot.calibrated=false" in argv and "--robot.use_degrees=true" in argv
    assert "--robot.gains=[1, 2]" in argv
    assert not any(a.startswith("--device=") for a in argv)
    assert "--device=cpu" in build_argv(_spec().model_copy(update={"device": "cpu"}))


def test_build_argv_omits_empty_optional_robot_fields():
    argv = build_argv(_spec())
    assert not any(a.startswith(("--robot.port=", "--robot.id=", "--robot.cameras=")) for a in argv)


@pytest.mark.parametrize(
    "extra",
    [
        {"max_relative_target": 1000},
        {"type": "koch_follower"},
        {"cameras.front.fps": 5},
        {"port": "/dev/other"},
        {"bad key": 1},
        {"x=1 --robot.max_relative_target": 1},
    ],
)
def test_build_argv_rejects_unsafe_extra(extra):
    with pytest.raises(ValueError):
        build_argv(_spec(extra=extra))


def test_build_argv_requires_motion_limit():
    with pytest.raises(ValueError):
        build_argv(_spec(max_relative_target=None))


def test_stop_before_load_is_safe():
    pose = LeRobotBackend().stop_and_teardown(5.0)
    assert pose.context == "stop" and pose.verified is None and pose.error


# ---------------------------------------------------------------------- lerobot required


@pytest.fixture
def lerobot_runtime():
    pytest.importorskip("lerobot.rollout")
    from agx_robot_bridge.lerobot_backend import check_runtime

    return check_runtime()


def test_parse_errors_become_value_errors(lerobot_runtime):
    from agx_robot_bridge.lerobot_backend import _parse_rollout_config

    with pytest.raises(ValueError, match="argument parsing failed"):
        _parse_rollout_config(["--robot.type=so101_follower", "--fps=not-a-number"])


# ---------------------------------------------------------------------- simulated robot + policy


@pytest.fixture
def sim(lerobot_runtime, monkeypatch):
    if not POLICY_PATH:
        pytest.skip("AGX_ROBOT_BRIDGE_POLICY_PATH is not set")
    sim_module = pytest.importorskip("lerobot_robot_agx_sim")
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setattr(builtins, "input", _blocked_input)
    yield sim_module
    assert sim_module.live_connections() == 0, "simulated robot left connected"


def _sim_body(**robot: object) -> dict:
    return {
        "robot": {"type": "agx_sim_so101", "max_relative_target": 10.0, **robot},
        "policy_path": POLICY_PATH,
        "task": "pick up the cube",
        "device": DEVICE,
        "home_tolerance": 5.0,
    }


def _wait_pose_check(client, sid: str, context: str, since: int, timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = client.get(f"/session/{sid}", params={"since": since}).json()
        checks = [e["detail"] for e in status["events"] if e["type"] == "pose_check"]
        if checks and checks[-1]["context"] == context:
            return checks[-1]
        time.sleep(0.1)
    raise AssertionError(f"no {context} pose_check within {timeout}s")


def _assert_moved_away(sim, robot) -> None:
    # Beyond the home tolerance, or the return-to-home checks would pass without proving anything.
    state = robot._state_copy()
    moved = max(abs(state[j] - sim.agx_sim_so101.INITIAL_POSE[j]) for j in sim.agx_sim_so101.JOINTS)
    assert moved > 5.0, state


def test_sim_full_chain(sim, make_client, wait_state):
    client = make_client(LeRobotBackend)
    sid = client.post("/session", json=_sim_body()).json()["session_id"]
    ready = wait_state(client, sid, "idle", timeout=120)
    assert ready["cameras"] == ["front", "handeye"]
    assert sim.live_connections() == 1

    assert client.post(f"/session/{sid}/start").json()["accepted"] is True
    wait_state(client, sid, "running", timeout=30)
    time.sleep(5)
    robot = next(r for r in list(sim.agx_sim_so101._INSTANCES) if r.is_connected)
    _assert_moved_away(sim, robot)

    snap = client.get(f"/session/{sid}/snapshot").json()
    image = Image.open(io.BytesIO(base64.b64decode(snap["png_base64"])))
    assert image.size == (640, 480) and snap["camera"] == "front"
    handeye = client.get(f"/session/{sid}/snapshot", params={"camera": "handeye"}).json()
    assert handeye["camera"] == "handeye"

    since = client.get(f"/session/{sid}").json()["last_seq"]
    assert client.post(f"/session/{sid}/reset").json()["accepted"] is True
    reset_check = _wait_pose_check(client, sid, "reset", since, timeout=15)
    assert reset_check["verified"] is True and reset_check["max_abs_err"] <= 5.0, reset_check
    wait_state(client, sid, "idle", timeout=15)

    # Stop in the middle of a second segment: the return move must start from a moved pose.
    assert client.post(f"/session/{sid}/start").json()["accepted"] is True
    wait_state(client, sid, "running", timeout=30)
    time.sleep(3)
    _assert_moved_away(sim, robot)
    t0 = time.monotonic()
    stop = client.post(f"/session/{sid}/stop").json()
    assert time.monotonic() - t0 < 10
    assert stop["state"] == "stopped"
    assert stop["pose_check"]["verified"] is True, stop["pose_check"]
    assert sim.live_connections() == 0


def test_sim_calibration_fail_closed(sim, make_client, wait_state):
    client = make_client(LeRobotBackend)
    t0 = time.monotonic()
    sid = client.post("/session", json=_sim_body(extra={"calibrated": False})).json()["session_id"]
    failed = wait_state(client, sid, "failed", timeout=30)
    assert time.monotonic() - t0 < 30
    assert failed["error_code"] == "calibration_required"
    assert failed["hint"].startswith("lerobot-calibrate --robot.type=agx_sim_so101")


def test_sim_failure_after_connect_releases_robot(sim, make_client, wait_state):
    client = make_client(LeRobotBackend)
    sid = client.post("/session", json=_sim_body(extra={"camera_names": ["cam0"]})).json()["session_id"]
    failed = wait_state(client, sid, "failed", timeout=120)
    assert failed["error_code"] == "policy_load_failed"
    assert "Visual feature mismatch" in failed["error"]
    assert sim.live_connections() == 0


def test_offline_backbone(sim):
    from agx_robot_bridge.lerobot_backend import prepare_config

    body = _sim_body()
    cfg = prepare_config(SessionCreate.model_validate(body))
    assert cfg.policy.pretrained_backbone_weights is None
    assert cfg.return_to_initial_position is False and cfg.interactive is True

    online = prepare_config(SessionCreate.model_validate({**body, "offline_backbone": False}))
    assert online.policy.pretrained_backbone_weights
