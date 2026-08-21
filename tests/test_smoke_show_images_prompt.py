"""Smoke tests for show_images system prompt discipline."""

from __future__ import annotations

from agenticx.runtime.prompts.meta_agent import _build_inline_photo_display_block


def test_inline_photo_block_requires_show_images_not_link_tables() -> None:
    block = _build_inline_photo_display_block()
    assert "show_images" in block
    assert "禁止只用表格" in block
    assert "无法在气泡内渲染图片" in block
    assert "generate_image" in block
    assert "discovered_images" in block
    assert "/ops/" in block
    assert "/avatar/" in block
