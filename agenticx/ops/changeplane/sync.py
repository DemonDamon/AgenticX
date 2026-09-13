"""Upsert ChangePlane snapshots into the local object graph.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.ops.changeplane.types import ALLOWED_SNAPSHOT_ATTRS, ChangePlaneProvider, DeploymentSnapshot
from agenticx.ops.umodel.ingest import register_deployment
from agenticx.ops.umodel.schema import UModelObject
from agenticx.ops.umodel.store import FileObjectStore


def _merge_openship_attrs(existing: dict[str, str], snap: DeploymentSnapshot) -> dict[str, str]:
    merged = {k: v for k, v in existing.items() if k in ALLOWED_SNAPSHOT_ATTRS or k == "service_id"}
    for key, value in snap.attrs.items():
        if key in ALLOWED_SNAPSHOT_ATTRS and value:
            merged[key] = value
    merged["source"] = "openship"
    if snap.status:
        merged["status"] = snap.status
    if snap.environment:
        merged["environment"] = snap.environment
    if snap.project_id:
        merged["project_id"] = snap.project_id
    return merged


def upsert_snapshot(store: FileObjectStore, snap: DeploymentSnapshot) -> UModelObject:
    obj = register_deployment(
        snap.deployment_id,
        store=store,
        service_id=snap.project_id,
        summary=snap.summary,
    )
    current = store.get("deployment", snap.deployment_id) or obj
    attrs = _merge_openship_attrs(dict(current.attrs), snap)
    return store.upsert(
        UModelObject(
            kind="deployment",
            id=snap.deployment_id,
            deployment_id=snap.deployment_id,
            tenant_id=current.tenant_id,
            session_id=current.session_id,
            name=current.name,
            status=snap.status or current.status,
            summary=snap.summary or current.summary,
            attrs=attrs,
        )
    )


def sync_deployments(
    provider: ChangePlaneProvider,
    store: FileObjectStore,
    *,
    project_id: str = "",
    limit: int = 50,
) -> list[DeploymentSnapshot]:
    snapshots = provider.list_deployments(project_id=project_id, limit=limit)
    for snap in snapshots:
        upsert_snapshot(store, snap)
    return snapshots
