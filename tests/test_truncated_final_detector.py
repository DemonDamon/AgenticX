"""Unit tests for model-agnostic truncated terminal reply detection."""

from __future__ import annotations

from agenticx.runtime.truncated_final import detect_suspected_truncated_final


def _detect(
    *,
    body: str,
    reasoning: str = "",
    had_tool_calls: bool = False,
    executed_tools: list[str] | None = None,
    finish_reason: str = "",
) -> str:
    return detect_suspected_truncated_final(
        visible_body=body,
        reasoning_text=reasoning,
        had_tool_calls_this_round=had_tool_calls,
        executed_tool_names=executed_tools or [],
        finish_reason=finish_reason,
    )


def test_detects_short_unterminated_body_with_english_action_intent() -> None:
    assert _detect(
        body="团长，这条信息涉及具体发布日期、定价和竞品对比",
        reasoning="I need to search the web to verify this. Let me do that.",
    ) == "short_unterminated_with_intent"


def test_missing_finish_reason_does_not_trigger_without_action_intent() -> None:
    assert _detect(body="我来继续核实这个信息") == ""


def test_ignores_long_body_even_without_terminal_punctuation() -> None:
    assert _detect(body="这是正常的说明文本" * 20) == ""


def test_ignores_complete_body() -> None:
    assert _detect(body="好的，我已经处理完了。") == ""


def test_ignores_turns_that_called_or_executed_tools() -> None:
    assert _detect(
        body="我来继续核实这个信息",
        reasoning="Let me search the web.",
        had_tool_calls=True,
    ) == ""
    assert _detect(
        body="我来继续核实这个信息",
        reasoning="Let me search the web.",
        executed_tools=["web_search"],
    ) == ""


def test_ignores_short_unterminated_body_with_explicit_stop_and_no_intent() -> None:
    assert _detect(body="简短但完整", finish_reason="stop") == ""


def test_treats_ellipsis_as_unterminated_when_action_is_declared() -> None:
    assert _detect(
        body="我正在继续核实…",
        reasoning="Let me search the web.",
        finish_reason="stop",
    ) == "short_unterminated_with_intent"
