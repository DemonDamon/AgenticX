#!/usr/bin/env python3
"""E2E: rate-limit failure triggers auth profile rotation and retry.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.llms.auth_profile import AuthProfile
from agenticx.llms.auth_profile import AuthProfileManager


def _simulate_request_with_rotation(manager: AuthProfileManager) -> str:
    current = manager.get_current()
    if current is None:
        raise RuntimeError("No available profile")

    # Simulate first profile hitting rate limit.
    manager.mark_failure(current.name, "rate_limit")
    rotated = manager.advance(exclude_name=current.name)
    if rotated is None:
        raise RuntimeError("No rotated profile available")
    manager.mark_success(rotated.name)
    return rotated.name


def test_e2e_auth_rotation_and_persistence(tmp_path: Path):
    persist = tmp_path / "auth-profiles.json"
    profiles = [
        AuthProfile(name="p1", provider="openai", api_key="k1"),
        AuthProfile(name="p2", provider="openai", api_key="k2"),
    ]
    manager = AuthProfileManager(profiles=profiles, persistence_path=persist)

    used = _simulate_request_with_rotation(manager)
    assert used == "p2"
    assert persist.exists()
    assert profiles[0].cooldown.error_count == 1
    assert profiles[0].cooldown.cooldown_until > 0

    # New manager instance should load persisted cooldown state.
    another = AuthProfileManager(
        profiles=[
            AuthProfile(name="p1", provider="openai", api_key="k1"),
            AuthProfile(name="p2", provider="openai", api_key="k2"),
        ],
        persistence_path=persist,
    )
    assert another.profiles[0].cooldown.error_count == 1
    assert another.get_current().name == "p2"
