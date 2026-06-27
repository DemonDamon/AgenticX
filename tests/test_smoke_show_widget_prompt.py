"""Smoke tests for show_widget system prompt discipline."""

from __future__ import annotations

from agenticx.runtime.prompts.meta_agent import _build_widget_capability_block


def test_widget_capability_block_forbids_text_flow_diagrams() -> None:
    block = _build_widget_capability_block()
    assert "show_widget" in block
    assert "硬性纪律" in block
    assert "```text" in block
    assert "mitmproxy" in block
    assert "A -> B -> C" in block


def test_widget_capability_block_requires_visible_bridge_before_widget() -> None:
    block = _build_widget_capability_block()
    assert "衔接语" in block
    assert "思考块" in block
    assert "可见正文" in block
