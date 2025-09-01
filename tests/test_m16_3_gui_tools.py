"""Tests for M16.3 GUI Tools Module."""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from agenticx.embodiment.tools import (
    GUIActionTool, ToolResult,
    ClickArgs, TypeArgs, ScrollArgs, WaitArgs,
    BasePlatformAdapter, WebPlatformAdapter, MockPlatformAdapter,
    ClickTool, TypeTool, ScrollTool, ScreenshotTool, GetElementTreeTool,
    WaitTool, GetScreenStateTool
)
from agenticx.embodiment.core.models import ScreenState, InteractionElement


class TestToolResult:
    """Test ToolResult data model."""
    
    def test_tool_result_creation(self):
        """Test ToolResult creation with basic parameters."""
        result = ToolResult(
            success=True,
            message="Operation successful",
            execution_time=0.5
        )
        
        assert result.success is True
        assert result.message == "Operation successful"
        assert result.execution_time == 0.5
        assert result.data is None
        assert result.error is None
    
    def test_tool_result_with_data(self):
        """Test ToolResult with additional data."""
        data = {"element_id": "button_1", "click_type": "left"}
        result = ToolResult(
            success=True,
            message="Click successful",
            execution_time=0.2,
            data=data
        )
        
        assert result.data == data
    
    def test_tool_result_with_error(self):
        """Test ToolResult with error information."""
        result = ToolResult(
            success=False,
            message="Operation failed",
            execution_time=0.1,
            error="Element not found"
        )
        
        assert result.success is False
        assert result.error == "Element not found"


class TestParameterModels:
    """Test parameter models for GUI tools."""
    
    def test_click_args_creation(self):
        """Test ClickArgs model creation."""
        args = ClickArgs(
            element_query="Submit button",
            click_type="left",
            wait_for_element=True,
            timeout=5.0
        )
        
        assert args.element_query == "Submit button"
        assert args.click_type == "left"
        assert args.wait_for_element is True
        assert args.timeout == 5.0
        assert args.element_id is None
    
    def test_type_args_creation(self):
        """Test TypeArgs model creation."""
        args = TypeArgs(
            text="Hello World",
            element_id="input_field",
            clear_first=True
        )
        
        assert args.text == "Hello World"
        assert args.element_id == "input_field"
        assert args.clear_first is True
    
    def test_scroll_args_creation(self):
        """Test ScrollArgs model creation."""
        args = ScrollArgs(
            direction="down",
            amount=5,
            element_query="main content"
        )
        
        assert args.direction == "down"
        assert args.amount == 5
        assert args.element_query == "main content"
    
    def test_wait_args_creation(self):
        """Test WaitArgs model creation."""
        args = WaitArgs(
            element_query="loading spinner",
            condition="invisible",
            timeout=10.0
        )
        
        assert args.element_query == "loading spinner"
        assert args.condition == "invisible"
        assert args.timeout == 10.0


