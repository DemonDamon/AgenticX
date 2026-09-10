#!/usr/bin/env python3
"""Read-only Studio routes for durable run replay.

Author: Damon Li
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import APIRouter, FastAPI, Header, HTTPException, Query, Response

from agenticx.runtime.replay_ledger import EVENT_TYPES, ReplayLedgerStore, RunEvent
from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
from agenticx.runtime.replay_ledger.export import export_run_json, export_run_markdown
from agenticx.runtime.subagent_runs import SubAgentRunStore


MAX_EXPORT_EVENTS = 10_000
MAX_EXPORT_RESOLVED_BYTES = 32 * 1024 * 1024


def _nested_subagent_runs(
    session_id: str,
    event: RunEvent,
    attached_source_ids: set[str],
) -> list[dict[str, Any]]:
    if event.type != "tool_call":
        return []
    source_id = str(
        event.payload.get("source_tool_call_id") or event.tool_call_id or ""
    ).strip()
    if not source_id or source_id in attached_source_ids:
        return []
    attached_source_ids.add(source_id)
    store = SubAgentRunStore(session_id)
    nested: list[dict[str, Any]] = []
    seen_run_ids: set[str] = set()
    for record in store.list_runs():
        if record.source_tool_call_id != source_id or record.run_id in seen_run_ids:
            continue
        seen_run_ids.add(record.run_id)
        nested.append(
            {
                "run": record.to_dict(),
                "activity": [
                    entry.to_dict() for entry in store.read_activity(record.run_id)
                ],
            }
        )
    return nested


def register_run_replay_routes(
    app: FastAPI,
    manager: Any,
    check_token: Callable[[str | None], None],
    desktop_token: str = "",
) -> None:
    """Register authenticated read-only replay endpoints."""
    router = APIRouter()

    def _store() -> ReplayLedgerStore:
        return ReplayLedgerStore(Path(manager._sessions_root))

    def _validated_id(value: str, field_name: str) -> str:
        try:
            return validate_ledger_id(value, field_name)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    def _require_run(run_id: str):
        record = _store().get_run(_validated_id(run_id, "run_id"))
        if record is None:
            raise HTTPException(status_code=404, detail="run not found")
        return record

    def _check_sensitive_token(token: str | None) -> None:
        if not desktop_token:
            raise HTTPException(
                status_code=403,
                detail="desktop token required for sensitive replay data",
            )
        check_token(token)

    @router.get("/api/runs")
    def list_runs(
        session_id: str = Query(min_length=1),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        session_id = _validated_id(session_id, "session_id")
        records = _store().list_runs(session_id)
        if not records:
            session_dir = Path(manager._sessions_root) / session_id
            if (
                manager.get(session_id, touch=False) is None
                and not session_dir.exists()
            ):
                raise HTTPException(status_code=404, detail="session not found")
            return {
                "ok": True,
                "runs": [],
                "legacy_summary_available": True,
                "reason": "no_replay_ledger",
            }
        return {"ok": True, "runs": [record.to_dict() for record in records]}

    @router.get("/api/runs/{run_id}")
    def get_run(
        run_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        check_token(x_agx_desktop_token)
        record = _require_run(run_id)
        return {"ok": True, "run": record.to_dict()}

    @router.get("/api/runs/{run_id}/events")
    def get_events(
        run_id: str,
        after_seq: int = Query(default=0, ge=0),
        limit: int = Query(default=100, ge=1, le=500),
        types: str = Query(default=""),
        include_payload: bool = Query(default=False),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict[str, Any]:
        _check_sensitive_token(x_agx_desktop_token)
        run_id = _validated_id(run_id, "run_id")
        record = _require_run(run_id)
        requested_types = {
            item.strip() for item in types.split(",") if item.strip() in EVENT_TYPES
        }
        event_types = requested_types if types.strip() else None
        store = _store()
        events, has_more = store.read_events(
            run_id,
            after_seq=after_seq,
            limit=limit,
            event_types=event_types,
        )
        rows: list[dict[str, Any]] = []
        attached_source_ids: set[str] = set()
        for event in events:
            row = event.to_dict()
            if include_payload and event.payload_ref:
                row["resolved_payload"] = store.read_blob(
                    run_id,
                    event.payload_ref,
                    max_uncompressed_bytes=MAX_EXPORT_RESOLVED_BYTES,
                )
            nested = _nested_subagent_runs(
                record.session_id,
                event,
                attached_source_ids,
            )
            if nested:
                row["subagent_runs"] = nested
            rows.append(row)
        refreshed = store.get_run(run_id) or record
        return {
            "ok": True,
            "run": refreshed.to_dict(),
            "events": rows,
            "next_seq": events[-1].seq if events else after_seq,
            "has_more": has_more,
        }

    @router.get("/api/runs/{run_id}/export")
    def export_run(
        run_id: str,
        format: str = Query(default="markdown", pattern="^(markdown|json)$"),
        redact: bool = Query(default=True),
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> Response:
        _check_sensitive_token(x_agx_desktop_token)
        run_id = _validated_id(run_id, "run_id")
        record = _require_run(run_id)
        if record.event_count > MAX_EXPORT_EVENTS:
            raise HTTPException(status_code=413, detail="export_too_large")
        store = _store()
        events, has_more = store.read_events(run_id, limit=MAX_EXPORT_EVENTS + 1)
        if has_more or len(events) > MAX_EXPORT_EVENTS:
            raise HTTPException(status_code=413, detail="export_too_large")
        resolved_bytes = 0
        payload_cache: dict[str, Any | None] = {}
        payload_sizes: dict[str, int] = {}
        for event in events:
            payload_ref = event.payload_ref
            if not payload_ref:
                continue
            if payload_ref not in payload_cache:
                payload_cache[payload_ref] = store.read_blob(
                    run_id,
                    payload_ref,
                    max_uncompressed_bytes=MAX_EXPORT_RESOLVED_BYTES,
                )
            payload = payload_cache[payload_ref]
            if payload is None:
                refreshed = store.get_run(run_id)
                if (
                    refreshed is not None
                    and refreshed.gap_reason == "payload_blob_too_large"
                ):
                    raise HTTPException(status_code=413, detail="export_too_large")
                continue
            if payload_ref not in payload_sizes:
                payload_sizes[payload_ref] = len(
                    json.dumps(
                        payload,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                        default=str,
                    ).encode("utf-8")
                )
            resolved_bytes += payload_sizes[payload_ref]
            if resolved_bytes > MAX_EXPORT_RESOLVED_BYTES:
                raise HTTPException(status_code=413, detail="export_too_large")
        record = store.get_run(run_id) or record

        def resolver(payload_ref: str) -> Any | None:
            return payload_cache.get(payload_ref)

        if format == "json":
            content = export_run_json(
                record,
                events,
                resolve_payload=resolver,
                redact=redact,
            )
            return Response(content=content, media_type="application/json")
        content = export_run_markdown(
            record,
            events,
            resolve_payload=resolver,
            redact=redact,
        )
        return Response(content=content, media_type="text/markdown; charset=utf-8")

    app.include_router(router)
