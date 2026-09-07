"""Read-only change-plane adapter.

Author: Damon Li
"""

from agenticx.ops.changeplane.openship import OpenshipProvider, parse_deployment_list
from agenticx.ops.changeplane.provider import (
    NullChangePlaneProvider,
    changeplane_base_url,
    get_changeplane,
)
from agenticx.ops.changeplane.sync import sync_deployments, upsert_snapshot
from agenticx.ops.changeplane.types import (
    ACTION_DISABLED,
    ChangePlaneResult,
    DeploymentSnapshot,
)
from agenticx.ops.changeplane.webhook import apply_webhook_payload

__all__ = [
    "ACTION_DISABLED",
    "ChangePlaneResult",
    "DeploymentSnapshot",
    "NullChangePlaneProvider",
    "OpenshipProvider",
    "apply_webhook_payload",
    "changeplane_base_url",
    "get_changeplane",
    "parse_deployment_list",
    "sync_deployments",
    "upsert_snapshot",
]
