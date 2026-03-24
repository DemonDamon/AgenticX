#!/usr/bin/env python3
"""Tests for ToolFallbackChain.

Author: Damon Li
"""

import pytest
from agenticx.tools.fallback_chain import (
    ToolFallbackChain,
    FallbackLevel,
    FallbackResult,
    ToolResolver,
)


class MockAPIResolver(ToolResolver):
    """Mock resolver that succeeds for known tools."""

    def __init__(self, supported_tools=None):
        self.supported_tools = supported_tools or set()

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self.supported_tools

    async def resolve(self, task_intent: str, **kwargs) -> str:
        if task_intent not in self.supported_tools:
            raise RuntimeError(f"Cannot handle: {task_intent}")
        return f"api_result:{task_intent}"


class MockBrowserResolver(ToolResolver):
    def __init__(self, supported_tools=None):
        self.supported_tools = supported_tools or set()

    async def can_handle(self, task_intent: str) -> bool:
        return task_intent in self.supported_tools

    async def resolve(self, task_intent: str, **kwargs) -> str:
        return f"browser_result:{task_intent}"


class MockComputerUseResolver(ToolResolver):
    async def can_handle(self, task_intent: str) -> bool:
        return True

    async def resolve(self, task_intent: str, **kwargs) -> str:
        return f"computer_use_result:{task_intent}"


@pytest.mark.asyncio
async def test_fallback_chain_uses_highest_priority():
    """API connector should be preferred when available."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver({"send_slack"}))
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver({"send_slack"}))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("send_slack")
    assert result.level == FallbackLevel.API_CONNECTOR
    assert result.output == "api_result:send_slack"


@pytest.mark.asyncio
async def test_fallback_chain_degrades_to_browser():
    """When no API connector, fall back to browser."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver({"open_calendar"}))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("open_calendar")
    assert result.level == FallbackLevel.BROWSER
    assert result.output == "browser_result:open_calendar"


@pytest.mark.asyncio
async def test_fallback_chain_degrades_to_computer_use():
    """When nothing else works, fall back to computer use."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))
    chain.register(FallbackLevel.BROWSER, MockBrowserResolver(set()))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("unknown_app_action")
    assert result.level == FallbackLevel.COMPUTER_USE


@pytest.mark.asyncio
async def test_fallback_chain_no_resolvers_raises():
    """Empty chain should raise."""
    chain = ToolFallbackChain()
    with pytest.raises(RuntimeError, match="No resolver"):
        await chain.execute("anything")


@pytest.mark.asyncio
async def test_fallback_chain_tracks_attempted_levels():
    """Result should record which levels were attempted."""
    chain = ToolFallbackChain()
    chain.register(FallbackLevel.API_CONNECTOR, MockAPIResolver(set()))
    chain.register(FallbackLevel.COMPUTER_USE, MockComputerUseResolver())

    result = await chain.execute("action")
    assert FallbackLevel.API_CONNECTOR in result.attempted_levels
    assert result.level == FallbackLevel.COMPUTER_USE
