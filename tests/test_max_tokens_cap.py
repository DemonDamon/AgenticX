#!/usr/bin/env python3
"""Tests for vendor max_tokens cap parsing.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.agent_runtime import _parse_max_tokens_cap


def test_parse_max_tokens_cap_from_zhipu_message() -> None:
    assert (
        _parse_max_tokens_cap(
            Exception("max_tokens参数非法：限制数值范围[1,1024]")
        )
        == 1024
    )


def test_parse_max_tokens_cap_unrelated() -> None:
    assert _parse_max_tokens_cap(Exception("invalid input")) is None
    assert _parse_max_tokens_cap(Exception("rate limit")) is None
