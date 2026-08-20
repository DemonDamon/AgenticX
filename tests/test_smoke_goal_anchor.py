#!/usr/bin/env python3
"""Smoke tests for user goal anchor injection (FR-1/FR-2/FR-3).

Author: Damon Li
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

# Add parent to path
sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from agenticx.runtime.agent_runtime import (
    _inject_goal_anchor,
    _build_user_goal_anchor,
    _detect_pathological_goal_anchor_echo,
)


@dataclass
class MockStudioSession:
    """Minimal mock of StudioSession for testing."""

    session_id: str = "test-session-001"
    _session_id: str = "test-session-001"
    current_user_intent: Optional[str] = None
    agent_messages: List[Dict[str, Any]] = field(default_factory=list)


class TestBuildUserGoalAnchor:
    """Test suite for _build_user_goal_anchor function (AC-2, AC-3)."""

    def test_returns_none_when_intent_is_none(self):
        """AC-2: Returns None if session.current_user_intent is None (NFR-4)."""
        session = MockStudioSession(current_user_intent=None)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is None

    def test_returns_none_when_disable_env_set(self):
        """AC-3: AGX_GOAL_ANCHOR_DISABLE=1 should completely disable anchor (NFR-6)."""
        session = MockStudioSession(current_user_intent="Test query")
        with patch.dict(os.environ, {"AGX_GOAL_ANCHOR_DISABLE": "1"}):
            result = _build_user_goal_anchor(
                session=session,
                round_idx=1,
                max_rounds=10,
                tools_used_so_far=0,
                messages_total_chars=1000,
            )
        assert result is None

    def test_first_round_minimal_mode(self):
        """AC-3: First round (round=1, tools=0) should use minimal mode (≤80 chars)."""
        session = MockStudioSession(current_user_intent="Test query")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is not None
        assert result["role"] == "system"
        assert result["content"].startswith("[user-goal-anchor]")
        assert "Test query" in result["content"]
        # Minimal mode should be ≤80 chars (short intent)
        assert len(result["content"]) <= 80 or "[user-goal-anchor] Test query" == result["content"]

    def test_first_round_long_intent_truncated(self):
        """Minimal mode truncates long intent to fit 80 char budget."""
        long_intent = "A" * 200
        session = MockStudioSession(current_user_intent=long_intent)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is not None
        assert len(result["content"]) <= 80

    def test_complex_tools_trigger_full_mode(self):
        """AC-3: tools_used >= 3 triggers full mode."""
        session = MockStudioSession(current_user_intent="What is the weather?")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=3,
            messages_total_chars=1000,
        )
        assert result is not None
        content = result["content"]
        # Full mode should contain the concise execution requirements.
        assert "执行要求：" in content
        assert "1. 本轮所有工具调用与最终答复必须直接服务于上述问题" in content
        assert "2. 若发现自己正在重复上一轮已做过的分析" in content
        assert "3. 工具调用累计 >= 5 次" in content
        assert "4. 不要输出 [user-goal-anchor]" in content
        assert "(round 2/10, tools_used_so_far=3)" in content

    def test_complex_chars_trigger_full_mode(self):
        """AC-3: messages_total_chars >= 20000 triggers full mode."""
        session = MockStudioSession(current_user_intent="Analyze this data")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,
            messages_total_chars=25000,
        )
        assert result is not None
        assert "执行要求：" in result["content"]

    def test_historical_agent_messages_do_not_trigger_full_mode(self):
        """Historical turns alone must not escalate the current anchor."""
        session = MockStudioSession(
            current_user_intent="Process files",
            agent_messages=[{"role": "user"}] * 8,
        )
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,
            messages_total_chars=1000,
        )
        assert result is not None
        assert "执行要求：" not in result["content"]

    def test_current_turn_message_count_triggers_full_mode(self):
        """A long current turn can still escalate the anchor."""
        session = MockStudioSession(current_user_intent="Process files")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,
            messages_total_chars=1000,
            current_turn_message_count=8,
        )
        assert result is not None
        assert "执行要求：" in result["content"]

    def test_compact_mode_for_middle_ground(self):
        """AC-3: Not first round and not complex = compact mode."""
        session = MockStudioSession(current_user_intent="Middle ground test")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,  # Below full trigger
            messages_total_chars=5000,  # Below full trigger
        )
        assert result is not None
        content = result["content"]
        # Compact mode should have anchor marker and query but no disciplines
        assert "[user-goal-anchor]" in content
        assert "Middle ground test" in content
        assert "执行要求：" not in content  # No requirements in compact mode
        assert "(round 2/10)" in content

    def test_custom_thresholds_via_env(self):
        """AC-3: Custom thresholds via environment variables."""
        session = MockStudioSession(current_user_intent="Custom threshold test")
        env_vars = {
            "AGX_GOAL_ANCHOR_FULL_TRIGGER_TOOLS": "5",
            "AGX_GOAL_ANCHOR_FULL_TRIGGER_CHARS": "50000",
        }
        with patch.dict(os.environ, env_vars):
            # With custom thresholds, 3 tools should NOT trigger full mode
            result = _build_user_goal_anchor(
                session=session,
                round_idx=2,
                max_rounds=10,
                tools_used_so_far=3,
                messages_total_chars=1000,
            )
            assert result is not None
            # Should be compact, not full (since threshold is now 5)
            assert "执行要求：" not in result["content"]

    def test_anchor_contains_original_query_verbatim(self):
        """AC-2: Anchor must contain original query verbatim (no rewriting)."""
        original_query = "对于一个具有五十万个文档的企业级知识库来说，仅用RAG是否合适和足够？"
        session = MockStudioSession(current_user_intent=original_query)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is not None
        # Even in minimal mode, the query should appear verbatim
        assert original_query[:70] in result["content"] or original_query in result["content"]


class TestGoalAnchorSessionLifecycle:
    """Test session lifecycle integration for goal anchor."""

    def test_intent_persisted_across_rounds(self):
        """AC-2: current_user_intent should persist across rounds if not overwritten."""
        session = MockStudioSession(current_user_intent="Persistent query")

        # Round 1
        result1 = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result1 is not None
        assert "Persistent query" in result1["content"]

        # Round 2 (same session, same intent)
        result2 = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,
            messages_total_chars=2000,
        )
        assert result2 is not None
        assert "Persistent query" in result2["content"]


class TestGoalAnchorEdgeCases:
    """Edge case tests for goal anchor."""

    def test_empty_intent_returns_none(self):
        """Empty string intent should return None (treated as missing)."""
        session = MockStudioSession(current_user_intent="")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is None

    def test_whitespace_only_intent_returns_none(self):
        """Whitespace-only intent should return None."""
        session = MockStudioSession(current_user_intent="   \n\t  ")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=1,
            max_rounds=10,
            tools_used_so_far=0,
            messages_total_chars=1000,
        )
        assert result is None

    def test_very_long_intent_in_full_mode(self):
        """Very long intent should be capped at reasonable limit even in full mode."""
        long_intent = "Question: " + "A" * 10000
        session = MockStudioSession(current_user_intent=long_intent)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=5,
            messages_total_chars=30000,
        )
        assert result is not None
        # Should still contain the intent but may be truncated in output
        assert "Question:" in result["content"]

    def test_full_mode_intent_capped_at_2000_chars(self):
        """Code-review fix #3: full mode caps intent verbatim block at 2000 chars."""
        long_intent = "Q:" + ("X" * 5000)
        session = MockStudioSession(current_user_intent=long_intent)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=5,
            messages_total_chars=30000,
        )
        assert result is not None
        # The verbatim "X" run inside the anchor body must not exceed 2000 chars (cap),
        # even though the original intent was 5002 chars long.
        # Count consecutive Xs in content.
        max_x_run = 0
        cur = 0
        for ch in result["content"]:
            if ch == "X":
                cur += 1
                max_x_run = max(max_x_run, cur)
            else:
                cur = 0
        # Cap allows up to 2000; the leading "Q:" eats 2 of the 2000-char budget so X-run is ≤1998.
        assert max_x_run <= 2000, f"X run {max_x_run} exceeds 2000-char cap"

    def test_compact_mode_intent_capped_at_2000_chars(self):
        """Code-review fix #3: compact mode also caps intent at 2000 chars."""
        long_intent = "Q:" + ("Y" * 5000)
        session = MockStudioSession(current_user_intent=long_intent)
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=1,  # Below full trigger
            messages_total_chars=5000,
        )
        assert result is not None
        # Should be compact mode (no disciplines) but still capped
        assert "执行要求：" not in result["content"]
        max_y_run = 0
        cur = 0
        for ch in result["content"]:
            if ch == "Y":
                cur += 1
                max_y_run = max(max_y_run, cur)
            else:
                cur = 0
        assert max_y_run <= 2000

    def test_full_mode_stop_threshold_tracks_env(self):
        """Code-review fix #2: discipline #3 stop_threshold derives from env, not hard-coded 5."""
        session = MockStudioSession(current_user_intent="Q")
        # With trigger_tools=10, stop_threshold = max(10+2, 5) = 12.
        env_vars = {"AGX_GOAL_ANCHOR_FULL_TRIGGER_TOOLS": "10"}
        with patch.dict(os.environ, env_vars):
            result = _build_user_goal_anchor(
                session=session,
                round_idx=2,
                max_rounds=20,
                tools_used_so_far=10,  # Hits new trigger threshold
                messages_total_chars=1000,
            )
        assert result is not None
        content = result["content"]
        assert "执行要求：" in content
        # New behavior: discipline #3 should mention 12, not the legacy "5"
        assert "工具调用累计 >= 12 次" in content
        assert "工具调用累计 >= 5 次" not in content

    def test_full_mode_stop_threshold_default(self):
        """Code-review fix #2: default trigger=3 yields stop_threshold = max(3+2, 5) = 5."""
        session = MockStudioSession(current_user_intent="Q")
        result = _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=3,
            messages_total_chars=1000,
        )
        assert result is not None
        # Default keeps "5" so existing behavior preserved.
        assert "工具调用累计 >= 5 次" in result["content"]

    def test_tool_result_tokens_trigger_full_mode(self):
        """M4: 工具结果累计 token 高时强制走 full 锚点。

        原来这条还断言 ``_goal_anchor_prepend is True``。那个标志描述的是"锚点插在
        开头的 system 块里"，而位置已经统一改到尾部（见 _inject_goal_anchor 的注释：
        插在头部会让整段 append-only 的历史每轮全价重算）。``force_full_anchor``
        这个信号本身还在，它决定的是**用哪种模式**，从来不是插在哪。
        """
        session = MockStudioSession(current_user_intent="Install skills from repo")
        with patch.dict(os.environ, {"AGX_ANCHOR_RESTRENGTHEN_THRESHOLD": "1000"}):
            result = _build_user_goal_anchor(
                session=session,
                round_idx=2,
                max_rounds=10,
                tools_used_so_far=1,
                messages_total_chars=1000,
                tool_result_tokens_session=5000,
            )
        assert result is not None
        assert "执行要求：" in result["content"]
        assert getattr(session, "_goal_anchor_placement", "") == "tail"

    def test_function_does_not_mutate_session(self):
        """_build_user_goal_anchor must not alter intent or agent_messages."""
        session = MockStudioSession(current_user_intent="Original intent")
        snapshot_intent = session.current_user_intent
        snapshot_msgs = list(session.agent_messages)
        _build_user_goal_anchor(
            session=session,
            round_idx=2,
            max_rounds=10,
            tools_used_so_far=5,
            messages_total_chars=30000,
        )
        assert session.current_user_intent == snapshot_intent
        assert session.agent_messages == snapshot_msgs


