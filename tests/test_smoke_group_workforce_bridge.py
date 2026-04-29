#!/usr/bin/env python3
"""Smoke test: GroupChatRouter routing="team" bridge to WorkforcePattern.

Tests the _run_team_turn branching logic and WorkforceEvent → GroupReply
mapping WITHOUT triggering LLM calls.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agenticx.avatar.group_chat import GroupChatConfig, GroupChatRegistry
from agenticx.runtime.group_router import (
    GroupChatRouter,
    GroupReply,
    _get_mention_hops,
    _is_complex_multistep_task,
    MAX_WORKERS_PER_GROUP,
)
from agenticx.collaboration.workforce.events import WorkforceEvent, WorkforceAction
from agenticx.collaboration.task_lock import get_or_create_task_lock, remove_task_lock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_router() -> GroupChatRouter:
    """Build a GroupChatRouter with mocked dependencies."""
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=None)
    llm_factory = MagicMock(return_value=MagicMock())
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=llm_factory,
        max_tool_rounds=5,
    )


def _make_session(session_id: str = "test-session") -> MagicMock:
    sess = MagicMock()
    sess.session_id = session_id
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    return sess


# ---------------------------------------------------------------------------
# GroupChatConfig: routing="team" accepted
# ---------------------------------------------------------------------------

class TestGroupChatConfigTeamRouting:
    def test_group_config_accepts_team_routing(self):
        cfg = GroupChatConfig(id="g1", name="Test", routing="team")
        assert cfg.routing == "team"

    def test_group_config_default_still_intelligent(self):
        cfg = GroupChatConfig(id="g1", name="Test")
        assert cfg.routing == "intelligent"

    def test_all_routing_values_accepted(self):
        for routing in ("intelligent", "user-directed", "meta-routed", "round-robin", "team"):
            cfg = GroupChatConfig(id="x", name="x", routing=routing)
            assert cfg.routing == routing


# ---------------------------------------------------------------------------
# _get_mention_hops: config-based, default 2
# ---------------------------------------------------------------------------

class TestComplexMultistepHeuristic:
    """Validate the heuristic that drives intelligent → Workforce auto-dispatch."""

    @pytest.mark.parametrize("text", [
        "帮我调研一下 X 库，然后基于它写一个 hello world demo",
        "同时做这两件事：1) 调查 ChromaDB vs Milvus 2) 写一段 RAG 入库 demo",
        "先调研 streaming API，再写一个 demo 验证",
        "请按以下步骤执行：分析需求、设计方案、实现代码、写测试。",
        "拆分这个任务给团队",
        "需要并行处理多个任务",
        "把这个任务分解成几个子任务",
    ])
    def test_complex_prompts_trip_heuristic(self, text):
        assert _is_complex_multistep_task(text), f"Should trip on: {text!r}"

    @pytest.mark.parametrize("text", [
        "你好",
        "@avatar1 项目主页有什么内容？",
        "@avatar1 你好",
        "天气怎么样？",
        "再来一个",
        "然后呢",
        "",
        "ok",
    ])
    def test_simple_prompts_skip_heuristic(self, text):
        assert not _is_complex_multistep_task(text), f"Should NOT trip on: {text!r}"

    def test_empty_input_returns_false(self):
        assert _is_complex_multistep_task("") is False
        assert _is_complex_multistep_task(None) is False  # type: ignore[arg-type]
        assert _is_complex_multistep_task("   ") is False


class TestMentionHopsConfig:
    def test_default_is_two(self):
        with patch("agenticx.cli.config_manager.ConfigManager._load_yaml", return_value={}):
            hops = _get_mention_hops()
        assert hops == 2

    def test_reads_from_config(self):
        with patch(
            "agenticx.cli.config_manager.ConfigManager._load_yaml",
            return_value={"group_chat": {"mention_hops": 4}},
        ):
            hops = _get_mention_hops()
        assert hops == 4

    def test_clamped_to_valid_range(self):
        with patch(
            "agenticx.cli.config_manager.ConfigManager._load_yaml",
            return_value={"group_chat": {"mention_hops": 999}},
        ):
            hops = _get_mention_hops()
        # 999 > 10, so should fallback to default 2
        assert hops == 2


# ---------------------------------------------------------------------------
# _workforce_event_to_group_reply: mapping correctness
# ---------------------------------------------------------------------------

class TestWorkforceEventMapping:
    def test_task_completed_maps_to_workforce_event_type(self):
        router = _make_router()
        evt = WorkforceEvent(
            action=WorkforceAction.TASK_COMPLETED,
            task_id="t1",
            agent_id="avatar1",
            data={"result": "done"},
        )
        reply = router._workforce_event_to_group_reply(
            evt, agent_id="avatar1", avatar_name="Dev"
        )
        assert reply.event_type == "workforce.task_completed"
        assert not reply.skipped

    def test_workforce_started_maps_correctly(self):
        router = _make_router()
        evt = WorkforceEvent(action=WorkforceAction.WORKFORCE_STARTED, data={})
        reply = router._workforce_event_to_group_reply(evt)
        assert reply.event_type == "workforce.workforce_started"

    def test_non_event_returns_unknown(self):
        router = _make_router()
        reply = router._workforce_event_to_group_reply("not-an-event")
        assert reply.event_type == "workforce.unknown"
        assert reply.skipped


# ---------------------------------------------------------------------------
# run_group_turn routing dispatch: "team" calls _run_team_turn, others don't
# ---------------------------------------------------------------------------

class TestRoutingDispatch:
    @pytest.mark.asyncio
    async def test_team_routing_dispatches_to_team_turn(self):
        """When routing="team", _run_team_turn must be called."""
        router = _make_router()
        team_called = False

        async def fake_team_turn(**kwargs):
            nonlocal team_called
            team_called = True
            yield GroupReply(
                agent_id="__meta__",
                avatar_name="Leader",
                avatar_url="",
                content="team done",
                skipped=False,
                event_type="group_reply",
            )

        router._run_team_turn = fake_team_turn  # type: ignore[assignment]

        session = _make_session()
        replies = []
        async for r in router.run_group_turn(
            base_session=session,
            group_id="g1",
            group_name="Test Group",
            routing="team",
            group_avatar_ids=["av1"],
            mentioned_avatar_ids=[],
            user_input="调研 X 然后写 demo",
            quoted_content="",
            should_stop=lambda: False,
        ):
            replies.append(r)

        assert team_called, "_run_team_turn was not called for routing='team'"
        assert len(replies) > 0

    @pytest.mark.asyncio
    async def test_intelligent_routing_simple_prompt_skips_team_turn(self):
        """When routing="intelligent" + simple prompt, _run_team_turn must NOT be called.

        With the auto-dispatch heuristic, intelligent routing only calls
        _run_team_turn for complex multi-step tasks.  A simple greeting must
        stay on the legacy path.
        """
        router = _make_router()
        team_called = False

        async def fake_team_turn(**kwargs):
            nonlocal team_called
            team_called = True
            yield GroupReply("x", "x", "", "", True, event_type="group_reply")

        router._run_team_turn = fake_team_turn  # type: ignore[assignment]

        # Stub the rest of the legacy path so the test terminates fast.
        async def stub_analyze_intent(**kwargs):
            from agenticx.runtime.group_router import IntentDecision
            return IntentDecision(action="meta_direct", target_ids=[], reason="stub")

        async def stub_meta_pm(**kwargs):
            return GroupReply("__meta__", "Machi", "", "ok", False, event_type="group_reply")

        router._analyze_intent = stub_analyze_intent  # type: ignore[assignment]
        router._run_meta_project_manager_reply = stub_meta_pm  # type: ignore[assignment]

        session = _make_session()
        async for _ in router.run_group_turn(
            base_session=session,
            group_id="g1",
            group_name="Test Group",
            routing="intelligent",
            group_avatar_ids=["av1"],
            mentioned_avatar_ids=[],
            user_input="你好",
            quoted_content="",
            should_stop=lambda: False,
        ):
            pass

        assert not team_called, (
            "Simple prompt under intelligent routing must NOT trigger _run_team_turn"
        )

    @pytest.mark.asyncio
    async def test_intelligent_routing_complex_prompt_auto_dispatches_to_team(self):
        """When routing="intelligent" + multi-step prompt + ≥2 avatars, _run_team_turn IS called."""
        router = _make_router()
        team_called = False
        captured_input: list[str] = []

        async def fake_team_turn(**kwargs):
            nonlocal team_called
            team_called = True
            captured_input.append(kwargs.get("user_input", ""))
            yield GroupReply(
                "__meta__", "Machi", "", "team done", False, event_type="group_reply"
            )

        router._run_team_turn = fake_team_turn  # type: ignore[assignment]

        session = _make_session()
        replies = []
        async for r in router.run_group_turn(
            base_session=session,
            group_id="g-auto",
            group_name="Auto Dispatch",
            routing="intelligent",
            group_avatar_ids=["av1", "av2"],  # ≥ 2 members
            mentioned_avatar_ids=[],  # no @ mention
            user_input="帮我调研一下 X 库，然后基于它写一个 hello world demo",
            quoted_content="",
            should_stop=lambda: False,
        ):
            replies.append(r)

        assert team_called, (
            "intelligent routing should auto-dispatch to _run_team_turn for complex prompts"
        )
        assert "调研" in captured_input[0]

    @pytest.mark.asyncio
    async def test_intelligent_routing_with_explicit_mention_skips_auto_dispatch(self):
        """Even with multi-step prompt, explicit @ mention skips auto-dispatch (user knows best)."""
        router = _make_router()
        team_called = False

        async def fake_team_turn(**kwargs):
            nonlocal team_called
            team_called = True
            yield GroupReply("x", "x", "", "", True, event_type="group_reply")

        router._run_team_turn = fake_team_turn  # type: ignore[assignment]

        # Stub legacy path
        async def stub_analyze_intent(**kwargs):
            from agenticx.runtime.group_router import IntentDecision
            return IntentDecision(action="route_to", target_ids=["av1"], reason="explicit")

        async def stub_one_target_stream(**kwargs):
            yield GroupReply(
                kwargs.get("avatar_id", "av1"), "Avatar1", "",
                "ok", False, event_type="group_reply"
            )

        router._analyze_intent = stub_analyze_intent  # type: ignore[assignment]
        router._run_one_target_stream = stub_one_target_stream  # type: ignore[assignment]

        session = _make_session()
        async for _ in router.run_group_turn(
            base_session=session,
            group_id="g-mention",
            group_name="Mention Test",
            routing="intelligent",
            group_avatar_ids=["av1", "av2"],
            mentioned_avatar_ids=["av1"],  # explicit @
            user_input="@av1 然后再调研一下 ChromaDB 步骤",  # has multi-step markers
            quoted_content="",
            should_stop=lambda: False,
        ):
            pass

        assert not team_called, (
            "Explicit @ mention should skip auto-dispatch even with multi-step prompt"
        )

    @pytest.mark.asyncio
    async def test_intelligent_routing_single_member_skips_auto_dispatch(self):
        """Group with only 1 avatar should skip Workforce dispatch (no point decomposing)."""
        router = _make_router()
        team_called = False

        async def fake_team_turn(**kwargs):
            nonlocal team_called
            team_called = True
            yield GroupReply("x", "x", "", "", True, event_type="group_reply")

        router._run_team_turn = fake_team_turn  # type: ignore[assignment]

        async def stub_analyze_intent(**kwargs):
            from agenticx.runtime.group_router import IntentDecision
            return IntentDecision(action="meta_direct", target_ids=[], reason="stub")

        async def stub_meta_pm(**kwargs):
            return GroupReply("__meta__", "Machi", "", "ok", False, event_type="group_reply")

        router._analyze_intent = stub_analyze_intent  # type: ignore[assignment]
        router._run_meta_project_manager_reply = stub_meta_pm  # type: ignore[assignment]

        session = _make_session()
        async for _ in router.run_group_turn(
            base_session=session,
            group_id="g-single",
            group_name="Single Member",
            routing="intelligent",
            group_avatar_ids=["av1"],  # only 1 member
            mentioned_avatar_ids=[],
            user_input="先调研 X，再写 demo 实现一下",  # complex prompt
            quoted_content="",
            should_stop=lambda: False,
        ):
            pass

        assert not team_called, (
            "Single-member group should not invoke Workforce auto-dispatch"
        )

    @pytest.mark.asyncio
    async def test_team_routing_no_avatars_yields_error_message(self):
        """When routing="team" but no avatar_ids, should yield an error reply gracefully."""
        router = _make_router()
        session = _make_session()

        # Patch _run_team_turn to simulate no-avatar early return
        async def fake_team_turn_no_members(**kwargs):
            yield GroupReply(
                agent_id="__meta__",
                avatar_name="Leader",
                avatar_url="",
                content="群聊没有成员，无法启动 Team 模式。",
                skipped=False,
                event_type="group_reply",
            )

        router._run_team_turn = fake_team_turn_no_members  # type: ignore[assignment]

        replies = []
        async for r in router.run_group_turn(
            base_session=session,
            group_id="g2",
            group_name="Empty Group",
            routing="team",
            group_avatar_ids=[],
            mentioned_avatar_ids=[],
            user_input="hello",
            quoted_content="",
            should_stop=lambda: False,
        ):
            replies.append(r)

        assert any("成员" in (r.content or "") for r in replies), "Should emit no-member message"


# ---------------------------------------------------------------------------
# task_experience tools: end-to-end without LLM
# ---------------------------------------------------------------------------

class TestTaskExperienceTools:
    def _make_session_with_group(self, group_id: str) -> MagicMock:
        sess = _make_session()
        sess.scratchpad = {"__group_id": group_id}
        return sess

    @pytest.mark.asyncio
    async def test_experience_learn_and_retrieve(self, tmp_path, monkeypatch):
        """learn → retrieve should return the recorded entry."""
        import agenticx.cli.agent_tools as tools_mod
        # Redirect experience storage to tmp dir.
        orig_path = tools_mod._experience_path

        def patched_path(gid: str):
            p = tmp_path / "groups" / gid
            p.mkdir(parents=True, exist_ok=True)
            return p / "experience.json"

        monkeypatch.setattr(tools_mod, "_experience_path", patched_path)

        group_id = "test-g1"
        result_learn = tools_mod._experience_learn_impl(
            content="chunked vector 需要分批 <= 10 条调用 embed API",
            group_id=group_id,
            section="api_usage",
            when_to_use="调用 embed API 时",
            title="embed API 批量限制",
        )
        import json
        learn_parsed = json.loads(result_learn)
        assert learn_parsed["status"] == "ok"
        assert learn_parsed["group_id"] == group_id

        result_retrieve = tools_mod._experience_retrieve_impl(
            query="embed API 批量调用",
            group_id=group_id,
            limit=5,
        )
        retrieve_parsed = json.loads(result_retrieve)
        assert retrieve_parsed["status"] == "ok"
        assert retrieve_parsed["count"] >= 1
        assert any("embed" in e.get("content", "").lower() for e in retrieve_parsed["results"])

    @pytest.mark.asyncio
    async def test_experience_clear_requires_confirm(self, tmp_path, monkeypatch):
        import agenticx.cli.agent_tools as tools_mod
        import json

        def patched_path(gid: str):
            p = tmp_path / "groups" / gid
            p.mkdir(parents=True, exist_ok=True)
            return p / "experience.json"

        monkeypatch.setattr(tools_mod, "_experience_path", patched_path)

        tools_mod._experience_learn_impl("test entry", group_id="g-clear-test")
        # Should abort without confirm=True
        result = tools_mod._experience_clear_impl("g-clear-test", confirm=False)
        assert json.loads(result)["status"] == "aborted"
        # Should clear with confirm=True
        result = tools_mod._experience_clear_impl("g-clear-test", confirm=True)
        assert json.loads(result)["status"] == "cleared"

    def test_studio_tools_contain_experience_tools(self):
        from agenticx.cli.agent_tools import STUDIO_TOOLS
        names = {t["function"]["name"] for t in STUDIO_TOOLS}
        assert "task_experience_retrieve" in names
        assert "task_experience_learn" in names
        assert "task_experience_clear" in names


# ---------------------------------------------------------------------------
# TaskLock isolation
# ---------------------------------------------------------------------------

class TestTaskLockIsolation:
    @pytest.mark.asyncio
    async def test_group_session_task_locks_are_isolated(self):
        pid_a = "group::ga::s1"
        pid_b = "group::gb::s1"  # different group, same session
        pid_c = "group::ga::s2"  # same group, different session
        try:
            la = get_or_create_task_lock(pid_a)
            lb = get_or_create_task_lock(pid_b)
            lc = get_or_create_task_lock(pid_c)
            assert la is not lb, "Different group_ids must not share TaskLock"
            assert la is not lc, "Different session_ids must not share TaskLock"
        finally:
            for pid in (pid_a, pid_b, pid_c):
                remove_task_lock(pid)
