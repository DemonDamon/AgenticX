#!/usr/bin/env python3
"""钉住确认 / 澄清工具结果串的形态。

这些串不只给模型看：Desktop 的 ``summarizeUserDecision``
（desktop/src/components/messages/ToolCallCard.tsx）按前缀解析它们，
把用户的选择显示在折叠起来的卡片标题上。两边靠字符串耦合，没有共享常量，
所以改这里的措辞必须同步改那边。

这个文件存在的原因：前端原本只认「用户选择：」一种形态，而后端产出九种，
于是「已取消」「自定义补充」「超时」全都掉进 fallback——用户明明点了取消，
卡片还显示「等待你确认」。
"""

from __future__ import annotations

import pytest

from agenticx.cli.agent_tools import (
    build_action_confirmation_tool_result,
    build_clarification_tool_result,
)

# 前端 switch 的锚点。删一条或改一个字，对应的卡片标题就会退回 "等待你确认"。
TS_CONSUMER = "desktop/src/components/messages/ToolCallCard.tsx::summarizeUserDecision"


@pytest.mark.parametrize(
    "answer, prefix",
    [
        ({"selected_options": ["确认执行"]}, "[ACTION_CONFIRMED]"),
        ({"selected_options": ["取消"]}, "[ACTION_REJECTED]"),
        ({"answer_text": "确认"}, "[ACTION_CONFIRMED]"),
        ({"answer_text": "不用了"}, "[ACTION_REJECTED]"),
        ({}, "[ACTION_REJECTED]"),  # 空答复绝不能默默放行
        ({"__timeout__": True}, "[ACTION_CONFIRMATION_EXPIRED]"),
        ({"__suspended__": True}, "[ACTION_CONFIRMATION_SUSPENDED]"),
    ],
)
def test_action_confirmation_prefixes(answer: dict, prefix: str) -> None:
    assert build_action_confirmation_tool_result(answer).startswith(prefix), TS_CONSUMER


def test_action_rejected_distinguishes_explicit_cancel_from_silence() -> None:
    """前端靠「已取消执行」这四个字区分「点了取消」和「没答」。"""
    explicit = build_action_confirmation_tool_result({"selected_options": ["取消"]})
    silent = build_action_confirmation_tool_result({})
    assert "已取消执行" in explicit, TS_CONSUMER
    assert "已取消执行" not in silent, TS_CONSUMER


@pytest.mark.parametrize(
    "answer, prefix",
    [
        ({"selected_options": ["方案 A"]}, "用户选择："),
        ({"answer_text": "先跑测试"}, "自定义补充："),
        ({}, "用户未提供具体内容"),
        ({"__timeout__": True}, "[CLARIFICATION_TIMEOUT]"),
        ({"__suspended__": True}, "[CLARIFICATION_PENDING]"),
    ],
)
def test_clarification_prefixes(answer: dict, prefix: str) -> None:
    assert build_clarification_tool_result(answer).startswith(prefix), TS_CONSUMER


def test_clarification_puts_selection_first_when_both_present() -> None:
    """两者都有时「用户选择：」必须在前——前端只切掉开头那个标签。"""
    out = build_clarification_tool_result(
        {"selected_options": ["A"], "answer_text": "再加个开关"}
    )
    assert out.startswith("用户选择："), TS_CONSUMER
    assert "自定义补充：" in out
