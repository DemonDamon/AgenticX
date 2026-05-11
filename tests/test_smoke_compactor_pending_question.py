#!/usr/bin/env python3
"""Smoke tests for compactor pending user question feature (FR-5/FR-6/FR-7).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Dict, List

import pytest

# Add parent to path
sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from agenticx.runtime.compactor import ContextCompactor


class _MockLLM:
    """Mock LLM for testing compactor."""

    def __init__(self, response: str = "Test summary"):
        self._response = response

    def invoke(self, messages, **kwargs):
        class Response:
            def __init__(self, content):
                self.content = content
        return Response(self._response)


class TestExtractPendingUserQuestion:
    """Test suite for pending user question extraction (AC-5)."""

    def test_pending_question_extracted_when_only_tool_calls_after(self):
        """AC-5: Pending question extracted when only tool/assistant-with-tool-calls follow user."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        messages = [
            {"role": "user", "content": "50 万文档企业知识库参考 openviking 出方案"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "Some result"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "file_read"}}]},
        ]
        pending = c._extract_pending_user_question(messages)
        assert pending == "50 万文档企业知识库参考 openviking 出方案"

    def test_pending_question_empty_when_final_assistant_response_exists(self):
        """AC-5: Pending question empty when final assistant text response exists after user."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        messages = [
            {"role": "user", "content": "What is the weather?"},
            {"role": "assistant", "content": "The weather is sunny today."},  # Final response
        ]
        pending = c._extract_pending_user_question(messages)
        assert pending == ""

    def test_pending_question_most_recent_unanswered_user(self):
        """AC-5: When multiple user messages, use most recent unanswered one."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        messages = [
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "First answer"},
            {"role": "user", "content": "Second question"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "Result"},
        ]
        pending = c._extract_pending_user_question(messages)
        assert pending == "Second question"

    def test_pending_question_capped_at_4000_chars(self):
        """AC-5: Very long user question is capped at 4000 chars."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        long_question = "Q: " + "A" * 10000
        messages = [
            {"role": "user", "content": long_question},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
        ]
        pending = c._extract_pending_user_question(messages)
        assert len(pending) <= 4000
        assert pending.startswith("Q: ")


class TestCompactedMessageContent:
    """Test suite for compacted message content with pending question (AC-5/AC-6)."""

    @pytest.mark.asyncio
    async def test_compacted_message_starts_with_pending_question(self):
        """AC-5: compacted_message.content must start with [user-pending-question] line."""
        c = ContextCompactor(_MockLLM(), threshold_messages=5, retain_recent_messages=2)
        messages = [
            {"role": "user", "content": "50 万文档企业知识库参考 openviking 出方案"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "Result"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "file_read"}}]},
            {"role": "tool", "name": "file_read", "content": "File content"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "todo_write"}}]},
            {"role": "tool", "name": "todo_write", "content": "OK"},
        ]
        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages, force=True)

        assert did_compact is True
        assert compacted[0]["role"] == "system"
        content = compacted[0]["content"]

        # Content must start with [user-pending-question]
        assert content.startswith("[user-pending-question] 50 万文档企业知识库参考 openviking 出方案")
        # pending_q return value must match
        assert pending_q == "50 万文档企业知识库参考 openviking 出方案"

    @pytest.mark.asyncio
    async def test_no_pending_question_when_user_answered(self):
        """AC-5: When user was answered, content should NOT have [user-pending-question] line."""
        # Note: threshold_messages=8, retain_recent_messages=4 are the minimums enforced by constructor
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        # Need at least 9 messages to trigger compaction (8+1)
        messages = [
            {"role": "user", "content": "What is 2+2?"},
            {"role": "assistant", "content": "2+2 equals 4."},  # Final answer
            {"role": "user", "content": "Next question"},
            {"role": "assistant", "content": "Next answer."},  # Also answered
            {"role": "user", "content": "msg5"},
            {"role": "assistant", "content": "ans5"},
            {"role": "user", "content": "msg6"},
            {"role": "assistant", "content": "ans6"},
            {"role": "user", "content": "msg7"},
            {"role": "assistant", "content": "ans7"},
        ]
        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages, force=True)

        assert did_compact is True
        content = compacted[0]["content"]

        # No pending question since all users were answered
        assert "[user-pending-question]" not in content
        assert pending_q == ""

    @pytest.mark.asyncio
    async def test_pending_question_present_when_most_recent_unanswered(self):
        """AC-5: When most recent user message is unanswered, it should be in content."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        messages = [
            {"role": "user", "content": "Answered question"},
            {"role": "assistant", "content": "Final answer"},  # This answers the user
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "Result"},
            {"role": "user", "content": "Unanswered follow-up"},  # This is pending!
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "file_read"}}]},
            {"role": "tool", "name": "file_read", "content": "Content"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "todo_write"}}]},
            {"role": "tool", "name": "todo_write", "content": "OK"},
        ]
        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages, force=True)

        assert did_compact is True
        content = compacted[0]["content"]

        # Most recent unanswered user is "Unanswered follow-up"
        assert "[user-pending-question] Unanswered follow-up" in content
        assert pending_q == "Unanswered follow-up"