class TestMockPlatformAdapter:
    """Test MockPlatformAdapter functionality."""
    
    @pytest.fixture
    def mock_adapter(self):
        """Create a mock platform adapter for testing."""
        return MockPlatformAdapter()
    
    @pytest.mark.asyncio
    async def test_click_operation(self, mock_adapter):
        """Test click operation recording."""
        await mock_adapter.click(
            element_query="test button",
            click_type="left"
        )
        
        assert len(mock_adapter.actions_performed) == 1
        action = mock_adapter.actions_performed[0]
        assert action['action'] == 'click'
        assert action['element_query'] == 'test button'
        assert action['click_type'] == 'left'
    
    @pytest.mark.asyncio
    async def test_type_operation(self, mock_adapter):
        """Test type operation recording."""
        await mock_adapter.type_text(
            text="test input",
            element_id="input_1",
            clear_first=True
        )
        
        assert len(mock_adapter.actions_performed) == 1
        action = mock_adapter.actions_performed[0]
        assert action['action'] == 'type'
        assert action['text'] == 'test input'
        assert action['element_id'] == 'input_1'
        assert action['clear_first'] is True
    
    @pytest.mark.asyncio
    async def test_scroll_operation(self, mock_adapter):
        """Test scroll operation recording."""
        await mock_adapter.scroll(
            direction="down",
            amount=3
        )
        
        assert len(mock_adapter.actions_performed) == 1
        action = mock_adapter.actions_performed[0]
        assert action['action'] == 'scroll'
        assert action['direction'] == 'down'
        assert action['amount'] == 3
    
    @pytest.mark.asyncio
    async def test_screenshot_operation(self, mock_adapter):
        """Test screenshot operation."""
        screenshot = await mock_adapter.take_screenshot()
        
        assert isinstance(screenshot, str)
        assert len(screenshot) > 0
    
    @pytest.mark.asyncio
    async def test_get_element_tree(self, mock_adapter):
        """Test element tree retrieval."""
        elements = await mock_adapter.get_element_tree()
        
        assert isinstance(elements, list)
        assert len(elements) > 0
        assert all(isinstance(elem, InteractionElement) for elem in elements)
    
    @pytest.mark.asyncio
    async def test_find_element(self, mock_adapter):
        """Test element finding."""
        element_id = await mock_adapter.find_element("button")
        assert element_id == "button_1"
        
        element_id = await mock_adapter.find_element("nonexistent")
        assert element_id is None
    
    @pytest.mark.asyncio
    async def test_wait_for_element(self, mock_adapter):
        """Test waiting for element."""
        result = await mock_adapter.wait_for_element("test element")
        assert result is True
    
    @pytest.mark.asyncio
    async def test_get_screen_state(self, mock_adapter):
        """Test screen state retrieval."""
        screen_state = await mock_adapter.get_current_screen_state()
        
        assert isinstance(screen_state, ScreenState)
        assert screen_state.screenshot is not None
        assert len(screen_state.interactive_elements) > 0
        assert screen_state.metadata['platform'] == 'mock'


class TestClickTool:
    """Test ClickTool functionality."""
    
    @pytest.fixture
    def click_tool(self):
        """Create a ClickTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return ClickTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_click(self, click_tool):
        """Test successful click operation."""
        args = ClickArgs(
            element_query="test button",
            click_type="left"
        )
        
        result = await click_tool.aexecute(args)
        
        assert result.success is True
        assert "Successfully performed left click" in result.message
        assert result.data['element_query'] == "test button"
        assert result.data['click_type'] == "left"
    
    @pytest.mark.asyncio
    async def test_click_with_element_id(self, click_tool):
        """Test click with element ID."""
        args = ClickArgs(
            element_id="button_1",
            click_type="right"
        )
        
        result = await click_tool.aexecute(args)
        
        assert result.success is True
        assert result.data['element_id'] == "button_1"
        assert result.data['click_type'] == "right"
    
    @pytest.mark.asyncio
    async def test_click_without_target(self, click_tool):
        """Test click without element target."""
        args = ClickArgs(click_type="left")
        
        result = await click_tool.aexecute(args)
        
        assert result.success is False
        assert "Either element_id or element_query must be provided" in result.message


class TestTypeTool:
    """Test TypeTool functionality."""
    
    @pytest.fixture
    def type_tool(self):
        """Create a TypeTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return TypeTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_type(self, type_tool):
        """Test successful type operation."""
        args = TypeArgs(
            text="Hello World",
            element_query="input field",
            clear_first=True
        )
        
        result = await type_tool.aexecute(args)
        
        assert result.success is True
        assert "Successfully typed text: 'Hello World'" in result.message
        assert result.data['text'] == "Hello World"
        assert result.data['clear_first'] is True
    
    @pytest.mark.asyncio
    async def test_type_empty_text(self, type_tool):
        """Test type with empty text."""
        args = TypeArgs(text="")
        
        result = await type_tool.aexecute(args)
        
        assert result.success is False
        assert "Text to type cannot be empty" in result.message
    
    @pytest.mark.asyncio
    async def test_type_long_text(self, type_tool):
        """Test type with long text (truncation in message)."""
        long_text = "A" * 100
        args = TypeArgs(text=long_text)
        
        result = await type_tool.aexecute(args)
        
        assert result.success is True
        assert "..." in result.message  # Should be truncated
        assert result.data['text_length'] == 100


