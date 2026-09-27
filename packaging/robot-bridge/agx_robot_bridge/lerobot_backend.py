#!/usr/bin/env python3
"""Real rollout backend wrapping the LeRobot rollout controller.

Only the standard library, numpy and this package are imported at module level,
so the module stays importable (and ``build_argv`` testable) without lerobot.

Author: Hongyi Zhao
"""

import contextlib
import io
import json
import logging
import re
import sys
import threading
import time
import traceback
from typing import Any

import numpy as np

from .backend import EventCallback, PoseCheck
from .errors import (
    CALIBRATION_REQUIRED,
    NO_CAMERA,
    POLICY_LOAD_FAILED,
    ROBOT_CONNECT_FAILED,
    BridgeError,
    InteractiveInputBlocked,
)
from .models import SessionCreate

logger = logging.getLogger(__name__)

_ARGV_LOCK = threading.Lock()
_BUILD_LOCK = threading.Lock()
_PLUGINS_LOCK = threading.Lock()
_PLUGINS_REGISTERED = False

_SERVE_JOIN_TIMEOUT_S = 10.0
_SETTLE_BEFORE_VERIFY_S = 0.5
_EXTRA_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
# Set from dedicated SessionCreate fields; an ``extra`` entry must never override them.
_RESERVED_ROBOT_KEYS = frozenset({"type", "port", "id", "cameras", "max_relative_target"})


def check_runtime() -> str:
    """Return the installed lerobot version; raise ImportError when the rollout controller API is missing."""
    try:
        import lerobot
    except Exception as exc:
        raise ImportError(f"lerobot is not importable: {exc}") from exc
    version = str(getattr(lerobot, "__version__", "unknown"))
    try:
        from lerobot.rollout import RolloutController  # noqa: F401
    except Exception as exc:
        raise ImportError(f"lerobot {version} has no usable lerobot.rollout.RolloutController: {exc}") from exc
    return version


def _render_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def build_argv(spec: SessionCreate) -> list[str]:
    """Rollout CLI arguments for ``spec``; raises ValueError for an unsafe robot spec."""
    robot = spec.robot
    if robot.max_relative_target is None:
        raise ValueError("robot.max_relative_target is required")
    argv = [
        "--strategy.type=base",
        f"--policy.path={spec.policy_path}",
        f"--robot.type={robot.type}",
        f"--task={spec.task}",
        "--interactive=true",
        "--play_sounds=false",
        "--display_data=false",
        # The bridge returns home itself and verifies the pose afterwards.
        "--return_to_initial_position=false",
        f"--fps={spec.fps}",
        f"--duration={spec.duration_s}",
        f"--robot.max_relative_target={robot.max_relative_target}",
    ]
    if spec.device:
        argv.append(f"--device={spec.device}")
    if robot.port:
        argv.append(f"--robot.port={robot.port}")
    if robot.id:
        argv.append(f"--robot.id={robot.id}")
    if robot.cameras:
        argv.append(f"--robot.cameras={json.dumps(robot.cameras)}")
    for key, value in robot.extra.items():
        if not _EXTRA_KEY.match(key):
            raise ValueError(f"invalid robot.extra key: {key!r}")
        if key.split(".", 1)[0] in _RESERVED_ROBOT_KEYS:
            raise ValueError(f"robot.extra must not set {key!r}; use the dedicated field")
        argv.append(f"--robot.{key}={_render_value(value)}")
    return argv


def _parse_rollout_config(argv: list[str]) -> Any:
    """Build a RolloutConfig from CLI-style arguments (the config reads ``sys.argv`` directly)."""
    from lerobot.configs import parser
    from lerobot.rollout import RolloutConfig

    def _inner(cfg):
        return cfg

    # parser.wrap() inspects the raw annotation object, so it must be the class, not a string.
    _inner.__annotations__ = {"cfg": RolloutConfig}
    wrapped = parser.wrap()(_inner)

    captured = io.StringIO()
    with _ARGV_LOCK:
        saved = sys.argv
        sys.argv = ["agx-robot-bridge", *argv]
        try:
            with contextlib.redirect_stderr(captured):
                return wrapped()
        except SystemExit as exc:
            detail = captured.getvalue().strip() or f"exit code {exc.code}"
            raise ValueError(f"argument parsing failed: {detail}") from None
        finally:
            sys.argv = saved


def _ensure_plugins() -> None:
    global _PLUGINS_REGISTERED
    with _PLUGINS_LOCK:
        if _PLUGINS_REGISTERED:
            return
        from lerobot.utils.import_utils import register_third_party_plugins

        register_third_party_plugins()
        _PLUGINS_REGISTERED = True


