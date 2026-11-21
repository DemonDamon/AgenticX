#!/usr/bin/env python3
"""Simulated SO-101 follower: first-order servo joints and threaded cameras, no physics.

Joint and camera features match SO-101 ACT checkpoints (6 x ``<joint>.pos``,
cameras ``front`` / ``handeye`` at 480x640), so a real pretrained policy can run
against it. Cameras follow the same concurrency shape as the OpenCV camera
(background thread, ``frame_lock``, non-blocking ``read_latest``).

Author: Hongyi Zhao
"""

from __future__ import annotations

import logging
import threading
import time
import weakref
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
from lerobot.robots.config import RobotConfig
from lerobot.robots.robot import Robot

logger = logging.getLogger(__name__)

JOINTS = ("shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper")
# Degrees for arm joints, 0..100 for the gripper (SO-101 convention).
JOINT_LIMITS = {j: (-110.0, 110.0) for j in JOINTS[:-1]} | {"gripper": (0.0, 100.0)}
INITIAL_POSE = {j: 0.0 for j in JOINTS} | {"gripper": 20.0}

_SERVO_PERIOD_S = 0.01
_SERVO_GAIN = 0.2
_INSTANCES: weakref.WeakSet[AgxSimSO101] = weakref.WeakSet()


def live_connections() -> int:
    """Number of simulated robots currently connected (used by tests to catch leaks)."""
    return sum(1 for robot in list(_INSTANCES) if robot.is_connected)


@RobotConfig.register_subclass("agx_sim_so101")
@dataclass(kw_only=True)
class AgxSimSO101Config(RobotConfig):
    # Not named ``cameras``: RobotConfig.__post_init__ validates that field as real camera configs.
    camera_names: list[str] = field(default_factory=lambda: ["front", "handeye"])
    height: int = 480
    width: int = 640
    camera_fps: int = 30
    # When False, calibrate() prompts on stdin exactly like the real SO follower does.
    calibrated: bool = True
    # Per-step clamp on |goal - present|, same semantics as the real follower. None = no clamp.
    max_relative_target: float | None = None


