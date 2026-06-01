#!/usr/bin/env python3
"""Tests for LLM vision capability helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.llms.vision import (
    is_vision_capable,
    strip_nonvision_multimodal_messages,
)


def test_bailian_qwen37_max_is_not_vision_capable() -> None:
    assert is_vision_capable("bailian", "qwen3.7-max") is False
    assert is_vision_capable("bailian", "openai/qwen3.7-max") is False


def test_bailian_qwen_vl_is_vision_capable() -> None:
    assert is_vision_capable("bailian", "qwen-vl-max") is True
    assert is_vision_capable("bailian", "qwen2.5-vl-72b-instruct") is True


def test_strip_nonvision_multimodal_messages_flattens_image_url() -> None:
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }
    ]
    out = strip_nonvision_multimodal_messages(messages, "bailian", "qwen3.7-max")
    assert out[0]["content"].startswith("describe this")
    assert "image attachment(s) omitted" in out[0]["content"]
    assert isinstance(out[0]["content"], str)


def test_strip_nonvision_multimodal_messages_keeps_vision_models() -> None:
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }
    ]
    out = strip_nonvision_multimodal_messages(messages, "bailian", "qwen-vl-max")
    assert isinstance(out[0]["content"], list)
    assert out[0]["content"][1]["type"] == "image_url"