def prepare_config(spec: SessionCreate) -> Any:
    """Parse the rollout config for ``spec`` and apply the offline-backbone override."""
    _ensure_plugins()
    try:
        cfg = _parse_rollout_config(build_argv(spec))
    except Exception as exc:
        raise BridgeError(POLICY_LOAD_FAILED, f"invalid rollout config: {exc}") from exc
    if spec.offline_backbone and hasattr(cfg.policy, "pretrained_backbone_weights"):
        # Only the ImageNet init is skipped; the checkpoint still provides the trained weights.
        cfg.policy.pretrained_backbone_weights = None
    return cfg


def _safe_disconnect(robot: Any, what: str) -> None:
    try:
        robot.disconnect()
    except Exception:
        logger.warning("%s disconnect failed", what, exc_info=True)


def _preflight_calibration(cfg: Any, spec: SessionCreate) -> None:
    """Fail closed on an uncalibrated robot instead of letting connect() prompt for input."""
    from lerobot.robots import make_robot_from_config

    probe = make_robot_from_config(cfg.robot)
    try:
        probe.connect(calibrate=False)
    except InteractiveInputBlocked:
        _safe_disconnect(probe, "probe")
        raise
    except Exception as exc:
        _safe_disconnect(probe, "probe")
        raise BridgeError(
            ROBOT_CONNECT_FAILED, f"cannot connect robot: {exc}", hint="检查 USB 线缆、串口 port 与供电"
        ) from exc
    try:
        calibrated = bool(probe.is_calibrated)
    finally:
        _safe_disconnect(probe, "probe")
    if not calibrated:
        raise BridgeError(
            CALIBRATION_REQUIRED,
            "robot is not calibrated",
            hint=(
                f"lerobot-calibrate --robot.type={spec.robot.type} "
                f"--robot.port={spec.robot.port or '<port>'} --robot.id={spec.robot.id or '<id>'}"
            ),
        )