class TestAnchorEphemeralBehavior:
    """Code-review fix #1: verify anchor injection doesn't pollute the message array.

    These tests directly assert the helper signature/behavior. The runtime-level
    non-mutation invariant (anchor never appears in session.agent_messages or
    persisted history) is enforced by agent_runtime.py inserting the anchor into
    a copied message list and passing it to LLM calls without rebinding `messages`.
    """

    def test_anchor_message_is_a_fresh_dict(self):
        """Each call returns a new dict (no shared mutable reference)."""
        session = MockStudioSession(current_user_intent="Test")
        a1 = _build_user_goal_anchor(
            session=session, round_idx=1, max_rounds=10,
            tools_used_so_far=0, messages_total_chars=1000,
        )
        a2 = _build_user_goal_anchor(
            session=session, round_idx=1, max_rounds=10,
            tools_used_so_far=0, messages_total_chars=1000,
        )
        assert a1 is not None and a2 is not None
        assert a1 is not a2  # Distinct objects—safe to mutate one without affecting the other.

    def test_injection_appends_at_the_tail_without_touching_the_original(self):
        """锚点追加在末尾，且不动入参列表。

        这条原来自己把 agent_runtime 的插入算法抄了一遍再断言，等于测自己抄的那份；
        现在直接调真的 ``_inject_goal_anchor``。位置也从 ``messages_for_llm[1]``
        改成了末尾——历史必须紧贴 system prompt，否则每轮都白算一遍。
        """
        session = MockStudioSession(current_user_intent="Test")
        anchor = _build_user_goal_anchor(
            session=session, round_idx=2, max_rounds=10,
            tools_used_so_far=3, messages_total_chars=1000,
        )
        assert anchor is not None

        original_messages = [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
        ]
        original_len = len(original_messages)
        messages_for_llm = _inject_goal_anchor(original_messages, anchor)

        # 入参必须原样：锚点是 ephemeral 的，绝不能进 session.agent_messages。
        assert len(original_messages) == original_len
        assert original_messages[-1] == {"role": "user", "content": "hi"}
        assert messages_for_llm is not original_messages
        # 系统提示词之后立刻就是历史，锚点在最末。
        assert messages_for_llm[0]["role"] == "system"
        assert messages_for_llm[1] == {"role": "user", "content": "hi"}
        assert messages_for_llm[-1] == anchor
        assert len(messages_for_llm) == original_len + 1

    def test_injection_is_a_noop_without_an_anchor(self):
        messages = [{"role": "system", "content": "sys"}]
        assert _inject_goal_anchor(messages, None) is messages


