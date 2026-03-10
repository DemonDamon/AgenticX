#!/usr/bin/env python3
"""Auto-solve mode for non-technical users."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class AutoSolvePlan:
    complexity: str
    prompt: str


class AutoSolveMode:
    """Generate simplified autonomous strategy for non-technical users."""

    SIMPLE_HINTS = ("解释", "说明", "总结", "翻译", "问答")
    COMPLEX_HINTS = ("重构", "实现", "搭建", "设计", "多智能体", "调研", "修复")

    def plan(self, user_request: str) -> AutoSolvePlan:
        text = (user_request or "").strip()
        complexity = "medium"
        if any(token in text for token in self.SIMPLE_HINTS):
            complexity = "simple"
        if any(token in text for token in self.COMPLEX_HINTS) or len(text) > 120:
            complexity = "complex"
        prompt = (
            "你正在 AutoSolve 模式下工作，面向非技术用户。"
            "优先自动完成任务并给出结果，不要暴露过多实现细节。"
            "如需澄清，问题必须简短且最多 1 个。"
            f"\n任务复杂度判断: {complexity}\n用户请求: {text}"
        )
        return AutoSolvePlan(complexity=complexity, prompt=prompt)

    def enrich_prompt(self, user_request: str) -> Dict[str, Any]:
        plan = self.plan(user_request)
        return {
            "complexity": plan.complexity,
            "prompt": plan.prompt,
            "single_agent_preferred": plan.complexity == "simple",
        }