class LeRobotBackend:
    """RolloutBackend implementation driving ``lerobot.rollout.RolloutController`` on a serve thread."""

    def __init__(self) -> None:
        self._cfg: Any = None
        self._ctx: Any = None
        self._strategy: Any = None
        self._controller: Any = None
        self._thread: threading.Thread | None = None
        self._on_event: EventCallback | None = None
        self._serve_crash: str | None = None
        self._teardown_lock = threading.Lock()
        self._teardown_result: PoseCheck | None = None

    # ------------------------------------------------------------------ lifecycle

    def load(self, spec: SessionCreate, on_event: EventCallback) -> None:
        self._on_event = on_event
        cfg = prepare_config(spec)
        self._cfg = cfg
        _preflight_calibration(cfg, spec)
        try:
            self._build(cfg)
        except (BridgeError, InteractiveInputBlocked):
            raise
        except Exception as exc:
            raise BridgeError(POLICY_LOAD_FAILED, str(exc)) from exc

    def _build(self, cfg: Any) -> None:
        import lerobot.rollout.context as context_module
        from lerobot.rollout import LinkedEvent, RolloutController, build_rollout_context, create_strategy

        # build_rollout_context connects the robot before its last validation steps; record the
        # robots it creates so a late failure never leaves the hardware connected.
        created: list[Any] = []
        original_factory = context_module.make_robot_from_config

        def _recording_factory(config: Any) -> Any:
            robot = original_factory(config)
            created.append(robot)
            return robot

        shutdown = LinkedEvent(threading.Event())
        with _BUILD_LOCK:
            context_module.make_robot_from_config = _recording_factory
            try:
                self._ctx = build_rollout_context(cfg, shutdown)
            except BaseException:
                for robot in created:
                    if getattr(robot, "is_connected", False):
                        _safe_disconnect(robot, "robot")
                raise
            finally:
                context_module.make_robot_from_config = original_factory

        try:
            self._strategy = create_strategy(cfg.strategy)
            self._strategy.setup(self._ctx)
            self._controller = RolloutController(self._strategy, self._ctx, on_event=self._forward_event)
            self._thread = threading.Thread(target=self._serve, name="rollout-serve", daemon=True)
            self._thread.start()
        except BaseException:
            strategy = self._strategy or create_strategy(cfg.strategy)
            try:
                strategy.teardown(self._ctx)
            except Exception:
                logger.exception("teardown after a failed build also failed")
            self._controller = None
            raise

    def _serve(self) -> None:
        try:
            self._controller.serve()
        except Exception:
            self._serve_crash = traceback.format_exc()
            logger.exception("rollout serve loop crashed")
            self._emit("engine_failed")

    def _forward_event(self, event: Any, _payload: Any = None) -> None:
        self._emit(getattr(event, "value", str(event)))

    def _emit(self, event_type: str) -> None:
        callback = self._on_event
        if callback is not None:
            callback(event_type, {})

    # ------------------------------------------------------------------ controls

    def start(self) -> bool:
        return bool(self._controller.start())

    def set_task(self, task: str) -> bool:
        return bool(self._controller.set_task(task))

    def reset(self) -> bool:
        return bool(self._controller.reset())

    def stop_and_teardown(self, tolerance: float) -> PoseCheck:
        with self._teardown_lock:
            if self._teardown_result is not None:
                return self._teardown_result
            if self._controller is None:
                self._teardown_result = PoseCheck("stop", None, None, tolerance, "backend not loaded")
                return self._teardown_result

            try:
                self._controller.stop()
            except Exception:
                logger.exception("controller stop failed; tearing down anyway")
            if self._thread is not None:
                self._thread.join(timeout=_SERVE_JOIN_TIMEOUT_S)
            pose = self._return_home_and_verify(tolerance)
            try:
                self._strategy.teardown(self._ctx)
            except Exception as exc:
                logger.exception("strategy teardown failed")
                note = f"teardown failed: {exc}"
                pose.error = f"{pose.error}; {note}" if pose.error else note
            self._teardown_result = pose
            return pose

    def _return_home_and_verify(self, tolerance: float) -> PoseCheck:
        if self._thread is not None and self._thread.is_alive():
            # Never interpolate home while the control loop may still be sending actions.
            return PoseCheck(
                "stop", None, None, tolerance,
                f"control loop did not stop within {_SERVE_JOIN_TIMEOUT_S:.0f}s; return move skipped",
            )
        hw = self._ctx.hardware
        if not hw.initial_position:
            return PoseCheck("stop", None, None, tolerance, "no initial position captured")
        if not hw.robot_wrapper.is_connected:
            return PoseCheck("stop", None, None, tolerance, "robot not connected")
        try:
            moved = self._strategy.return_to_initial_position(hw)
        except Exception as exc:
            return PoseCheck("stop", None, None, tolerance, f"return failed: {exc}")
        if not moved:
            return PoseCheck("stop", None, None, tolerance, "return move failed partway")
        time.sleep(_SETTLE_BEFORE_VERIFY_S)
        return self.verify_pose("stop", tolerance)

    def verify_pose(self, context: str, tolerance: float) -> PoseCheck:
        hw = self._ctx.hardware
        if not hw.initial_position:
            return PoseCheck(context, None, None, tolerance, "no initial position captured")
        try:
            obs = hw.robot_wrapper.get_observation()
            errors = [abs(float(obs[k]) - float(v)) for k, v in hw.initial_position.items() if k in obs]
        except Exception as exc:
            return PoseCheck(context, None, None, tolerance, f"pose read failed: {exc}")
        if not errors:
            return PoseCheck(context, None, None, tolerance, "no joint positions in observation")
        err = max(errors)
        return PoseCheck(context, err <= tolerance, round(err, 4), tolerance)

    def read_frame(self, camera: str | None) -> tuple[str, np.ndarray]:
        cameras = dict(self._ctx.hardware.robot_wrapper.cameras or {})
        name = camera or next(iter(cameras), None)
        if name is None or name not in cameras:
            raise BridgeError(
                NO_CAMERA,
                f"camera {camera!r} not found",
                hint=f"available cameras: {', '.join(cameras) or 'none'}",
                status=404,
            )
        frame = cameras[name].read_latest(max_age_ms=1000)
        return name, np.asarray(frame, dtype=np.uint8)

    # ------------------------------------------------------------------ properties

    @property
    def task(self) -> str:
        return str(self._controller.task)

    @property
    def initial_task(self) -> str:
        return str(self._controller.initial_task)

    @property
    def failure_traceback(self) -> str | None:
        if self._controller is not None and self._controller.failure_traceback:
            return self._controller.failure_traceback
        return self._serve_crash

    @property
    def camera_names(self) -> list[str]:
        return list(self._ctx.hardware.robot_wrapper.cameras or {})

    @property
    def supports_text_queries(self) -> bool:
        return bool(self._ctx.policy.inference.supports_text_queries)
