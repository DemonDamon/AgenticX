#!/usr/bin/env python3
"""Helpers for sub-agent run review / artifact REST APIs.

Author: Damon Li
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from agenticx.runtime.subagent_runs import ActivityEntry, RunRecord, SubAgentRunStore
from agenticx.runtime.team_manager import AgentTeamManager

_LOG = logging.getLogger(__name__)

_TEXT_PREVIEW_MAX_BYTES = 32 * 1024
_BINARY_PREVIEW_KINDS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".pdf",
    ".zip",
    ".gz",
    ".mp4",
    ".mp3",
    ".wav",
    ".ico",
    ".icns",
}


def collect_memory_status_map(session_id: str) -> Dict[str, Dict[str, Any]]:
    """Build agent_id -> live status map for one owner session."""
    merged: Dict[str, Dict[str, Any]] = {}
    sid = str(session_id or "").strip()
    if not sid:
        return merged
    for row in AgentTeamManager.collect_global_statuses(session_id=sid):
        if not isinstance(row, dict):
            continue
        aid = str(row.get("agent_id", "") or row.get("run_id", "")).strip()
        if not aid:
            continue
        merged[aid] = row
    return merged


def run_record_to_member_summary(
    record: RunRecord,
    memory: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Serialize one run into cluster member summary aligned with _serialize_status."""
    summary: Dict[str, Any] = {
        "run_id": record.run_id,
        "agent_id": record.run_id,
        "name": record.name,
        "role": record.role,
        "badge_seq": record.badge_seq,
        "status": record.status,
        "provider": record.provider or "",
        "model": record.model or "",
        "avatar_id": record.avatar_id,
        "kind": record.kind,
        "cluster_id": record.cluster_id,
        "updated_at": record.updated_at,
    }
    if memory:
        _apply_memory_overrides(summary, record, memory, summary_only=True)
    return summary


def merge_run_record_with_memory(
    record: RunRecord,
    memory: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Merge persisted run record with in-memory live status when fresher."""
    payload = record.to_dict()
    if memory:
        _apply_memory_overrides(payload, record, memory, summary_only=False)
    return payload


def list_subagent_clusters_payload(
    *,
    session_id: str,
    store: SubAgentRunStore,
    memory_map: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Build cluster list payload with member summaries."""
    memory_map = memory_map or {}
    runs_by_id = {item.run_id: item for item in store.list_runs()}
    clusters: List[Dict[str, Any]] = []
    for cluster in store.list_clusters():
        members: List[Dict[str, Any]] = []
        for run_id in cluster.run_ids:
            record = runs_by_id.get(run_id) or store.get_run(run_id)
            if record is None:
                continue
            members.append(
                run_record_to_member_summary(record, memory_map.get(run_id))
            )
        clusters.append(
            {
                "cluster_id": cluster.cluster_id,
                "title": cluster.title,
                "created_at": cluster.created_at,
                "members": members,
            }
        )
    return clusters


def paginate_activity_entries(
    entries: Sequence[ActivityEntry],
    *,
    offset: int = 0,
    limit: int = 100,
    order: str = "asc",
) -> Tuple[List[Dict[str, Any]], int, int, int]:
    """Return paginated activity entries plus total/offset/limit metadata."""
    rows = list(entries)
    if str(order or "asc").strip().lower() == "desc":
        rows = list(reversed(rows))
    total = len(rows)
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(int(limit or 100), 500))
    page = rows[safe_offset : safe_offset + safe_limit]
    return (
        [item.to_dict() for item in page],
        total,
        safe_offset,
        safe_limit,
    )



def _collect_whitelist_paths(record: RunRecord) -> List[str]:
    paths: List[str] = []
    if record.result_file:
        paths.append(str(record.result_file))
    paths.extend(str(item) for item in record.output_files if str(item).strip())
    for artifact in record.artifacts:
        if isinstance(artifact, dict):
            raw = str(artifact.get("path", "") or "").strip()
            if raw:
                paths.append(raw)
    detail_refs = record.detail_refs if isinstance(record.detail_refs, dict) else {}
    for key in ("result_md_path", "messages_json", "avatar_messages_json"):
        raw = str(detail_refs.get(key, "") or "").strip()
        if raw:
            paths.append(raw)
    deduped: List[str] = []
    seen: set[str] = set()
    for raw in paths:
        if raw in seen:
            continue
        seen.add(raw)
        deduped.append(raw)
    return deduped


