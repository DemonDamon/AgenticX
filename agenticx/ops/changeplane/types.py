"""Frozen ChangePlane types.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

ACTION_DISABLED = "action_disabled"

ALLOWED_SNAPSHOT_ATTRS = frozenset(
    {
        "source",
        "status",
        "environment",
        "project_id",
        "branch",
        "repo_url",
        "runtime_mode",
        "deploy_target",
        "previous_deployment_id",
    }
)


@dataclass
class DeploymentSnapshot:
    deployment_id: str
    project_id: str = ""
    status: str = ""
    environment: str = ""
    summary: str = ""
    ts: datetime | None = None
    attrs: dict[str, str] = field(default_factory=dict)


@dataclass
class ChangePlaneResult:
    ok: bool
    reason: str = ""
    snapshot: DeploymentSnapshot | None = None


class ChangePlaneProvider(Protocol):
    def list_deployments(
        self, *, project_id: str = "", limit: int = 50
    ) -> list[DeploymentSnapshot]: ...

    def get_deployment(self, deployment_id: str) -> DeploymentSnapshot | None: ...

    def restart(self, deployment_id: str) -> ChangePlaneResult: ...

    def rollback(self, deployment_id: str) -> ChangePlaneResult: ...

    def redeploy(self, deployment_id: str) -> ChangePlaneResult: ...
