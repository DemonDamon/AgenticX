#!/usr/bin/env python3
"""Eval suite: 5 + 1 评测 prompt 结构定义与契约验证（不触发 LLM 调用）.

This file defines the evaluation contract for the group chat Workforce bridge.
Full evaluation requires a live LLM and a running AgenticX Studio server.
These tests verify:
1. Eval task definitions are structurally valid.
2. Key behaviours can be asserted programmatically (routing path, event types).

Author: Damon Li
"""

from __future__ import annotations

import pytest
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Eval task spec dataclass
# ---------------------------------------------------------------------------

@dataclass
class EvalTask:
    id: str
    description: str
    routing_setting: str
    prompt_seq: list[str] = field(default_factory=list)
    expect_routing_path: str = ""
    expect_no_workforce_actions: bool = False
    expect_workforce_actions: list[str] = field(default_factory=list)
    expect_min_tasks: int = 0
    expect_task_completion_rate: float = 0.0
    expect_tool_calls: list[str] = field(default_factory=list)


EVAL_TASKS = [
    EvalTask(
        id="simple_qa",
        description="Single simple question should go through legacy intelligent routing",
        routing_setting="intelligent",
        prompt_seq=["@avatar1 项目主页有什么内容？"],
        expect_routing_path="intelligent_legacy",
        expect_no_workforce_actions=True,
    ),
    EvalTask(
        id="research_then_implement",
        description="Complex multi-step task should trigger Workforce task decomposition",
        routing_setting="team",
        prompt_seq=["/team 帮我调研一下 X 库，然后基于它写一个 hello world demo"],
        expect_workforce_actions=[
            "decompose_start",
            "decompose_complete",
            "task_assigned",
            "task_completed",
            "workforce_stopped",
        ],
        expect_min_tasks=2,
        expect_task_completion_rate=1.0,
    ),
    EvalTask(
        id="parallel_subtasks",
        description="Two independent subtasks should be assigned to different workers",
        routing_setting="team",
        prompt_seq=["/team 同时做：1) 调查 ChromaDB vs Milvus 2) 写一段 RAG 入库 demo"],
        expect_workforce_actions=["decompose_start", "decompose_complete"],
        expect_min_tasks=2,
    ),
    EvalTask(
        id="insert_during_execution",
        description="Mid-flight task change should be handled via ADD_TASK + SKIP_TASK actions",
        routing_setting="team",
        prompt_seq=[
            "/team 调研 A 库的 streaming API",
            "现在改成调研 B 库的",
        ],
    ),
    EvalTask(
        id="experience_reuse",
        description="Second similar task should trigger task_experience_retrieve",
        routing_setting="team",
        prompt_seq=[
            "/team 解决 issue X（涉及 chunked vector）",
            "/team 解决类似的 issue Y",
        ],
        expect_tool_calls=["task_experience_retrieve", "task_experience_learn"],
    ),
    EvalTask(
        id="regression_legacy",
        description="Simple @ mention should stay on legacy intelligent path",
        routing_setting="intelligent",
        prompt_seq=["@avatar1 你好"],
        expect_routing_path="intelligent_legacy",
        expect_no_workforce_actions=True,
    ),
]


# ---------------------------------------------------------------------------
# Structural validation (no LLM)
# ---------------------------------------------------------------------------

class TestEvalTaskStructure:
    def test_all_tasks_have_unique_ids(self):
        ids = [t.id for t in EVAL_TASKS]
        assert len(ids) == len(set(ids)), "Duplicate eval task IDs"

    def test_all_tasks_have_non_empty_prompts(self):
        for task in EVAL_TASKS:
            assert len(task.prompt_seq) >= 1, f"Task {task.id!r} has no prompts"

    def test_team_tasks_use_team_routing(self):
        for task in EVAL_TASKS:
            if task.expect_workforce_actions:
                assert task.routing_setting == "team", (
                    f"Task {task.id!r} expects workforce actions but routing_setting={task.routing_setting!r}"
                )

    def test_no_workforce_action_tasks_use_non_team_routing(self):
        for task in EVAL_TASKS:
            if task.expect_no_workforce_actions:
                assert task.routing_setting != "team", (
                    f"Task {task.id!r} expects no workforce but routing_setting={task.routing_setting!r}"
                )

    def test_workforce_action_names_are_valid(self):
        from agenticx.collaboration.workforce.events import WorkforceAction
        valid_actions = {a.value for a in WorkforceAction}
        for task in EVAL_TASKS:
            for action in task.expect_workforce_actions:
                assert action in valid_actions, (
                    f"Task {task.id!r}: unknown WorkforceAction {action!r}"
                )

    def test_tool_call_names_registered_in_studio_tools(self):
        from agenticx.cli.agent_tools import STUDIO_TOOLS
        registered = {t["function"]["name"] for t in STUDIO_TOOLS}
        for task in EVAL_TASKS:
            for tc in task.expect_tool_calls:
                assert tc in registered, (
                    f"Task {task.id!r}: tool {tc!r} not in STUDIO_TOOLS"
                )

    def test_success_criteria(self):
        """The plan requires 4+ out of 5 tasks to pass (success_rate >= 0.8)."""
        num_tasks = len([t for t in EVAL_TASKS if t.id != "regression_legacy"])
        assert num_tasks == 5, "Should have exactly 5 non-regression eval tasks"


# ---------------------------------------------------------------------------
# Per-task behavioural contract
# ---------------------------------------------------------------------------

class TestEvalTaskContracts:
    def test_simple_qa_stays_on_legacy_path(self):
        """Verifies that simple_qa is marked for legacy routing."""
        task = next(t for t in EVAL_TASKS if t.id == "simple_qa")
        assert task.expect_no_workforce_actions
        assert task.routing_setting == "intelligent"

    def test_research_task_expects_decomposition(self):
        task = next(t for t in EVAL_TASKS if t.id == "research_then_implement")
        assert "decompose_start" in task.expect_workforce_actions
        assert "decompose_complete" in task.expect_workforce_actions
        assert task.expect_min_tasks >= 2
        assert task.expect_task_completion_rate == 1.0

    def test_experience_reuse_expects_retrieve_and_learn(self):
        task = next(t for t in EVAL_TASKS if t.id == "experience_reuse")
        assert "task_experience_retrieve" in task.expect_tool_calls
        assert "task_experience_learn" in task.expect_tool_calls

    def test_regression_uses_legacy_path(self):
        task = next(t for t in EVAL_TASKS if t.id == "regression_legacy")
        assert task.expect_no_workforce_actions
        assert task.routing_setting == "intelligent"