class TestGoalAnchorEchoGuard:
    def test_short_or_normal_text_is_not_blocked(self):
        assert _detect_pathological_goal_anchor_echo("[user-goal-anchor]" * 10) is None
        normal = "项目 | 说明\n" + "| A | 这是普通表格内容 |\n" * 100
        assert _detect_pathological_goal_anchor_echo(normal) is None

    def test_repeated_internal_anchor_is_detected(self):
        repeated = " ".join(
            ["[user-goal-anchor] 用户目标锚点 执行要求：生成表格"] * 80
        )
        result = _detect_pathological_goal_anchor_echo(repeated)
        assert result is not None
        assert result["marker"] == "[user-goal-anchor]"
        assert result["count"] == 80


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# --------------------------------------------------------------------------
# 强模型不注入 anchor
# --------------------------------------------------------------------------
@dataclass
class _ModelSession(MockStudioSession):
    provider_name: str = ""
    model_name: str = ""
    declared_context_window: Optional[int] = None


def _anchor_for(session) -> Optional[Dict[str, Any]]:
    return _build_user_goal_anchor(
        session=session,
        round_idx=3,
        max_rounds=10,
        tools_used_so_far=1,
        messages_total_chars=5_000,
    )


class TestStrongModelSuppression:
    """anchor 是给注意力会在长上下文里漂的模型用的护栏；强模型上它是噪声。"""

    def test_million_token_model_gets_no_anchor(self):
        for model in ("kimi-k3", "glm-5.2", "gemini-2.5-pro"):
            session = _ModelSession(
                current_user_intent="帮我分析这份财报", provider_name="p", model_name=model
            )
            assert _anchor_for(session) is None, model

    def test_smaller_models_keep_the_anchor(self):
        for model in ("kimi-k2", "gpt-5", "claude-opus-4", "deepseek-v3", "qwen3-vl-27b"):
            session = _ModelSession(
                current_user_intent="帮我分析这份财报", provider_name="p", model_name=model
            )
            anchor = _anchor_for(session)
            assert anchor is not None and "[user-goal-anchor]" in anchor["content"], model

    def test_strength_reads_endpoint_capability_not_the_harness_window(self):
        """1M 模型的 harness 窗口是 262K —— 拿它去和 512K 比会得出「弱模型」，正好反了。"""
        from agenticx.runtime.model_context_window import (
            is_strong_context_model,
            resolve_context_window,
            resolve_model_capability,
        )

        assert resolve_model_capability("kimi-k3") == 1_048_576
        assert resolve_context_window("kimi-k3") == 262_144    # < 512K
        assert is_strong_context_model("kimi-k3") is True

    def test_admin_declared_window_decides_for_models_the_table_never_heard_of(self):
        """企业管理员填的窗口最可信，前缀表只是兜底。"""
        weak = _ModelSession(
            current_user_intent="分析",
            provider_name="enterprise",
            model_name="vendor-internal-x",
            declared_context_window=200_000,
        )
        strong = _ModelSession(
            current_user_intent="分析",
            provider_name="enterprise",
            model_name="vendor-internal-x",
            declared_context_window=1_000_000,
        )
        assert _anchor_for(weak) is not None
        assert _anchor_for(strong) is None

    def test_force_env_brings_the_anchor_back_for_a_b_testing(self):
        session = _ModelSession(
            current_user_intent="分析", provider_name="p", model_name="kimi-k3"
        )
        assert _anchor_for(session) is None
        with patch.dict(os.environ, {"AGX_GOAL_ANCHOR_FORCE": "1"}):
            assert _anchor_for(session) is not None

    def test_switching_models_mid_session_re_evaluates(self):
        """附件路由会在会话中途把模型切到私有化 Qwen —— 缓存必须跟着 key 失效。"""
        session = _ModelSession(
            current_user_intent="分析这份 PDF", provider_name="p", model_name="kimi-k3"
        )
        assert _anchor_for(session) is None
        session.model_name = "qwen3-vl-27b"
        session.provider_name = "enterprise"
        assert _anchor_for(session) is not None
        session.model_name = "kimi-k3"
        session.provider_name = "p"
        assert _anchor_for(session) is None
