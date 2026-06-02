#!/usr/bin/env python3
"""Tests for follow-up stream parsing and model control-token cleanup."""

from __future__ import annotations

from agenticx.runtime.followup_stream import (
    split_final_answer_and_followups,
    strip_model_control_artifacts,
)


def test_strip_model_control_artifacts_removes_mangled_minimax_tail() -> None:
    raw = "再查下知识库里 AI 网关的限流、路由、Fallback 相关内容]<]minimax[>["
    assert strip_model_control_artifacts(raw) == (
        "再查下知识库里 AI 网关的限流、路由、Fallback 相关内容"
    )


def test_strip_model_control_artifacts_preserves_plain_minimax_word() -> None:
    assert strip_model_control_artifacts("对比 MiniMax 与豆包的差异") == "对比 MiniMax 与豆包的差异"


def test_split_final_strips_minimax_from_followup_lines() -> None:
    body, lines = split_final_answer_and_followups(
        "正文回答。\n<followups>\n"
        "问题一\n"
        "问题二\n"
        "再查下 Fallback 相关内容]<]minimax[>[\n"
        "</followups>"
    )
    assert body == "正文回答。"
    assert lines[2] == "再查下 Fallback 相关内容"

