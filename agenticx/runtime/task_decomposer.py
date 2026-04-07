#!/usr/bin/env python3
"""Structured task decomposer for complex multi-step tasks.

Provides LLM-assisted task decomposition with dependency DAG,
enabling parallel subtask execution via AgentTeamManager.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional, Set, Tuple

_log = logging.getLogger(__name__)

DECOMPOSE_PROMPT = """\
You are a task planning specialist. Analyze the following task and decide \
whether it should be decomposed into subtasks.

TASK:
{task}

RULES:
1. Only decompose if the task has 3+ distinct, independent steps.
2. Simple questions, lookups, or single-tool tasks should NOT be decomposed.
3. Return valid JSON only, no markdown fences.

If the task is simple (no decomposition needed), return:
{{"decompose": false, "reason": "brief explanation"}}

If decomposition is appropriate, return:
{{"decompose": true, "subtasks": [
  {{"id": "t1", "name": "short name", "description": "what to do", "depends_on": []}},
  {{"id": "t2", "name": "short name", "description": "what to do", "depends_on": ["t1"]}},
  ...
]}}

Keep subtask count between 2-6. Use depends_on to express ordering constraints.
Tasks without depends_on can run in parallel.
"""


class SubtaskSpec:
    """One subtask from the decomposition plan."""

    __slots__ = ("id", "name", "description", "depends_on", "status", "result")

    def __init__(
        self,
        id: str,
        name: str,
        description: str,
        depends_on: Optional[List[str]] = None,
    ) -> None:
        self.id = id
        self.name = name
        self.description = description
        self.depends_on: List[str] = depends_on or []
        self.status: str = "pending"
        self.result: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "depends_on": list(self.depends_on),
            "status": self.status,
            "result": self.result,
        }


class TaskDecomposer:
    """Orchestrates LLM-based task decomposition and DAG execution.

    Workflow:
    1. evaluate() asks the LLM whether a task needs decomposition.
    2. If yes, returns a list of SubtaskSpec with dependency edges.
    3. The caller can use ready_tasks() to get parallelizable batches
       and mark_complete() to advance the DAG.
    """

    def __init__(self, llm: Any) -> None:
        self._llm = llm
        self._subtasks: Dict[str, SubtaskSpec] = {}
        self._original_task: str = ""

    @property
    def subtasks(self) -> List[SubtaskSpec]:
        return list(self._subtasks.values())

    async def evaluate(self, task: str) -> Tuple[bool, List[SubtaskSpec]]:
        """Ask the LLM whether *task* should be decomposed.

        Returns (should_decompose, subtask_list).
        """
        self._original_task = task
        prompt = DECOMPOSE_PROMPT.format(task=task[:4000])
        try:
            import asyncio
            response = await asyncio.to_thread(
                self._llm.invoke,
                [{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=2048,
            )
            text = (response.content or "").strip()
            if text.startswith("```"):
                text = text.split("```", 2)[1]
                if text.startswith("json"):
                    text = text[4:]
            data = json.loads(text)
        except Exception as exc:
            _log.warning("Task decomposition LLM call failed: %s", exc)
            return False, []

        if not data.get("decompose"):
            return False, []

        raw_tasks = data.get("subtasks", [])
        if not isinstance(raw_tasks, list) or len(raw_tasks) < 2:
            return False, []

        specs: List[SubtaskSpec] = []
        seen_ids: Set[str] = set()
        for item in raw_tasks[:8]:
            if not isinstance(item, dict):
                continue
            tid = str(item.get("id", "")).strip()
            if not tid or tid in seen_ids:
                continue
            seen_ids.add(tid)
            deps = item.get("depends_on", [])
            if not isinstance(deps, list):
                deps = []
            valid_deps = [d for d in deps if isinstance(d, str) and d in seen_ids]
            specs.append(SubtaskSpec(
                id=tid,
                name=str(item.get("name", tid)),
                description=str(item.get("description", "")),
                depends_on=valid_deps,
            ))

        self._subtasks = {s.id: s for s in specs}
        return True, specs

    def ready_tasks(self) -> List[SubtaskSpec]:
        """Return subtasks whose dependencies are all completed."""
        completed = {
            tid for tid, st in self._subtasks.items()
            if st.status == "completed"
        }
        return [
            st for st in self._subtasks.values()
            if st.status == "pending"
            and all(d in completed for d in st.depends_on)
        ]

    def mark_complete(self, task_id: str, result: str = "") -> None:
        spec = self._subtasks.get(task_id)
        if spec:
            spec.status = "completed"
            spec.result = result

    def mark_failed(self, task_id: str, error: str = "") -> None:
        spec = self._subtasks.get(task_id)
        if spec:
            spec.status = "failed"
            spec.result = error

    @property
    def all_done(self) -> bool:
        return all(
            s.status in ("completed", "failed")
            for s in self._subtasks.values()
        )

    def summary(self) -> str:
        """Build a combined summary of all subtask results."""
        lines = [f"Task decomposition results for: {self._original_task[:200]}"]
        for st in self._subtasks.values():
            status_icon = "done" if st.status == "completed" else st.status
            lines.append(f"- [{status_icon}] {st.name}: {st.result[:500]}")
        return "\n".join(lines)

    def to_plan_dict(self) -> Dict[str, Any]:
        """Serialize the plan for SSE / frontend display."""
        return {
            "task": self._original_task[:1000],
            "subtasks": [s.to_dict() for s in self._subtasks.values()],
        }
