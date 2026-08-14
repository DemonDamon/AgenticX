#!/usr/bin/env python3
"""Smoke tests for the opt-in fresh_round_loop tool (G-004).

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime.fresh_round_loop import (
    HANDOFF_MAX_CHARS,
    MAX_ROUNDS_HARD,
    clamp_max_rounds,
    run_fresh_round_loop,
)
from agenticx.runtime.meta_tools import dispatch_meta_tool_async, visible_meta_agent_tools


PARENT_SENTINEL = "PARENT_HISTORY_SENTINEL_SHOULD_NOT_LEAK"


class _FakeTeamManager:
    def __init__(self, outputs: List[str]) -> None:
        self.outputs = list(outputs)
        self.calls: List[Dict[str, Any]] = []
        self._agents: Dict[str, Any] = {}
        self._archived_agents: Dict[str, Any] = {}
        self._tasks: Dict[str, Any] = {}

    async def spawn_subagent(self, **kwargs: Any) -> Dict[str, Any]:
        self.calls.append(dict(kwargs))
        idx = len(self.calls) - 1
        agent_id = f"sa-fake-{idx}"
        text = self.outputs[min(idx, len(self.outputs) - 1)] if self.outputs else ""
        self._agents[agent_id] = type("Ctx", (), {"final_text": text})()
        return {"ok": True, "agent_id": agent_id, "final_text": text}


def _handoff(status: str, summary: str, **extra: Any) -> str:
    payload = {
        "status": status,
        "summary": summary,
        "evidence": extra.get("evidence", ["ok"]),
        "next_steps": extra.get("next_steps", []),
        "blocker": extra.get("blocker", ""),
    }
    return "done\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```"


async def test_two_rounds_complete() -> None:
    tm = _FakeTeamManager(
        [
            _handoff("continue", "round-1-summary"),
            _handoff("complete", "round-2-done"),
        ]
    )
    session = StudioSession()
    session.agent_messages = [{"role": "user", "content": PARENT_SENTINEL}]
    session.chat_history = [{"role": "user", "content": PARENT_SENTINEL}]
    result = await run_fresh_round_loop(
        team_manager=tm,
        session=session,
        objective="finish the audit",
        workspace_dir="/tmp/ws",
        max_rounds=8,
    )
    assert result["status"] == "complete"
    assert result["rounds_started"] == 2
    assert PARENT_SENTINEL not in tm.calls[1]["task"]
    assert "round-1-summary" in tm.calls[1]["task"]
    assert all(c.get("inherit_parent_context") is False for c in tm.calls)
    assert PARENT_SENTINEL not in (tm.calls[0].get("system_prompt") or "")


async def test_oversized_handoff_retries_then_blocks() -> None:
    huge = {
        "status": "continue",
        "summary": "x" * (HANDOFF_MAX_CHARS + 50),
        "evidence": [],
        "next_steps": [],
        "blocker": "",
    }
    blob = json.dumps(huge, ensure_ascii=False)
    tm = _FakeTeamManager([blob, blob])
    result = await run_fresh_round_loop(
        team_manager=tm,
        session=StudioSession(),
        objective="obj",
        workspace_dir="/tmp/ws",
        max_rounds=4,
    )
    assert result["status"] == "blocked"
    assert len(tm.calls) == 2
    assert result["report"]["summary"] == huge["summary"]
    assert len(result["report"]["summary"]) > HANDOFF_MAX_CHARS


async def test_budget_limited() -> None:
    tm = _FakeTeamManager([_handoff("continue", "again")])
    result = await run_fresh_round_loop(
        team_manager=tm,
        session=StudioSession(),
        objective="obj",
        workspace_dir="/tmp/ws",
        max_rounds=3,
    )
    assert result["status"] == "budget_limited"
    assert result["rounds_started"] == 3


def test_max_rounds_clamped() -> None:
    assert clamp_max_rounds(999) == MAX_ROUNDS_HARD


def test_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_FRESH_ROUND_LOOP", raising=False)
    names = {
        str((t.get("function") or {}).get("name", ""))
        for t in visible_meta_agent_tools()
    }
    assert "fresh_round_loop" not in names


async def test_dispatch_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_FRESH_ROUND_LOOP", raising=False)
    raw = await dispatch_meta_tool_async(
        "fresh_round_loop",
        {"objective": "x", "workspace_dir": "/tmp/ws"},
        team_manager=_FakeTeamManager([]),
        session=StudioSession(),
    )
    payload = json.loads(raw)
    assert payload["ok"] is False
    assert payload["error"] == "disabled"
