#!/usr/bin/env python3
"""Error types and error codes shared by the robot bridge.

Author: Hongyi Zhao
"""

from __future__ import annotations

UNAUTHORIZED = "unauthorized"
SESSION_ACTIVE = "session_active"
NOT_FOUND = "not_found"
INVALID_STATE = "invalid_state"
MAX_RELATIVE_TARGET_REQUIRED = "max_relative_target_required"
CALIBRATION_REQUIRED = "calibration_required"
ROBOT_CONNECT_FAILED = "robot_connect_failed"
POLICY_LOAD_FAILED = "policy_load_failed"
STDIN_INPUT_BLOCKED = "stdin_input_blocked"
NO_CAMERA = "no_camera"
INTERNAL_ERROR = "internal_error"


class BridgeError(Exception):
    """An error with a stable machine-readable code, surfaced to the HTTP client."""

    def __init__(self, code: str, message: str, *, hint: str = "", status: int = 400) -> None:
        super().__init__(message)
        self.code, self.message, self.hint, self.status = code, message, hint, status


class InteractiveInputBlocked(RuntimeError):
    """Raised when library code calls input() inside the bridge process."""
