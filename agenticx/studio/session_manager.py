#!/usr/bin/env python3
"""Session manager for Studio service mode.

Author: Damon Li
"""

from __future__ import annotations

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
        except Exception:
            return

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
        except Exception:
            return

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
