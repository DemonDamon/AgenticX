#!/usr/bin/env python3
"""Auth profile rotation and cooldown persistence.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional
import json
import time


@dataclass
class AuthProfileCooldown:
    cooldown_until: float = 0.0
    disabled_until: float = 0.0
    error_count: int = 0
    failure_type: str = ""


@dataclass
class AuthProfile:
    name: str
    provider: str
    api_key: str
    profile_type: str = "api_key"
    last_used: float = 0.0
    cooldown: AuthProfileCooldown = field(default_factory=AuthProfileCooldown)

    @property
    def is_available(self) -> bool:
        now = time.time()
        return now >= self.cooldown.cooldown_until and now >= self.cooldown.disabled_until


class AuthProfileManager:
    """Manage profile rotation with cooldown backoff and persistence."""

    RATE_LIMIT_BASE_MS = 60_000
    RATE_LIMIT_CAP_MS = 3_600_000
    BILLING_BASE_MS = 18_000_000
    BILLING_CAP_MS = 86_400_000

    def __init__(
        self,
        profiles: List[AuthProfile],
        persistence_path: Optional[Path] = None,
    ) -> None:
        self._profiles = profiles
        self._current_index = 0
        self._persistence_path = persistence_path
        self._load_persisted_state()

    @property
    def profiles(self) -> List[AuthProfile]:
        return self._profiles

    def get_current(self) -> Optional[AuthProfile]:
        ordered = self._ordered_profiles()
        if not ordered:
            return None
        profile = ordered[0]
        self._current_index = self._profiles.index(profile)
        return profile

    def mark_success(self, profile_name: str) -> None:
        profile = self._find(profile_name)
        if profile is None:
            return
        profile.last_used = time.time()
        profile.cooldown.error_count = 0
        profile.cooldown.failure_type = ""
        profile.cooldown.cooldown_until = 0.0
        self._persist()

    def mark_failure(self, profile_name: str, failure_type: str) -> None:
        profile = self._find(profile_name)
        if profile is None:
            return
        profile.cooldown.error_count += 1
        profile.cooldown.failure_type = failure_type
        cooldown_ms = self._compute_cooldown_ms(
            failure_type=failure_type,
            error_count=profile.cooldown.error_count,
        )
        profile.cooldown.cooldown_until = time.time() + cooldown_ms / 1000.0
        self._persist()

    def advance(self, exclude_name: Optional[str] = None) -> Optional[AuthProfile]:
        for profile in self._ordered_profiles():
            if exclude_name and profile.name == exclude_name:
                continue
            self._current_index = self._profiles.index(profile)
            profile.last_used = time.time()
            self._persist()
            return profile
        return None

    def classify_failure(self, error: Exception) -> str:
        message = str(error).lower()
        if "billing" in message or "insufficient_quota" in message or "quota" in message:
            return "billing"
        if "auth" in message or "invalid api key" in message or "unauthorized" in message:
            return "auth"
        if "rate" in message or "429" in message or "too many requests" in message:
            return "rate_limit"
        return "other"

    def _compute_cooldown_ms(self, failure_type: str, error_count: int) -> float:
        if failure_type == "billing":
            return min(
                self.BILLING_BASE_MS * (2 ** min(error_count - 1, 10)),
                self.BILLING_CAP_MS,
            )
        return min(
            self.RATE_LIMIT_BASE_MS * (5 ** min(error_count - 1, 3)),
            self.RATE_LIMIT_CAP_MS,
        )

    def _ordered_profiles(self) -> List[AuthProfile]:
        available = sorted(
            [p for p in self._profiles if p.is_available],
            key=lambda p: p.last_used,
        )
        cooling = sorted(
            [p for p in self._profiles if not p.is_available],
            key=lambda p: p.cooldown.cooldown_until,
        )
        return available + cooling

    def _find(self, name: str) -> Optional[AuthProfile]:
        for profile in self._profiles:
            if profile.name == name:
                return profile
        return None

    def _persist(self) -> None:
        if self._persistence_path is None:
            return
        self._persistence_path.parent.mkdir(parents=True, exist_ok=True)
        payload: Dict[str, Dict] = {}
        for profile in self._profiles:
            payload[profile.name] = {
                "last_used": profile.last_used,
                "cooldown": asdict(profile.cooldown),
            }
        tmp_path = self._persistence_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self._persistence_path)

    def _load_persisted_state(self) -> None:
        if self._persistence_path is None or not self._persistence_path.exists():
            return
        try:
            data = json.loads(self._persistence_path.read_text(encoding="utf-8"))
        except Exception:
            return
        for profile in self._profiles:
            item = data.get(profile.name)
            if not item:
                continue
            profile.last_used = float(item.get("last_used", 0.0))
            cooldown = item.get("cooldown", {})
            profile.cooldown = AuthProfileCooldown(
                cooldown_until=float(cooldown.get("cooldown_until", 0.0)),
                disabled_until=float(cooldown.get("disabled_until", 0.0)),
                error_count=int(cooldown.get("error_count", 0)),
                failure_type=str(cooldown.get("failure_type", "")),
            )
