#!/usr/bin/env python3
"""Tests for Meta-Agent tool dispatchers."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime.meta_tools import dispatch_meta_tool_async
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.team_manager import AgentTeamManager


class _FakeResponse:
    def __init__(self, content: str, tool_calls):
        self.content = content
        self.tool_calls = tool_calls


class _QuickTextLLM:
    def invoke(self, *_args, **_kwargs):
        return _FakeResponse("done", [])

    def stream(self, *_args, **_kwargs):
        yield "ok"


def test_meta_tools_spawn_query_cancel_and_resource_check() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )

        spawn_raw = await dispatch_meta_tool_async(
            "spawn_subagent",
            {"name": "编码员", "role": "coder", "task": "写一个 demo"},
            team_manager=manager,
        )
        spawn_data = json.loads(spawn_raw)
        assert spawn_data["ok"] is True
        agent_id = spawn_data["agent_id"]

        query_raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {"agent_id": agent_id},
            team_manager=manager,
        )
        query_data = json.loads(query_raw)
        assert query_data["ok"] is True
        assert query_data["subagent"]["agent_id"] == agent_id

        resource_raw = await dispatch_meta_tool_async(
            "check_resources",
            {},
            team_manager=manager,
        )
        resource_data = json.loads(resource_raw)
        assert resource_data["ok"] is True
        assert "check" in resource_data

        cancel_raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": agent_id},
            team_manager=manager,
        )
        cancel_data = json.loads(cancel_raw)
        assert cancel_data["ok"] is True

    asyncio.run(_run())


def test_meta_tools_list_skills_and_mcps() -> None:
    async def _run() -> None:
        session = StudioSession()
        session.mcp_configs = {
            "github": SimpleNamespace(command="npx", args=["-y", "@modelcontextprotocol/server-github"])
        }
        session.connected_servers = {"github"}

        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
        )

        skills_raw = await dispatch_meta_tool_async(
            "list_skills",
            {},
            team_manager=manager,
            session=session,
        )
        skills_data = json.loads(skills_raw)
        assert skills_data["ok"] is True
        assert isinstance(skills_data.get("skills"), list)

        mcps_raw = await dispatch_meta_tool_async(
            "list_mcps",
            {},
            team_manager=manager,
            session=session,
        )
        mcps_data = json.loads(mcps_raw)
        assert mcps_data["ok"] is True
        assert mcps_data["count"] == 1
        assert mcps_data["connected_count"] == 1
        assert mcps_data["servers"][0]["name"] == "github"
        assert mcps_data["servers"][0]["connected"] is True
        assert "args" not in mcps_data["servers"][0]

    asyncio.run(_run())


def test_meta_tools_retry_subagent() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        spawn_raw = await dispatch_meta_tool_async(
            "spawn_subagent",
            {"name": "研究员", "role": "researcher", "task": "先执行一次"},
            team_manager=manager,
        )
        spawn_data = json.loads(spawn_raw)
        assert spawn_data["ok"] is True
        original_id = spawn_data["agent_id"]

        # Wait the quick sub-agent to leave running state.
        for _ in range(40):
            status = manager.get_status(original_id)
            if status.get("ok") and status.get("subagent", {}).get("status") != "running":
                break
            await asyncio.sleep(0.05)

        retry_raw = await dispatch_meta_tool_async(
            "retry_subagent",
            {"agent_id": original_id, "task": "基于失败信息重试"},
            team_manager=manager,
        )
        retry_data = json.loads(retry_raw)
        assert retry_data["ok"] is True
        assert retry_data["agent_id"] == original_id
        assert retry_data.get("retried") is True

    asyncio.run(_run())


def test_delegate_to_avatar_missing_args_is_skipped() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        raw = await dispatch_meta_tool_async(
            "delegate_to_avatar",
            {},
            team_manager=manager,
        )
        data = json.loads(raw)
        assert data["ok"] is True
        assert data["skipped"] is True
        assert data["reason"] == "missing_args"

    asyncio.run(_run())


def _delegation_session(owner_session_id: str, run_id: str) -> tuple[StudioSession, Any]:
    session = StudioSession()
    session._owner_session_id = owner_session_id
    managed = SimpleNamespace(
        archived=False,
        session_id="avatar-session-1",
        avatar_id="avatar-1",
        avatar_name="Coder",
        _delegation_info={
            "delegation_id": run_id,
            "task": "long task",
            "from_session": owner_session_id,
            "status": "running",
            "avatar_id": "avatar-1",
            "avatar_name": "Coder",
            "avatar_session_id": "avatar-session-1",
        },
        _delegation_cancel_event=asyncio.Event(),
    )
    session._session_manager = SimpleNamespace(
        _sessions={"avatar-session-1": managed},
    )
    return session, managed


def test_cancel_delegation_updates_run_store(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "cancel-owner"
    run_id = "dlg-cancel-1"
    SubAgentRunStore(owner_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Coder",
        role="Engineer",
        task="long task",
        status="running",
        avatar_id="avatar-1",
        avatar_session_id="avatar-session-1",
    )

    async def _run() -> None:
        session, managed = _delegation_session(owner_id, run_id)
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id=owner_id,
        )
        raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": run_id},
            team_manager=manager,
            session=session,
        )
        assert json.loads(raw)["status"] == "cancelled"
        assert managed._delegation_cancel_event.is_set()
        record = SubAgentRunStore(owner_id).get_run(run_id)
        assert record is not None
        assert record.status == "cancelled"
        assert record.completed_at is not None

    asyncio.run(_run())


@pytest.mark.parametrize("failure_stage", ["open", "update"])
def test_cancel_delegation_reports_partial_success_when_ledger_write_fails(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = f"cancel-partial-{failure_stage}"
    run_id = f"dlg-cancel-partial-{failure_stage}"
    if failure_stage == "update":
        SubAgentRunStore(owner_id).open_run(
            run_id=run_id,
            kind="delegate",
            name="Coder",
            role="Engineer",
            task="long task",
            status="running",
        )

    def _raise_write_error(*args: Any, **kwargs: Any) -> None:
        del args, kwargs
        raise OSError(f"cannot write {tmp_path}")

    if failure_stage == "open":
        monkeypatch.setattr(SubAgentRunStore, "open_run", _raise_write_error)
    else:
        monkeypatch.setattr(SubAgentRunStore, "update_status", _raise_write_error)

    async def _run() -> None:
        session, managed = _delegation_session(owner_id, run_id)
        delegation_task = asyncio.create_task(asyncio.sleep(60))
        managed._delegation_task = delegation_task
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id=owner_id,
        )

        raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": run_id},
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        await asyncio.sleep(0)

        assert payload == {
            "ok": False,
            "partial": True,
            "cancelled": True,
            "agent_id": run_id,
            "status": "cancelled",
            "error": "ledger_update_failed",
            "message": "delegation cancelled but run ledger update failed",
        }
        assert str(tmp_path) not in raw
        assert managed._delegation_cancel_event.is_set()
        assert delegation_task.cancelled()
        assert managed._delegation_info["status"] == "cancelled"

    asyncio.run(_run())


def test_cancel_delegation_is_idempotent(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "cancel-owner"
    run_id = "dlg-cancel-2"
    SubAgentRunStore(owner_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Coder",
        role="Engineer",
        task="long task",
        status="running",
    )

    async def _run() -> None:
        session, _managed = _delegation_session(owner_id, run_id)
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id=owner_id,
        )
        for _ in range(2):
            raw = await dispatch_meta_tool_async(
                "cancel_subagent",
                {"agent_id": run_id},
                team_manager=manager,
                session=session,
            )
            assert json.loads(raw)["status"] == "cancelled"
        record = SubAgentRunStore(owner_id).get_run(run_id)
        assert record is not None
        statuses = [item["status"] for item in record.status_history]
        assert statuses == ["running", "cancelled"]

    asyncio.run(_run())


def test_cancel_delegation_never_crosses_owner_session(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    caller_owner_id = "owner-a"
    target_owner_id = "owner-b"
    run_id = "dlg-other-owner"
    SubAgentRunStore(target_owner_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Other Coder",
        role="Engineer",
        task="private task",
        status="running",
    )

    async def _run() -> None:
        session, managed = _delegation_session(target_owner_id, run_id)
        session._owner_session_id = caller_owner_id
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id=caller_owner_id,
        )
        raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": run_id},
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert payload["error"] == "not_found"
        assert managed._delegation_cancel_event.is_set() is False
        record = SubAgentRunStore(target_owner_id).get_run(run_id)
        assert record is not None
        assert record.status == "running"

    asyncio.run(_run())


def test_cancel_spawn_still_uses_team_manager() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        spawn = await manager.spawn_subagent(
            name="Worker",
            role="worker",
            task="wait",
        )
        raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": spawn["agent_id"]},
            team_manager=manager,
        )
        assert json.loads(raw)["ok"] is True
        assert manager.get_status(spawn["agent_id"])["subagent"]["status"] == "cancelled"

    asyncio.run(_run())


def test_cancel_unknown_run_keeps_existing_not_found_contract() -> None:
    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
        )
        raw = await dispatch_meta_tool_async(
            "cancel_subagent",
            {"agent_id": "missing-run"},
            team_manager=manager,
        )
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert payload["error"] == "not_found"
        assert payload["message"] == "未找到子智能体: missing-run"

    asyncio.run(_run())


def _seed_query_run(owner_id: str, run_id: str, status: str = "completed") -> None:
    SubAgentRunStore(owner_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Ledger Worker",
        role="worker",
        task="ledger task",
        status=status,
    )


def test_query_subagent_status_prefers_ledger_over_stale_scratchpad(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "query-owner"
    run_id = "dlg-ledger-wins"
    _seed_query_run(owner_id, run_id)
    session = StudioSession()
    session.scratchpad[f"subagent_result::{run_id}"] = "stale result"

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id=owner_id,
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {"agent_id": run_id},
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        assert payload["ok"] is True
        assert payload["subagent"]["source"] == "ledger"
        assert payload["subagent"]["status"] == "completed"

    asyncio.run(_run())


def test_query_subagent_status_lists_cold_start_runs(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "query-owner"
    _seed_query_run(owner_id, "dlg-cold-list")

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=owner_id,
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {},
            team_manager=manager,
        )
        payload = json.loads(raw)
        assert [row["run_id"] for row in payload["subagents"]] == ["dlg-cold-list"]

    asyncio.run(_run())


def test_query_subagent_status_marks_legacy_fallback() -> None:
    session = StudioSession()
    session.scratchpad["subagent_result::legacy-run"] = "legacy result"

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id="legacy-owner",
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {},
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        assert payload["subagents"][0]["source"] == "legacy_fallback"

    asyncio.run(_run())


def test_query_subagent_status_deduplicates_legacy_keys_by_run_id() -> None:
    session = StudioSession()
    session.scratchpad["subagent_result::legacy-same"] = "spawn result"
    session.scratchpad["delegation_result::legacy-same"] = "delegation result"

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=session,
            owner_session_id="legacy-dedup-owner",
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {},
            team_manager=manager,
            session=session,
        )
        payload = json.loads(raw)
        assert len(payload["subagents"]) == 1
        assert payload["subagents"][0]["run_id"] == "legacy-same"
        assert payload["summary"]["total"] == 1

    asyncio.run(_run())


def test_query_subagent_status_never_crosses_owner_session() -> None:
    async def _run() -> None:
        other_manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id="other-owner",
        )
        spawned = await other_manager.spawn_subagent(
            name="Other Worker",
            role="worker",
            task="other task",
        )
        owner_manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id="query-owner-isolated",
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {"agent_id": spawned["agent_id"]},
            team_manager=owner_manager,
        )
        payload = json.loads(raw)
        assert payload["ok"] is False
        assert payload["error"] == "not_found"

    asyncio.run(_run())


@pytest.mark.parametrize("query", ["run-query-alias", "Query Worker", "avatar-query-alias"])
def test_query_subagent_status_supports_same_owner_legacy_lookup_keys(
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
    query: str,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = "query-alias-owner"
    SubAgentRunStore(owner_id).open_run(
        run_id="run-query-alias",
        kind="delegate",
        name="Query Worker",
        role="worker",
        task="query task",
        status="running",
        avatar_id="avatar-query-alias",
    )

    async def _run() -> None:
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=owner_id,
        )
        raw = await dispatch_meta_tool_async(
            "query_subagent_status",
            {"agent_id": query},
            team_manager=manager,
        )
        payload = json.loads(raw)
        assert payload["ok"] is True
        assert payload["subagent"]["run_id"] == "run-query-alias"

    asyncio.run(_run())
