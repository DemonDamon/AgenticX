#!/usr/bin/env python3
"""Session manager for Studio service mode.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime import AsyncConfirmGate
from agenticx.runtime.team_manager import AgentTeamManager, SubAgentContext

EventEmitter = Callable[[Any], Awaitable[None]]
SummarySink = Callable[[str, SubAgentContext], Awaitable[None]]


@dataclass
class ManagedSession:
    session_id: str
    studio_session: StudioSession
    confirm_gate: AsyncConfirmGate = field(default_factory=AsyncConfirmGate)
    sub_confirm_gates: Dict[str, AsyncConfirmGate] = field(default_factory=dict)
    team_manager: Optional[AgentTeamManager] = None
    updated_at: float = field(default_factory=time.time)
    avatar_id: Optional[str] = None
    avatar_name: Optional[str] = None
    session_name: Optional[str] = None

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
                event_emitter=event_emitter,
                summary_sink=summary_sink,
            )
        else:
            self.team_manager.llm_factory = llm_factory
            self.team_manager.base_session = self.studio_session
            self.team_manager.event_emitter = event_emitter
            self.team_manager.summary_sink = summary_sink
        return self.team_manager


class SessionManager:
    def __init__(self, *, ttl_seconds: int = 3600) -> None:
        self.ttl_seconds = ttl_seconds
        self._sessions: Dict[str, ManagedSession] = {}
        self._session_store = SessionStore()
        self._sessions_root = os.path.join(os.path.expanduser("~"), ".agenticx", "sessions")

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
        self._sessions[sid] = managed
        return managed

    def get(self, session_id: str) -> Optional[ManagedSession]:
        managed = self._sessions.get(session_id)
        if managed is None:
            return None
        managed.updated_at = time.time()
        return managed

    def delete(self, session_id: str) -> bool:
        managed = self._sessions.pop(session_id, None)
        if managed is None:
            return False
        self._persist_session_state(session_id, managed.studio_session)
        if managed.team_manager is not None:
            managed.team_manager.shutdown_now()
        return True

    def list_sessions(self, avatar_id: str | None = None) -> list[dict]:
        """List sessions, optionally filtered by avatar_id."""
        result = []
        for sid, managed in self._sessions.items():
            if avatar_id and getattr(managed, "avatar_id", None) != avatar_id:
                continue
            result.append({
                "session_id": sid,
                "avatar_id": getattr(managed, "avatar_id", None),
                "avatar_name": getattr(managed, "avatar_name", None),
                "session_name": getattr(managed, "session_name", None),
                "updated_at": managed.updated_at,
            })
        result.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
        return result

    def rename_session(self, session_id: str, name: str) -> bool:
        """Rename an existing session. Returns True if found and renamed."""
        managed = self._sessions.get(session_id)
        if managed is None:
            return False
        managed.session_name = name
        managed.updated_at = time.time()
        return True

    def get_messages(self, session_id: str) -> list[dict]:
        """Return normalized chat messages for session."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            return self._normalize_messages(getattr(managed.studio_session, "chat_history", []) or [])
        payload = self._load_messages_snapshot(session_id)
        return self._normalize_messages(payload)

    def cleanup_expired(self) -> None:
        now = time.time()
        expired = [
            sid
            for sid, session in self._sessions.items()
            if (now - session.updated_at) > self.ttl_seconds
        ]
        for sid in expired:
            managed = self._sessions.pop(sid, None)
            if managed is None:
                continue
            self._persist_session_state(sid, managed.studio_session)
            if managed.team_manager is not None:
                managed.team_manager.shutdown_now()

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

    def _persist_session_state(self, session_id: str, session: StudioSession) -> None:
        try:
            todos = session.todo_manager.to_payload()
            scratchpad = dict(getattr(session, "scratchpad", {}) or {})
            self._session_store._save_todos_sync(session_id, todos)
            self._session_store._save_scratchpad_sync(session_id, scratchpad)
            summary = self._build_session_summary(session)
            metadata = {
                "provider": session.provider_name or "",
                "model": session.model_name or "",
                "chat_messages": len(session.chat_history),
                "artifacts": len(session.artifacts),
            }
            self._session_store._save_session_summary_sync(session_id, summary, metadata)
            self._save_messages_snapshot(session_id, session.chat_history or [])
            self._save_agent_messages_snapshot(session_id, getattr(session, "agent_messages", None) or [])
            self._save_context_refs(session_id, session)
        except Exception:
            return

    def _messages_path(self, session_id: str) -> str:
        return os.path.join(self._sessions_root, session_id, "messages.json")

    def _save_messages_snapshot(self, session_id: str, messages: list[dict]) -> None:
        path = self._messages_path(session_id)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(messages, fh, ensure_ascii=False, indent=2)

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
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(tail, fh, ensure_ascii=False, indent=2)

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
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(paths, fh, ensure_ascii=False, indent=2)

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
        normalized: list[dict] = []
        for item in messages:
            role = str(item.get("role", "assistant"))
            if role not in {"user", "assistant", "tool"}:
                role = "assistant"
            normalized.append(
                {
                    "id": str(item.get("id", "")),
                    "role": role,
                    "content": str(item.get("content", "")),
                    "agent_id": str(item.get("agent_id", "meta") or "meta"),
                    "provider": str(item.get("provider", "") or ""),
                    "model": str(item.get("model", "") or ""),
                }
            )
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