class TestCompactionPromptPrioritization:
    """Test suite for compaction prompt changes (FR-6)."""

    def test_prompt_includes_pending_question_priority(self):
        """FR-6: Compaction prompt must emphasize pending question as highest priority."""
        c = ContextCompactor(_MockLLM())
        messages = [{"role": "user", "content": "Test"}]
        prompt = c._build_compaction_prompt(messages, memory_prefix="[test]")

        assert "最高优先级" in prompt
        assert "pending_user_question" in prompt
        assert "任何对该问题的偏离/降级回答都视为压缩失败" in prompt


class TestNoCompaction:
    """Test suite for when compaction doesn't occur."""

    @pytest.mark.asyncio
    async def test_no_compaction_returns_empty_pending(self):
        """When compaction doesn't happen, pending_question should be empty."""
        c = ContextCompactor(_MockLLM(), threshold_messages=100)  # High threshold
        # Need fewer than retain_recent_messages (min 4) messages to not compact
        messages = [
            {"role": "user", "content": "Q1"},
            {"role": "assistant", "content": "A1"},
            {"role": "user", "content": "Q2"},
        ]

        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages)

        assert did_compact is False
        assert pending_q == ""


class TestPendingQuestionDeduplication:
    """Code-review fix #4: pending_user_question must not be duplicated in [session_memory] block."""

    @pytest.mark.asyncio
    async def test_pending_question_not_duplicated_in_session_memory(self):
        """Pending question appears only once at the top, not also inside [session_memory] JSON."""
        c = ContextCompactor(_MockLLM(), threshold_messages=8, retain_recent_messages=4)
        unique_marker = "UNIQUE_QUESTION_MARKER_42"
        messages = [
            {"role": "user", "content": unique_marker},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec"}}]},
            {"role": "tool", "name": "bash_exec", "content": "Result"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "file_read"}}]},
            {"role": "tool", "name": "file_read", "content": "File content"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "todo_write"}}]},
            {"role": "tool", "name": "todo_write", "content": "OK"},
        ]
        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages, force=True)

        assert did_compact is True
        content = compacted[0]["content"]

        # pending question marker should appear EXACTLY once (only in [user-pending-question] line)
        # The MockLLM summary is "Test summary" so won't contain the marker.
        assert content.count(unique_marker) == 1, (
            f"Expected unique_marker exactly once in content, got {content.count(unique_marker)}.\n"
            f"Full content:\n{content}"
        )
        assert pending_q == unique_marker
        # Specifically, [session_memory] block must not include pending_user_question key
        assert "pending_user_question" not in content


class TestPendingQuestionWithToolChain:
    """Test realistic tool call chain scenarios."""

    @pytest.mark.asyncio
    async def test_long_tool_chain_preserves_original_question(self):
        """AC-6: Long tool chain should preserve original user question."""
        c = ContextCompactor(_MockLLM(), threshold_messages=3, retain_recent_messages=2)

        original_question = "对于一个具有五十万个文档的企业级知识库来说，仅用RAG是否合适和足够？"
        messages = [
            {"role": "user", "content": original_question},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "bash_exec", "arguments": "{}"}}]},
            {"role": "tool", "name": "bash_exec", "content": "ls -la"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "file_read", "arguments": "{}"}}]},
            {"role": "tool", "name": "file_read", "content": "file content"},
            {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "grep", "arguments": "{}"}}]},
            {"role": "tool", "name": "grep", "content": "grep results"},
        ]

        compacted, did_compact, _summary, _count, pending_q = await c.maybe_compact(messages, force=True)

        assert did_compact is True
        assert pending_q == original_question
        assert compacted[0]["content"].startswith(f"[user-pending-question] {original_question}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
