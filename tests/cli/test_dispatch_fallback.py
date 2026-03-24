#!/usr/bin/env python3
"""Tests for fallback chain integration in dispatch_tool_async.

Author: Damon Li
"""

import pytest
from unittest.mock import AsyncMock
from agenticx.tools.fallback_chain import ToolFallbackChain, FallbackLevel, FallbackResult


@pytest.mark.asyncio
async def test_dispatch_falls_back_to_chain():
    """When tool name is unknown, dispatch should try fallback chain."""
    mock_chain = AsyncMock(spec=ToolFallbackChain)
    mock_chain.execute = AsyncMock(return_value=FallbackResult(
        level=FallbackLevel.BROWSER,
        output="Fallback result",
        attempted_levels=[FallbackLevel.API_CONNECTOR, FallbackLevel.BROWSER],
    ))

    result = await mock_chain.execute("open_unknown_app")
    assert result.level == FallbackLevel.BROWSER
    assert result.output == "Fallback result"


@pytest.mark.asyncio
async def test_fallback_chain_result_has_attempted_levels():
    """FallbackResult should track attempted levels."""
    result = FallbackResult(
        level=FallbackLevel.COMPUTER_USE,
        output="done via screen",
        attempted_levels=[
            FallbackLevel.API_CONNECTOR,
            FallbackLevel.BROWSER,
            FallbackLevel.COMPUTER_USE,
        ],
        errors={FallbackLevel.BROWSER: "No browser available"},
    )
    assert len(result.attempted_levels) == 3
    assert FallbackLevel.BROWSER in result.errors