class TestScrollTool:
    """Test ScrollTool functionality."""
    
    @pytest.fixture
    def scroll_tool(self):
        """Create a ScrollTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return ScrollTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_scroll(self, scroll_tool):
        """Test successful scroll operation."""
        args = ScrollArgs(
            direction="down",
            amount=3
        )
        
        result = await scroll_tool.aexecute(args)
        
        assert result.success is True
        assert "Successfully scrolled down by 3 units" in result.message
        assert result.data['direction'] == "down"
        assert result.data['amount'] == 3
    
    @pytest.mark.asyncio
    async def test_invalid_scroll_direction(self, scroll_tool):
        """Test scroll with invalid direction."""
        # This should raise a Pydantic validation error
        with pytest.raises(Exception):  # Pydantic validation error
            args = ScrollArgs(
                direction="invalid",
                amount=1
            )


class TestScreenshotTool:
    """Test ScreenshotTool functionality."""
    
    @pytest.fixture
    def screenshot_tool(self):
        """Create a ScreenshotTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return ScreenshotTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_screenshot(self, screenshot_tool):
        """Test successful screenshot operation."""
        result = await screenshot_tool.aexecute()
        
        assert result.success is True
        assert "Successfully captured screenshot" in result.message
        assert 'screenshot' in result.data
        assert result.data['format'] == 'base64_png'
        assert 'timestamp' in result.data


class TestGetElementTreeTool:
    """Test GetElementTreeTool functionality."""
    
    @pytest.fixture
    def element_tree_tool(self):
        """Create a GetElementTreeTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return GetElementTreeTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_element_tree(self, element_tree_tool):
        """Test successful element tree retrieval."""
        result = await element_tree_tool.aexecute()
        
        assert result.success is True
        assert "Successfully retrieved" in result.message
        assert "interactive elements" in result.message
        assert 'elements' in result.data
        assert result.data['element_count'] > 0
        assert 'timestamp' in result.data


class TestWaitTool:
    """Test WaitTool functionality."""
    
    @pytest.fixture
    def wait_tool(self):
        """Create a WaitTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return WaitTool(adapter)
    
    @pytest.mark.asyncio
    async def test_wait_for_element(self, wait_tool):
        """Test waiting for element."""
        args = WaitArgs(
            element_query="test element",
            condition="visible",
            timeout=1.0
        )
        
        result = await wait_tool.aexecute(args)
        
        assert result.success is True
        assert "Element condition 'visible' met" in result.message
        assert result.data['element_query'] == "test element"
        assert result.data['condition'] == "visible"
    
    @pytest.mark.asyncio
    async def test_simple_wait(self, wait_tool):
        """Test simple time-based wait."""
        args = WaitArgs(timeout=0.1)  # Short wait for testing
        
        start_time = datetime.now()
        result = await wait_tool.aexecute(args)
        end_time = datetime.now()
        
        assert result.success is True
        assert "Waited for 0.1 seconds" in result.message
        assert (end_time - start_time).total_seconds() >= 0.1


class TestGetScreenStateTool:
    """Test GetScreenStateTool functionality."""
    
    @pytest.fixture
    def screen_state_tool(self):
        """Create a GetScreenStateTool with mock adapter."""
        adapter = MockPlatformAdapter()
        return GetScreenStateTool(adapter)
    
    @pytest.mark.asyncio
    async def test_successful_screen_state(self, screen_state_tool):
        """Test successful screen state retrieval."""
        result = await screen_state_tool.aexecute()
        
        assert result.success is True
        assert "Successfully retrieved screen state" in result.message
        assert 'screenshot' in result.data
        assert 'elements' in result.data
        assert 'metadata' in result.data
        assert 'timestamp' in result.data


