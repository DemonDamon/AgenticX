#!/usr/bin/env python3
"""Bridge session: state machine and event log around one rollout backend.

Author: Hongyi Zhao
"""

from __future__ import annotations

import base64
import logging
import threading
import time
import traceback
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .backend import PoseCheck, RolloutBackend
from .errors import (
    INTERNAL_ERROR,
    INVALID_STATE,
    POLICY_LOAD_FAILED,
    STDIN_INPUT_BLOCKED,
    BridgeError,
    InteractiveInputBlocked,
)
from .events import EventLog
from .imaging import encode_png
from .models import SessionCreate

logger = logging.getLogger(__name__)

LOADING = "loading"
IDLE = "idle"
RUNNING = "running"
RESETTING = "resetting"
FAILED = "failed"
STOPPING = "stopping"
STOPPED = "stopped"

_TRACEBACK_LIMIT = 4000
_RESET_VERIFY_DELAY_S = 0.5
_SNAPSHOT_STATES = frozenset({IDLE, RUNNING, RESETTING})
_TASK_STATES_BLOCKED = frozenset({LOADING, FAILED, STOPPING, STOPPED})
_STDIN_BLOCKED_HINT = "LeRobot 请求了交互输入（通常是标定）。请在终端先完成 lerobot-calibrate 后重试。"

_EVENT_TRANSITIONS = {
    "segment_started": RUNNING,
    "segment_ended": IDLE,
    "reset_started": RESETTING,
    "reset_done": IDLE,
    "reset_skipped": IDLE,
    "reset_failed": IDLE,
    "engine_failed": FAILED,
    "strategy_failed": FAILED,
}


