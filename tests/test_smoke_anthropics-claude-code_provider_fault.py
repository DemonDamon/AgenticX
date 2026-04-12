#!/usr/bin/env python3
"""Smoke: session-scoped provider hard-failure denylist (G1).

Author: Damon Li
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.llms.provider_fault import (
    classify_provider_fault,
    is_provider_session_blocked,
    record_session_provider_hard_failure,
)
from agenticx.runtime.meta_tools import _recommend_subagent_model_payload, dispatch_meta_tool_async


class AccountOverdueError(Exception):
    """LiteLLM-style billing failure."""

    pass


def test_classify_account_overdue_as_billing() -> None:
    exc = AccountOverdueError("AccountOverdueError: balance due")
    assert classify_provider_fault(exc) == "billing"


def test_record_and_is_blocked_session_scoped() -> None:
    session = StudioSession()
    record_session_provider_hard_failure(session, "OpenAI", fault="billing")
    assert is_provider_session_blocked(session, "openai")
    assert not is_provider_session_blocked(session, "anthropic")


def test_recommend_subagent_model_excludes_blocked_providers() -> None:
    session = StudioSession()
    session.provider_name = "acme"
    session.model_name = "acme-model"
    record_session_provider_hard_failure(session, "acme", fault="auth")

    fake_cfg = MagicMock()
    fake_cfg.providers = {
        "acme": {"model": "acme-model"},
        "beta": {"model": "beta-model"},
    }

    with patch("agenticx.runtime.meta_tools.ConfigManager.load", return_value=fake_cfg):
        payload = _recommend_subagent_model_payload(task="refactor the whole codebase", session=session)

    assert payload.get("ok") is True
    rec = payload.get("recommended") or {}
    assert rec.get("provider") == "beta"
    alts = payload.get("alternatives") or []
    assert all((a.get("provider") or "").lower() != "acme" for a in alts)


@pytest.mark.asyncio
async def test_spawn_subagent_rejects_blocked_provider() -> None:
    session = StudioSession()
    record_session_provider_hard_failure(session, "volcengine", fault="billing")

    team = MagicMock()
    team.spawn_subagent = AsyncMock(return_value={"ok": True, "agent_id": "sa-should-not"})

    raw = await dispatch_meta_tool_async(
        "spawn_subagent",
        {
            "name": "helper",
            "role": "coder",
            "task": "do thing",
            "provider": "volcengine",
            "model": "x",
        },
        team_manager=team,
        session=session,
    )
    data = json.loads(raw)
    assert data.get("ok") is False
    assert data.get("error") == "provider_session_blocked"
    team.spawn_subagent.assert_not_called()
