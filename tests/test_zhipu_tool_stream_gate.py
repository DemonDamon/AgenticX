#!/usr/bin/env python3
"""Tests for GLM tool_stream capability gate (vision SKUs excluded).

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _zhipu_tool_stream_supported


def test_zhipu_tool_stream_supported_text_glm() -> None:
    assert _zhipu_tool_stream_supported("zhipu", "glm-4.7") is True
    assert _zhipu_tool_stream_supported("zhipu", "glm-5") is True
    assert _zhipu_tool_stream_supported("zhipu", "glm-4.6") is True
    assert _zhipu_tool_stream_supported("custom_openai_x", "glm-4.7") is True


def test_zhipu_tool_stream_supported_excludes_vision() -> None:
    assert _zhipu_tool_stream_supported("zhipu", "glm-4.6v") is False
    assert _zhipu_tool_stream_supported("zhipu", "glm-4.5v") is False
    assert _zhipu_tool_stream_supported("zhipu", "glm-4v-flash") is False


def test_zhipu_tool_stream_supported_excludes_glm_4_5_air() -> None:
    assert _zhipu_tool_stream_supported("zhipu", "glm-4.5-air") is False
    assert _zhipu_tool_stream_supported("custom_openai_glm", "glm-4.5-air") is False
