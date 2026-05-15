#!/usr/bin/env python3
"""Session manager for Studio service mode.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

_log = logging.getLogger(__name__)

# Titles that should be replaced by the first real user message (case-insensitive ASCII).
_PLACEHOLDER_SESSION_TITLE_CF: frozenset[str] = frozenset(
    x.casefold()
    for x in (
        "微信会话",
        "微信对话",
        "微信聊天",
        "飞书会话",
        "飞书对话",
        "新对话",
        "新会话",
        "new chat",
        "new conversation",
    )
)

# One-shot flag in StudioSession.scratchpad: after first Meta assistant FINAL we may call LLM titling.
LLM_TITLE_SCRATCH_KEY = "__agx_llm_title_done__"

from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore, session_fts_enabled
from agenticx.runtime import AsyncConfirmGate
from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext
from agenticx.utils.atomic_writer import atomic_write_json

EventEmitter = Callable[[Any], Awaitable[None]]
SummarySink = Callable[[str, SubAgentContext], Awaitable[None]]


def normalize_session_avatar_binding(avatar_id: Optional[str]) -> Optional[str]:
    """Collapse empty string to None so meta vs avatar-bound sessions compare consistently."""
    s = (avatar_id or "").strip()
    return s or None


def managed_session_binding_matches_avatar_query(
    managed: "ManagedSession",
    *,
    query_avatar_id: Optional[str],
) -> bool:
    """Enforce session isolation: Meta panes omit avatar_id (expect unbound); avatar panes must match."""
    stored = normalize_session_avatar_binding(managed.avatar_id)
    q = normalize_session_avatar_binding(query_avatar_id)
    if q is None:
        return stored is None
    return stored == q


@dataclass
class ManagedSession:
    session_id: str
    studio_session: StudioSession
    confirm_gate: AsyncConfirmGate = field(default_factory=AsyncConfirmGate)
    sub_confirm_gates: Dict[str, AsyncConfirmGate] = field(default_factory=dict)
    team_manager: Optional[AgentTeamManager] = None
    updated_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    avatar_id: Optional[str] = None
    avatar_name: Optional[str] = None
    session_name: Optional[str] = None
    pinned: bool = False
    archived: bool = False
    taskspaces: list[dict[str, str]] = field(default_factory=list)
    execution_state: str = "idle"  # idle | running | interrupted

    def get_confirm_gate(self, agent_id: str = "meta") -> AsyncConfirmGate:
        if not agent_id or agent_id == "meta":
            return self.confirm_gate
        return self.sub_confirm_gates.setdefault(agent_id, AsyncConfirmGate())

    def get_or_create_team(
        self,
        *,
        llm_factory: Callable[[], Any],
        event_emitter: Optional[EventEmitter] = None,
        summary_sink: Optional[SummarySink] = None,
    ) -> AgentTeamManager:
        if self.team_manager is None:
            self.team_manager = AgentTeamManager(
                llm_factory=llm_factory,
                base_session=self.studio_session,
                owner_session_id=self.session_id,
                event_emitter=event_emitter,
                summary_sink=summary_sink,
            )
        else:
            self.team_manager.llm_factory = llm_factory
            self.team_manager.base_session = self.studio_session
            self.team_manager.owner_session_id = self.session_id
            self.team_manager.event_emitter = event_emitter
            self.team_manager.summary_sink = summary_sink
        return self.team_manager


class SessionManager:
    _META_TASKSPACE_SCOPE = "meta"

    def __init__(self, *, ttl_seconds: int = 3600) -> None:
        self.ttl_seconds = ttl_seconds
        self._sessions: Dict[str, ManagedSession] = {}
        self._interrupt_requests: set[str] = set()
        self._session_store = SessionStore()
        self._sessions_root = os.path.join(os.path.expanduser("~"), ".agenticx", "sessions")
        self._taskspaces_root = os.path.join(os.path.expanduser("~"), ".agenticx", "taskspaces")
        self.max_taskspaces = 5
        self._schedule_fts_backfill()

    def _schedule_fts_backfill(self) -> None:
        """Fire-and-forget: index historical messages.json files on first startup."""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            return
        if loop.is_running():
            loop.create_task(self._run_fts_backfill())

    async def _run_fts_backfill(self) -> None:
        try:
            result = await self._session_store.backfill_from_sessions_root(
                self._sessions_root, overwrite=False
            )
            if result.get("indexed", 0) > 0:
                _log.info("[session_fts] backfill: %s", result)
        except Exception as exc:
            _log.debug("[session_fts] backfill error (non-fatal): %s", exc)

    def create(
        self,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        *,
        session_id: Optional[str] = None,
    ) -> ManagedSession:
        sid = (session_id or "").strip() or str(uuid.uuid4())
        studio_session = StudioSession(provider_name=provider, model_name=model)
        self._restore_persisted_state(sid, studio_session)
        managed = ManagedSession(
            session_id=sid,
            studio_session=studio_session,
        )
        self._restore_managed_metadata(sid, managed)
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        self._sessions[sid] = managed
        return managed

    def get(self, session_id: str, *, touch: bool = False) -> Optional[ManagedSession]:
        managed = self._sessions.get(session_id)
        if managed is None and self._session_exists_in_persistence(session_id):
            managed = self.create(session_id=session_id)
        if managed is None:
            return None
        if touch:
            managed.updated_at = time.time()
        return managed

    def touch(self, session_id: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.updated_at = time.time()
        return True

    def persist(self, session_id: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        self._persist_session_state(session_id, managed.studio_session)
        return True

    def set_execution_state(self, session_id: str, state: str) -> None:
        """Update execution_state for a session (idle | running | interrupted)."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            managed.execution_state = state
            managed.updated_at = time.time()

    def _normalize_execution_state_for_listing(self, session_id: str, state: Any) -> str:
        """Normalize execution_state for session list display.

        Persisted stale `interrupted` states (left by old flows or historical data)
        should not be shown forever. Only keep `interrupted` visible when there is
        an active interrupt request in this process.
        """
        raw = str(state or "idle").strip().lower()
        if raw not in {"idle", "running", "interrupted"}:
            raw = "idle"
        if raw == "interrupted" and not self.should_interrupt(session_id):
            return "idle"
        return raw

    def request_interrupt(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        self._interrupt_requests.add(sid)
        return True

    def clear_interrupt(self, session_id: str) -> None:
        sid = str(session_id or "").strip()
        if sid:
            self._interrupt_requests.discard(sid)

    def should_interrupt(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        return bool(sid and sid in self._interrupt_requests)

    def scan_interrupted_sessions(self) -> list[str]:
        """Scan persisted sessions for those left in 'running' state.

        Called at startup to detect sessions that were interrupted by a crash.
        Marks them as 'interrupted' and returns their session IDs.
        """
        interrupted: list[str] = []
        try:
            rows = self._session_store._list_latest_sessions_sync(limit=0)
        except Exception:
            return interrupted
        for row in rows:
            sid = str(row.get("session_id", "")).strip()
            if not sid:
                continue
            meta = row.get("metadata")
            if not isinstance(meta, dict):
                continue
            state = str(meta.get("execution_state", "idle")).strip()
            if state == "running":
                interrupted.append(sid)
                try:
                    self._session_store._save_session_summary_sync(
                        sid,
                        str(row.get("summary", "")),
                        {**meta, "execution_state": "interrupted"},
                    )
                except Exception:
                    pass
        if interrupted:
            _log.info("Found %d interrupted sessions on startup: %s", len(interrupted), interrupted[:5])
        return interrupted

    def incremental_persist(self, session_id: str) -> bool:
        """Lightweight mid-turn persist: only flush messages + agent_messages.

        Skips SQLite summary / FTS / context-refs to minimize I/O overhead
        during active tool loops.  Called by AgentRuntime between tool calls
        to guard against crash data loss.
        """
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        session = managed.studio_session
        try:
            self._save_messages_snapshot(session_id, session.chat_history or [])
            self._save_agent_messages_snapshot(
                session_id, getattr(session, "agent_messages", None) or [],
            )
        except Exception:
            _log.debug("incremental_persist failed for %s (non-fatal)", session_id)
            return False
        return True

    @staticmethod
    def _close_mcp_hub_sync(managed: ManagedSession) -> None:
        """No-op: MCP children are now process-level resources owned by GlobalMcpManager.
        They are closed once at server shutdown via GlobalMcpManager.close_all()."""

    def delete(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        self._interrupt_requests.discard(sid)
        existed_in_persistence = self._session_exists_in_persistence(sid)
        managed = self._sessions.pop(sid, None)
        if managed is not None:
            if managed.team_manager is not None:
                managed.team_manager.shutdown_now()
            # MCP hub is global; do NOT kill child processes on session delete.
        purged = self._purge_session_state(sid)
        if managed is not None and not existed_in_persistence:
            return True
        return purged and existed_in_persistence

    def list_sessions(self, avatar_id: str | None = None) -> list[dict]:
        """List sessions, optionally filtered by avatar_id."""
        result = []
        seen_session_ids: set[str] = set()
        for sid, managed in self._sessions.items():
            if getattr(managed, "archived", False):
                continue
            if avatar_id and getattr(managed, "avatar_id", None) != avatar_id:
                continue
            hist = getattr(managed.studio_session, "chat_history", None) or []
            # 之前跳过 len(hist)==0 会把「刚创建、尚未写入首条消息」的会话从列表里藏起来，
            # 桌面历史侧栏无法立刻显示当前会话；保留空会话条目以便 UI 及时对齐。
            seen_session_ids.add(sid)
            result.append({
                "session_id": sid,
                "avatar_id": getattr(managed, "avatar_id", None),
                "avatar_name": getattr(managed, "avatar_name", None),
                "session_name": getattr(managed, "session_name", None),
                "updated_at": managed.updated_at,
                "created_at": getattr(managed, "created_at", managed.updated_at),
                "pinned": bool(getattr(managed, "pinned", False)),
                "archived": bool(getattr(managed, "archived", False)),
                "execution_state": self._normalize_execution_state_for_listing(
                    sid, getattr(managed, "execution_state", "idle")
                ),
                "provider": str(getattr(managed.studio_session, "provider_name", "") or ""),
                "model": str(getattr(managed.studio_session, "model_name", "") or ""),
            })
        for row in self._list_persisted_sessions():
            sid = str(row.get("session_id", "")).strip()
            if not sid or sid in seen_session_ids:
                continue
            if row.get("archived"):
                continue
            if avatar_id and row.get("avatar_id") != avatar_id:
                continue
            row["execution_state"] = self._normalize_execution_state_for_listing(
                sid, row.get("execution_state", "idle")
            )
            result.append(row)
            seen_session_ids.add(sid)
        result.sort(
            key=lambda row: (
                1 if row.get("pinned") else 0,
                float(row.get("updated_at", 0)),
            ),
            reverse=True,
        )
        return result

    @staticmethod
    def _snippet_around_query(content: str, query: str, max_len: int = 140) -> str:
        c = str(content or "")
        q = (query or "").strip()
        if not c:
            return ""
        if not q:
            return (c[:max_len] + "…") if len(c) > max_len else c
        try:
            lower_c = c.casefold()
            lower_q = q.casefold()
        except Exception:
            lower_c = c.lower()
            lower_q = q.lower()
        idx = lower_c.find(lower_q)
        if idx < 0:
            return (c[:max_len] + "…") if len(c) > max_len else c
        start = max(0, idx - 36)
        end = min(len(c), idx + max_len)
        frag = c[start:end]
        if start > 0:
            frag = "…" + frag
        if end < len(c):
            frag = frag + "…"
        return frag

    def search_sessions_by_message_text(
        self,
        query: str,
        *,
        avatar_id: Optional[str] = None,
        limit_sessions: int = 50,
    ) -> list[dict[str, Any]]:
        """Return session_id + snippet for sessions whose messages match query (FTS, then LIKE)."""
        q = str(query or "").strip()
        if not q:
            return []
        rows = self.list_sessions(avatar_id=avatar_id)
        allowed = frozenset(
            str(r["session_id"]).strip()
            for r in rows
            if r.get("session_id") and str(r["session_id"]).strip()
        )
        if not allowed:
            return []
        lim = max(1, min(int(limit_sessions), 100))
        store = self._session_store
        by_sid: dict[str, str] = {}

        if session_fts_enabled():
            try:
                fts_hits = store._search_session_messages_sync(q, None, limit=400)
            except Exception:
                fts_hits = []
            for hit in fts_hits:
                sid = str(hit.get("session_id") or "").strip()
                if sid not in allowed or sid in by_sid:
                    continue
                snip = str(hit.get("snippet") or "").strip()
                if not snip:
                    prev = str(hit.get("content_preview") or "")
                    snip = (prev[:120] + "…") if len(prev) > 120 else prev
                by_sid[sid] = snip or "…"
                if len(by_sid) >= lim:
                    return [{"session_id": k, "snippet": v} for k, v in by_sid.items()]

        if len(by_sid) < lim:
            try:
                like_hits = store._search_session_messages_like_sync(q, allowed, limit=400)
            except Exception:
                like_hits = []
            for hit in like_hits:
                sid = str(hit.get("session_id") or "").strip()
                if sid not in allowed or sid in by_sid:
                    continue
                body = str(hit.get("content") or "")
                by_sid[sid] = self._snippet_around_query(body, q)
                if len(by_sid) >= lim:
                    break

        return [{"session_id": k, "snippet": v} for k, v in by_sid.items()]

    def rename_session(self, session_id: str, name: str) -> bool:
        """Rename an existing session. Returns True if found and renamed."""
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.session_name = name
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    def set_session_model(
        self,
        session_id: str,
        *,
        provider: Optional[str],
        model: Optional[str],
    ) -> bool:
        """Update the session's active LLM provider/model and persist to disk.

        Triggered by the desktop model-picker so a session's last-used model
        survives app restarts (the UI re-applies it via list_sessions()).
        Returns True if the session exists (either in memory or persistence).
        """
        sid = str(session_id or "").strip()
        if not sid:
            return False
        managed = self.get(sid)
        if managed is None:
            return False
        prov_clean = str(provider or "").strip()
        model_clean = str(model or "").strip()
        managed.studio_session.provider_name = prov_clean
        managed.studio_session.model_name = model_clean
        managed.updated_at = time.time()
        self._persist_session_state(sid, managed.studio_session)
        return True

    @staticmethod
    def session_title_needs_auto_fill(name: Optional[str]) -> bool:
        """True if missing or a generic IM/new-chat placeholder."""
        raw = str(name or "").strip()
        if not raw:
            return True
        key = raw.casefold()
        if key in _PLACEHOLDER_SESSION_TITLE_CF:
            return True
        if key.startswith("新会话") or key.startswith("新对话"):
            return True
        if key.startswith("new session") or key.startswith("new chat"):
            return True
        return False

    def auto_title_session(self, session_id: str, first_user_message: str) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        if not self.session_title_needs_auto_fill(managed.session_name):
            return False
        title = self._build_auto_title(first_user_message)
        if not title:
            return False
        managed.session_name = title
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    @staticmethod
    def _text_from_chat_history_item(item: Any) -> str:
        if not isinstance(item, dict):
            return ""
        raw = item.get("content")
        if isinstance(raw, str):
            return raw.strip()
        if isinstance(raw, list):
            parts: list[str] = []
            for block in raw:
                if isinstance(block, dict) and str(block.get("type") or "") == "text":
                    parts.append(str(block.get("text") or ""))
            return "".join(parts).strip()
        return ""

    def session_has_user_and_assistant_for_llm_title(self, session: StudioSession) -> bool:
        hist = getattr(session, "chat_history", None) or []
        has_user = False
        has_asst = False
        for item in hist:
            role = str(item.get("role") or "")
            text = self._text_from_chat_history_item(item)
            if not text:
                continue
            if role == "user":
                has_user = True
            elif role == "assistant":
                has_asst = True
        return has_user and has_asst

    def claim_llm_title_slot(self, session_id: str, snapshot_session_name: str) -> bool:
        """Reserve one-shot LLM title upgrade; returns True if background job should run."""
        sid = str(session_id or "").strip()
        if not sid:
            return False
        managed = self._sessions.get(sid)
        if managed is None:
            return False
        session = managed.studio_session
        sp = session.scratchpad
        if not isinstance(sp, dict):
            session.scratchpad = {}
            sp = session.scratchpad
        if sp.get(LLM_TITLE_SCRATCH_KEY):
            return False
        if not self.session_has_user_and_assistant_for_llm_title(session):
            return False
        cur = str(managed.session_name or "").strip()
        snap = str(snapshot_session_name or "").strip()
        if snap and cur != snap:
            return False
        sp[LLM_TITLE_SCRATCH_KEY] = True
        self._persist_session_state(sid, session)
        return True

    @staticmethod
    def _sanitize_llm_session_title(raw: Any) -> str | None:
        s = str(raw or "").strip()
        if not s:
            return None
        s = s.splitlines()[0].strip()
        for ch in ('"', "'", "「", "」", "『", "』", "《", "》"):
            s = s.replace(ch, "")
        s = s.strip(" \t.:：。；;，,")
        if len(s) > 40:
            s = s[:40].rstrip()
        return s or None

    def apply_llm_suggested_session_title(self, session_id: str, raw_title: str | None) -> None:
        sid = str(session_id or "").strip()
        if not sid:
            return
        cleaned = self._sanitize_llm_session_title(raw_title)
        if cleaned:
            self.rename_session(sid, cleaned)
        else:
            self.persist(sid)

    def pin_session(self, session_id: str, pinned: bool) -> bool:
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.pinned = bool(pinned)
        managed.updated_at = time.time()
        self._persist_session_state(session_id, managed.studio_session)
        return True

    def fork_session(self, session_id: str) -> Optional[ManagedSession]:
        source = self._sessions.get(session_id)
        if source is None:
            return None
        forked = self.create(
            provider=source.studio_session.provider_name,
            model=source.studio_session.model_name,
        )
        forked.avatar_id = source.avatar_id
        forked.avatar_name = source.avatar_name
        forked.session_name = self._build_fork_name(source.session_name)
        forked.studio_session.workspace_dir = source.studio_session.workspace_dir
        forked.studio_session.chat_history = deepcopy(source.studio_session.chat_history or [])
        forked.studio_session.agent_messages = deepcopy(getattr(source.studio_session, "agent_messages", []) or [])
        forked.studio_session.context_files = deepcopy(source.studio_session.context_files or {})
        forked.studio_session.scratchpad = deepcopy(source.studio_session.scratchpad or {})
        forked.studio_session.artifacts = deepcopy(source.studio_session.artifacts or {})
        forked.updated_at = time.time()
        self._persist_session_state(forked.session_id, forked.studio_session)
        return forked

    def archive_sessions_before(self, session_id: str, avatar_id: str | None = None) -> int:
        target = self._sessions.get(session_id)
        if target is None:
            return -1
        target_avatar = avatar_id if avatar_id is not None else target.avatar_id
        target_updated_at = float(target.updated_at)
        archived_count = 0
        for sid, managed in self._sessions.items():
            if sid == session_id:
                continue
            if managed.archived:
                continue
            if managed.avatar_id != target_avatar:
                continue
            if float(managed.updated_at) < target_updated_at:
                managed.archived = True
                managed.updated_at = time.time()
                self._persist_session_state(sid, managed.studio_session)
                archived_count += 1
        return archived_count

    def get_messages(self, session_id: str) -> list[dict]:
        """Return normalized chat messages for session."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            return self._normalize_messages(getattr(managed.studio_session, "chat_history", []) or [])
        payload = self._load_messages_snapshot(session_id)
        return self._normalize_messages(payload)

    def list_taskspaces(self, session_id: str) -> list[dict[str, str]]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            return []
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        return [dict(item) for item in managed.taskspaces]

    def add_taskspace(
        self,
        session_id: str,
        *,
        path: str | None = None,
        label: str | None = None,
    ) -> dict[str, str]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        scope_key = self._taskspace_scope_key_for_managed(managed)
        default_taskspace = self._get_taskspace(managed, "default")
        resolved_path = (
            self._resolve_taskspace_path(path)
            if path and str(path).strip()
            else str(Path(default_taskspace["path"]).resolve(strict=False))
        )
        for item in managed.taskspaces:
            if item.get("path") == resolved_path:
                return dict(item)
        globals_rows = self._load_global_taskspaces(scope_key=scope_key)
        if len(globals_rows) >= max(0, self.max_taskspaces - 1):
            raise ValueError(f"taskspace limit reached ({self.max_taskspaces})")
        clean_label = (label or "").strip() or Path(resolved_path).name or "taskspace"
        taskspace = {
            "id": f"ts-{uuid.uuid4().hex[:8]}",
            "label": clean_label,
            "path": resolved_path,
        }
        globals_rows.append(taskspace)
        self._save_global_taskspaces(globals_rows, scope_key=scope_key)
        self._sync_all_sessions_from_global(scope_key=scope_key)
        for sid, each in self._sessions.items():
            if self._taskspace_scope_key_for_managed(each) != scope_key:
                continue
            each.updated_at = time.time()
            self._persist_session_state(sid, each.studio_session)
        return dict(taskspace)

    def remove_taskspace(self, session_id: str, taskspace_id: str) -> bool:
        managed = self.get(session_id, touch=False)
        if managed is None:
            return False
        if str(taskspace_id).strip() == "default":
            return False
        scope_key = self._taskspace_scope_key_for_managed(managed)
        globals_rows = self._load_global_taskspaces(scope_key=scope_key)
        before = len(globals_rows)
        globals_rows = [item for item in globals_rows if item.get("id") != taskspace_id]
        if len(globals_rows) == before:
            return False
        self._save_global_taskspaces(globals_rows, scope_key=scope_key)
        self._sync_all_sessions_from_global(scope_key=scope_key)
        for sid, each in self._sessions.items():
            if self._taskspace_scope_key_for_managed(each) != scope_key:
                continue
            each.updated_at = time.time()
            self._persist_session_state(sid, each.studio_session)
        return True

    def list_taskspace_files(
        self,
        session_id: str,
        taskspace_id: str,
        rel_path: str = ".",
    ) -> list[dict[str, Any]]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        taskspace = self._get_taskspace(managed, taskspace_id)
        if taskspace is None:
            raise KeyError("taskspace not found")
        root = Path(taskspace["path"]).expanduser().resolve(strict=False)
        target = self._resolve_inside_root(root, rel_path, expect_dir=True)
        rows: list[dict[str, Any]] = []
        for entry in sorted(target.iterdir(), key=lambda p: (0 if p.is_dir() else 1, p.name.lower())):
            stat = entry.stat()
            rows.append(
                {
                    "name": entry.name,
                    "type": "dir" if entry.is_dir() else "file",
                    "path": str(entry.relative_to(root)),
                    "size": int(stat.st_size),
                    "modified": float(stat.st_mtime),
                }
            )
        return rows

    def read_taskspace_file(
        self,
        session_id: str,
        taskspace_id: str,
        rel_path: str,
        *,
        max_bytes: int = 512 * 1024,
    ) -> dict[str, Any]:
        managed = self.get(session_id, touch=False)
        if managed is None:
            raise KeyError("session not found")
        self._ensure_default_taskspace(managed)
        self._sync_taskspaces_with_global(managed)
        taskspace = self._get_taskspace(managed, taskspace_id)
        if taskspace is None:
            raise KeyError("taskspace not found")
        root = Path(taskspace["path"]).expanduser().resolve(strict=False)
        target = self._resolve_inside_root(root, rel_path, expect_dir=False)
        if target.is_dir():
            raise IsADirectoryError(str(target))
        data = target.read_bytes()
        truncated = False
        if len(data) > max_bytes:
            data = data[:max_bytes]
            truncated = True
        content = data.decode("utf-8", errors="replace")
        return {
            "name": target.name,
            "path": str(target.relative_to(root)),
            "absolute_path": str(target),
            "content": content,
            "truncated": truncated,
            "size": int(target.stat().st_size),
        }

    def cleanup_expired(self) -> None:
        now = time.time()
        expired = [
            sid
            for sid, session in self._sessions.items()
            if (now - session.updated_at) > self.ttl_seconds
        ]
        for sid in expired:
            managed = self._sessions.get(sid)
            if managed is None:
                self._sessions.pop(sid, None)
                continue
            # Persist BEFORE removing from _sessions so _persist_session_state
            # can still look up the managed ref via self._sessions.get(sid) and
            # write all metadata fields (session_name, avatar_id, etc.) correctly.
            self._persist_session_state(sid, managed.studio_session)
            self._sessions.pop(sid, None)
            if managed.team_manager is not None:
                managed.team_manager.shutdown_now()
            # MCP hub is global; do NOT kill child processes on session cleanup.

    def _restore_persisted_state(self, session_id: str, session: StudioSession) -> None:
        try:
            todos = self._session_store._load_todos_sync(session_id)
            if todos:
                session.todo_manager.load_payload(todos)
            scratchpad = self._session_store._load_scratchpad_sync(session_id)
            if scratchpad:
                session.scratchpad = dict(scratchpad)
            messages = self._load_messages_snapshot(session_id)
            if messages:
                session.chat_history = self._normalize_messages(messages)
        except Exception:
            pass

        try:
            raw = self._load_agent_messages_snapshot(session_id)
            if raw:
                from agenticx.runtime.agent_runtime import _sanitize_context_messages
                session.agent_messages = _sanitize_context_messages(raw)
        except Exception:
            pass

        try:
            self._load_context_refs(session_id, session)
        except Exception:
            pass

    def _restore_managed_metadata(self, session_id: str, managed: ManagedSession) -> None:
        try:
            metadata = self._session_store._load_latest_session_metadata_sync(session_id)
        except Exception:
            metadata = {}
        if not isinstance(metadata, dict):
            return
        raw_name = metadata.get("session_name")
        if raw_name is not None:
            session_name = str(raw_name).strip()
            if session_name and session_name != "None":
                managed.session_name = session_name
        # Last resort: if DB history also had no valid name, derive from chat_history
        # which was already loaded by _restore_persisted_state before this method.
        if self.session_title_needs_auto_fill(managed.session_name):
            first = self._first_user_text_from_chat_history(
                getattr(managed.studio_session, "chat_history", None) or []
            )
            if first:
                managed.session_name = self._build_auto_title(first)
        managed.created_at = self._to_float(metadata.get("created_at"), managed.created_at)
        managed.pinned = bool(metadata.get("pinned", False))
        managed.archived = bool(metadata.get("archived", False))
        managed.taskspaces = self._sanitize_taskspaces(session_id, metadata.get("taskspaces"))

        if "avatar_id" in metadata:
            raw_av = metadata.get("avatar_id")
            managed.avatar_id = (
                None if raw_av is None else normalize_session_avatar_binding(str(raw_av))
            )
        if "avatar_name" in metadata:
            raw_name = metadata.get("avatar_name")
            managed.avatar_name = (
                None if raw_name is None else (str(raw_name).strip() or None)
            )
        if "execution_state" in metadata:
            raw_state = str(metadata.get("execution_state", "idle")).strip().lower()
            if raw_state in ("idle", "running", "interrupted"):
                managed.execution_state = raw_state
            else:
                managed.execution_state = "idle"

    def _persist_session_state(self, session_id: str, session: StudioSession) -> None:
        self._ensure_session_title_from_chat_history(session_id, session)
        try:
            todos = session.todo_manager.to_payload()
            scratchpad = dict(getattr(session, "scratchpad", {}) or {})
            self._session_store._save_todos_sync(session_id, todos)
            self._session_store._save_scratchpad_sync(session_id, scratchpad)
            summary = self._build_session_summary(session)
            managed_ref = self._sessions.get(session_id)
            metadata = {
                "provider": session.provider_name or "",
                "model": session.model_name or "",
                "chat_messages": len(session.chat_history),
                "artifacts": len(session.artifacts),
                "session_name": getattr(managed_ref, "session_name", None),
                "avatar_id": getattr(managed_ref, "avatar_id", None),
                "avatar_name": getattr(managed_ref, "avatar_name", None),
                "created_at": getattr(managed_ref, "created_at", time.time()),
                "updated_at": getattr(managed_ref, "updated_at", time.time()),
                "pinned": bool(getattr(managed_ref, "pinned", False)),
                "archived": bool(getattr(managed_ref, "archived", False)),
                "taskspaces": list(getattr(managed_ref, "taskspaces", []) or []),
                "execution_state": getattr(managed_ref, "execution_state", "idle"),
            }
            self._session_store._save_session_summary_sync(session_id, summary, metadata)
            self._save_messages_snapshot(session_id, session.chat_history or [])
            self._session_store._index_session_messages_sync(session_id, session.chat_history or [])
            self._save_agent_messages_snapshot(session_id, getattr(session, "agent_messages", None) or [])
            self._save_context_refs(session_id, session)
        except Exception:
            return

    def _messages_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "messages.json")

    def _save_messages_snapshot(self, session_id: str, messages: list[dict]) -> None:
        path = self._messages_path(session_id)
        atomic_write_json(path, messages)

    def _load_messages_snapshot(self, session_id: str) -> list[dict]:
        path = self._messages_path(session_id)
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def _agent_messages_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "agent_messages.json")

    def _save_agent_messages_snapshot(self, session_id: str, messages: list[dict]) -> None:
        if not messages:
            return
        tail = messages[-40:]
        path = self._agent_messages_path(session_id)
        atomic_write_json(path, tail)

    def _load_agent_messages_snapshot(self, session_id: str) -> list[dict]:
        path = self._agent_messages_path(session_id)
        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    def _context_refs_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "context_files_refs.json")

    def _save_context_refs(self, session_id: str, session: StudioSession) -> None:
        ctx = getattr(session, "context_files", None)
        if not ctx:
            return
        paths = list(ctx.keys())
        path = self._context_refs_path(session_id)
        atomic_write_json(path, paths)

    def _load_context_refs(self, session_id: str, session: StudioSession) -> None:
        path = self._context_refs_path(session_id)
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as fh:
            paths = json.load(fh)
        if not isinstance(paths, list):
            return
        for fpath in paths:
            if not isinstance(fpath, str) or not os.path.isfile(fpath):
                continue
            with open(fpath, "r", encoding="utf-8") as fh:
                session.context_files[fpath] = fh.read()

    def _normalize_messages(self, messages: list[dict]) -> list[dict]:
        max_data_url = 8_000_000
        normalized: list[dict] = []
        for item in messages:
            role = str(item.get("role", "assistant"))
            if role not in {"user", "assistant", "tool"}:
                role = "assistant"
            raw_timestamp = item.get("timestamp")
            try:
                parsed_timestamp = int(raw_timestamp) if raw_timestamp is not None else None
            except (TypeError, ValueError):
                parsed_timestamp = None
            row: dict[str, Any] = {
                "id": str(item.get("id", "")),
                "role": role,
                "content": str(item.get("content", "")),
                "agent_id": str(item.get("agent_id", "meta") or "meta"),
                "avatar_name": str(item.get("avatar_name", "") or ""),
                "avatar_url": str(item.get("avatar_url", "") or ""),
                "provider": str(item.get("provider", "") or ""),
                "model": str(item.get("model", "") or ""),
                "quoted_message_id": str(item.get("quoted_message_id", "") or ""),
                "quoted_content": str(item.get("quoted_content", "") or ""),
                "timestamp": parsed_timestamp,
                "forwarded_history": item.get("forwarded_history"),
            }
            if role == "tool":
                tool_call_id = str(
                    item.get("tool_call_id", item.get("toolCallId", "")) or ""
                ).strip()
                tool_name = str(item.get("tool_name", item.get("toolName", "")) or "").strip()
                tool_status = str(
                    item.get("tool_status", item.get("toolStatus", "")) or ""
                ).strip()
                tool_group_id = str(
                    item.get("tool_group_id", item.get("toolGroupId", "")) or ""
                ).strip()
                if tool_call_id:
                    row["tool_call_id"] = tool_call_id
                if tool_name:
                    row["tool_name"] = tool_name
                raw_tool_args = item.get("tool_args", item.get("toolArgs"))
                if isinstance(raw_tool_args, dict):
                    row["tool_args"] = raw_tool_args
                if tool_status in {"pending", "running", "done", "error", "cancelled"}:
                    row["tool_status"] = tool_status
                raw_elapsed = item.get("tool_elapsed_sec", item.get("toolElapsedSec"))
                try:
                    elapsed = int(raw_elapsed) if raw_elapsed is not None else None
                except (TypeError, ValueError):
                    elapsed = None
                if elapsed is not None and elapsed >= 0:
                    row["tool_elapsed_sec"] = elapsed
                preview = str(
                    item.get("tool_result_preview", item.get("toolResultPreview", "")) or ""
                ).strip()
                if preview:
                    row["tool_result_preview"] = preview
                if tool_group_id:
                    row["tool_group_id"] = tool_group_id
                raw_stream = item.get("tool_stream_lines", item.get("toolStreamLines"))
                if isinstance(raw_stream, list):
                    row["tool_stream_lines"] = [str(line) for line in raw_stream[:200]]
            raw_atts = item.get("attachments")
            if isinstance(raw_atts, list) and raw_atts:
                clean_atts: list[dict[str, Any]] = []
                image_n = 0
                file_n = 0
                for a in raw_atts[:24]:
                    if not isinstance(a, dict):
                        continue
                    du = str(a.get("data_url", "")).strip()
                    kind = str(a.get("kind", "") or "").strip()
                    is_context = kind == "context_file"
                    if du.startswith("data:image/") and len(du) <= max_data_url:
                        if image_n >= 4:
                            continue
                        mime = str(a.get("mime_type", "") or "").strip()
                        if not mime and du.startswith("data:"):
                            semi = du.find(";")
                            if semi > 5:
                                mime = du[5:semi]
                        if not mime:
                            mime = "image/png"
                        try:
                            sz = int(a.get("size", 0) or 0)
                        except (TypeError, ValueError):
                            sz = 0
                        clean_atts.append(
                            {
                                "name": str(a.get("name", "") or "").strip() or "image",
                                "mime_type": mime,
                                "size": sz,
                                "data_url": du,
                            }
                        )
                        image_n += 1
                        continue
                    if is_context or (not du and str(a.get("name", "") or "").strip()):
                        name = str(a.get("name", "") or "").strip()
                        if not name:
                            continue
                        if file_n >= 8:
                            continue
                        sp = str(a.get("source_path", "") or "").strip()
                        rt = bool(a.get("reference_token", False))
                        crl = str(a.get("composer_ref_label", "") or "").strip()
                        mime = str(a.get("mime_type", "") or "").strip() or "application/octet-stream"
                        try:
                            sz = int(a.get("size", 0) or 0)
                        except (TypeError, ValueError):
                            sz = 0
                        att_dict = {
                            "name": name,
                            "mime_type": mime,
                            "size": sz,
                            "source_path": sp,
                            "reference_token": rt,
                            "kind": "context_file",
                        }
                        if crl:
                            att_dict["composer_ref_label"] = crl
                        clean_atts.append(att_dict)
                        file_n += 1
                if clean_atts:
                    row["attachments"] = clean_atts
            if role == "assistant":
                raw_sq = item.get("suggested_questions")
                if isinstance(raw_sq, list) and raw_sq:
                    row["suggested_questions"] = [
                        str(x).strip() for x in raw_sq[:5] if str(x).strip()
                    ]
            normalized.append(row)
        return normalized

    def _build_session_summary(self, session: StudioSession) -> str:
        last_user = ""
        last_assistant = ""
        for item in reversed(session.chat_history[-20:]):
            role = str(item.get("role", ""))
            content = str(item.get("content", ""))
            if role == "assistant" and not last_assistant:
                last_assistant = content
            if role == "user" and not last_user:
                last_user = content
            if last_user and last_assistant:
                break
        return (
            f"last_user={last_user[:300]}\n"
            f"last_assistant={last_assistant[:300]}\n"
            f"todos={session.todo_manager.render()[:600]}"
        )

    def _build_auto_title(self, message: str) -> str:
        compact = " ".join(str(message or "").split())
        if not compact:
            return ""
        return compact[:48]

    @staticmethod
    def _first_user_text_from_chat_history(chat_history: list) -> str:
        for item in chat_history or []:
            if not isinstance(item, dict):
                continue
            if str(item.get("role", "")).strip() != "user":
                continue
            content = str(item.get("content", "")).strip()
            if content:
                return content
        return ""

    def _ensure_session_title_from_chat_history(self, session_id: str, session: StudioSession) -> None:
        managed = self._sessions.get(session_id)
        if managed is None:
            return
        if not self.session_title_needs_auto_fill(managed.session_name):
            return
        first = self._first_user_text_from_chat_history(getattr(session, "chat_history", None) or [])
        if not first:
            return
        managed.session_name = self._build_auto_title(first)
        managed.updated_at = time.time()

    def _build_fork_name(self, base_name: Optional[str]) -> str:
        text = str(base_name or "").strip()
        if not text:
            return "Fork Chat"
        return f"{text} (Fork)"

    def _to_float(self, value: Any, fallback: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return fallback
        if parsed <= 0:
            return fallback
        return parsed

    @staticmethod
    def _sanitize_session_name(raw: Any) -> str | None:
        if raw is None:
            return None
        s = str(raw).strip()
        if not s or s == "None":
            return None
        return s

    def _list_persisted_sessions(self) -> list[dict]:
        rows: list[dict] = []
        try:
            latest = self._session_store._list_latest_sessions_sync(limit=0)
        except Exception:
            latest = []
        for item in latest:
            sid = str(item.get("session_id", "")).strip()
            if not sid:
                continue
            metadata = item.get("metadata", {})
            if not isinstance(metadata, dict):
                metadata = {}
            chat_count = 0
            try:
                chat_count = int(metadata.get("chat_messages", 0))
            except (TypeError, ValueError):
                pass
            if chat_count <= 0:
                # 元数据可能略滞后于磁盘 messages.json；有消息则仍应出现在会话列表中。
                try:
                    mp = Path(self._messages_path(sid))
                    raw = mp.read_text(encoding="utf-8").strip()
                    if raw and raw != "[]":
                        chat_count = 1
                except Exception:
                    pass
            if chat_count <= 0:
                continue
            created_at = self._to_float(metadata.get("created_at"), self._iso_to_epoch(item.get("created_at")))
            updated_at = self._to_float(metadata.get("updated_at"), self._iso_to_epoch(item.get("created_at")))
            rows.append(
                {
                    "session_id": sid,
                    "avatar_id": metadata.get("avatar_id"),
                    "avatar_name": metadata.get("avatar_name"),
                    "session_name": self._sanitize_session_name(metadata.get("session_name")),
                    "updated_at": updated_at,
                    "created_at": created_at,
                    "pinned": bool(metadata.get("pinned", False)),
                    "archived": bool(metadata.get("archived", False)),
                    "execution_state": str(metadata.get("execution_state", "idle") or "idle"),
                    "provider": str(metadata.get("provider", "") or ""),
                    "model": str(metadata.get("model", "") or ""),
                }
            )
        known = {str(row.get("session_id", "")) for row in rows}
        root = Path(self._sessions_root)
        if root.exists():
            for child in root.iterdir():
                if not child.is_dir():
                    continue
                sid = child.name
                if sid in known:
                    continue
                messages_path = child / "messages.json"
                if not messages_path.exists():
                    continue
                try:
                    content = messages_path.read_text(encoding="utf-8").strip()
                    if not content or content == "[]":
                        continue
                except Exception:
                    continue
                mtime = float(messages_path.stat().st_mtime)
                fs_meta: dict[str, Any] = {}
                try:
                    loaded = self._session_store._load_latest_session_metadata_sync(sid)
                    if isinstance(loaded, dict):
                        fs_meta = loaded
                except Exception:
                    fs_meta = {}
                raw_av = fs_meta.get("avatar_id")
                av_norm = (
                    None
                    if raw_av is None
                    else normalize_session_avatar_binding(str(raw_av))
                )
                raw_nm = fs_meta.get("avatar_name")
                av_name = None if raw_nm is None else (str(raw_nm).strip() or None)
                sess_nm = self._sanitize_session_name(fs_meta.get("session_name"))
                rows.append(
                    {
                        "session_id": sid,
                        "avatar_id": av_norm,
                        "avatar_name": av_name,
                        "session_name": sess_nm,
                        "updated_at": mtime,
                        "created_at": mtime,
                        "pinned": False,
                        "archived": False,
                        "execution_state": str(fs_meta.get("execution_state", "idle") or "idle"),
                        "provider": str(fs_meta.get("provider", "") or ""),
                        "model": str(fs_meta.get("model", "") or ""),
                    }
                )
        return rows

    def _purge_session_state(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        db_ok = False
        try:
            self._session_store._purge_session_sync(sid)
            db_ok = not self._session_store._session_exists_sync(sid)
        except Exception:
            db_ok = False
        fs_ok = True
        session_dir = Path(self._sessions_root) / sid
        if session_dir.exists():
            try:
                shutil.rmtree(session_dir, ignore_errors=False)
            except Exception:
                fs_ok = False
            else:
                fs_ok = not session_dir.exists()
        taskspace_ok = True
        default_taskspace_dir = Path(self._taskspaces_root) / sid
        if default_taskspace_dir.exists():
            try:
                shutil.rmtree(default_taskspace_dir, ignore_errors=False)
            except Exception:
                taskspace_ok = False
            else:
                taskspace_ok = not default_taskspace_dir.exists()
        return db_ok and fs_ok and taskspace_ok

    def _session_exists_in_persistence(self, session_id: str) -> bool:
        sid = str(session_id or "").strip()
        if not sid:
            return False
        try:
            metadata = self._session_store._load_latest_session_metadata_sync(sid)
            if isinstance(metadata, dict) and metadata:
                return True
        except Exception:
            pass
        messages_path = Path(self._messages_path(sid))
        return messages_path.exists()

    def _iso_to_epoch(self, value: Any) -> float:
        text = str(value or "").strip()
        if not text:
            return time.time()
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
        except Exception:
            return time.time()

    def _ensure_default_taskspace(self, managed: ManagedSession) -> None:
        for existing in managed.taskspaces:
            if existing.get("id") == "default" and existing.get("path"):
                existing["path"] = str(Path(existing["path"]).resolve(strict=False))
                existing["label"] = existing.get("label") or "默认工作区"
                return
        session_ws = getattr(managed.studio_session, "workspace_dir", None)
        default_path = (
            session_ws
            if session_ws and str(session_ws).strip()
            else self._resolve_taskspace_root(managed.session_id, None)
        )
        resolved = Path(default_path).resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        managed.taskspaces = [{
            "id": "default",
            "label": "默认工作区",
            "path": str(resolved),
        }] + [item for item in managed.taskspaces if item.get("id") != "default"]

    def _sync_taskspaces_with_global(self, managed: ManagedSession) -> None:
        self._ensure_default_taskspace(managed)
        globals_rows = self._load_global_taskspaces(
            scope_key=self._taskspace_scope_key_for_managed(managed)
        )
        default_item = self._get_taskspace(managed, "default")
        if default_item is None:
            return
        merged: list[dict[str, str]] = [dict(default_item)]
        seen_paths: set[str] = {default_item["path"]}
        for row in globals_rows:
            path = str(row.get("path", "")).strip()
            if not path or path in seen_paths:
                continue
            merged.append(
                {
                    "id": str(row.get("id", "")).strip(),
                    "label": str(row.get("label", "")).strip() or Path(path).name or "taskspace",
                    "path": path,
                }
            )
            seen_paths.add(path)
            if len(merged) >= self.max_taskspaces:
                break
        managed.taskspaces = merged

    def _sync_all_sessions_from_global(self, scope_key: str | None = None) -> None:
        for managed in self._sessions.values():
            if (
                scope_key is not None
                and self._taskspace_scope_key_for_managed(managed) != scope_key
            ):
                continue
            self._sync_taskspaces_with_global(managed)

    def _global_taskspaces_path(self) -> str:
        return os.path.join(self._taskspaces_root, "global_workspaces.json")

    @staticmethod
    def _taskspace_scope_key_from_avatar_id(avatar_id: Optional[str]) -> str:
        normalized = normalize_session_avatar_binding(avatar_id)
        if normalized is None:
            return SessionManager._META_TASKSPACE_SCOPE
        return f"avatar:{normalized}"

    def _taskspace_scope_key_for_managed(self, managed: ManagedSession) -> str:
        return self._taskspace_scope_key_from_avatar_id(getattr(managed, "avatar_id", None))

    def _normalize_global_taskspace_rows(self, payload: Any) -> list[dict[str, str]]:
        if not isinstance(payload, list):
            return []
        rows: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        for item in payload:
            if not isinstance(item, dict):
                continue
            taskspace_id = str(item.get("id", "")).strip()
            raw_path = str(item.get("path", "")).strip()
            if not taskspace_id or not raw_path:
                continue
            resolved_path = self._resolve_taskspace_path(raw_path)
            if resolved_path in seen_paths:
                continue
            rows.append(
                {
                    "id": taskspace_id,
                    "label": str(item.get("label", "")).strip()
                    or Path(resolved_path).name
                    or "taskspace",
                    "path": resolved_path,
                }
            )
            seen_paths.add(resolved_path)
            if len(rows) >= max(0, self.max_taskspaces - 1):
                break
        return rows

    def _load_global_taskspace_scopes(self) -> dict[str, list[dict[str, str]]]:
        path = self._global_taskspaces_path()
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except Exception:
            return {}

        # Backward compatibility: old payload was a plain list shared by all sessions.
        if isinstance(payload, list):
            return {
                self._META_TASKSPACE_SCOPE: self._normalize_global_taskspace_rows(payload)
            }

        if not isinstance(payload, dict):
            return {}
        raw_scopes = payload.get("scopes", payload)
        if not isinstance(raw_scopes, dict):
            return {}

        scopes: dict[str, list[dict[str, str]]] = {}
        for key, rows in raw_scopes.items():
            scope_key = str(key or "").strip()
            if not scope_key:
                continue
            normalized_rows = self._normalize_global_taskspace_rows(rows)
            if normalized_rows:
                scopes[scope_key] = normalized_rows
        return scopes

    def _load_global_taskspaces(self, scope_key: str | None = None) -> list[dict[str, str]]:
        key = (scope_key or "").strip() or self._META_TASKSPACE_SCOPE
        scopes = self._load_global_taskspace_scopes()
        return [dict(item) for item in scopes.get(key, [])]

    def _save_global_taskspaces(
        self,
        rows: list[dict[str, str]],
        scope_key: str | None = None,
    ) -> None:
        key = (scope_key or "").strip() or self._META_TASKSPACE_SCOPE
        scopes = self._load_global_taskspace_scopes()
        normalized_rows = self._normalize_global_taskspace_rows(rows)
        if normalized_rows:
            scopes[key] = normalized_rows
        else:
            scopes.pop(key, None)
        path = self._global_taskspaces_path()
        atomic_write_json(path, {"scopes": scopes})

    def _resolve_taskspace_path(self, path: str) -> str:
        root = Path(str(path).strip()).expanduser()
        resolved = root.resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved)

    def _resolve_taskspace_root(self, session_id: str, path: str | None) -> str:
        if path and str(path).strip():
            return self._resolve_taskspace_path(path)
        root = Path(self._taskspaces_root) / session_id / "default"
        resolved = root.resolve(strict=False)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved)

    def rebind_default_taskspace_to_workspace(self, managed: ManagedSession) -> None:
        """Re-point the 'default' taskspace to the session's workspace_dir (call after workspace_dir is set)."""
        ws = getattr(managed.studio_session, "workspace_dir", None)
        if not ws or not str(ws).strip():
            return
        resolved = str(Path(ws).resolve(strict=False))
        for ts in managed.taskspaces:
            if ts.get("id") == "default":
                if ts["path"] != resolved:
                    Path(resolved).mkdir(parents=True, exist_ok=True)
                    ts["path"] = resolved
                return

    def apply_avatar_binding(
        self,
        managed: ManagedSession,
        *,
        avatar_id: Optional[str],
        avatar_name: Optional[str] = None,
    ) -> None:
        """Bind session avatar identity and immediately rescope taskspaces.

        New sessions are created before avatar_id is known in some API flows. If we only
        set avatar_id later without re-sync, taskspaces can stay in the wrong scope.
        """
        managed.avatar_id = normalize_session_avatar_binding(avatar_id)
        managed.avatar_name = (str(avatar_name).strip() or None) if avatar_name is not None else None
        self._sync_taskspaces_with_global(managed)

    def _sanitize_taskspaces(self, session_id: str, payload: Any) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        if isinstance(payload, list):
            for item in payload:
                if not isinstance(item, dict):
                    continue
                taskspace_id = str(item.get("id", "")).strip()
                label = str(item.get("label", "")).strip()
                path = str(item.get("path", "")).strip()
                if not taskspace_id or not path:
                    continue
                resolved_path = self._resolve_taskspace_root(session_id, path)
                rows.append(
                    {
                        "id": taskspace_id,
                        "label": label or Path(resolved_path).name or "taskspace",
                        "path": resolved_path,
                    }
                )
                if len(rows) >= self.max_taskspaces:
                    break
        if not rows:
            return []
        dedup: list[dict[str, str]] = []
        seen_paths: set[str] = set()
        for row in rows:
            row_path = row["path"]
            if row_path in seen_paths:
                continue
            dedup.append(row)
            seen_paths.add(row_path)
            if len(dedup) >= self.max_taskspaces:
                break
        return dedup

    def _get_taskspace(self, managed: ManagedSession, taskspace_id: str) -> Optional[dict[str, str]]:
        for item in managed.taskspaces:
            if item.get("id") == taskspace_id:
                return item
        return None

    def _resolve_inside_root(self, root: Path, rel_path: str, *, expect_dir: bool) -> Path:
        clean_rel = str(rel_path or ".").strip() or "."
        target = (root / clean_rel).resolve(strict=False)
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError("path escapes taskspace root") from exc
        if not target.exists():
            raise FileNotFoundError(str(target))
        if expect_dir and not target.is_dir():
            raise NotADirectoryError(str(target))
        return target
