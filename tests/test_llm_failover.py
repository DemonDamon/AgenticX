#!/usr/bin/env python3
"""Tests for LLM failover provider.

Author: Damon Li
"""

import pytest
from unittest.mock import MagicMock
from agenticx.llms.failover import FailoverProvider
from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage


def _make_response(text: str) -> LLMResponse:
    return LLMResponse(
        id="test-id",
        model_name="test",
        created=0,
        content=text,
        choices=[LLMChoice(index=0, content=text)],
        token_usage=TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30),
    )


class TestFailoverProvider:
    def test_primary_success_uses_primary(self):
        primary = MagicMock()
        primary.invoke.return_value = _make_response("primary answer")
        fallback = MagicMock()
        provider = FailoverProvider(primary=primary, fallback=fallback)
        result = provider.invoke("hello")
        assert result.content == "primary answer"
        primary.invoke.assert_called_once()
        fallback.invoke.assert_not_called()

    def test_primary_failure_falls_back(self):
        primary = MagicMock()
        primary.invoke.side_effect = Exception("primary down")
        fallback = MagicMock()
        fallback.invoke.return_value = _make_response("fallback answer")
        provider = FailoverProvider(primary=primary, fallback=fallback)
        result = provider.invoke("hello")
        assert result.content == "fallback answer"

    def test_cooldown_after_threshold(self):
        primary = MagicMock()
        primary.invoke.side_effect = Exception("down")
        fallback = MagicMock()
        fallback.invoke.return_value = _make_response("fallback")
        provider = FailoverProvider(
            primary=primary, fallback=fallback,
            failure_threshold=2, cooldown_duration=1.0,
        )
        provider.invoke("q1")
        provider.invoke("q2")
        primary.invoke.reset_mock()
        provider.invoke("q3")
        primary.invoke.assert_not_called()
