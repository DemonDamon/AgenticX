"""Managed Agents error codes.

Author: Damon Li


Wire shape is ``{"error": {"code", "message", "details"}}``. ``MAError.code`` is the
string code, not the ``MAErrorCode`` constant object.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MAErrorCode:
    code: str
    http_status: int


class MAError(Exception):
    def __init__(
        self,
        code: MAErrorCode,
        message: str,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code.code
        self.http_status = code.http_status
        self.message = message
        self.details = {} if details is None else details

    def to_dict(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


INVALID_REQUEST = MAErrorCode("invalid_request", 400)
INVALID_EVENT_BATCH = MAErrorCode("invalid_event_batch", 400)
DUPLICATE_RESOLUTION = MAErrorCode("duplicate_resolution", 400)
MANIFEST_INVALID = MAErrorCode("manifest_invalid", 400)
UNAUTHORIZED = MAErrorCode("unauthorized", 401)
FORBIDDEN_SCOPE = MAErrorCode("forbidden_scope", 403)
SESSION_NOT_FOUND = MAErrorCode("session_not_found", 404)
AGENT_NOT_FOUND = MAErrorCode("agent_not_found", 404)
AGENT_VERSION_NOT_FOUND = MAErrorCode("agent_version_not_found", 404)
ENVIRONMENT_NOT_FOUND = MAErrorCode("environment_not_found", 404)
RESOLUTION_NOT_FOUND = MAErrorCode("resolution_not_found", 404)
SESSION_REQUIRES_ACTION = MAErrorCode("session_requires_action", 409)
RESOLUTION_CONFLICT = MAErrorCode("resolution_conflict", 409)
WORK_LEASE_LOST = MAErrorCode("work_lease_lost", 409)
SESSION_TERMINATED = MAErrorCode("session_terminated", 409)
INTERNAL = MAErrorCode("internal_error", 500)
TASK_NOT_FOUND = MAErrorCode("task_not_found", 404)
THREAD_NOT_FOUND = MAErrorCode("thread_not_found", 404)

ALL_ERROR_CODES: tuple[MAErrorCode, ...] = (
    INVALID_REQUEST,
    INVALID_EVENT_BATCH,
    DUPLICATE_RESOLUTION,
    MANIFEST_INVALID,
    UNAUTHORIZED,
    FORBIDDEN_SCOPE,
    SESSION_NOT_FOUND,
    AGENT_NOT_FOUND,
    AGENT_VERSION_NOT_FOUND,
    ENVIRONMENT_NOT_FOUND,
    RESOLUTION_NOT_FOUND,
    SESSION_REQUIRES_ACTION,
    RESOLUTION_CONFLICT,
    WORK_LEASE_LOST,
    SESSION_TERMINATED,
    INTERNAL,
    TASK_NOT_FOUND,
    THREAD_NOT_FOUND,
)