class TestWebPlatformAdapter:
    """Test WebPlatformAdapter functionality."""
    
    def test_adapter_initialization(self):
        """Test WebPlatformAdapter initialization."""
        adapter = WebPlatformAdapter()
        
        assert adapter.page is None
        assert adapter.browser_context is None
        assert adapter._element_cache == {}
    
    @pytest.mark.asyncio
    async def test_operations_without_page(self):
        """Test operations fail without page context."""
        adapter = WebPlatformAdapter()
        
        with pytest.raises(RuntimeError, match="No page context available"):
            await adapter.click(element_query="test")
        
        with pytest.raises(RuntimeError, match="No page context available"):
            await adapter.type_text("test")
        
        with pytest.raises(RuntimeError, match="No page context available"):
            await adapter.scroll("down")
        
        with pytest.raises(RuntimeError, match="No page context available"):
            await adapter.take_screenshot()


class TestGUIToolsIntegration:
    """Integration tests for GUI tools."""
    
    @pytest.fixture
    def mock_adapter(self):
        """Create a mock adapter for integration testing."""
        return MockPlatformAdapter()
    
    @pytest.mark.asyncio
    async def test_complete_workflow(self, mock_adapter):
        """Test a complete GUI interaction workflow."""
        # Initialize tools
        click_tool = ClickTool(mock_adapter)
        type_tool = TypeTool(mock_adapter)
        scroll_tool = ScrollTool(mock_adapter)
        screenshot_tool = ScreenshotTool(mock_adapter)
        
        # Perform a sequence of operations
        # 1. Take initial screenshot
        screenshot_result = await screenshot_tool.aexecute()
        assert screenshot_result.success is True
        
        # 2. Click on an input field
        click_result = await click_tool.aexecute(
            ClickArgs(element_query="input field")
        )
        assert click_result.success is True
        
        # 3. Type some text
        type_result = await type_tool.aexecute(
            TypeArgs(text="Hello World", clear_first=True)
        )
        assert type_result.success is True
        
        # 4. Scroll down
        scroll_result = await scroll_tool.aexecute(
            ScrollArgs(direction="down", amount=2)
        )
        assert scroll_result.success is True
        
        # 5. Take final screenshot
        final_screenshot = await screenshot_tool.aexecute()
        assert final_screenshot.success is True
        
        # Verify all operations were recorded
        assert len(mock_adapter.actions_performed) == 3  # click, type, scroll
        
        actions = mock_adapter.actions_performed
        assert actions[0]['action'] == 'click'
        assert actions[1]['action'] == 'type'
        assert actions[2]['action'] == 'scroll'
    
    @pytest.mark.asyncio
    async def test_error_handling(self, mock_adapter):
        """Test error handling in tools."""
        # Mock an adapter method to raise an exception
        original_click = mock_adapter.click
        mock_adapter.click = AsyncMock(side_effect=Exception("Test error"))
        
        click_tool = ClickTool(mock_adapter)
        
        result = await click_tool.aexecute(
            ClickArgs(element_query="test button")
        )
        
        assert result.success is False
        assert "Click operation failed" in result.message
        assert "Test error" in result.error
        
        # Restore original method
        mock_adapter.click = original_click
    
    @pytest.mark.asyncio
    async def test_tool_performance_tracking(self, mock_adapter):
        """Test that tools track execution time."""
        click_tool = ClickTool(mock_adapter)
        
        result = await click_tool.aexecute(
            ClickArgs(element_query="test button")
        )
        
        assert result.success is True
        assert result.execution_time > 0
        assert isinstance(result.execution_time, float)


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])