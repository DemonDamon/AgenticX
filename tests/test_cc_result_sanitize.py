#!/usr/bin/env python3
"""Unit tests for Claude Code harness result-text sanitization.

Fixtures mirror leaked assistant content from session
``3a01dde2-9e2c-413a-b6b1-e8fec5d86d48`` (harness ``claude-code``): English
planning / identity drafts and raw think-close markers ending up in Near's
user-visible reply via NDJSON ``type=result``.

Author: Damon Li
"""

from __future__ import annotations

import ujson

from agenticx.harness.adapters.claude_code import _last_result_text
from agenticx.harness.cc_result_sanitize import sanitize_claude_code_result_text


def test_strip_answer_briefly_english_planning_preamble() -> None:
    raw = (
        "User asks in Chinese: 你是 Claude Code 吗？ "
        "Answer briefly: 是的，我在 Claude Code 环境中运行。"
    )
    out = sanitize_claude_code_result_text(raw)
    assert out == "是的，我在 Claude Code 环境中运行。"
    assert "Answer briefly" not in out
    assert "User asks" not in out


def test_strip_before_last_think_close_and_answer_simply() -> None:
    raw = (
        "Answer simply: I'm running in a Claude Code-like harness "
        "with gateway routing. </think>可以说是，也可以说不是"
    )
    out = sanitize_claude_code_result_text(raw)
    assert out == "可以说是，也可以说不是"
    assert "Answer simply" not in out
    assert "</think>" not in out
    assert "<think>" not in out


def test_orphan_think_close_only_prefix() -> None:
    raw = "</think>你好！有什么我可以帮你的吗？"
    out = sanitize_claude_code_result_text(raw)
    assert out == "你好！有什么我可以帮你的吗？"
    assert "</think>" not in out


def test_paired_think_block_stripped() -> None:
    raw = "<think>planning identity draft here</think>最终答复"
    assert sanitize_claude_code_result_text(raw) == "最终答复"


def test_plain_user_facing_text_unchanged() -> None:
    assert sanitize_claude_code_result_text("  你好，正常回复  ") == "你好，正常回复"


def test_empty_and_whitespace() -> None:
    assert sanitize_claude_code_result_text("") == ""
    assert sanitize_claude_code_result_text("   \n  ") == ""
    assert sanitize_claude_code_result_text(None) == ""  # type: ignore[arg-type]


def test_answer_directive_without_body_left_alone() -> None:
    # No body after the marker → do not return empty by stripping everything.
    raw = "Answer briefly:"
    assert sanitize_claude_code_result_text(raw) == "Answer briefly:"


def test_redacted_thinking_close_cuts_preamble() -> None:
    raw = "drafting… </redacted_thinking>可见正文"
    assert sanitize_claude_code_result_text(raw) == "可见正文"


class _FakeSession:
    def __init__(self, lines: list[str]) -> None:
        import threading

        self.lines = lines
        self.lock = threading.Lock()


def test_last_result_text_sanitizes_ndjson_result_field() -> None:
    payload = {
        "type": "result",
        "result": (
            "Answer simply: I'm running in a Claude Code-like setup. "
            "</think>可以说是，也可以说不是"
        ),
    }
    session = _FakeSession([ujson.dumps(payload)])
    out = _last_result_text(session)  # type: ignore[arg-type]
    assert out == "可以说是，也可以说不是"
    assert "Answer simply" not in out
    assert "</think>" not in out
