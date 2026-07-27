#!/usr/bin/env python3
"""Tests for the Meta-Agent visible response contract.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.cli.studio import StudioSession
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt


def test_meta_prompt_requires_visible_body_or_tool_call_each_round() -> None:
    prompt = build_meta_agent_system_prompt(
        StudioSession(),
        mode="interactive",
        taskspaces=[],
    )

    assert "每轮模型输出必须满足以下至少一项：产生用户可见正文，或产生合法 tool_call。" in prompt
    assert "reasoning / <think> 仅用于内部思考，不算用户可见回复。" in prompt
    assert "即使用户只是问候，也必须在同一轮输出简短可见正文；禁止只结束在 reasoning。" in prompt
    assert prompt.count("每轮模型输出必须满足以下至少一项") == 1
