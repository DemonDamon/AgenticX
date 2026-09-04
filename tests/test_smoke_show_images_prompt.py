"""Smoke tests for show_images system prompt discipline."""

from __future__ import annotations

from agenticx.cli.agent_tools import STUDIO_TOOLS
from agenticx.runtime.prompts.meta_agent import _build_inline_photo_display_block


def _studio_description(name: str) -> str:
    for tool in STUDIO_TOOLS:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") or {}
        if str(fn.get("name") or "") == name:
            return str(fn.get("description") or "")
    raise AssertionError(f"missing studio tool {name}")


def test_inline_photo_block_requires_show_images_not_link_tables() -> None:
    block = _build_inline_photo_display_block()
    assert "show_images" in block
    assert "禁止只用表格" in block
    assert "无法在气泡内渲染图片" in block
    assert "discovered_images" in block


def test_show_images_description_has_ops_filters() -> None:
    desc = _studio_description("show_images")
    assert "/ops/" in desc
    assert "/avatar/" in desc
    assert "generate_image" in desc
