"""Smoke tests for group_progress structured tool-step fields.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.events import EventType
from agenticx.runtime.group_router import GroupChatRouter, GroupReply
from agenticx.runtime.group_context import GroupChatContext
from agenticx.cli.studio import StudioSession


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
    assert reply.confirm_context == {}
    assert reply.clarify_options == []
    assert reply.clarify_allow_free_text is True


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


def test_progress_text_emits_clarification_prompt() -> None:
    text = GroupChatRouter._runtime_event_to_progress_text(
        EventType.CLARIFICATION_REQUIRED.value,
        {"id": "clr_1", "prompt": "飞机叫什么名字？", "options": ["红鹰", "蓝燕"]},
    )
    assert text == "飞机叫什么名字？"
    mapped = GroupChatRouter._runtime_event_to_group_event_type(
        EventType.CLARIFICATION_REQUIRED.value
    )
    assert mapped == "group_clarification"


def test_progress_text_clarification_fallback_when_prompt_empty() -> None:
    text = GroupChatRouter._runtime_event_to_progress_text(
        EventType.CLARIFICATION_REQUIRED.value,
        {"id": "clr_2"},
    )
    assert text == "等待你的输入后继续"


def test_should_enqueue_hitl_even_when_progress_empty() -> None:
    assert GroupChatRouter._should_enqueue_runtime_event(
        EventType.CLARIFICATION_REQUIRED.value, ""
    )
    assert GroupChatRouter._should_enqueue_runtime_event(
        EventType.CONFIRM_REQUIRED.value, ""
    )
    assert not GroupChatRouter._should_enqueue_runtime_event(
        EventType.ROUND_START.value, ""
    )
    assert GroupChatRouter._should_enqueue_runtime_event(
        EventType.TOOL_CALL.value, "正在调用工具：web_search"
    )


def test_should_forward_hitl_even_when_content_empty() -> None:
    clarify = GroupReply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        content="",
        skipped=True,
        event_type="group_clarification",
    )
    blocked = GroupReply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        content="",
        skipped=True,
        event_type="group_blocked",
    )
    empty_progress = GroupReply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        content="",
        skipped=True,
        event_type="group_progress",
    )
    assert GroupChatRouter._should_forward_progress(clarify) is True
    assert GroupChatRouter._should_forward_progress(blocked) is True
    assert GroupChatRouter._should_forward_progress(empty_progress) is False


@pytest.mark.asyncio
async def test_group_blocked_forwards_structured_confirm_context(monkeypatch) -> None:
    from agenticx.runtime import group_router as group_router_module

    class _ConfirmRuntime:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        async def run_turn(self, *_args, **_kwargs):
            yield type(
                "Event",
                (),
                {
                    "type": EventType.CONFIRM_REQUIRED.value,
                    "data": {
                        "id": "confirm-high",
                        "question": "run?",
                        "context": {"tool": "bash_exec", "risk": "high"},
                    },
                },
            )()
            yield type(
                "Event",
                (),
                {"type": EventType.FINAL.value, "data": {"text": "done"}},
            )()

    monkeypatch.setattr(group_router_module, "AgentRuntime", _ConfirmRuntime)
    router = GroupChatRouter(
        avatar_registry=MagicMock(),
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    queue: asyncio.Queue[GroupReply] = asyncio.Queue()
    session = StudioSession(provider_name="fake", model_name="fake")
    session.scratchpad = {}

    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="G",
        avatar_id="meta",
        user_input="hi",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
        progress_queue=queue,
    )

    assert reply.content == "done"
    queued = [queue.get_nowait(), queue.get_nowait()]
    blocked = next(item for item in queued if item.event_type == "group_blocked")
    assert blocked.confirm_request_id == "confirm-high"
    assert blocked.confirm_context == {"tool": "bash_exec", "risk": "high"}


def _hitl_reply() -> GroupReply:
    return GroupReply(
        agent_id="av1",
        avatar_name="专家",
        avatar_url="",
        content="",
        skipped=True,
        event_type="group_clarification",
        confirm_request_id="clr_hitl",
    )


@pytest.mark.asyncio
async def test_stream_yields_empty_clarification_before_final() -> None:
    router = GroupChatRouter(
        avatar_registry=MagicMock(),
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    release = asyncio.Event()

    async def blocked_target(**kwargs):
        queue = kwargs.get("progress_queue")
        assert queue is not None
        queue.put_nowait(_hitl_reply())
        await release.wait()
        return GroupReply("av1", "专家", "", "done", False, event_type="group_reply")

    router._run_one_target = blocked_target  # type: ignore[assignment]
    session = MagicMock()
    session.scratchpad = {}

    agen = router._run_one_target_stream(
        base_session=session,
        context=MagicMock(),
        group_id="g1",
        group_name="G",
        avatar_id="av1",
        user_input="hi",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    first = await asyncio.wait_for(agen.__anext__(), timeout=2)
    assert first.event_type == "group_clarification"
    assert first.confirm_request_id == "clr_hitl"
    release.set()
    final = await asyncio.wait_for(agen.__anext__(), timeout=2)
    assert final.event_type == "group_reply"
    assert final.content == "done"
    await agen.aclose()


@pytest.mark.asyncio
async def test_parallel_routing_yields_empty_clarification_while_blocked() -> None:
    router = GroupChatRouter(
        avatar_registry=MagicMock(),
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    release = asyncio.Event()

    async def blocked_target(**kwargs):
        queue = kwargs.get("progress_queue")
        assert queue is not None
        queue.put_nowait(_hitl_reply())
        await release.wait()
        return GroupReply("av1", "专家", "", "done", False, event_type="group_reply")

    async def no_followups(**kwargs):
        if False:
            yield None

    router._run_one_target = blocked_target  # type: ignore[assignment]
    router._emit_mention_follow_ups = no_followups  # type: ignore[assignment]
    router.pick_targets = lambda **kwargs: ["av1"]  # type: ignore[method-assign]
    session = MagicMock()
    session.scratchpad = {}

    agen = router.run_group_turn(
        base_session=session,
        group_id="g1",
        group_name="G",
        routing="user-directed",
        group_avatar_ids=["av1"],
        mentioned_avatar_ids=[],
        user_input="hi",
        quoted_content="",
        should_stop=lambda: False,
    )
    first = await asyncio.wait_for(agen.__anext__(), timeout=2)
    assert first.event_type == "group_clarification"
    release.set()
    rest = []
    async for evt in agen:
        rest.append(evt)
    assert any(e.event_type == "group_reply" and e.content == "done" for e in rest)
