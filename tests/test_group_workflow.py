#!/usr/bin/env python3
"""Tests for the reviewed project-group collaboration workflow.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agenticx.core.task import Task
from agenticx.runtime.graph.models import NodeStatus
from agenticx.runtime.graph.store import GraphRunStore
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.harden_flags import group_review_max_retries
from agenticx.runtime.group_router import GroupChatRouter, GroupReply
from agenticx.runtime.group_workflow import (
    MEMBER_HISTORY_MAX_CHARS,
    MEMBER_HISTORY_MAX_MESSAGES,
    ReviewStatus,
    WorkflowMember,
    WorkflowStageRecord,
    parse_review_decision,
    persist_member_runtime_state,
    render_execution_dossier,
    restore_member_runtime_state,
    select_reviewer,
    write_group_deliverable,
)


def test_parse_review_json_and_fenced_json() -> None:
    raw = (
        '{"status":"pass_with_risk","summary":"可交付",'
        '"issues":[{"severity":"P2","problem":"缺少次要样例","fix":"后续补充"}],'
        '"strengths":["结构完整"]}'
    )
    plain = parse_review_decision(raw)
    fenced = parse_review_decision(f"```json\n{raw}\n```")

    assert plain.status == ReviewStatus.PASS_WITH_RISK
    assert fenced.status == ReviewStatus.PASS_WITH_RISK
    assert plain.accepted is True
    assert plain.issues[0].severity == "P2"


def test_p0_issue_overrides_false_pass() -> None:
    decision = parse_review_decision(
        '{"status":"pass","summary":"看起来可以",'
        '"issues":[{"severity":"P0","problem":"核心数据无来源","fix":"补证据"}]}'
    )

    assert decision.status == ReviewStatus.REVISE
    assert decision.accepted is False


def test_plain_text_p1_overrides_false_pass() -> None:
    decision = parse_review_decision("审核通过\nP1: 关键结论没有证据来源")

    assert decision.status == ReviewStatus.REVISE
    assert decision.issues[0].severity == "P1"


def test_unparseable_review_fails_closed() -> None:
    decision = parse_review_decision("我大概看了一下，应该还行。")

    assert decision.status == ReviewStatus.REVISE
    assert decision.accepted is False
    assert decision.issues[0].severity == "P1"
    assert "无法解析" in decision.issues[0].problem


def test_review_retry_limit_reads_env_and_clamps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_GROUP_REVIEW_MAX_RETRIES", "99")
    assert group_review_max_retries() == 4

    monkeypatch.setenv("AGX_GROUP_REVIEW_MAX_RETRIES", "-3")
    assert group_review_max_retries() == 0


def test_select_reviewer_excludes_executor_and_prefers_quality_role() -> None:
    members = [
        WorkflowMember("dev", "开发", "开发工程师"),
        WorkflowMember("research", "研究", "行业研究员"),
        WorkflowMember("qa", "质检", "质量审核与验收负责人"),
    ]

    reviewer = select_reviewer(members, executor_id="dev", task_index=0)

    assert reviewer is not None
    assert reviewer.avatar_id == "qa"
    assert reviewer.avatar_id != "dev"


def test_member_state_round_trip_is_isolated_and_bounded() -> None:
    owner = SimpleNamespace(scratchpad={})
    local_a = SimpleNamespace(
        agent_messages=[
            {"role": "system", "content": "hidden"},
            *[
                {"role": "user" if i % 2 == 0 else "assistant", "content": f"A-{i}-" + "x" * 1800}
                for i in range(30)
            ],
            {"role": "tool", "content": "tool-chain-must-not-persist"},
        ],
        chat_history=[],
    )
    local_b = SimpleNamespace(
        agent_messages=[
            {"role": "user", "content": "B-question"},
            {"role": "assistant", "content": "B-answer"},
        ],
        chat_history=[],
    )
    persist_member_runtime_state(owner, local_a, group_id="g1", avatar_id="a")
    persist_member_runtime_state(owner, local_b, group_id="g1", avatar_id="b")

    restored_a = SimpleNamespace(agent_messages=[], chat_history=[])
    restored_b = SimpleNamespace(agent_messages=[], chat_history=[])
    rows_a = restore_member_runtime_state(owner, restored_a, group_id="g1", avatar_id="a")
    rows_b = restore_member_runtime_state(owner, restored_b, group_id="g1", avatar_id="b")

    assert 0 < len(rows_a) <= MEMBER_HISTORY_MAX_MESSAGES
    assert sum(len(row["content"]) for row in rows_a) <= MEMBER_HISTORY_MAX_CHARS
    assert all(row["role"] in {"user", "assistant"} for row in rows_a)
    assert all("B-" not in row["content"] for row in rows_a)
    assert [row["content"] for row in rows_b] == ["B-question", "B-answer"]
    assert restored_a.chat_history == restored_a.agent_messages


def test_render_execution_dossier_contains_handoffs_and_gate_state() -> None:
    decision = parse_review_decision(
        '{"status":"pass","summary":"审核通过","issues":[],"strengths":["完整"]}'
    )
    record = WorkflowStageRecord(
        task_id="t2",
        description="整合方案",
        executor_id="dev",
        executor_name="开发",
        reviewer_id="qa",
        reviewer_name="质检",
        dependency_outputs={"t1": "已审核调研结论"},
        attempts=["最终方案正文"],
        reviews=[decision],
        final_output="最终方案正文",
        status="pass",
    )

    dossier = render_execution_dossier([record])

    assert "整合方案" in dossier
    assert "开发 (dev)" in dossier
    assert "质检 (qa)" in dossier
    assert "已接收上游: t1" in dossier
    assert "最终方案正文" in dossier
    assert "结论: pass" in dossier


def test_write_group_deliverable_creates_markdown(tmp_path: Path) -> None:
    record = WorkflowStageRecord(
        task_id="t1",
        description="调研",
        executor_id="a",
        executor_name="成员A",
        status="failed",
        failure_reason="缺少可访问数据源",
    )

    path = write_group_deliverable(
        group_id="g/path/../unsafe",
        group_name="方案组",
        original_request="调研 A/B 并给方案",
        run_id="run/../1",
        records=[record],
        final_answer="当前未完全闭环。",
        workspace_root=tmp_path,
    )

    assert path.is_file()
    assert path.parent == tmp_path / "deliverables"
    assert ".." not in path.name
    text = path.read_text(encoding="utf-8")
    assert "调研 A/B 并给方案" in text
    assert "缺少可访问数据源" in text
    assert "当前未完全闭环" in text


def _router_with_two_members() -> GroupChatRouter:
    avatars = {
        "executor": SimpleNamespace(
            name="执行者",
            role="方案工程师",
            system_prompt="完成分配的方案任务",
            avatar_url="executor.png",
        ),
        "reviewer": SimpleNamespace(
            name="审核者",
            role="质量审核与验收负责人",
            system_prompt="独立审核交付质量",
            avatar_url="reviewer.png",
        ),
    }
    registry = MagicMock()
    registry.get_avatar.side_effect = lambda avatar_id: avatars.get(avatar_id)
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=3,
    )


class _FakeCoordinator:
    async def assign_tasks(self, *, tasks, workers):
        return {str(task.id): "executor" for task in tasks}


class _FakeWorkforcePattern:
    def __init__(self, *, workers, **kwargs):
        self.worker_instances = [SimpleNamespace(id=worker.id) for worker in workers]
        self.coordinator = _FakeCoordinator()

    async def decompose_task(self, task):
        return [
            Task(
                id="stage-1",
                description="产出一份可交付方案",
                expected_output="完整方案",
                dependencies=[],
            )
        ]


def _owner_session() -> SimpleNamespace:
    return SimpleNamespace(
        session_id="group-session",
        _session_id="group-session",
        _usage_owner_session_id="group-session",
        provider_name="openai",
        model_name="model",
        workspace_dir=None,
        context_files={},
        taskspaces=[],
        scratchpad={},
        chat_history=[],
    )


@pytest.mark.asyncio
async def test_delivery_mode_treats_execution_dossier_as_authoritative() -> None:
    router = _router_with_two_members()
    session = _owner_session()
    setattr(session, "__group_avatar_ids", ["executor", "reviewer"])
    context = GroupChatContext(session, max_items=20)
    captured: dict[str, object] = {}

    async def fake_llm(**kwargs):
        captured.update(kwargs)
        return "负责人交付"

    router._call_llm_text = fake_llm  # type: ignore[assignment]
    reply = await router._run_meta_project_manager_reply(
        base_session=session,
        context=context,
        group_name="交付群",
        user_input="团队执行档案：stage-1 已审核通过",
        delivery_mode=True,
    )

    prompt = str(captured["prompt"])
    assert "共同构成本轮权威事实" in prompt
    assert "以带 task_id、审核状态和产出的执行档案为准" in prompt
    assert int(captured["max_tokens"]) >= 4_000
    assert reply.content == "负责人交付"


@pytest.mark.asyncio
async def test_explicit_collaboration_expands_single_plan_across_members(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    router = _router_with_two_members()
    session = _owner_session()
    context = GroupChatContext(session, max_items=50)
    store = GraphRunStore(root=tmp_path / "graphs")
    executor_identities: list[str] = []

    async def fake_target_stream(**kwargs):
        avatar_id = str(kwargs["avatar_id"])
        if kwargs.get("append_to_context", True):
            executor_identities.append(avatar_id)
            content = f"{avatar_id} 的独立专业意见"
        else:
            content = (
                '{"status":"pass","summary":"独立意见可交付",'
                '"issues":[],"strengths":["角色视角明确"]}'
            )
        yield GroupReply(avatar_id, avatar_id, "", content, False, event_type="group_reply")

    async def fake_pm(**kwargs):
        kwargs["context"].append_agent(
            agent_id="__meta__",
            agent_name="Near",
            text="团队终稿",
        )
        return GroupReply("__meta__", "Near", "", "团队终稿", False, event_type="group_reply")

    def fake_deliverable(**kwargs):
        path = tmp_path / "collaboration.md"
        path.write_text("collaboration", encoding="utf-8")
        return path

    router._run_one_target_stream = fake_target_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = fake_pm  # type: ignore[assignment]
    monkeypatch.setattr("agenticx.runtime.graph.store.get_default_store", lambda: store)
    monkeypatch.setattr(
        "agenticx.runtime.group_router.write_group_deliverable",
        fake_deliverable,
    )

    with patch(
        "agenticx.collaboration.workforce.workforce_pattern.WorkforcePattern",
        _FakeWorkforcePattern,
    ):
        replies = [
            reply
            async for reply in router._run_team_turn(
                base_session=session,
                context=context,
                group_id="g-independent",
                group_name="独立讨论群",
                group_avatar_ids=["executor", "reviewer"],
                user_input="请大家分别分析这个方案并交叉评审",
                quoted_content="",
                should_stop=lambda: False,
                user_display_name="我",
                # 「要不要多人分头出意见」现在是本轮编排计划的结论，由调用方传入，
                # 不再从提示词里查关键词。
                collaboration=True,
            )
        ]

    assert set(executor_identities) == {"executor", "reviewer"}
    assert sum(reply.event_type == "workforce.task_completed" for reply in replies) == 2
    run = store.list_by_session("group-session")[0]
    assert len(run.nodes) == 2
    assert {node.agent_id for node in run.nodes.values()} == {"executor", "reviewer"}
    assert all(node.status == NodeStatus.DONE for node in run.nodes.values())
    assert run.meta["collaborative_request"] is True
    assert run.meta["independent_first_passes"] is True


@pytest.mark.asyncio
async def test_team_stage_revises_then_passes_and_completes_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    router = _router_with_two_members()
    session = _owner_session()
    context = GroupChatContext(session, max_items=50)
    store = GraphRunStore(root=tmp_path / "graphs")
    calls: list[tuple[str, bool, str]] = []
    executor_calls = 0
    reviewer_calls = 0

    async def fake_target_stream(**kwargs):
        nonlocal executor_calls, reviewer_calls
        avatar_id = str(kwargs["avatar_id"])
        append_to_context = bool(kwargs.get("append_to_context", True))
        user_input = str(kwargs["user_input"])
        calls.append((avatar_id, append_to_context, user_input))
        if avatar_id == "executor":
            executor_calls += 1
            content = "候选方案 v1" if executor_calls == 1 else "修订方案 v2（已补证据）"
        else:
            reviewer_calls += 1
            content = (
                '{"status":"revise","summary":"关键依据缺失",'
                '"issues":[{"severity":"P1","problem":"没有证据",'
                '"fix":"补充证据边界"}],"strengths":[]}'
                if reviewer_calls == 1
                else '{"status":"pass","summary":"修改后可交付","issues":[],"strengths":["证据边界清晰"]}'
            )
        yield GroupReply(
            agent_id=avatar_id,
            avatar_name="执行者" if avatar_id == "executor" else "审核者",
            avatar_url="",
            content=content,
            skipped=False,
            event_type="group_reply",
        )

    async def fake_pm(**kwargs):
        kwargs["context"].append_agent(
            agent_id="__meta__",
            agent_name="Near",
            text="负责人终稿",
        )
        return GroupReply("__meta__", "Near", "", "负责人终稿", False, event_type="group_reply")

    def fake_deliverable(**kwargs):
        path = tmp_path / "deliverable.md"
        path.write_text("deliverable", encoding="utf-8")
        return path

    router._run_one_target_stream = fake_target_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = fake_pm  # type: ignore[assignment]
    monkeypatch.setattr("agenticx.runtime.graph.store.get_default_store", lambda: store)
    monkeypatch.setattr("agenticx.runtime.group_router.group_review_max_retries", lambda: 2)
    monkeypatch.setattr("agenticx.runtime.group_router.write_group_deliverable", fake_deliverable)

    with patch(
        "agenticx.collaboration.workforce.workforce_pattern.WorkforcePattern",
        _FakeWorkforcePattern,
    ):
        replies = [
            reply
            async for reply in router._run_team_turn(
                base_session=session,
                context=context,
                group_id="g-reviewed",
                group_name="评审群",
                group_avatar_ids=["executor", "reviewer"],
                user_input="请按步骤产出一份可交付方案",
                quoted_content="",
                should_stop=lambda: False,
                user_display_name="我",
            )
        ]

    assert executor_calls == 2
    assert reviewer_calls == 2
    assert all(append is False for avatar, append, _ in calls if avatar == "reviewer")
    assert any("需要返工" in reply.content for reply in replies)
    assert any("审核通过" in reply.content for reply in replies)
    assert sum(reply.event_type == "workforce.task_completed" for reply in replies) == 1
    assert not any('"status":"revise"' in str(row.get("content")) for row in session.chat_history)

    runs = store.list_by_session("group-session")
    assert len(runs) == 1
    run = runs[0]
    assert run.nodes["stage-1"].status == NodeStatus.DONE
    assert run.nodes["stage-1"].retry_count == 1
    assert run.nodes["stage-1"].meta["review_status"] == "pass"
    assert run.meta["workflow_complete"] is True
    assert run.artifacts[0].path_or_uri == str(tmp_path / "deliverable.md")


@pytest.mark.asyncio
async def test_team_stage_review_failure_does_not_emit_completed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    router = _router_with_two_members()
    session = _owner_session()
    context = GroupChatContext(session, max_items=50)
    store = GraphRunStore(root=tmp_path / "graphs")
    captured_pm_input: list[str] = []

    async def fake_target_stream(**kwargs):
        avatar_id = str(kwargs["avatar_id"])
        content = (
            "候选方案"
            if avatar_id == "executor"
            else '{"status":"fail","summary":"核心产物不可用",'
            '"issues":[{"severity":"P0","problem":"缺少核心结果","fix":"重做"}]}'
        )
        yield GroupReply(avatar_id, avatar_id, "", content, False, event_type="group_reply")

    async def fake_pm(**kwargs):
        captured_pm_input.append(str(kwargs["user_input"]))
        kwargs["context"].append_agent(
            agent_id="__meta__",
            agent_name="Near",
            text="存在未闭环项",
        )
        return GroupReply("__meta__", "Near", "", "存在未闭环项", False, event_type="group_reply")

    def fake_deliverable(**kwargs):
        path = tmp_path / "failed-deliverable.md"
        path.write_text("failed", encoding="utf-8")
        return path

    router._run_one_target_stream = fake_target_stream  # type: ignore[assignment]
    router._run_meta_project_manager_reply = fake_pm  # type: ignore[assignment]
    monkeypatch.setattr("agenticx.runtime.graph.store.get_default_store", lambda: store)
    monkeypatch.setattr("agenticx.runtime.group_router.group_review_max_retries", lambda: 0)
    monkeypatch.setattr("agenticx.runtime.group_router.write_group_deliverable", fake_deliverable)

    with patch(
        "agenticx.collaboration.workforce.workforce_pattern.WorkforcePattern",
        _FakeWorkforcePattern,
    ):
        replies = [
            reply
            async for reply in router._run_team_turn(
                base_session=session,
                context=context,
                group_id="g-failed",
                group_name="失败门控群",
                group_avatar_ids=["executor", "reviewer"],
                user_input="请按步骤产出一份可交付方案",
                quoted_content="",
                should_stop=lambda: False,
                user_display_name="我",
            )
        ]

    assert not any(reply.event_type == "workforce.task_completed" for reply in replies)
    assert any(reply.event_type == "workforce.task_failed" for reply in replies)
    assert captured_pm_input and "状态: failed" in captured_pm_input[0]
    run = store.list_by_session("group-session")[0]
    assert run.nodes["stage-1"].status == NodeStatus.FAILED
    assert run.meta["workflow_complete"] is False