class BridgeSession:
    """One rollout session. ``stop()`` is reachable from every state and always ends in STOPPED."""

    def __init__(self, session_id: str, spec: SessionCreate, backend: RolloutBackend, snapshot_dir: Path) -> None:
        self.session_id = session_id
        self._spec = spec
        self._backend = backend
        self._snapshot_dir = Path(snapshot_dir)
        self._lock = threading.RLock()
        self._log = EventLog()
        self._state = LOADING
        self._loaded = False
        self._stop_requested = False
        self._torn_down = False
        self._torn_down_event = threading.Event()
        self._pose_check: dict[str, Any] | None = None
        self._error_code: str | None = None
        self._error: str | None = None
        self._hint: str | None = None
        self._failure_traceback: str | None = None
        self._cameras: list[str] = []
        self._supports_text_queries = False
        self._task = spec.task
        self._initial_task = spec.task
        self._reset_timer: threading.Timer | None = None
        self._load_thread: threading.Thread | None = None

    # ------------------------------------------------------------------ loading

    def begin_load(self) -> None:
        with self._lock:
            if self._load_thread is not None:
                return
            self._load_thread = threading.Thread(
                target=self._load, name=f"bridge-load-{self.session_id}", daemon=True
            )
            self._load_thread.start()

    def _load(self) -> None:
        self._log.append(
            "session_loading", {"policy_path": self._spec.policy_path, "robot_type": self._spec.robot.type}
        )
        try:
            self._backend.load(self._spec, self._on_backend_event)
        except BridgeError as exc:
            self._fail_load(exc.code, exc.message, exc.hint, None)
            return
        except InteractiveInputBlocked as exc:
            self._fail_load(STDIN_INPUT_BLOCKED, str(exc), _STDIN_BLOCKED_HINT, None)
            return
        except (Exception, SystemExit) as exc:
            # SystemExit too: argument parsers exit on bad input, which would otherwise end this
            # thread silently and leave the session in LOADING forever.
            logger.exception("session %s failed to load", self.session_id)
            message = str(exc) if isinstance(exc, Exception) else f"{type(exc).__name__}({exc})"
            self._fail_load(POLICY_LOAD_FAILED, message, "", traceback.format_exc()[-_TRACEBACK_LIMIT:])
            return

        cameras = list(self._backend.camera_names)
        supports_text_queries = bool(self._backend.supports_text_queries)
        with self._lock:
            self._loaded = True
            self._cameras = cameras
            self._supports_text_queries = supports_text_queries
            stop_now = self._stop_requested
            if not stop_now:
                self._state = IDLE
                self._log.append(
                    "session_ready", {"cameras": cameras, "supports_text_queries": supports_text_queries}
                )
        if stop_now:
            self._do_stop()

    def _fail_load(self, code: str, message: str, hint: str, failure_traceback: str | None) -> None:
        with self._lock:
            self._error_code, self._error, self._hint = code, message, hint
            self._failure_traceback = failure_traceback
            self._log.append("session_failed", {"error_code": code, "error": message})
            self._mark_torn_down_locked()
            if self._stop_requested:
                self._state = STOPPED
                self._log.append("session_stopped", {"pose_check": None})
            else:
                self._state = FAILED

    # ------------------------------------------------------------------ backend events

    def _on_backend_event(self, type_: str, detail: dict[str, Any]) -> None:
        with self._lock:
            self._log.append(type_, detail)
            if self._state in (STOPPING, STOPPED):
                return
            new_state = _EVENT_TRANSITIONS.get(type_)
            if new_state is None:
                return
            self._state = new_state
            if new_state == FAILED:
                self._error_code = INTERNAL_ERROR
                self._error = f"rollout {type_.replace('_', ' ')}"
                self._failure_traceback = (self._backend.failure_traceback or "")[-_TRACEBACK_LIMIT:] or None
            elif type_ == "reset_done":
                self._schedule_reset_verify_locked()

    def _schedule_reset_verify_locked(self) -> None:
        if self._reset_timer is not None:
            self._reset_timer.cancel()
        timer = threading.Timer(_RESET_VERIFY_DELAY_S, self._verify_after_reset)
        timer.daemon = True
        self._reset_timer = timer
        timer.start()

    def _verify_after_reset(self) -> None:
        tolerance = self._spec.home_tolerance
        with self._lock:
            state = self._state
        if state in (STOPPING, STOPPED, FAILED):
            return
        if state != IDLE:
            pose = PoseCheck("reset", None, None, tolerance, "skipped: robot started moving again before the check")
        else:
            try:
                pose = self._backend.verify_pose("reset", tolerance)
            except Exception as exc:
                pose = PoseCheck("reset", None, None, tolerance, f"pose read failed: {exc}")
        with self._lock:
            # A stop that began meanwhile owns the final pose check.
            if self._state in (STOPPING, STOPPED):
                return
            self._pose_check = asdict(pose)
            self._log.append("pose_check", asdict(pose))

    # ------------------------------------------------------------------ commands

    def start(self) -> dict[str, Any]:
        with self._lock:
            if self._state != IDLE:
                raise BridgeError(INVALID_STATE, f"cannot start in state {self._state}", status=409)
            return {"accepted": bool(self._backend.start())}

    def set_task(self, task: str) -> dict[str, Any]:
        with self._lock:
            if self._state in _TASK_STATES_BLOCKED:
                raise BridgeError(INVALID_STATE, f"cannot change the task in state {self._state}", status=409)
            changed = bool(self._backend.set_task(task))
            self._refresh_tasks_locked()
            return {"changed": changed, "task": self._task}

    def reset(self) -> dict[str, Any]:
        with self._lock:
            if self._state not in (IDLE, RUNNING):
                raise BridgeError(INVALID_STATE, f"cannot reset in state {self._state}", status=409)
            restored = bool(self._backend.reset())
            self._refresh_tasks_locked()
            return {"accepted": True, "restored": restored}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            if self._state == STOPPED:
                return self._stop_result_locked()
            if self._state == STOPPING:
                return {"state": STOPPING, "pose_check": None}
            if self._state == LOADING:
                self._stop_requested = True
                self._state = STOPPING
                return {"state": STOPPING, "pose_check": None}
            if self._torn_down:
                self._state = STOPPED
                self._log.append("session_stopped", {"pose_check": None})
                return self._stop_result_locked()
            self._state = STOPPING
        self._do_stop()
        with self._lock:
            return self._stop_result_locked()

    def _do_stop(self) -> None:
        tolerance = self._spec.home_tolerance
        with self._lock:
            if self._reset_timer is not None:
                self._reset_timer.cancel()
            self._refresh_tasks_locked()
        failure: tuple[str, str] | None = None
        try:
            pose = asdict(self._backend.stop_and_teardown(tolerance))
        except Exception as exc:
            logger.exception("session %s failed to stop cleanly", self.session_id)
            failure = (f"stop failed: {exc}", traceback.format_exc()[-_TRACEBACK_LIMIT:])
            pose = asdict(PoseCheck("stop", None, None, tolerance, failure[0]))
        with self._lock:
            self._pose_check = pose
            if failure is not None:
                self._error_code = INTERNAL_ERROR
                self._error, self._failure_traceback = failure
            self._state = STOPPED
            self._mark_torn_down_locked()
            self._log.append("session_stopped", {"pose_check": pose})

    def _stop_result_locked(self) -> dict[str, Any]:
        return {"state": self._state, "pose_check": dict(self._pose_check) if self._pose_check else None}

    def _mark_torn_down_locked(self) -> None:
        self._torn_down = True
        self._torn_down_event.set()

    def _refresh_tasks_locked(self) -> None:
        if not self._loaded or self._torn_down:
            return
        try:
            self._task = str(self._backend.task)
            self._initial_task = str(self._backend.initial_task)
        except Exception:
            logger.debug("could not read task from backend", exc_info=True)

    # ------------------------------------------------------------------ queries

    def status(self, since: int = 0) -> dict[str, Any]:
        with self._lock:
            self._refresh_tasks_locked()
            return {
                "session_id": self.session_id,
                "state": self._state,
                "task": self._task,
                "initial_task": self._initial_task,
                "supports_text_queries": self._supports_text_queries,
                "cameras": list(self._cameras),
                "events": self._log.since(since),
                "last_seq": self._log.last_seq,
                "pose_check": dict(self._pose_check) if self._pose_check else None,
                "error_code": self._error_code,
                "error": self._error,
                "hint": self._hint,
                "failure_traceback": self._failure_traceback,
            }

    def snapshot(self, camera: str | None) -> dict[str, Any]:
        with self._lock:
            if self._state not in _SNAPSHOT_STATES:
                raise BridgeError(INVALID_STATE, f"cannot take a snapshot in state {self._state}", status=409)
        try:
            name, frame = self._backend.read_frame(camera)
            png, width, height = encode_png(frame)
        except BridgeError:
            raise
        except Exception as exc:
            raise BridgeError(INTERNAL_ERROR, f"camera read failed: {exc}", status=500) from exc
        self._snapshot_dir.mkdir(parents=True, exist_ok=True)
        path = self._snapshot_dir / f"{self.session_id}_{int(time.time() * 1000)}.png"
        path.write_bytes(png)
        return {
            "path": str(path),
            "camera": name,
            "width": width,
            "height": height,
            "png_base64": base64.b64encode(png).decode("ascii"),
        }

    @property
    def torn_down(self) -> bool:
        with self._lock:
            return self._torn_down

    def wait_torn_down(self, timeout: float) -> bool:
        return self._torn_down_event.wait(timeout)
