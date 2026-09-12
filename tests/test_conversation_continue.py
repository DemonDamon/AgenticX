#!/usr/bin/env python3
"""Tests for conversation-level continue-from-message.

Author: Damon Li
"""

from __future__ import annotations

import asyncio

import pytest

from agenticx.cli import agent_tools
from agenticx.studio.conversation_continue import (
    ConversationContinueError,
    should_prompt_shared_write,
    slice_transcript_for_continue,
)
from agenticx.studio.session_manager import SessionManager


def _three_rounds() -> tuple[list[dict], list[dict]]:
    chat = [
        {"id": "u1", "role": "user", "content": "q1"},
        {"id": "a1", "role": "assistant", "content": "r1"},
        {"id": "u2", "role": "user", "content": "q2"},
        {"id": "a2", "role": "assistant", "content": "r2"},
        {"id": "u3", "role": "user", "content": "q3"},
        {"id": "a3", "role": "assistant", "content": "r3"},
    ]
    agents = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "r1"},
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "r2"},
        {"role": "user", "content": "q3"},
        {"role": "assistant", "content": "r3"},
    ]
    return chat, agents


def test_slice_from_assistant_keeps_prefix_only() -> None:
    chat, agents = _three_rounds()
    chat_prefix, agent_prefix = slice_transcript_for_continue(chat, agents, "a1")
    assert [row["id"] for row in chat_prefix] == ["u1", "a1"]
    assert [row["content"] for row in agent_prefix] == ["q1", "r1"]


def test_slice_from_user_drops_later_answer() -> None:
    chat, agents = _three_rounds()
    chat_prefix, agent_prefix = slice_transcript_for_continue(chat, agents, "u2")
    assert [row["id"] for row in chat_prefix] == ["u1", "a1", "u2"]
    assert [row["content"] for row in agent_prefix] == ["q1", "r1", "q2"]


def test_slice_keeps_full_tool_chain_for_assistant_cut() -> None:
    chat = [
        {"id": "u1", "role": "user", "content": "q1"},
        {"id": "a1", "role": "assistant", "content": "r1"},
        {"id": "u2", "role": "user", "content": "q2"},
    ]
    agents = [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "r1"},
        {"role": "user", "content": "q2"},
        {
            "role": "assistant",
            "content": "run tools",
            "tool_calls": [{"id": "c1"}, {"id": "c2"}],
        },
        {"role": "tool", "tool_call_id": "c1", "content": "ok1"},
        {"role": "tool", "tool_call_id": "c2", "content": "ok2"},
        {"role": "assistant", "content": "done"},
    ]
    chat_with_cut = chat + [{"id": "a2", "role": "assistant", "content": "done"}]
    chat_prefix, agent_prefix = slice_transcript_for_continue(
        chat_with_cut, agents, "a2"
    )
    assert chat_prefix[-1]["id"] == "a2"
    assert "c1" in str(agent_prefix) and "c2" in str(agent_prefix)
    assert not any(
        row.get("role") == "user" and row.get("content") == "q3" for row in agent_prefix
    )


def test_slice_rejects_tool_rows_and_unknown_ids() -> None:
    chat, agents = _three_rounds()
    chat_with_tool = chat + [{"id": "t1", "role": "tool", "content": "x"}]
    with pytest.raises(ConversationContinueError) as exc:
        slice_transcript_for_continue(chat_with_tool, agents, "t1")
    assert exc.value.code == "message_not_continueable"
    with pytest.raises(ConversationContinueError) as exc:
        slice_transcript_for_continue(chat, agents, "missing")
    assert exc.value.code == "message_not_found"


def _persisted_session_without_ids() -> tuple[list[dict], list[dict]]:
    """Shape of ~/.agenticx/sessions/<id>/messages.json: no top-level id."""
    chat = [
        {
            "role": "user",
            "content": "你好",
            "metadata": {"client_turn_id": "44f4e8df-791b-4a94-bd55-75b5bec7a71e"},
            "timestamp": 1789203156168,
        },
        {
            "role": "assistant",
            "content": "你好，团长。我在。",
            "timestamp": 1789203158939,
        },
    ]
    agents = [
        {"role": "user", "content": "你好", "metadata": {"client_turn_id": "44f4e8df-791b-4a94-bd55-75b5bec7a71e"}},
        {"role": "assistant", "content": "你好，团长。我在。"},
    ]
    return chat, agents


