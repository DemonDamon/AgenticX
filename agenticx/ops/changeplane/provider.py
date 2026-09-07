"""ChangePlane factory and null provider.

Author: Damon Li
"""

from __future__ import annotations

import os

from agenticx.ops.changeplane.types import (
    ACTION_DISABLED,
    ChangePlaneProvider,
    ChangePlaneResult,
    DeploymentSnapshot,
)


class NullChangePlaneProvider:
    def list_deployments(
        self, *, project_id: str = "", limit: int = 50
    ) -> list[DeploymentSnapshot]:
        return []

    def get_deployment(self, deployment_id: str) -> DeploymentSnapshot | None:
        return None

    def restart(self, deployment_id: str) -> ChangePlaneResult:
        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)

    def rollback(self, deployment_id: str) -> ChangePlaneResult:
        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)

    def redeploy(self, deployment_id: str) -> ChangePlaneResult:
        return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)


def changeplane_base_url() -> str:
    return str(os.environ.get("AGENTICX_CHANGEPLANE_BASE_URL") or "").strip()


def changeplane_token() -> str:
    token = str(os.environ.get("AGENTICX_CHANGEPLANE_TOKEN") or "").strip()
    if token:
        return token
    return str(os.environ.get("OPENSHIP_TOKEN") or "").strip()


def get_changeplane() -> ChangePlaneProvider:
    base = changeplane_base_url()
    if not base:
        return NullChangePlaneProvider()
    from agenticx.ops.changeplane.openship import OpenshipProvider

    return OpenshipProvider(base_url=base, token=changeplane_token())
