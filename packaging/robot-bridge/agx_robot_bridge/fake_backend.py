#!/usr/bin/env python3
"""In-process fake rollout backend for tests and hardware-free end-to-end runs.

Author: Hongyi Zhao
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterable

import numpy as np

from .backend import EventCallback, PoseCheck
from .errors import CALIBRATION_REQUIRED, NO_CAMERA, BridgeError
from .models import SessionCreate

logger = logging.getLogger(__name__)

_MOVING_POSITION = 10.0


class FakeBackend:
    """Mimics the rollout controller lifecycle: serve thread, events, one-shot stop."""

    def __init__(
        self,
        *,
        calibrated: bool = True,
        fail_on_start: bool = False,
        pose_error: float = 0.0,
        load_delay_s: float = 0.0,
        joints: int = 6,
        cameras: Iterable[str] = ("front",),
    ) -> None:
        self._calibrated = calibrated
        self._fail_on_start = fail_on_start
        self._pose_error = float(pose_error)
        self._load_delay_s = float(load_delay_s)
        self._joints = int(joints)
        self._cameras = list(cameras)

        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._start_requested = False
        self._reset_requested = False
        self._stop_requested = False
        self._running = False
        self._stopped = False
        self._failed = False
        self._task = ""
        self._initial_task = ""
        self._failure_traceback: str | None = None
        self._initial: dict[str, float] = {}
        self._present: dict[str, float] = {}
        self._duration_s = 0.0
        self._on_event: EventCallback | None = None
        self._thread: threading.Thread | None = None
        self._teardown_result: PoseCheck | None = None

    # ------------------------------------------------------------------ lifecycle

    def load(self, spec: SessionCreate, on_event: EventCallback) -> None:
        if self._load_delay_s > 0:
            time.sleep(self._load_delay_s)
        if not self._calibrated:
            raise BridgeError(
                CALIBRATION_REQUIRED,
                "robot is not calibrated",
                hint=(
                    f"lerobot-calibrate --robot.type={spec.robot.type} "
                    f"--robot.port={spec.robot.port or '<port>'} --robot.id={spec.robot.id or '<id>'}"
                ),
            )
        with self._lock:
            self._initial = {f"j{i}.pos": 0.0 for i in range(self._joints)}
            self._present = dict(self._initial)
            self._task = self._initial_task = spec.task
            self._duration_s = float(spec.duration_s)
            self._on_event = on_event
        self._thread = threading.Thread(target=self._serve, name="fake-rollout-serve", daemon=True)
        self._thread.start()

    def _emit(self, event: str) -> None:
        callback = self._on_event
        if callback is None:
            return
        try:
            callback(event, {})
        except Exception:
            logger.exception("fake backend event callback failed for %s", event)

    def _home_with_error(self) -> None:
        with self._lock:
            self._present = {k: v + self._pose_error for k, v in self._initial.items()}

    def _serve(self) -> None:
        deadline: float | None = None
        try:
            while True:
                with self._lock:
                    if self._stop_requested:
                        action = "stop"
                    elif self._reset_requested:
                        self._reset_requested = False
                        action = "reset"
                    elif self._start_requested:
                        self._start_requested = False
                        self._running = True
                        action = "start"
                    else:
                        action = None

                if action == "stop":
                    return
                if action == "reset":
                    deadline = None
                    with self._lock:
                        self._running = False
                    self._emit("reset_started")
                    self._home_with_error()
                    self._emit("reset_done")
                    continue
                if action == "start":
                    if self._fail_on_start:
                        self._emit("segment_started")
                        with self._lock:
                            self._failure_traceback = "Traceback (most recent call last):\n  ...\nFakeFailure"
                            self._failed = True
                            self._running = False
                        self._emit("strategy_failed")
                        return
                    with self._lock:
                        self._present = {k: _MOVING_POSITION for k in self._initial}
                        duration = self._duration_s
                    deadline = time.monotonic() + duration if duration > 0 else None
                    self._emit("segment_started")
                    continue

                if deadline is not None and time.monotonic() >= deadline:
                    deadline = None
                    with self._lock:
                        self._running = False
                    self._emit("segment_ended")
                    continue

                timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
                self._wake.wait(timeout)
                self._wake.clear()
        finally:
            with self._lock:
                self._running = False
                self._stopped = True
            self._emit("stopped")

    # ------------------------------------------------------------------ controls

    def start(self) -> bool:
        with self._lock:
            if self._thread is None or self._stopped or self._stop_requested or self._failed or self._running:
                return False
            self._start_requested = True
        self._wake.set()
        return True

    def set_task(self, task: str) -> bool:
        with self._lock:
            if self._stopped or self._stop_requested:
                return False
            changed = task != self._task
            self._task = task
            return changed

    def reset(self) -> bool:
        with self._lock:
            if self._stopped or self._stop_requested:
                return False
            self._start_requested = False
            restored = self._task != self._initial_task
            self._task = self._initial_task
            self._reset_requested = True
        self._wake.set()
        return restored

    def stop_and_teardown(self, tolerance: float) -> PoseCheck:
        with self._lock:
            if self._teardown_result is not None:
                return self._teardown_result
            self._stop_requested = True
            self._start_requested = False
        self._wake.set()
        if self._thread is not None:
            self._thread.join(5)
        self._home_with_error()
        result = self.verify_pose("stop", tolerance)
        with self._lock:
            self._teardown_result = result
        return result

    def verify_pose(self, context: str, tolerance: float) -> PoseCheck:
        with self._lock:
            initial = dict(self._initial)
            present = dict(self._present)
        if not initial:
            return PoseCheck(context, None, None, tolerance, "no initial position captured")
        err = max(abs(present[k] - initial[k]) for k in initial)
        return PoseCheck(context, err <= tolerance, round(err, 4), tolerance)

    def read_frame(self, camera: str | None) -> tuple[str, np.ndarray]:
        name = camera or (self._cameras[0] if self._cameras else None)
        if name is None or name not in self._cameras:
            raise BridgeError(
                NO_CAMERA,
                f"camera {camera!r} not found",
                hint=f"available cameras: {', '.join(self._cameras) or 'none'}",
                status=404,
            )
        return name, np.full((480, 640, 3), 80, np.uint8)

    # ------------------------------------------------------------------ properties

    @property
    def task(self) -> str:
        with self._lock:
            return self._task

    @property
    def initial_task(self) -> str:
        with self._lock:
            return self._initial_task

    @property
    def failure_traceback(self) -> str | None:
        with self._lock:
            return self._failure_traceback

    @property
    def camera_names(self) -> list[str]:
        return list(self._cameras)

    @property
    def supports_text_queries(self) -> bool:
        return False