class _SimCamera:
    def __init__(self, name: str, height: int, width: int, fps: int, state_fn) -> None:
        self.name, self.height, self.width, self.fps = name, height, width, fps
        self._state_fn = state_fn
        self.frame_lock = threading.Lock()
        self.latest_frame: np.ndarray | None = None
        self.latest_timestamp: float | None = None
        self._stop = threading.Event()
        self.thread: threading.Thread | None = None

    @property
    def is_connected(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def _render(self) -> np.ndarray:
        state = self._state_fn()
        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        img[:] = (36, 30, 30) if self.name == "front" else (30, 30, 36)
        base = (self.width // 2, self.height - 20)
        tip_x = int(self.width / 2 + state["shoulder_pan"] / 110.0 * self.width * 0.4)
        tip_y = int(self.height / 2 - (state["shoulder_lift"] + state["elbow_flex"]) / 220.0 * self.height * 0.4)
        size = int(10 + state["gripper"] / 100.0 * 40)
        cv2.circle(img, base, 12, (200, 200, 200), -1)
        cv2.line(img, base, (tip_x, tip_y), (255, 200, 0), 4)
        cv2.rectangle(img, (tip_x - size, tip_y - size), (tip_x + size, tip_y + size), (80, 220, 80), 2)
        cv2.putText(img, f"agx_sim_so101 cam={self.name}", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        for i, joint in enumerate(JOINTS):
            cv2.putText(
                img, f"{joint:>13}: {state[joint]:7.2f}", (10, 52 + 22 * i),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1,
            )
        return img

    def _loop(self) -> None:
        period = 1.0 / self.fps
        while not self._stop.is_set():
            started = time.perf_counter()
            frame = self._render()
            with self.frame_lock:
                self.latest_frame = frame
                self.latest_timestamp = time.perf_counter()
            self._stop.wait(max(0.0, period - (time.perf_counter() - started)))

    def connect(self) -> None:
        self._stop.clear()
        self.thread = threading.Thread(target=self._loop, name=f"sim_cam_{self.name}", daemon=True)
        self.thread.start()
        deadline = time.monotonic() + 2.0
        while self.latest_frame is None and time.monotonic() < deadline:
            time.sleep(0.01)

    def read_latest(self, max_age_ms: int = 500) -> np.ndarray:
        if not self.is_connected:
            raise RuntimeError(f"{self.name} read thread is not running.")
        with self.frame_lock:
            frame, timestamp = self.latest_frame, self.latest_timestamp
        if frame is None or timestamp is None:
            raise RuntimeError(f"{self.name} has not captured any frames yet.")
        age_ms = (time.perf_counter() - timestamp) * 1e3
        if age_ms > max_age_ms:
            raise TimeoutError(f"{self.name} latest frame too old: {age_ms:.1f} ms")
        return frame

    def disconnect(self) -> None:
        self._stop.set()
        if self.thread is not None:
            self.thread.join(timeout=2.0)
        self.thread = None


class AgxSimSO101(Robot):
    config_class = AgxSimSO101Config
    name = "agx_sim_so101"

    def __init__(self, config: AgxSimSO101Config) -> None:
        super().__init__(config)
        self.config = config
        self._state_lock = threading.Lock()
        self._present = dict(INITIAL_POSE)
        self._goal = dict(INITIAL_POSE)
        self.cameras = {
            name: _SimCamera(name, config.height, config.width, config.camera_fps, self._state_copy)
            for name in config.camera_names
        }
        self._connected = False
        self._calibrated = config.calibrated
        self._servo_stop = threading.Event()
        self._servo_thread: threading.Thread | None = None
        _INSTANCES.add(self)

    # ---- features -------------------------------------------------------

    @property
    def observation_features(self) -> dict[str, type | tuple]:
        features: dict[str, type | tuple] = {f"{j}.pos": float for j in JOINTS}
        for name in self.config.camera_names:
            features[name] = (self.config.height, self.config.width, 3)
        return features

    @property
    def action_features(self) -> dict[str, type]:
        return {f"{j}.pos": float for j in JOINTS}

    # ---- lifecycle ------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def is_calibrated(self) -> bool:
        return self._calibrated

    def connect(self, calibrate: bool = True) -> None:
        if not self.is_calibrated and calibrate:
            self.calibrate()
        self._servo_stop.clear()
        self._servo_thread = threading.Thread(target=self._servo_loop, name="sim_servo", daemon=True)
        self._servo_thread.start()
        for camera in self.cameras.values():
            camera.connect()
        self._connected = True
        self.configure()
        logger.info("%s connected", self)

    def calibrate(self) -> None:
        # Same blocking prompt as the real SO follower's calibrate().
        input("Press ENTER to use provided calibration file, or type 'c' and press ENTER to run calibration: ")
        self._calibrated = True

    def configure(self) -> None:
        pass

    def disconnect(self) -> None:
        for camera in self.cameras.values():
            camera.disconnect()
        time.sleep(0.2)  # let the servos settle on the last goal
        self._servo_stop.set()
        if self._servo_thread is not None:
            self._servo_thread.join(timeout=1.0)
        self._servo_thread = None
        self._connected = False
        logger.info("%s disconnected", self)

    # ---- I/O ------------------------------------------------------------

    def _state_copy(self) -> dict[str, float]:
        with self._state_lock:
            return dict(self._present)

    def _servo_loop(self) -> None:
        # Joints track the goal on their own, like real servos, whoever calls what.
        while not self._servo_stop.wait(_SERVO_PERIOD_S):
            with self._state_lock:
                for joint in JOINTS:
                    self._present[joint] += _SERVO_GAIN * (self._goal[joint] - self._present[joint])

    def get_observation(self) -> dict[str, Any]:
        obs: dict[str, Any] = {f"{j}.pos": v for j, v in self._state_copy().items()}
        for name, camera in self.cameras.items():
            obs[name] = camera.read_latest()
        return obs

    def send_action(self, action: dict[str, Any]) -> dict[str, Any]:
        goal = {k.removesuffix(".pos"): float(v) for k, v in action.items() if k.endswith(".pos")}
        present = self._state_copy()
        sent: dict[str, float] = {}
        for joint, target in goal.items():
            low, high = JOINT_LIMITS[joint]
            target = min(max(target, low), high)
            limit = self.config.max_relative_target
            if limit is not None:
                delta = target - present[joint]
                if abs(delta) > limit:
                    target = present[joint] + (limit if delta > 0 else -limit)
            sent[joint] = target
        with self._state_lock:
            self._goal.update(sent)
        return {f"{j}.pos": v for j, v in sent.items()}
