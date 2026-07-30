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


def test_finish_reason_length_triggers_even_for_long_bodies() -> None:
    body = (
        "风险\n\n- bug 修复窗口只有 1 小时。\n\n"
        "**一句话：1 天能做出演示版，演示完必须补 T4/T"
    )
    assert _detect(body=body, finish_reason="length") == "finish_reason_length"


def test_unbalanced_bold_markers_on_long_body() -> None:
    body = (
        "## 风险\n\n"
        "- bug 修复窗口只有 1 小时，演示前不要加新功能，有 bug 就绕过。\n\n"
        "---\n\n"
        "**一句话：1 天能做出「能看、能点、能干预」的演示版，但安全性和审计是裸的，演示完必须补 T4/T"
    )
    assert len(body) > 80
    assert _detect(body=body, finish_reason="stop") == "unbalanced_markdown"


def test_mid_path_cut_on_long_body_without_terminator() -> None:
    body = ("这是一段足够长的说明文字，用来超过短回复阈值。" * 3) + "\n\n补齐清单后还需完成 T4/T"
    assert _detect(body=body, finish_reason="stop") == "mid_path_cut"
