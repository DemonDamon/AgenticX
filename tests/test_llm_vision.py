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


def test_zhipu_text_only_glm_skus_are_not_vision_capable() -> None:
    assert is_vision_capable("zhipu", "glm-4.5-air") is False
    assert is_vision_capable("zhipu", "glm-4.5-airx") is False
    assert is_vision_capable("zhipu", "glm-4.6") is False
    assert is_vision_capable("zhipu", "glm-4-plus") is False
    assert is_vision_capable("zhipu", "glm-5") is False


def test_known_text_only_skus_are_not_vision_capable_across_providers() -> None:
    assert is_vision_capable("custom_openai_caiyun", "glm-5.2") is False
    assert is_vision_capable("custom_openai_x", "qwen3.7-max") is False
    assert is_vision_capable("custom_openai_x", "glm-4.6v") is True
    assert is_vision_capable("openai", "gpt-4o") is True


def test_zhipu_vision_glm_skus_are_vision_capable() -> None:
    assert is_vision_capable("zhipu", "glm-4v") is True
    assert is_vision_capable("zhipu", "glm-4v-flash") is True
    assert is_vision_capable("zhipu", "glm-4.1v-thinking-flash") is True
    assert is_vision_capable("zhipu", "glm-4.5v") is True
    assert is_vision_capable("zhipu", "glm-4.6v") is True
    assert is_vision_capable("zhipu", "openai/glm-4.6v") is True
    assert is_vision_capable("zhipu", "glm-6-future-vision") is True


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
