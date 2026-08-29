#!/usr/bin/env python3
"""Smoke tests: group-chat floor control, short-reply contract, evidence gate.

钉住控制室发言权：单人专业答、未 @ / 执行型 Near 主答走 runtime、静默 skip、
无公开催人、无证据不得声称完成。

Author: Damon Li
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_router import (
    META_LEADER_AGENT_ID,
    GroupChatRouter,
    GroupReply,
    IntentDecision,
    _group_chat_tools,
    _looks_like_completion_claim,
    _looks_like_deferred_promise,
    _looks_like_execution_request,
    _looks_like_search_claim,
    _tool_result_succeeded,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_avatar(name: str, role: str = "成员") -> MagicMock:
    avatar = MagicMock()
    avatar.name = name
    avatar.role = role
    return avatar


def _make_router_with_spies(avatar_ids: list[str] | None = None) -> GroupChatRouter:
    ids = avatar_ids or ["a1", "a2", "a3"]
    avatars = {aid: _make_avatar(aid) for aid in ids}
    registry = MagicMock()
    registry.get_avatar = MagicMock(side_effect=lambda aid: avatars.get(str(aid)))
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    router._project_h2a_fanout = MagicMock(return_value=[])  # type: ignore[assignment]
    return router


def _make_session(avatar_ids: list[str] | None = None) -> MagicMock:
    sess = MagicMock()
    sess.session_id = "control-plane-session"
    sess._session_id = "control-plane-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = avatar_ids or ["a1", "a2", "a3"]
    return sess


def _reply(
    agent_id: str,
    content: str,
    *,
    skipped: bool = False,
    event_type: str = "group_reply",
    successful_tool_results: int = 0,
) -> GroupReply:
    return GroupReply(
        agent_id=agent_id,
        avatar_name=agent_id,
        avatar_url="",
        content=content,
        skipped=skipped,
        event_type=event_type,
        successful_tool_results=successful_tool_results,
    )


def _install_turn_stubs(
    router: GroupChatRouter,
    *,
    decision: IntentDecision,
    stream_by_id: dict[str, GroupReply],
    meta_reply: GroupReply | None = None,
    stream_order: list[str] | None = None,
    extra_instructions: list[str] | None = None,
    stream_kwargs: list[dict] | None = None,
) -> None:
    async def _stub_analyze_intent(**kwargs):
        return decision

    async def _stub_one_target_stream(**kwargs):
        aid = str(kwargs.get("avatar_id") or "")
        if stream_order is not None:
            stream_order.append(aid)
        if stream_kwargs is not None:
            stream_kwargs.append(dict(kwargs))
        yield stream_by_id.get(aid, _reply(aid, "", skipped=True, event_type="group_skipped"))

    async def _stub_meta_pm(**kwargs):
        if extra_instructions is not None:
            extra_instructions.append(str(kwargs.get("extra_instruction") or ""))
        return meta_reply or _reply(META_LEADER_AGENT_ID, "目前缺一份可执行的输入。")

    async def _stub_team_turn(**kwargs):
        if False:
            yield _reply("x", "")
        return

    router._analyze_intent = _stub_analyze_intent  # type: ignore[assignment]
    router._run_one_target_stream = _stub_one_target_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = _stub_meta_pm  # type: ignore[assignment]
    router._run_team_turn = _stub_team_turn  # type: ignore[assignment]


async def _collect_turn(
    router: GroupChatRouter,
    *,
    avatar_ids: list[str],
    user_input: str = "解释一下 MCP",
    mentioned_avatar_ids: list[str] | None = None,
) -> list[GroupReply]:
    session = _make_session(avatar_ids)
    events: list[GroupReply] = []
    async for evt in router.run_group_turn(
        base_session=session,
        group_id="g-control-plane",
        group_name="Control Room",
        routing="intelligent",
        group_avatar_ids=avatar_ids,
        mentioned_avatar_ids=mentioned_avatar_ids or [],
        user_input=user_input,
        quoted_content="",
        should_stop=lambda: False,
    ):
        events.append(evt)
    return events


# ---------------------------------------------------------------------------
# FR-1: intent execution field
# ---------------------------------------------------------------------------

def test_looks_like_execution_request_markers() -> None:
    assert _looks_like_execution_request("解释一下 MCP") is False
    assert _looks_like_execution_request("查仓库并修复这个 bug") is True
    assert _looks_like_execution_request("进度如何") is False
    assert _looks_like_execution_request("帮我做一版方案") is True


def test_intent_decision_defaults_requires_execution_false() -> None:
    decision = IntentDecision("route_to", ["a1"], "legacy")
    assert decision.requires_execution is False


@pytest.mark.asyncio
async def test_analyze_intent_reads_requires_execution_true() -> None:
    router = _make_router_with_spies(["a1", "a2"])

    async def stub_llm(**kwargs):
        return (
            '{"action":"route_to","target_ids":["a1"],'
            '"requires_execution":true,"reason":"fix"}'
        )

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Control Room",
        group_avatar_ids=["a1", "a2"],
        user_input="查仓库并修复这个 bug",
        explicit_targets=[],
    )
    assert decision.action == "route_to"
    assert decision.target_ids == ["a1"]
    assert decision.requires_execution is True


@pytest.mark.asyncio
async def test_analyze_intent_respects_explicit_false() -> None:
    router = _make_router_with_spies(["a1", "a2"])

    async def stub_llm(**kwargs):
        return (
            '{"action":"route_to","target_ids":["a1"],'
            '"requires_execution":false,"reason":"explain"}'
        )

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Control Room",
        group_avatar_ids=["a1", "a2"],
        user_input="帮我做一版方案",
        explicit_targets=[],
    )
    assert decision.requires_execution is False


@pytest.mark.asyncio
async def test_analyze_intent_missing_field_uses_heuristic() -> None:
    router = _make_router_with_spies(["a1", "a2"])

    async def stub_llm(**kwargs):
        return '{"action":"route_to","target_ids":["a1"],"reason":"legacy"}'

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1", "a2"])
    decision = await router._analyze_intent(
        base_session=session,
        context=GroupChatContext(session),
        group_name="Control Room",
        group_avatar_ids=["a1", "a2"],
        user_input="查仓库并修复这个 bug",
        explicit_targets=[],
    )
    assert decision.action == "route_to"
    assert decision.target_ids == ["a1"]
    assert decision.requires_execution is True


# ---------------------------------------------------------------------------
# FR-2: floor control
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unnamed_route_to_calls_single_target() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("route_to", ["a1", "a2"], "duty"),
        stream_by_id={
            "a1": _reply("a1", "结论：用方案 A。"),
            "a2": _reply("a2", "不该上场"),
        },
        stream_order=stream_order,
    )
    events = await _collect_turn(router, avatar_ids=["a1", "a2"])
    assert stream_order == ["a1"]
    replies = [e for e in events if e.event_type == "group_reply"]
    assert [e.agent_id for e in replies] == ["a1"]


@pytest.mark.asyncio
async def test_explicit_double_mention_can_call_two() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("route_to", ["a1", "a2"], "explicit_mention"),
        stream_by_id={
            "a1": _reply("a1", "A 的结论"),
            "a2": _reply("a2", "B 的结论"),
        },
        stream_order=stream_order,
    )
    events = await _collect_turn(
        router,
        avatar_ids=["a1", "a2"],
        user_input="@A @B 一起看下许可证",
        mentioned_avatar_ids=["a1", "a2"],
    )
    assert stream_order == ["a1", "a2"]
    replies = [e for e in events if e.event_type == "group_reply"]
    assert {e.agent_id for e in replies} == {"a1", "a2"}


@pytest.mark.asyncio
async def test_open_floor_still_allows_two_candidates() -> None:
    router = _make_router_with_spies(["a1", "a2", "a3"])
    stream_order: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("open_floor", ["a1", "a2"], "chitchat"),
        stream_by_id={
            "a1": _reply("a1", "我来接一句"),
            "a2": _reply("a2", "", skipped=True, event_type="group_skipped"),
        },
        stream_order=stream_order,
    )
    await _collect_turn(router, avatar_ids=["a1", "a2", "a3"], user_input="你们平时怎么配合？")
    assert stream_order == ["a1", "a2"]


# ---------------------------------------------------------------------------
# FR-3: execution meta_direct must enter AgentRuntime
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_execution_meta_direct_uses_runtime() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    stream_order: list[str] = []
    extra_instructions: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision(
            "meta_direct",
            [],
            "coord",
            requires_execution=True,
        ),
        stream_by_id={
            META_LEADER_AGENT_ID: _reply(META_LEADER_AGENT_ID, "已经查了仓库。"),
        },
        stream_order=stream_order,
        extra_instructions=extra_instructions,
    )
    events = await _collect_turn(
        router,
        avatar_ids=["a1", "a2"],
        user_input="去仓库修复并跑测试",
    )
    assert stream_order == [META_LEADER_AGENT_ID]
    assert extra_instructions == []
    replies = [e for e in events if e.event_type == "group_reply"]
    assert replies[-1].agent_id == META_LEADER_AGENT_ID


@pytest.mark.asyncio
async def test_casual_meta_direct_uses_runtime() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    stream_order: list[str] = []
    extra_instructions: list[str] = []
    stream_kwargs: list[dict] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("meta_direct", [], "pm"),
        stream_by_id={
            META_LEADER_AGENT_ID: _reply(META_LEADER_AGENT_ID, "这是概念解释。"),
        },
        stream_order=stream_order,
        extra_instructions=extra_instructions,
        stream_kwargs=stream_kwargs,
    )
    events = await _collect_turn(router, avatar_ids=["a1", "a2"])
    assert stream_order == [META_LEADER_AGENT_ID]
    assert extra_instructions == []
    assert stream_kwargs
    assert "项目经理" in str(stream_kwargs[0].get("extra_instruction") or "")
    replies = [e for e in events if e.event_type == "group_reply"]
    assert replies[-1].content == "这是概念解释。"


# ---------------------------------------------------------------------------
# FR-4: execution evidence gate
# ---------------------------------------------------------------------------

def test_tool_result_succeeded_pure() -> None:
    assert _tool_result_succeeded({"success": True}) is True
    assert _tool_result_succeeded({}) is True
    assert _tool_result_succeeded({"success": False}) is False
    assert _tool_result_succeeded({"error": "boom"}) is False


def test_deferred_and_completion_markers() -> None:
    assert _looks_like_deferred_promise("等我回复") is True
    assert _looks_like_deferred_promise("稍等，我去处理") is True
    assert _looks_like_deferred_promise("后续给你") is True
    assert _looks_like_deferred_promise("完成后告诉你") is True
    assert _looks_like_deferred_promise("许可证是 MIT。") is False
    assert _looks_like_completion_claim("已修复") is True
    assert _looks_like_completion_claim("已经写入仓库") is True
    assert _looks_like_completion_claim("done") is True
    assert _looks_like_completion_claim("completed") is True
    assert _looks_like_completion_claim("这是概念解释。") is False
    assert _looks_like_search_claim("我搜了中英文多个来源，目前只是传闻") is True
    assert _looks_like_search_claim("查了一圈没有官方公告") is True
    assert _looks_like_search_claim("这是概念解释。") is False


@pytest.mark.asyncio
async def test_deferred_promise_without_evidence_is_replaced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "等我回复"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="去仓库修复并跑测试",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert "等我回复" not in reply.content
    assert "没有产生实际执行记录" in reply.content


@pytest.mark.asyncio
async def test_completion_claim_without_evidence_is_marked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "已修复"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="去仓库修复并跑测试",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert "已修复" in reply.content
    assert "完成状态未被确认" in reply.content
    assert reply.successful_tool_results == 0


@pytest.mark.asyncio
async def test_completion_claim_with_tool_success_is_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(
                type=EventType.TOOL_RESULT.value,
                data={"success": True, "tool_name": "bash_exec"},
            )
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "已修复"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="去仓库修复并跑测试",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert reply.content == "已修复"
    assert "未被确认" not in reply.content
    assert reply.successful_tool_results == 1


@pytest.mark.asyncio
async def test_plain_knowledge_answer_without_tools_is_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(
                type=EventType.FINAL.value,
                data={"text": "MCP 是模型调用外部工具的协议。"},
            )

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="解释一下 MCP",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert reply.content == "MCP 是模型调用外部工具的协议。"


@pytest.mark.asyncio
async def test_search_claim_without_web_search_is_marked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(
                type=EventType.FINAL.value,
                data={"text": "我搜了中英文多个来源，目前只是传闻。"},
            )

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="帮我看图判断这条收购是不是真的",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert "搜了中英文多个来源" in reply.content
    assert "检索陈述未被确认" in reply.content
    assert reply.successful_web_search is False


@pytest.mark.asyncio
async def test_search_claim_with_unrelated_tool_is_still_marked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(
                type=EventType.TOOL_RESULT.value,
                data={"name": "file_read", "success": True},
            )
            yield SimpleNamespace(
                type=EventType.FINAL.value,
                data={"text": "查了一圈没有官方公告。"},
            )

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="帮我看图判断这条收购是不是真的",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert "查了一圈" in reply.content
    assert "检索陈述未被确认" in reply.content
    assert reply.successful_tool_results == 1
    assert reply.successful_web_search is False


@pytest.mark.asyncio
async def test_search_claim_with_web_search_is_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _FakeRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(
                type=EventType.TOOL_RESULT.value,
                data={"name": "web_search", "success": True},
            )
            yield SimpleNamespace(
                type=EventType.FINAL.value,
                data={"text": "我搜了中英文多个来源，交割已经完成。"},
            )

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _FakeRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="帮我看图判断这条收购是不是真的",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert reply.content == "我搜了中英文多个来源，交割已经完成。"
    assert "检索陈述未被确认" not in reply.content
    assert reply.successful_web_search is True


def test_group_chat_tools_keep_web_search_and_tool_search() -> None:
    names = {
        str((tool.get("function") or {}).get("name") or "").strip()
        for tool in _group_chat_tools()
        if isinstance(tool, dict)
    }
    assert "web_search" in names
    assert "tool_search" in names
    assert "delegate_to_avatar" not in names


@pytest.mark.asyncio
async def test_group_target_binds_owner_session_and_web_search_prompt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, user_input, session, *args, **kwargs):
            captured["session_id"] = getattr(session, "_session_id", None)
            captured["usage_owner"] = getattr(session, "_usage_owner_session_id", None)
            captured["system_prompt"] = str(kwargs.get("system_prompt") or "")
            tool_names = {
                str((tool.get("function") or {}).get("name") or "").strip()
                for tool in (kwargs.get("tools") or [])
                if isinstance(tool, dict)
            }
            captured["tool_names"] = tool_names
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "短结论。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router_with_spies(["a1"])
    session = _make_session(["a1"])
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="musk 收购 cursor 是真的吗",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert captured["session_id"] == "control-plane-session"
    assert captured["usage_owner"] == "control-plane-session"
    prompt = str(captured["system_prompt"])
    assert "## 联网搜索" in prompt
    assert "web_search" in prompt
    assert "禁止假装检索" in prompt or "禁止声称" in prompt
    assert "web_search" in captured["tool_names"]
    assert "tool_search" in captured["tool_names"]


# ---------------------------------------------------------------------------
# FR-5: silent skip, no public nudge
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_route_to_all_skip_has_no_group_nudge() -> None:
    router = _make_router_with_spies(["a1", "a2"])
    extra_instructions: list[str] = []
    _install_turn_stubs(
        router,
        decision=IntentDecision("route_to", ["a1"], "duty"),
        stream_by_id={
            "a1": _reply("a1", "", skipped=True, event_type="group_skipped"),
        },
        meta_reply=_reply(META_LEADER_AGENT_ID, "目前还缺仓库路径。"),
        extra_instructions=extra_instructions,
    )
    events = await _collect_turn(
        router,
        avatar_ids=["a1", "a2"],
        user_input="帮我看下这个报错",
    )
    assert all(e.event_type != "group_nudge" for e in events)
    skipped = [e for e in events if e.event_type == "group_skipped"]
    assert skipped
    assert all(e.content == "" for e in skipped)
    replies = [e for e in events if e.event_type == "group_reply"]
    assert replies[-1].agent_id == META_LEADER_AGENT_ID
    assert extra_instructions
    assert "团长刚才的问题需要你" not in extra_instructions[-1]
    assert "诚实兜底" in extra_instructions[-1]


# ---------------------------------------------------------------------------
# FR-6: shared control-plane contract in prompts
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_member_and_meta_prompts_share_control_plane_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[str] = []

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured.append(str(kwargs.get("system_prompt") or ""))
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "短结论。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router_with_spies(["a1"])

    async def stub_llm(**kwargs):
        captured.append(str(kwargs.get("prompt") or ""))
        return "短结论。"

    router._call_llm_text = stub_llm  # type: ignore[assignment]
    session = _make_session(["a1"])
    context = GroupChatContext(session)
    await router._run_one_target(
        base_session=session,
        context=context,
        group_id="g-control-plane",
        group_name="Control Room",
        avatar_id="a1",
        user_input="解释一下当前架构",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=False,
    )
    await router._run_meta_project_manager_reply(
        base_session=session,
        context=context,
        group_name="Control Room",
        user_input="解释一下当前架构",
    )
    assert len(captured) >= 2
    for prompt in captured:
        assert "群聊控制面答复" in prompt
        assert "默认 1–3 句" in prompt
        assert "禁止以“稍等 / 等我回复 / 我去处理”作为 FINAL" in prompt
        assert "正在调用工具 / 已回答 / 等待追问" in prompt
        assert "web_search" in prompt
        assert "查了一圈" in prompt
