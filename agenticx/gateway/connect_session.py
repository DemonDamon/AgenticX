#!/usr/bin/env python3
"""In-memory connect sessions for QR-based IM binding flow.

Author: Damon Li
"""

from __future__ import annotations

import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ConnectSession:
    """One-time session linking a QR page to a device binding code."""

    session_id: str
    device_id: str
    binding_code: str
    status: str = "pending"  # pending | scanned | bound | expired
    platform: str = ""
    sender_name: str = ""
    created_at: float = field(default_factory=time.time)
    expires_at: float = 0.0
    bound_at: float = 0.0

    def to_api_dict(self, now: Optional[float] = None) -> Dict[str, Any]:
        t = now if now is not None else time.time()
        eff = self._effective_status(t)
        return {
            "session_id": self.session_id,
            "binding_code": self.binding_code,
            "status": eff,
            "platform": self.platform,
            "sender_name": self.sender_name,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "bound_at": self.bound_at if eff == "bound" else 0.0,
        }

    def _effective_status(self, now: float) -> str:
        if self.status == "bound":
            return "bound"
        if now >= self.expires_at:
            return "expired"
        return self.status


class ConnectSessionManager:
    """TTL connect sessions; thread-safe for async + sync router."""

    TTL_SECONDS = 300.0

    def __init__(self, ttl_seconds: float = TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._by_id: Dict[str, ConnectSession] = {}

    def create(self, device_id: str, binding_code: str) -> ConnectSession:
        device_id = (device_id or "").strip()
        binding_code = (binding_code or "").strip()
        if not device_id or not binding_code:
            raise ValueError("device_id and binding_code required")
        sid = str(uuid.uuid4())
        now = time.time()
        sess = ConnectSession(
            session_id=sid,
            device_id=device_id,
            binding_code=binding_code,
            status="pending",
            created_at=now,
            expires_at=now + self._ttl,
        )
        with self._lock:
            self._prune_unlocked(time.time())
            self._by_id[sid] = sess
        return sess

    def get(self, session_id: str, *, now: Optional[float] = None) -> Optional[ConnectSession]:
        t = now if now is not None else time.time()
        with self._lock:
            self._prune_unlocked(t)
            s = self._by_id.get(session_id)
            if s is None:
                return None
            return s

    def mark_scanned(self, session_id: str) -> bool:
        with self._lock:
            t = time.time()
            self._prune_unlocked(t)
            s = self._by_id.get(session_id)
            if s is None or t >= s.expires_at:
                return False
            if s.status == "pending":
                s.status = "scanned"
            return True

    def try_complete_bind(
        self,
        binding_code: str,
        device_id: str,
        platform: str,
        sender_name: str,
    ) -> bool:
        """Mark the newest matching pending/scanned session as bound."""
        binding_code = (binding_code or "").strip()
        device_id = (device_id or "").strip()
        if not binding_code or not device_id:
            return False
        now = time.time()
        with self._lock:
            self._prune_unlocked(now)
            candidates: List[ConnectSession] = [
                s
                for s in self._by_id.values()
                if s.binding_code == binding_code
                and s.device_id == device_id
                and s.status in ("pending", "scanned")
                and now < s.expires_at
            ]
            if not candidates:
                return False
            # Prefer most recently created
            best = max(candidates, key=lambda x: x.created_at)
            best.status = "bound"
            best.platform = (platform or "").strip()
            best.sender_name = (sender_name or "").strip()
            best.bound_at = now
            return True

    def _prune_unlocked(self, now: float) -> None:
        dead: List[str] = []
        for sid, s in self._by_id.items():
            if s.status != "bound" and now >= s.expires_at:
                dead.append(sid)
            elif s.status == "bound" and s.bound_at > 0 and now - s.bound_at > 3600:
                # Drop completed sessions after 1h to limit memory growth
                dead.append(sid)
        for sid in dead:
            del self._by_id[sid]
