#!/usr/bin/env python3
"""Smoke tests for compactor summary tag sanitization (FR-A.2).

Verifies that hallucinated `[xxx] ... [/xxx]` wrappers leaked from the
compaction prompt are stripped before the summary is written into the
session message list.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict, List

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from agenticx.runtime.compactor import ContextCompactor


class _MockLLM:
    """Mock LLM that returns a fixed response."""

    def __init__(self, response: str):
        self._response = response

    def invoke(self, messages, **kwargs):
        class Response:
            def __init__(self, content):
                self.content = content

        return Response(self._response)


class TestSanitizeSummaryText:
    """FR-A.2: hallucinated wrapper tags must be stripped from summary text."""

    def test_strips_pending_user_question_wrapper_with_prompt_leak(self):
        """The infamous `[pending_user_question] 请将以下对话压缩… [/pending_user_question]` block must be removed entirely."""
        leaked = (
            "[pending_user_question] 请将以下对话压缩成用于后续推理的精炼上下文。 [/pending_user_question]\n"
            "- 真实摘要要点 A\n"
            "- 真实摘要要点 B"
        )
        cleaned = ContextCompactor._sanitize_summary_text(leaked)
        assert "[pending_user_question]" not in cleaned
        assert "[/pending_user_question]" not in cleaned
        assert "请将以下对话压缩" not in cleaned
        assert "真实摘要要点 A" in cleaned
        assert "真实摘要要点 B" in cleaned

    def test_keeps_inner_content_when_no_prompt_leak(self):
        """If the wrapped content is real, only the wrapper should be peeled off, content preserved."""
        text = "[user-pending-question] 帮我评估 PyO3 混合架构 [/user-pending-question]\n- 决策要点"
        cleaned = ContextCompactor._sanitize_summary_text(text)
        assert "[user-pending-question]" not in cleaned
        assert "帮我评估 PyO3 混合架构" in cleaned
        assert "决策要点" in cleaned

    def test_strips_orphan_closing_tags(self):
        """Lone `[/foo]` tags without a matching opener are removed too."""
        text = "正常摘要\n[/pending_user_question]\n更多摘要"
        cleaned = ContextCompactor._sanitize_summary_text(text)
        assert "[/pending_user_question]" not in cleaned
        assert "正常摘要" in cleaned
        assert "更多摘要" in cleaned

    def test_passthrough_when_no_wrappers(self):
        text = "1. 决策 X\n2. 工具结果 Y"
        cleaned = ContextCompactor._sanitize_summary_text(text)
        assert cleaned == text

    def test_empty_input(self):
        assert ContextCompactor._sanitize_summary_text("") == ""

    def test_handles_nested_wrappers(self):
        """Nested wrappers should also be handled within the iteration cap."""
        text = (
            "[outer] [inner] 请将以下对话压缩成用于后续推理 [/inner] [/outer]\n"
            "- 真实内容"
        )
        cleaned = ContextCompactor._sanitize_summary_text(text)
        assert "请将以下对话压缩" not in cleaned
        assert "真实内容" in cleaned


class TestSummarizeAppliesSanitize:
    """FR-A.2 end-to-end: _summarize() output goes through sanitize."""

    def test_summary_pipeline_strips_leaked_tags(self):
        """maybe_compact() should write a sanitized summary into the system message."""
        polluted = (
            "[pending_user_question] 请将以下对话压缩成用于后续推理的精炼上下文。 [/pending_user_question]\n"
            "- 这才是真正的摘要"
        )
        compactor = ContextCompactor(
            _MockLLM(polluted), threshold_messages=4, retain_recent_messages=2
        )
        messages: List[Dict[str, Any]] = [
            {"role": "user", "content": "原始问题：请帮我做 X"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "result A"},
            {"role": "assistant", "content": "中间回复"},
            {"role": "user", "content": "继续 Y"},
            {"role": "assistant", "content": "OK"},
        ]
        new_msgs, did, summary, count, pending = asyncio.run(
            compactor.maybe_compact(messages, force=True)
        )
        assert did is True
        assert "[pending_user_question]" not in summary
        assert "[/pending_user_question]" not in summary
        assert "请将以下对话压缩" not in summary
        assert "这才是真正的摘要" in summary
        # And the synthesized system message must also be clean.
        assert new_msgs and new_msgs[0]["role"] == "system"
        sys_text = new_msgs[0]["content"]
        assert "[pending_user_question]" not in sys_text
        assert "[/pending_user_question]" not in sys_text


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