def test_slice_resolves_desktop_loaded_index_when_history_has_no_id() -> None:
    chat, agents = _persisted_session_without_ids()
    sid = "4d3ece4b-9ef0-4298-9a69-e34f6546442d"
    chat_prefix, agent_prefix = slice_transcript_for_continue(
        chat, agents, f"{sid}-i1"
    )
    assert [row["role"] for row in chat_prefix] == ["user", "assistant"]
    assert [row["content"] for row in agent_prefix] == ["你好", "你好，团长。我在。"]


def test_slice_resolves_client_turn_id_when_history_has_no_id() -> None:
    chat, agents = _persisted_session_without_ids()
    chat_prefix, agent_prefix = slice_transcript_for_continue(
        chat, agents, "44f4e8df-791b-4a94-bd55-75b5bec7a71e"
    )
    assert [row["role"] for row in chat_prefix] == ["user"]
    assert [row["content"] for row in agent_prefix] == ["你好"]


def test_continue_session_drops_isolate_and_slices() -> None:
    manager = SessionManager()
    source = manager.create(session_id="continue-source")
    chat, agents = _three_rounds()
    source.studio_session.chat_history = chat
    source.studio_session.agent_messages = agents
    source.studio_session.scratchpad = {
        "isolate_json": '{"worktree": "/tmp/x"}',
        "run_branch_lineage": {"parent_run_id": "r"},
    }
    source.studio_session.workspace_dir = "/tmp/work"

    forked = manager.continue_session_from_message("continue-source", "a1")

    assert [row.get("id") for row in forked.studio_session.chat_history] == [
        "u1",
        "a1",
    ]
    assert forked.studio_session.agent_messages == [
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "r1"},
    ]
    assert "isolate_json" not in forked.studio_session.scratchpad
    assert "run_branch_lineage" not in forked.studio_session.scratchpad
    lineage = forked.studio_session.scratchpad["conversation_lineage"]
    assert lineage["parent_session_id"] == "continue-source"
    assert lineage["source_message_id"] == "a1"
    assert lineage["workspace_mode"] == "shared_current"
    assert not any(row.get("system_notice") for row in forked.studio_session.chat_history)
    source.session_name = "你好"
    named = manager.continue_session_from_message("continue-source", "a1")
    assert named.session_name == "你好"
    listed = next(
        row
        for row in manager.list_sessions()
        if row.get("session_id") == named.session_id
    )
    assert listed.get("parent_session_id") == "continue-source"
    # Source stays intact.
    assert len(source.studio_session.chat_history) == 6


def test_fork_session_still_copies_whole_transcript() -> None:
    manager = SessionManager()
    source = manager.create(session_id="fork-source")
    chat, agents = _three_rounds()
    source.studio_session.chat_history = chat
    source.studio_session.agent_messages = agents

    forked = manager.fork_session("fork-source")
    assert forked is not None
    assert len(forked.studio_session.chat_history) == 6
    assert len(forked.studio_session.agent_messages) == 6


def test_shared_write_prompt_predicate() -> None:
    class _Session:
        scratchpad = {
            "conversation_lineage": {
                "kind": "conversation",
                "workspace_mode": "shared_current",
                "shared_write_prompted": False,
            }
        }

    assert should_prompt_shared_write(_Session(), "file_write", "local_write") is True
    assert should_prompt_shared_write(_Session(), "file_read", "read") is False

    prompted = _Session()
    prompted.scratchpad["conversation_lineage"]["shared_write_prompted"] = True
    assert should_prompt_shared_write(prompted, "file_write", "local_write") is False

    class _Plain:
        scratchpad = {}

    assert should_prompt_shared_write(_Plain(), "file_write", "local_write") is False


class _BranchSession:
    def __init__(self, workspace_dir: str = "/tmp/work") -> None:
        self.workspace_dir = workspace_dir
        self.scratchpad = {
            "conversation_lineage": {
                "kind": "conversation",
                "parent_session_id": "source",
                "source_message_id": "a1",
                "workspace_mode": "shared_current",
                "shared_write_prompted": False,
            }
        }


