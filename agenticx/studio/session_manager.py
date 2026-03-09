#!/usr/bin/env python3
"""Session manager for Studio service mode."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

from agenticx.cli.studio import StudioSession
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

    def create(self, provider: Optional[str] = None, model: Optional[str] = None) -> ManagedSession:
        session_id = str(uuid.uuid4())
        managed = ManagedSession(
            session_id=session_id,
            studio_session=StudioSession(provider_name=provider, model_name=model),
        )
        self._sessions[session_id] = managed
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
        if managed.team_manager is not None:
            managed.team_manager.shutdown_now()
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
            if managed is not None and managed.team_manager is not None:
                managed.team_manager.shutdown_now()
