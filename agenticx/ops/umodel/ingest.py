"""Materialize UModel objects from first-party session evidence.

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path

from agenticx.ops.change_log import read_change_events
from agenticx.ops.first_party import FirstPartyProvider
from agenticx.ops.query import QueryScope
from agenticx.ops.umodel.schema import UModelObject
from agenticx.ops.umodel.store import FileObjectStore


def _sessions_root(sessions_root: Path | None) -> Path:
    if sessions_root is not None:
        return Path(sessions_root)
    env_root = os.environ.get("AGENTICX_SESSIONS_ROOT", "").strip()
    if env_root:
        return Path(env_root)
    return Path.home() / ".agenticx" / "sessions"


def ingest_session(
    session_id: str,
    *,
    store: FileObjectStore,
    sessions_root: Path | None = None,
) -> list[UModelObject]:
    sid = str(session_id or "").strip()
    if not sid:
        return []
    root = _sessions_root(sessions_root)
    session_dir = root / sid
    messages_path = session_dir / "messages.json"
    if not session_dir.is_dir() or not messages_path.is_file():
        return []

    tenant_id = str(os.environ.get("AGENTICX_TENANT_ID") or "").strip()
    deployment_id = str(os.environ.get("AGENTICX_DEPLOYMENT_ID") or "").strip()
    change_summary = ""
    events = read_change_events(session_dir, 200)
    for event in reversed(events):
        did = str(event.deployment_id or "").strip()
        if did:
            deployment_id = did
            change_summary = str(event.summary or "")
            break

    written: list[UModelObject] = []
    written.append(
        store.upsert(
            UModelObject(
                kind="session",
                id=sid,
                session_id=sid,
                tenant_id=tenant_id,
                deployment_id=deployment_id,
                attrs={"source": "first_party"},
            )
        )
    )

    provider = FirstPartyProvider(sessions_root=root)
    traces = provider.get_trace(QueryScope(session_id=sid, limit=200))
    for span in traces.items:
        if getattr(span, "name", "") == "assistant.reply":
            continue
        tool_id = str(getattr(span, "span_id", "") or "").strip()
        if not tool_id:
            continue
        attrs = {"source": str(getattr(span, "source", "") or "first_party")}
        evidence = ""
        raw_attrs = getattr(span, "attributes", None)
        if isinstance(raw_attrs, dict):
            evidence = str(raw_attrs.get("agenticx.evidence.source") or "").strip()
        if evidence:
            attrs["agenticx.evidence.source"] = evidence
        written.append(
            store.upsert(
                UModelObject(
                    kind="tool_call",
                    id=tool_id,
                    tool_call_id=tool_id,
                    session_id=sid,
                    tenant_id=tenant_id,
                    deployment_id=deployment_id,
                    trace_id=str(getattr(span, "trace_id", "") or ""),
                    name=str(getattr(span, "name", "") or ""),
                    status=str(getattr(span, "status", "") or ""),
                    summary="",
                    attrs=attrs,
                )
            )
        )

    if deployment_id:
        written.append(
            store.upsert(
                UModelObject(
                    kind="deployment",
                    id=deployment_id,
                    deployment_id=deployment_id,
                    tenant_id=tenant_id,
                    session_id=sid,
                    summary=change_summary,
                    attrs={"source": "first_party"},
                )
            )
        )
    return written


def register_deployment(
    deployment_id: str,
    *,
    store: FileObjectStore,
    service_id: str = "",
    summary: str = "",
) -> UModelObject:
    did = str(deployment_id or "").strip()
    if not did:
        raise ValueError("deployment_id is required")
    svc = str(service_id or "").strip()
    attrs = {"source": "manual"}
    if svc:
        attrs["service_id"] = svc
        store.upsert(
            UModelObject(
                kind="service",
                id=svc,
                name=svc,
                attrs={"source": "manual"},
            )
        )
    return store.upsert(
        UModelObject(
            kind="deployment",
            id=did,
            deployment_id=did,
            summary=str(summary or ""),
            attrs=attrs,
        )
    )
