"""Smoke tests for group_progress structured tool-step fields.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.events import EventType
from agenticx.runtime.group_router import GroupChatRouter, GroupReply


def test_group_reply_defaults_new_fields_empty() -> None:
    reply = GroupReply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        content="hello",
    )
    assert reply.graph_run_id == ""
    assert reply.graph_node_id == ""
    assert reply.tool_name == ""
    assert reply.tool_phase == ""
    assert reply.tool_call_id == ""


def test_runtime_event_to_tool_step_phases() -> None:
    calling = GroupChatRouter._runtime_event_to_tool_step(
        EventType.TOOL_CALL.value,
        {"name": "web_search", "id": "call_1"},
    )
    assert calling == {
        "tool_name": "web_search",
        "tool_phase": "calling",
        "tool_call_id": "call_1",
    }

    done = GroupChatRouter._runtime_event_to_tool_step(
        EventType.TOOL_RESULT.value,
        {"tool_name": "web_search", "tool_call_id": "call_1"},
    )
    assert done == {
        "tool_name": "web_search",
        "tool_phase": "done",
        "tool_call_id": "call_1",
    }

    assert GroupChatRouter._runtime_event_to_tool_step(EventType.ROUND_START.value, {}) == {}
    assert GroupChatRouter._runtime_event_to_tool_step(EventType.FINAL.value, {"text": "ok"}) == {}


def test_graph_node_id_for_agent_normalization() -> None:
    assert GroupChatRouter._graph_node_id_for_agent("12e6fedc069f") == "agent:12e6fedc069f"
    assert GroupChatRouter._graph_node_id_for_agent("agent:12e6fedc069f") == "agent:12e6fedc069f"
    assert GroupChatRouter._graph_node_id_for_agent("") == ""


def test_progress_text_omits_tool_result_preview() -> None:
    text = GroupChatRouter._runtime_event_to_progress_text(
        EventType.TOOL_RESULT.value,
        {"name": "web_search", "result": "x" * 500},
    )
    assert text == "工具已完成：web_search"
    assert len(text) < 40


def test_progress_text_omits_tool_call_args() -> None:
    text = GroupChatRouter._runtime_event_to_progress_text(
        EventType.TOOL_CALL.value,
        {"name": "web_search", "arguments": {"q": "minimax h3" * 40}},
    )
    assert text == "正在调用工具：web_search"
    assert "{" not in text