class _ChoiceGate:
    def __init__(self, choice: str) -> None:
        self.choice = choice
        self.calls: list[dict] = []

    async def request_clarification(
        self, prompt, *, options=None, allow_free_text=True, context=None
    ):
        self.calls.append({"prompt": prompt, "options": list(options or [])})
        return {"selected_options": [self.choice], "answer_text": ""}


def test_shared_write_guard_read_only_never_prompts() -> None:
    gate = _ChoiceGate("取消")
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_read", {"path": "/tmp/x"}, _BranchSession(), clarify_gate=gate
        )
    )
    assert result is None
    assert gate.calls == []


def test_shared_write_guard_shared_choice_stops_asking() -> None:
    session = _BranchSession()
    gate = _ChoiceGate("继续共用当前工作区")
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=gate,
        )
    )
    assert result is None
    assert session.scratchpad["conversation_lineage"]["shared_write_prompted"] is True
    gate2 = _ChoiceGate("取消")
    again = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=gate2,
        )
    )
    assert again is None
    assert gate2.calls == []


def test_shared_write_guard_cancel_stops_tool() -> None:
    gate = _ChoiceGate("取消")
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            _BranchSession(),
            clarify_gate=gate,
        )
    )
    assert isinstance(result, str) and result.startswith("ERROR")
    assert "取消" in result


def test_shared_write_guard_unattended_never_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agenticx.cli.agent_tools import AutoSuspendClarifyGate

    gate = _ChoiceGate("取消")
    session = _BranchSession()
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=AutoSuspendClarifyGate(),
            is_unattended=True,
        )
    )
    assert result is None
    assert gate.calls == []
    assert session.scratchpad["conversation_lineage"]["shared_write_prompted"] is True


def test_shared_write_guard_isolate_switches_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import agenticx.runtime.isolate_run as isolate_run

    monkeypatch.setattr(
        isolate_run, "find_git_root", lambda start: start if str(start).strip() else None
    )

    created: dict = {}

    def fake_ensure(session, *, isolate_run, is_automation):
        created["called"] = True
        from agenticx.runtime.isolate_run import save_isolate_state

        save_isolate_state(
            session,
            {
                "run_id": "r",
                "repo_root": "/tmp/work",
                "worktree": "/tmp/iso",
                "branch": "b",
                "start_sha": "s",
            },
        )
        return {"active": True, "worktree": "/tmp/iso"}

    monkeypatch.setattr(isolate_run, "ensure_isolate", fake_ensure)
    session = _BranchSession()
    gate = _ChoiceGate("创建隔离副本")
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=gate,
        )
    )
    assert result is None
    assert created.get("called") is True
    assert session.scratchpad["conversation_lineage"]["workspace_mode"] == "isolated"
    # Isolated branches never prompt again.
    gate2 = _ChoiceGate("取消")
    again = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=gate2,
        )
    )
    assert again is None
    assert gate2.calls == []


def test_shared_write_guard_hides_isolate_when_not_git(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import agenticx.runtime.isolate_run as isolate_run

    monkeypatch.setattr(isolate_run, "find_git_root", lambda start: None)
    session = _BranchSession()
    gate = _ChoiceGate("继续共用当前工作区")
    result = asyncio.run(
        agent_tools._maybe_guard_shared_workspace_write(
            "file_write",
            {"path": "/tmp/x", "content": "hi"},
            session,
            clarify_gate=gate,
        )
    )
    assert result is None
    assert gate.calls and "创建隔离副本" not in gate.calls[0]["options"]


def test_listed_parent_skips_scratchpad_when_metadata_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = SessionManager()

    def _boom(_sid: str) -> dict:
        raise AssertionError("listing must not load scratchpad per session")

    monkeypatch.setattr(manager._session_store, "_load_scratchpad_sync", _boom)
    assert manager._resolve_listed_parent_session_id("s1", {"session_name": "你好"}) == ""
    assert (
        manager._resolve_listed_parent_session_id(
            "s1", {"parent_session_id": "parent-1"}
        )
        == "parent-1"
    )

    monkeypatch.setattr(
        manager._session_store,
        "_load_scratchpad_sync",
        lambda _sid: {
            "conversation_lineage": {
                "kind": "conversation",
                "parent_session_id": "parent-2",
            }
        },
    )
    assert manager._resolve_listed_parent_session_id("s1", {}) == "parent-2"
