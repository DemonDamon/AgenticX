"""M16.3 GUI Tools Module

This module provides a comprehensive set of GUI interaction tools for the AgenticX embodiment system.
It includes platform-agnostic tools for clicking, typing, scrolling, taking screenshots, and analyzing
UI element hierarchies.

Core Components:
- GUIActionTool: Base class for all GUI interaction tools
- ToolResult: Standardized result model for tool operations
- Platform Adapters: Abstraction layer for different platforms (Web, Desktop, Mobile)
- Core Tools: Click, Type, Scroll, Screenshot, GetElementTree tools

Usage:
    from agenticx.embodiment.tools import ClickTool, WebPlatformAdapter
    
    adapter = WebPlatformAdapter(page=playwright_page)
    click_tool = ClickTool(adapter)
    result = await click_tool.execute(ClickArgs(element_query="Submit button"))
"""

from .base import GUIActionTool, ToolResult
from .models import ClickArgs, TypeArgs, ScrollArgs, WaitArgs, DragArgs
from .adapters import BasePlatformAdapter, WebPlatformAdapter, MockPlatformAdapter
from .core_tools import (
    ClickTool,
    TypeTool, 
    ScrollTool,
    ScreenshotTool,
    GetElementTreeTool,
    WaitTool,
    GetScreenStateTool
)

__all__ = [
    # Base classes
    'GUIActionTool',
    'ToolResult',
    
    # Parameter models
    'ClickArgs',
    'TypeArgs', 
    'ScrollArgs',
    'WaitArgs',
    'DragArgs',
    
    # Platform adapters
    'BasePlatformAdapter',
    'WebPlatformAdapter',
    'MockPlatformAdapter',
    
    # Core tools
    'ClickTool',
    'TypeTool',
    'ScrollTool', 
    'ScreenshotTool',
    'GetElementTreeTool',
    'WaitTool',
    'GetScreenStateTool'
]