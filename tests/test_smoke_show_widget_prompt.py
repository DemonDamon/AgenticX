"""Smoke tests for show_widget system prompt discipline."""

from __future__ import annotations

from agenticx.runtime.prompts.meta_agent import _build_widget_capability_block
from agenticx.runtime.prompts.tool_discipline import SHOW_WIDGET_USAGE


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


def test_widget_capability_block_defaults_to_best_visual_format() -> None:
    """默认 SVG/HTML；Mermaid 只在用户点名时用。细则仍跟工具走。

    "什么时候必须出图"留在 system prompt；viewBox / CDN / 主题变量这些渲染
    细则搬去了 show_widget 自己的 description（见
    ``tool_discipline.SHOW_WIDGET_USAGE``），跟着工具走——工具被 ToolSearch 延迟
    时它们一起消失，工具被加载时又原样回来。
    """
    block = _build_widget_capability_block()
    assert "SVG" in block
    assert "HTML" in block
    assert "明确" in block and "Mermaid" in block
    assert 'widget_format="mermaid"' not in block
    assert "流程类图优先 Mermaid" not in block

    usage = SHOW_WIDGET_USAGE
    assert "流程图/架构图/链路图/时序图" in usage
    assert "不要包 Markdown 代码围栏" in usage
    assert "短标签" in usage
    assert "'svg'" in usage
    assert "明确" in usage and "'mermaid'" in usage


def test_widget_render_details_are_not_duplicated_into_the_prompt() -> None:
    """细则只该有一份：在 description 里，不在 system prompt 里。"""
    block = _build_widget_capability_block()
    for marker in ("CDN 白名单", "viewBox", "prefers-color-scheme"):
        assert marker in SHOW_WIDGET_USAGE
        assert marker not in block
