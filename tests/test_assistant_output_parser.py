#!/usr/bin/env python3
"""Tests for the canonical assistant output protocol parser.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.runtime.assistant_output import (
    AssistantOutputStreamParser,
    parse_assistant_output,
    sanitize_public_tool_summary,
    sanitize_suggested_questions,
    strip_model_control_artifacts,
)
from agenticx.runtime.followup_stream import (
    FollowupStreamEmitter,
    split_final_answer_and_followups,
)

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "assistant_output_protocol_cases.json"
)


def _load_cases() -> list[dict]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def test_golden_fixture_cases() -> None:
    for case in _load_cases():
        parsed = parse_assistant_output(case["raw"])
        assert parsed.reasoning == case["reasoning"], case["name"]
        assert parsed.visible_body == case["visible_body"], case["name"]
        assert list(parsed.suggested_questions) == case["suggested_questions"], case[
            "name"
        ]
        assert list(parsed.protocol_errors) == case["protocol_errors"], case["name"]
        assert parsed.malformed is case["malformed"], case["name"]


def test_stream_parser_matches_batch_on_fixtures() -> None:
    for case in _load_cases():
        parser = AssistantOutputStreamParser()
        raw = case["raw"]
        # Feed one character at a time to stress carry/partial tags.
        for ch in raw:
            parser.feed(ch)
        parsed = parser.finalize()
        assert parsed.reasoning == case["reasoning"], case["name"]
        assert parsed.visible_body == case["visible_body"], case["name"]
        assert list(parsed.suggested_questions) == case["suggested_questions"], case[
            "name"
        ]
        assert list(parsed.protocol_errors) == case["protocol_errors"], case["name"]


def test_body_plus_followups_without_reasoning() -> None:
    raw = "最终说明\n<followups>\n问题1\n问题2\n问题3\n</followups>"
    parsed = parse_assistant_output(raw)
    assert parsed.reasoning == ""
    assert parsed.visible_body == "最终说明\n"
    assert parsed.suggested_questions == ("问题1", "问题2", "问题3")
    assert parsed.protocol_errors == ()


def test_sanitize_rejects_wrong_counts_and_artifacts() -> None:
    assert sanitize_suggested_questions(["a", "b"], "body") == ()
    assert sanitize_suggested_questions(["a", "b", "c", "d"], "body") == ()
    assert sanitize_suggested_questions(
        ["a", "b", "<think>x"],
        "body",
    ) == ()
    assert sanitize_suggested_questions(
        ["# heading", "b", "c"],
        "body",
    ) == ()
    assert sanitize_suggested_questions(
        ["|a|b|", "b", "c"],
        "body",
    ) == ()
    assert sanitize_suggested_questions(
        ["```", "b", "c"],
        "body",
    ) == ()
    assert sanitize_suggested_questions(["a", "b", "c"], "") == ()


def test_minimax_strip_compatible() -> None:
    raw = "再查下 Fallback 相关内容]<]minimax[>["
    assert strip_model_control_artifacts(raw) == "再查下 Fallback 相关内容"
    body, lines = split_final_answer_and_followups(
        "正文回答。\n<followups>\n"
        "问题一\n"
        "问题二\n"
        "再查下 Fallback 相关内容]<]minimax[>[\n"
        "</followups>"
    )
    assert body == "正文回答。"
    assert lines == [
        "问题一",
        "问题二",
        "再查下 Fallback 相关内容",
    ]


def test_followup_emitter_does_not_leak_partial_followups() -> None:
    emitter = FollowupStreamEmitter(enabled=True)
    assert "问题" not in emitter.feed_append("<fol")
    assert "问题" not in emitter.feed_append("lowups>\n问题1\n问题2\n问题3\n")
    leaked = emitter.feed_append("</followups>")
    assert "问题1" not in leaked
    body, lines = emitter.finalize_text()
    assert body == ""
    assert lines == []


def test_followup_emitter_still_streams_think_reasoning() -> None:
    emitter = FollowupStreamEmitter(enabled=True)
    chunks = []
    for part in ("<think>", "推理中", "</think>", "可见正文"):
        chunks.append(emitter.feed_append(part))
    visible = "".join(chunks)
    assert "推理中" in visible
    assert "可见正文" in visible
    body, _ = emitter.finalize_text()
    assert body == "可见正文"


def test_sanitize_public_tool_summary_rejects_unsafe() -> None:
    ok = "数字分身「侠客」已创建并加入分身列表（id=avatar-1）。"
    assert sanitize_public_tool_summary(ok) == ok
    assert sanitize_public_tool_summary("<think>x</think>ok") is None
    assert sanitize_public_tool_summary("a\u200bok") is None
    assert sanitize_public_tool_summary("a\x00b") is None
