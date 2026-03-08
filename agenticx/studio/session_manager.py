#!/usr/bin/env python3
"""Session manager for Studio service mode."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from agenticx.cli.studio import StudioSession
from agenticx.runtime import AsyncConfirmGate


@dataclass
class ManagedSession:
    session_id: str
    studio_session: StudioSession
    confirm_gate: AsyncConfirmGate = field(default_factory=AsyncConfirmGate)
    updated_at: float = field(default_factory=time.time)


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
        return self._sessions.pop(session_id, None) is not None

    def cleanup_expired(self) -> None:
        now = time.time()
        expired = [
            sid
            for sid, session in self._sessions.items()
            if (now - session.updated_at) > self.ttl_seconds
        ]
        for sid in expired:
            self._sessions.pop(sid, None)