def resolve_artifact_path(
    *,
    requested_path: str,
    record: RunRecord,
    owner_session_id: str,
) -> Tuple[bool, Optional[Path], str]:
    """Validate artifact path against whitelist and session-root constraints."""
    raw = str(requested_path or "").strip()
    if not raw:
        return False, None, "path is required"
    try:
        resolved = Path(raw).expanduser().resolve(strict=False)
    except Exception as exc:  # noqa: BLE001
        return False, None, f"invalid path: {exc}"

    whitelist_raw = _collect_whitelist_paths(record)
    whitelist_resolved: List[Path] = []
    for item in whitelist_raw:
        try:
            whitelist_resolved.append(Path(item).expanduser().resolve(strict=False))
        except Exception:
            continue

    if resolved in whitelist_resolved:
        return True, resolved, ""

    return False, None, "path not allowed"


def preview_artifact_file(path: Path) -> Dict[str, Any]:
    """Return text/binary preview metadata for one artifact file."""
    if not path.exists():
        return {"ok": False, "error": "file not found", "detail": str(path)}
    if not path.is_file():
        return {"ok": False, "error": "not a file", "detail": str(path)}

    suffix = path.suffix.lower()
    size = path.stat().st_size
    if suffix in _BINARY_PREVIEW_KINDS or not _looks_text_file(path):
        return {
            "ok": True,
            "kind": "binary",
            "bytes": size,
            "truncated": False,
            "open_hint": "请使用系统应用打开该文件",
            "path": str(path),
        }

    try:
        data = path.read_bytes()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": "read failed", "detail": str(exc)}

    truncated = len(data) > _TEXT_PREVIEW_MAX_BYTES
    snippet = data[:_TEXT_PREVIEW_MAX_BYTES]
    try:
        text = snippet.decode("utf-8")
    except UnicodeDecodeError:
        text = snippet.decode("utf-8", errors="replace")

    return {
        "ok": True,
        "kind": "text",
        "text": text,
        "bytes": size,
        "truncated": truncated,
        "open_hint": "请使用系统应用打开完整文件" if truncated else None,
        "path": str(path),
    }


def _looks_text_file(path: Path) -> bool:
    mime, _ = mimetypes.guess_type(str(path))
    if mime and (mime.startswith("text/") or mime in {"application/json", "application/xml"}):
        return True
    return path.suffix.lower() in {
        ".md",
        ".txt",
        ".json",
        ".jsonl",
        ".yaml",
        ".yml",
        ".py",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".html",
        ".css",
        ".csv",
        ".log",
        ".toml",
        ".ini",
        ".sh",
        ".sql",
    }


def _apply_memory_overrides(
    target: Dict[str, Any],
    record: RunRecord,
    memory: Dict[str, Any],
    *,
    summary_only: bool,
) -> None:
    mem_updated = float(memory.get("updated_at", 0) or 0)
    record_updated = float(record.updated_at or 0)
    mem_status = str(memory.get("status", "") or "")
    active = {"running", "pending"}
    should_override = mem_status in active or mem_updated >= record_updated
    if not should_override:
        return

    for key in (
        "status",
        "result_summary",
        "error_text",
        "updated_at",
        "provider",
        "model",
        "avatar_id",
        "badge_seq",
        "cluster_id",
        "name",
        "role",
    ):
        if key in memory and memory.get(key) is not None:
            target[key] = memory[key]

    if summary_only:
        return

    for key in ("output_files", "result_file"):
        if memory.get(key):
            target[key] = memory[key]
    recent = memory.get("recent_events")
    if isinstance(recent, list) and recent:
        target["recent_events"] = recent[-20:]
