"""Normalized inbound change-plane webhook.

Author: Damon Li
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from agenticx.ops.change_log import record_change_event, record_ops_change_event
from agenticx.ops.changeplane.sync import upsert_snapshot
from agenticx.ops.changeplane.types import DeploymentSnapshot
from agenticx.ops.first_party import FirstPartyProvider
from agenticx.ops.query import ChangeEvent
from agenticx.ops.umodel.store import FileObjectStore, get_object_store


def _merge_missing(base: dict, extra: object) -> dict:
    if not isinstance(extra, dict):
        return base
    out = dict(extra)
    out.update(base)
    return out


def flatten_webhook_payload(payload: dict) -> dict:
    flat = dict(payload)
    data = payload.get("data")
    if isinstance(data, dict):
        flat = _merge_missing(flat, data)
    deployment = flat.get("deployment")
    if isinstance(deployment, dict):
        for key, value in deployment.items():
            if key not in flat or flat.get(key) in (None, ""):
                flat[key] = value
    return flat


def _first_str(row: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = row.get(key)
        if value is None or isinstance(value, (dict, list)):
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _parse_ts(raw: object) -> datetime:
    if raw is None or raw == "":
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def apply_webhook_payload(
    payload: dict,
    *,
    store: FileObjectStore | None = None,
    sessions_root: Path | None = None,
) -> ChangeEvent | None:
    if not isinstance(payload, dict):
        return None
    flat = flatten_webhook_payload(payload)
    deployment_id = _first_str(flat, ("deployment_id", "id", "deploymentId"))
    if not deployment_id:
        return None
    project_id = _first_str(flat, ("project_id", "projectId"))
    status = _first_str(flat, ("status",))
    environment = _first_str(flat, ("environment",))
    action = _first_str(flat, ("event", "type")) or "deployment.updated"
    summary = _first_str(flat, ("summary",)) or " ".join(
        part for part in (status, environment) if part
    )
    session_id = _first_str(flat, ("session_id",))
    ts = _parse_ts(flat.get("ts") or flat.get("createdAt"))
    target = store if store is not None else get_object_store()
    snap = DeploymentSnapshot(
        deployment_id=deployment_id,
        project_id=project_id,
        status=status,
        environment=environment,
        summary=summary,
        ts=ts,
        attrs={"source": "openship"},
    )
    upsert_snapshot(target, snap)
    event = ChangeEvent(
        ts=ts,
        deployment_id=deployment_id,
        action=action,
        summary=summary,
        source="changeplane",
    )
    record_ops_change_event(event)
    if session_id:
        session_dir = FirstPartyProvider(sessions_root=sessions_root)._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        record_change_event(session_dir, event)
    return event
