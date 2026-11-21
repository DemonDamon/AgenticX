#!/usr/bin/env python3
"""Request models for the robot bridge HTTP API.

Author: Hongyi Zhao
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


def _require_text(value: str, field: str) -> str:
    text = (value or "").strip()
    if not text:
        raise ValueError(f"{field} must not be empty")
    return text


class RobotSpec(BaseModel):
    type: str
    port: str | None = None
    id: str | None = None
    cameras: dict[str, Any] = Field(default_factory=dict)
    max_relative_target: float | None = None
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("type")
    @classmethod
    def _type_not_blank(cls, value: str) -> str:
        return _require_text(value, "robot.type")


class SessionCreate(BaseModel):
    robot: RobotSpec
    policy_path: str
    task: str
    fps: float = 30.0
    duration_s: float = 0.0
    device: str | None = None
    home_tolerance: float = 5.0
    offline_backbone: bool = True

    @field_validator("policy_path")
    @classmethod
    def _policy_path_not_blank(cls, value: str) -> str:
        return _require_text(value, "policy_path")

    @field_validator("task")
    @classmethod
    def _task_not_blank(cls, value: str) -> str:
        return _require_text(value, "task")


class TaskUpdate(BaseModel):
    task: str

    @field_validator("task")
    @classmethod
    def _task_not_blank(cls, value: str) -> str:
        return _require_text(value, "task")
