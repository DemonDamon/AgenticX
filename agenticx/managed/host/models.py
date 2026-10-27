#!/usr/bin/env python3
"""HTTP models for the Managed Agents session API.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from agenticx.managed.protocol import SessionRecord, SessionSource


class CreateSessionRequest(BaseModel):
    """Body of ``POST /ma/v1/sessions``. Unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1, max_length=64)
    agent_version: int | None = Field(default=None, ge=1)
    environment_id: str | None = Field(default=None, min_length=1, max_length=64)
    vault_ids: list[str] = Field(default_factory=list)
    resources: list[dict[str, Any]] = Field(default_factory=list)
    title: str | None = Field(default=None, max_length=200)
    source: SessionSource = "api"


def session_to_wire(record: SessionRecord) -> dict[str, Any]:
    """JSON object for session responses. Explicit nulls are kept."""
    dumped = record.model_dump(mode="json")
    if not isinstance(dumped, dict):
        raise TypeError("session_to_wire expected an object")
    return dumped


__all__ = [
    "CreateSessionRequest",
    "session_to_wire",
]
