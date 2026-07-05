#!/usr/bin/env python3
"""Persistence store for sub-agent run records.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from agenticx.runtime.subagent_runs.cluster import build_cluster_id
from agenticx.runtime.subagent_runs.contracts import (
    ActivityEntry,
    ClusterInfo,
    RunRecord,
    SCHEMA_VERSION,
)

_LOG = logging.getLogger(__name__)


class SubAgentRunStore:
    """Disk-backed run store for spawn/delegation timeline and artifacts."""

    _max_activity_entries = 500
    _activity_keep_head = 50
    _activity_keep_tail = 400

    def __init__(self, owner_session_id: Optional[str]) -> None:
        self.owner_session_id = str(owner_session_id or "").strip()
        if self.owner_session_id:
            self._root = (
                Path.home()
                / ".agenticx"
                / "sessions"
                / self.owner_session_id
                / "subagent_runs"
            )
        else:
            self._root = Path.home() / ".agenticx" / "subagent_runs"
        self._index_file = self._root / "index.json"
        self._lock = threading.RLock()

    @property
    def root(self) -> Path:
        """Return store root directory."""
        return self._root

    def open_run(
        self,
        *,
        run_id: str,
        kind: str,
        name: str,
        role: str,
        task: str,
        status: str,
        provider: str = "",
        model: str = "",
        persona: str = "",
        avatar_id: str = "",
        avatar_session_id: str = "",
        source_tool_call_id: str = "",
        cluster_id: str = "",
        title: str = "",
        started_at: Optional[float] = None,
        detail_refs: Optional[Dict[str, Any]] = None,
    ) -> RunRecord:
        """Create or overwrite one run record and attach it into a cluster."""
        rid = str(run_id or "").strip()
        if not rid:
            raise ValueError("run_id is required")
        now = time.time()
        with self._lock:
            self._ensure_root()
            index_data = self._load_index()
            picked_cluster_id, badge_seq = self._pick_cluster_and_badge(
                index_data=index_data,
                run_id=rid,
                cluster_id=cluster_id,
                source_tool_call_id=source_tool_call_id,
                title=title,
                now=now,
            )
            record_path = self._record_file(rid)
            old_record = self._load_record_from_file(record_path)
            history = list(old_record.status_history) if old_record else []
            history.append({"status": status, "ts": now})
            record = RunRecord(
                run_id=rid,
                kind=str(kind or "").strip() or "spawn",
                owner_session_id=self.owner_session_id,
                cluster_id=picked_cluster_id,
                badge_seq=badge_seq,
                name=str(name or "").strip() or rid,
                role=str(role or "").strip() or "worker",
                task=str(task or "").strip(),
                status=str(status or "").strip() or "running",
                created_at=(old_record.created_at if old_record else now),
                updated_at=now,
                persona=str(persona or "").strip() or None,
                provider=str(provider or "").strip() or None,
                model=str(model or "").strip() or None,
                avatar_id=str(avatar_id or "").strip() or None,
                avatar_session_id=str(avatar_session_id or "").strip() or None,
                started_at=started_at or now,
                completed_at=old_record.completed_at if old_record else None,
                status_history=history,
                result_summary=old_record.result_summary if old_record else None,
                error_text=old_record.error_text if old_record else None,
                result_file=old_record.result_file if old_record else None,
                output_files=list(old_record.output_files) if old_record else [],
                artifacts=list(old_record.artifacts) if old_record else [],
                detail_refs=dict(detail_refs or old_record.detail_refs if old_record else detail_refs or {}),
                activity_count=old_record.activity_count if old_record else 0,
                source_tool_call_id=str(source_tool_call_id or "").strip(),
                schema_version=SCHEMA_VERSION,
            )
            self._write_json(record_path, record.to_dict())
            self._update_index_run(index_data=index_data, record=record)
            self._write_json(self._index_file, index_data)
            return record

    def update_status(
        self,
        run_id: str,
        *,
        status: str,
        result_summary: Optional[str] = None,
        error_text: Optional[str] = None,
        completed_at: Optional[float] = None,
    ) -> Optional[RunRecord]:
        """Update status and optional summary/error fields for one run."""
        rid = str(run_id or "").strip()
        if not rid:
            return None
        with self._lock:
            record = self.get_run(run_id=rid)
            if record is None:
                return None
            now = time.time()
            next_status = str(status or "").strip() or record.status
            if not record.status_history or record.status_history[-1].get("status") != next_status:
                record.status_history.append({"status": next_status, "ts": now})
            record.status = next_status
            record.updated_at = now
            if result_summary is not None:
                record.result_summary = str(result_summary or "").strip() or None
            if error_text is not None:
                record.error_text = str(error_text or "").strip() or None
            if completed_at is not None:
                record.completed_at = float(completed_at)
            elif next_status in {"completed", "failed", "cancelled", "paused"} and record.completed_at is None:
                record.completed_at = now
            self._write_json(self._record_file(rid), record.to_dict())
            index_data = self._load_index()
            self._update_index_run(index_data=index_data, record=record)
            self._write_json(self._index_file, index_data)
            return record

    def append_activity(
        self,
        run_id: str,
        *,
        event_type: str,
        title: str,
        detail: str = "",
        ts: Optional[float] = None,
    ) -> Optional[ActivityEntry]:
        """Append one activity entry and keep timeline under bounded size."""
        rid = str(run_id or "").strip()
        if not rid:
            return None
        with self._lock:
            record = self.get_run(run_id=rid)
            if record is None:
                return None
            next_seq = int(record.activity_count or 0) + 1
            entry = ActivityEntry(
                seq=next_seq,
                ts=float(ts or time.time()),
                type=str(event_type or "").strip() or "note",
                title=str(title or "").strip() or "event",
                detail=str(detail or "").strip() or None,
            )
            activity_file = self._activity_file(rid)
            self._ensure_root()
            with activity_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")
            record.activity_count = next_seq
            record.updated_at = time.time()
            self._write_json(self._record_file(rid), record.to_dict())
            self._truncate_activity_if_needed(run_id=rid)
            return entry

    def append_runtime_event(
        self,
        run_id: str,
        *,
        event_type: str,
        data: Dict[str, Any],
        ts: Optional[float] = None,
    ) -> Optional[ActivityEntry]:
        """Append activity from runtime event payload."""
        item_type, title, detail = self._runtime_event_to_activity(event_type=event_type, data=data)
        if not title:
            return None
        return self.append_activity(
            run_id,
            event_type=item_type,
            title=title,
            detail=detail,
            ts=ts,
        )

    def close_run(
        self,
        run_id: str,
        *,
        status: str,
        result_summary: str = "",
        error_text: str = "",
        result_file: str = "",
        output_files: Optional[List[str]] = None,
        artifacts: Optional[List[Dict[str, Any]]] = None,
        detail_refs: Optional[Dict[str, Any]] = None,
        completed_at: Optional[float] = None,
    ) -> Optional[RunRecord]:
        """Finalize one run record after runtime exits."""
        rid = str(run_id or "").strip()
        if not rid:
            return None
        with self._lock:
            record = self.get_run(run_id=rid)
            if record is None:
                return None
            now = time.time()
            next_status = str(status or "").strip() or record.status
            if not record.status_history or record.status_history[-1].get("status") != next_status:
                record.status_history.append({"status": next_status, "ts": now})
            record.status = next_status
            record.updated_at = now
            record.completed_at = float(completed_at or now)
            record.result_summary = str(result_summary or "").strip() or None
            record.error_text = str(error_text or "").strip() or None
            record.result_file = str(result_file or "").strip() or None
            if output_files is not None:
                record.output_files = [
                    str(path).strip() for path in output_files if str(path).strip()
                ]
            if artifacts is not None:
                record.artifacts = [dict(item) for item in artifacts if isinstance(item, dict)]
            if detail_refs is not None:
                merged = dict(record.detail_refs)
                merged.update({k: v for k, v in detail_refs.items() if v is not None})
                record.detail_refs = merged
            self._write_json(self._record_file(rid), record.to_dict())
            index_data = self._load_index()
            self._update_index_run(index_data=index_data, record=record)
            cluster = self._load_cluster(index_data=index_data, cluster_id=record.cluster_id)
            if cluster is not None:
                cluster.updated_at = now
                cluster.sealed = all(
                    str(index_data.get("runs", {}).get(item, {}).get("status", "")) in {
                        "completed",
                        "failed",
                        "cancelled",
                        "paused",
                    }
                    for item in cluster.run_ids
                )
                self._write_cluster(index_data=index_data, cluster=cluster)
            self._write_json(self._index_file, index_data)
            return record

    def list_runs(self) -> List[RunRecord]:
        """List all runs for current owner session sorted by creation time."""
        with self._lock:
            index_data = self._load_index()
            run_ids = list(index_data.get("runs", {}).keys())
        records: List[RunRecord] = []
        for run_id in run_ids:
            record = self.get_run(run_id=run_id)
            if record is not None:
                records.append(record)
        records.sort(key=lambda item: (item.created_at, item.run_id))
        return records

    def get_run(self, run_id: str) -> Optional[RunRecord]:
        """Get one run record by id."""
        rid = str(run_id or "").strip()
        if not rid:
            return None
        record = self._load_record_from_file(self._record_file(rid))
        if record is None:
            return None
        if self.owner_session_id and record.owner_session_id and record.owner_session_id != self.owner_session_id:
            return None
        return record

    def list_clusters(self) -> List[ClusterInfo]:
        """List all clusters for current owner session sorted by creation time."""
        with self._lock:
            index_data = self._load_index()
            clusters_raw = index_data.get("clusters", {})
            clusters: List[ClusterInfo] = []
            if isinstance(clusters_raw, dict):
                for payload in clusters_raw.values():
                    if not isinstance(payload, dict):
                        continue
                    cluster = ClusterInfo.from_dict(payload)
                    if self.owner_session_id and cluster.owner_session_id != self.owner_session_id:
                        continue
                    clusters.append(cluster)
        clusters.sort(key=lambda item: (item.created_at, item.cluster_id))
        return clusters

    def read_activity(self, run_id: str) -> List[ActivityEntry]:
        """Read full activity timeline for one run."""
        rid = str(run_id or "").strip()
        if not rid:
            return []
        entries: List[ActivityEntry] = []
        path = self._activity_file(rid)
        if not path.exists():
            return entries
        try:
            text = path.read_text("utf-8", errors="replace")
        except Exception:
            return entries
        for line in text.splitlines():
            s = line.strip()
            if not s:
                continue
            try:
                payload = json.loads(s)
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            entries.append(ActivityEntry.from_dict(payload))
        return entries

    def _pick_cluster_and_badge(
        self,
        *,
        index_data: Dict[str, Any],
        run_id: str,
        cluster_id: str,
        source_tool_call_id: str,
        title: str,
        now: float,
    ) -> Tuple[str, str]:
        clusters_raw = index_data.setdefault("clusters", {})
        if not isinstance(clusters_raw, dict):
            clusters_raw = {}
            index_data["clusters"] = clusters_raw
        cluster = None
        picked_cluster_id = str(cluster_id or "").strip()
        source_id = str(source_tool_call_id or "").strip()
        if picked_cluster_id:
            cluster = self._load_cluster(index_data=index_data, cluster_id=picked_cluster_id)
        if cluster is None and source_id:
            for payload in clusters_raw.values():
                if not isinstance(payload, dict):
                    continue
                if str(payload.get("source_tool_call_id", "")).strip() != source_id:
                    continue
                candidate = ClusterInfo.from_dict(payload)
                if candidate.owner_session_id != self.owner_session_id:
                    continue
                if candidate.sealed:
                    continue
                if now - candidate.updated_at <= 2.0:
                    cluster = candidate
                    break
        if cluster is None and not picked_cluster_id:
            for payload in clusters_raw.values():
                if not isinstance(payload, dict):
                    continue
                candidate = ClusterInfo.from_dict(payload)
                if candidate.owner_session_id != self.owner_session_id:
                    continue
                if candidate.sealed:
                    continue
                if now - candidate.updated_at <= 2.0:
                    cluster = candidate
                    break
        if cluster is None:
            picked_cluster_id = picked_cluster_id or build_cluster_id(
                self.owner_session_id,
                source_tool_call_id=source_id,
                now=now,
            )
            cluster = ClusterInfo(
                cluster_id=picked_cluster_id,
                owner_session_id=self.owner_session_id,
                run_ids=[],
                title=str(title or "").strip(),
                created_at=now,
                updated_at=now,
                sealed=False,
                source_tool_call_id=source_id,
                schema_version=SCHEMA_VERSION,
            )
        else:
            picked_cluster_id = cluster.cluster_id
            if title and not cluster.title:
                cluster.title = str(title).strip()
        if run_id not in cluster.run_ids:
            cluster.run_ids.append(run_id)
        cluster.updated_at = now
        if source_id and not cluster.source_tool_call_id:
            cluster.source_tool_call_id = source_id
        self._write_cluster(index_data=index_data, cluster=cluster)
        badge_seq = f"{len(cluster.run_ids):02d}"
        return picked_cluster_id, badge_seq

    @staticmethod
    def _runtime_event_to_activity(event_type: str, data: Dict[str, Any]) -> Tuple[str, str, str]:
        t = str(event_type or "").strip()
        if t == "tool_call":
            name = str(data.get("name", "") or "tool").strip()
            args = data.get("arguments") or data.get("args") or {}
            args_hint = ""
            if isinstance(args, dict):
                path = str(args.get("path", "")).strip()
                if path:
                    args_hint = f"path={path}"
            title = f"调用工具：{name}"
            return "tool_call", title, args_hint
        if t == "tool_result":
            name = str(data.get("name", "") or "tool").strip()
            preview = str(data.get("content", "") or data.get("text", "") or "").strip()
            return "tool_result", f"工具完成：{name}", preview[:500]
        if t == "subagent_checkpoint":
            text = str(data.get("text", "") or "").strip()
            return "checkpoint", "阶段检查点", text
        if t in {"confirm_required", "confirm_response"}:
            text = str(data.get("text", "") or "").strip()
            item_type = "confirm"
            title = "等待确认" if t == "confirm_required" else "确认已响应"
            return item_type, title, text
        if t in {"clarification_required", "clarification_response"}:
            text = str(data.get("text", "") or "").strip()
            item_type = "clarify"
            title = "等待澄清" if t == "clarification_required" else "澄清已响应"
            return item_type, title, text
        if t == "subagent_progress":
            text = str(data.get("text", "") or "").strip()
            return "note", "进度更新", text
        if t == "error":
            text = str(data.get("text", "") or "").strip()
            return "note", "运行错误", text
        return "note", "", ""

    def _truncate_activity_if_needed(self, *, run_id: str) -> None:
        entries = self.read_activity(run_id)
        if len(entries) <= self._max_activity_entries:
            return
        omitted = len(entries) - (self._activity_keep_head + self._activity_keep_tail)
        if omitted <= 0:
            return
        placeholder = ActivityEntry(
            seq=entries[self._activity_keep_head - 1].seq + 1,
            ts=time.time(),
            type="note",
            title=f"已省略 {omitted} 条活动日志",
            detail="Timeline truncated to keep storage bounded.",
        )
        kept = entries[: self._activity_keep_head] + [placeholder] + entries[-self._activity_keep_tail :]
        for idx, item in enumerate(kept, start=1):
            item.seq = idx
        lines = [json.dumps(item.to_dict(), ensure_ascii=False) for item in kept]
        self._activity_file(run_id).write_text("\n".join(lines) + "\n", encoding="utf-8")
        record = self.get_run(run_id)
        if record is None:
            return
        record.activity_count = len(kept)
        record.updated_at = time.time()
        self._write_json(self._record_file(run_id), record.to_dict())

    def _load_cluster(self, *, index_data: Dict[str, Any], cluster_id: str) -> Optional[ClusterInfo]:
        payload = index_data.get("clusters", {}).get(cluster_id)
        if not isinstance(payload, dict):
            return None
        cluster = ClusterInfo.from_dict(payload)
        if self.owner_session_id and cluster.owner_session_id != self.owner_session_id:
            return None
        return cluster

    def _write_cluster(self, *, index_data: Dict[str, Any], cluster: ClusterInfo) -> None:
        clusters_raw = index_data.setdefault("clusters", {})
        if not isinstance(clusters_raw, dict):
            clusters_raw = {}
            index_data["clusters"] = clusters_raw
        clusters_raw[cluster.cluster_id] = cluster.to_dict()

    def _update_index_run(self, *, index_data: Dict[str, Any], record: RunRecord) -> None:
        runs = index_data.setdefault("runs", {})
        if not isinstance(runs, dict):
            runs = {}
            index_data["runs"] = runs
        runs[record.run_id] = {
            "run_id": record.run_id,
            "cluster_id": record.cluster_id,
            "name": record.name,
            "role": record.role,
            "badge_seq": record.badge_seq,
            "status": record.status,
            "kind": record.kind,
            "provider": record.provider,
            "model": record.model,
            "avatar_id": record.avatar_id,
            "avatar_session_id": record.avatar_session_id,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "source_tool_call_id": record.source_tool_call_id,
            "schema_version": SCHEMA_VERSION,
        }

    def _record_file(self, run_id: str) -> Path:
        safe = self._safe_name(run_id)
        return self._root / f"{safe}.json"

    def _activity_file(self, run_id: str) -> Path:
        safe = self._safe_name(run_id)
        return self._root / f"{safe}.activity.jsonl"

    @staticmethod
    def _safe_name(value: str) -> str:
        return "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in value)

    def _ensure_root(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    def _load_index(self) -> Dict[str, Any]:
        if not self._index_file.exists():
            return {
                "schema_version": SCHEMA_VERSION,
                "owner_session_id": self.owner_session_id,
                "clusters": {},
                "runs": {},
            }
        try:
            data = json.loads(self._index_file.read_text("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("index is not a dict")
            data.setdefault("schema_version", SCHEMA_VERSION)
            data.setdefault("owner_session_id", self.owner_session_id)
            data.setdefault("clusters", {})
            data.setdefault("runs", {})
            return data
        except Exception as exc:
            _LOG.warning("[subagent_runs] failed to load index %s: %s", self._index_file, exc)
            return {
                "schema_version": SCHEMA_VERSION,
                "owner_session_id": self.owner_session_id,
                "clusters": {},
                "runs": {},
            }

    def _load_record_from_file(self, path: Path) -> Optional[RunRecord]:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text("utf-8"))
            if not isinstance(payload, dict):
                return None
            return RunRecord.from_dict(payload)
        except Exception as exc:
            _LOG.warning("[subagent_runs] failed to load record %s: %s", path, exc)
            return None

    @staticmethod
    def _write_json(path: Path, payload: Dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

