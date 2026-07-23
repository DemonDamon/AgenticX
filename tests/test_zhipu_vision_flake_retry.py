#!/usr/bin/env python3
"""Tests for Zhipu multimodal invalid-input flake helpers.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import (
    _is_zhipu_transient_invalid_input,
    _messages_contain_image,
)


def test_messages_contain_image_true_false() -> None:
    with_image = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "see"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            ],
        }
    ]
    text_only = [{"role": "user", "content": "hello"}]
    assert _messages_contain_image(with_image) is True
    assert _messages_contain_image(text_only) is False
    assert _messages_contain_image(None) is False
    assert _messages_contain_image("bad") is False


def test_transient_invalid_input_classification() -> None:
    assert _is_zhipu_transient_invalid_input(
        Exception("litellm.BadRequestError: ... invalid input")
    ) is True
    assert _is_zhipu_transient_invalid_input(Exception("code 1210 ...")) is True
    assert _is_zhipu_transient_invalid_input(
        Exception("messages.content.type 参数非法，取值范围 ['text']")
    ) is False
    assert _is_zhipu_transient_invalid_input(Exception("rate limit exceeded")) is False
