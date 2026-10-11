#!/usr/bin/env python3
"""Durable job models and status enum.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class JobStatus(str, Enum):
    QUEUED = "queued"
    SCHEDULED = "scheduled"
    RUNNING = "running"
    WAITING_INPUT = "waiting_input"
    WAITING_EXTERNAL = "waiting_external"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


CLAIMABLE_STATUSES = frozenset({JobStatus.QUEUED, JobStatus.SCHEDULED})
TERMINAL_STATUSES = frozenset(
    {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}
)


@dataclass
class DurableJob:
    id: str
    owner: str
    kind: str
    status: JobStatus
    lease_id: Optional[str] = None
    lease_until: Optional[float] = None
    attempts: int = 0
    payload: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    updated_at: float = 0.0
    # Optional bridge to automation_tasks.json entries
    automation_task_id: Optional[str] = None
    # Prior status when paused (for resume)
    resume_status: Optional[str] = None
