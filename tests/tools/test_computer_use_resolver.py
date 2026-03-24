#!/usr/bin/env python3
"""Tests for ComputerUseResolver.

Author: Damon Li
"""

import pytest
from unittest.mock import AsyncMock

from agenticx.tools.resolvers.computer_use_resolver import ComputerUseResolver


@pytest.fixture
def mock_adapter():
    adapter = AsyncMock()
    adapter.take_screenshot = AsyncMock(return_value="base64_fake_screenshot")
    adapter.click_at = AsyncMock()
    adapter.type_text = AsyncMock()
    adapter.scroll = AsyncMock()
    return adapter


@pytest.fixture
def mock_vision_model():
    model = AsyncMock()
    model.analyze_screenshot = AsyncMock(
        return_value={
            "action": "click_at",
            "params": {"x": 100, "y": 200},
            "reasoning": "Found the submit button at (100, 200)",
            "task_complete": True,
        }
    )
    return model


@pytest.mark.asyncio
async def test_computer_use_resolver_can_handle():
    """Computer use should handle everything (universal fallback)."""
    resolver = ComputerUseResolver(
        adapter=AsyncMock(),
        vision_model=AsyncMock(),
    )
    assert await resolver.can_handle("anything") is True


@pytest.mark.asyncio
async def test_computer_use_resolver_executes_action(mock_adapter, mock_vision_model):
    """Resolver should screenshot, analyze, then execute the action."""
    resolver = ComputerUseResolver(
        adapter=mock_adapter,
        vision_model=mock_vision_model,
        max_steps=5,
    )
    result = await resolver.resolve("click the submit button")
    mock_adapter.take_screenshot.assert_called()
    mock_vision_model.analyze_screenshot.assert_called()
    mock_adapter.click_at.assert_called_once_with(x=100, y=200)
    assert "complete" in result.lower() or "submit" in result.lower()


@pytest.mark.asyncio
async def test_computer_use_resolver_max_steps(mock_adapter):
    """Resolver should stop after max_steps even if task not complete."""
    never_done = AsyncMock()
    never_done.analyze_screenshot = AsyncMock(
        return_value={
            "action": "scroll",
            "params": {"direction": "down"},
            "reasoning": "Looking for element...",
            "task_complete": False,
        }
    )
    resolver = ComputerUseResolver(
        adapter=mock_adapter,
        vision_model=never_done,
        max_steps=3,
    )
    result = await resolver.resolve("find something")
    assert never_done.analyze_screenshot.call_count == 3
