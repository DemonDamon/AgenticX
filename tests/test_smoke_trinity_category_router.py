#!/usr/bin/env python3
"""Smoke tests for trinity category-based model routing.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json

import pytest

from agenticx.runtime.meta_tools import _resolve_model_for_category
from agenticx.runtime.meta_tools import dispatch_meta_tool_async


class _DummyTeamManager:
    def __init__(self) -> None:
        self.last_spawn_kwargs: dict = {}

    async def spawn_subagent(self, **kwargs):  # noqa: ANN003
        self.last_spawn_kwargs = kwargs
        return {"ok": True, "agent_id": "sa-test", "provider": kwargs.get("provider"), "model": kwargs.get("model")}


class _DummyAvatarRegistry:
    def list_avatars(self) -> list:
        return []

    def get_avatar(self, avatar_id: str):  # noqa: ANN001
        class _Avatar:
            id = avatar_id
            name = "Demo Avatar"
            role = "researcher"

        return _Avatar()


def _patch_avatar_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("agenticx.avatar.registry.AvatarRegistry", _DummyAvatarRegistry)


@pytest.mark.asyncio
async def test_spawn_routes_model_from_category(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_avatar_registry(monkeypatch)
    monkeypatch.setattr(
        "agenticx.runtime.meta_tools._resolve_model_for_category",
        lambda **kwargs: {"provider": "anthropic", "model": "claude-sonnet"},
    )
    manager = _DummyTeamManager()
    raw = await dispatch_meta_tool_async(
        "spawn_subagent",
        {"name": "worker", "role": "coder", "task": "build", "category": "deep"},
        team_manager=manager,
        session=None,
    )
    payload = json.loads(raw)
    assert payload["ok"] is True
    assert manager.last_spawn_kwargs["provider"] == "anthropic"
    assert manager.last_spawn_kwargs["model"] == "claude-sonnet"


@pytest.mark.asyncio
async def test_spawn_keeps_explicit_model_override(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_avatar_registry(monkeypatch)
    monkeypatch.setattr(
        "agenticx.runtime.meta_tools._resolve_model_for_category",
        lambda **kwargs: {"provider": "x", "model": "y"},
    )
    manager = _DummyTeamManager()
    await dispatch_meta_tool_async(
        "spawn_subagent",
        {
            "name": "worker",
            "role": "coder",
            "task": "build",
            "category": "quick",
            "provider": "openai",
            "model": "gpt-5",
        },
        team_manager=manager,
        session=None,
    )
    assert manager.last_spawn_kwargs["provider"] == "openai"
    assert manager.last_spawn_kwargs["model"] == "gpt-5"


def test_resolve_model_for_category_returns_empty_when_no_hint_match(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Cfg:
        providers = {"demo": {"model": "plain-model"}}

    monkeypatch.setattr("agenticx.runtime.meta_tools.ConfigManager.load", lambda: _Cfg())
    selected = _resolve_model_for_category(category="visual", session=None)
    assert selected == {"provider": "", "model": ""}


@pytest.mark.asyncio
async def test_delegate_without_category_does_not_trigger_category_router(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_avatar_registry(monkeypatch)

    def _boom(**kwargs):  # noqa: ANN003
        raise AssertionError("category router should not run when category is not provided")

    monkeypatch.setattr("agenticx.runtime.meta_tools._resolve_model_for_category", _boom)

    class _Managed:
        session_id = "avatar-session"
        updated_at = 0.0

    class _SessionManager:
        def persist(self, _session_id: str) -> None:
            return None

    class _Session:
        provider_name = "openai"
        model_name = "gpt-5"
        scratchpad = {}
        _session_manager = _SessionManager()

    class _Team:
        owner_session_id = "owner-1"

        async def _emit(self, _event):  # noqa: ANN001
            return None

    observed: dict = {}

    async def _fake_run_delegation_in_avatar_session(**kwargs):  # noqa: ANN003
        observed["fallback_provider"] = kwargs.get("fallback_provider")
        observed["fallback_model"] = kwargs.get("fallback_model")
        return None

    monkeypatch.setattr(
        "agenticx.runtime.meta_tools._find_or_create_avatar_session",
        lambda *args, **kwargs: _Managed(),
    )
    monkeypatch.setattr(
        "agenticx.runtime.meta_tools._run_delegation_in_avatar_session",
        _fake_run_delegation_in_avatar_session,
    )

    raw = await dispatch_meta_tool_async(
        "delegate_to_avatar",
        {"avatar_id": "demo", "task": "run task"},
        team_manager=_Team(),
        session=_Session(),
    )
    payload = json.loads(raw)
    assert payload["ok"] is True
    await asyncio.sleep(0)
    assert observed["fallback_provider"] == "openai"
    assert observed["fallback_model"] == "gpt-5"
