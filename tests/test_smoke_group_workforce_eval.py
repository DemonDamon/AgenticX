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


# All eval tasks use routing_setting="intelligent" — Workforce orchestration is
# auto-detected from message content (no `/team` prefix, no manual switch).
EVAL_TASKS = [
    EvalTask(
        id="simple_qa",
        description="Single simple @-mention question stays on legacy intelligent routing",
        routing_setting="intelligent",
        prompt_seq=["@avatar1 项目主页有什么内容？"],
        expect_routing_path="intelligent_legacy",
        expect_no_workforce_actions=True,
    ),
    EvalTask(
        id="research_then_implement",
        description=(
            "Complex multi-step task should trigger Workforce automatically "
            "(heuristic: contains 然后/再/调研... markers)"
        ),
        routing_setting="intelligent",
        prompt_seq=["帮我调研一下 X 库，然后基于它写一个 hello world demo"],
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
        description=(
            "Parallel subtasks with bigram markers (1)..2)) trigger Workforce auto-dispatch"
        ),
        routing_setting="intelligent",
        prompt_seq=["同时做这两件事：1) 调查 ChromaDB vs Milvus 2) 写一段 RAG 入库 demo"],
        expect_workforce_actions=["decompose_start", "decompose_complete"],
        expect_min_tasks=2,
    ),
    EvalTask(
        id="insert_during_execution",
        description="Mid-flight task change handled via ADD_TASK + SKIP_TASK",
        routing_setting="intelligent",
        prompt_seq=[
            "先调研 A 库的 streaming API，再写一个 demo 验证一下",
            "现在改成调研 B 库的",
        ],
        expect_workforce_actions=["decompose_start", "task_assigned"],
    ),
    EvalTask(
        id="experience_reuse",
        description="Second similar complex task should trigger task_experience_retrieve",
        routing_setting="intelligent",
        prompt_seq=[
            "调研 issue X（涉及 chunked vector），然后写一个修复方案",
            "再调研类似的 issue Y，参考之前经验给出修复",
        ],
        expect_tool_calls=["task_experience_retrieve", "task_experience_learn"],
    ),
    EvalTask(
        id="regression_legacy",
        description="Simple @ mention stays on legacy intelligent path (no Workforce)",
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

    def test_workforce_action_tasks_trigger_via_heuristic(self):
        """Tasks expecting workforce actions must have prompts that trip the heuristic."""
        from agenticx.runtime.group_router import _is_complex_multistep_task
        for task in EVAL_TASKS:
            if not task.expect_workforce_actions:
                continue
            for prompt in task.prompt_seq:
                # At least one prompt in the sequence must trip the heuristic.
                if _is_complex_multistep_task(prompt):
                    break
            else:
                raise AssertionError(
                    f"Task {task.id!r} expects workforce actions but no prompt trips "
                    f"_is_complex_multistep_task heuristic. Prompts: {task.prompt_seq}"
                )

    def test_no_workforce_action_tasks_do_not_trip_heuristic(self):
        """Tasks expecting no workforce should NOT trip the heuristic on any prompt."""
        from agenticx.runtime.group_router import _is_complex_multistep_task
        for task in EVAL_TASKS:
            if not task.expect_no_workforce_actions:
                continue
            for prompt in task.prompt_seq:
                assert not _is_complex_multistep_task(prompt), (
                    f"Task {task.id!r} expects no workforce but prompt {prompt!r} "
                    "trips heuristic. Adjust prompt or expectations."
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
