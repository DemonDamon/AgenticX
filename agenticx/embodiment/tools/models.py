"""Parameter models for GUI tools."""

from typing import Optional, Literal
from pydantic import BaseModel, Field


class ClickArgs(BaseModel):
    """Arguments for the ClickTool.
    
    Supports both natural language element queries and direct element IDs
    for flexible element targeting.
    """
    
    element_query: Optional[str] = Field(
        default=None,
        description="Natural language description of the target element, e.g., 'the login button' or 'input field near username label'"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Optional direct element ID if known, bypasses visual element location"
    )
    click_type: Literal["left", "right", "double"] = Field(
        default="left",
        description="Type of click to perform"
    )
    wait_for_element: bool = Field(
        default=False,
        description="Whether to wait for the element to be available before clicking"
    )
    timeout: float = Field(
        default=10.0,
        description="Maximum time to wait for element in seconds"
    )


class TypeArgs(BaseModel):
    """Arguments for the TypeTool.
    
    Supports typing in focused elements or specific target elements.
    """
    
    text: str = Field(
        description="Text to type/input"
    )
    element_query: Optional[str] = Field(
        default=None,
        description="Optional element description to type into. If None, types into currently focused element"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Optional direct element ID if known"
    )
    clear_first: bool = Field(
        default=False,
        description="Whether to clear the element content before typing"
    )
    wait_for_element: bool = Field(
        default=False,
        description="Whether to wait for the element to be available before typing"
    )
    timeout: float = Field(
        default=10.0,
        description="Maximum time to wait for element in seconds"
    )


class ScrollArgs(BaseModel):
    """Arguments for the ScrollTool.
    
    Supports scrolling in different directions within specific elements or the entire view.
    """
    
    direction: Literal["up", "down", "left", "right"] = Field(
        description="Direction to scroll"
    )
    element_query: Optional[str] = Field(
        default=None,
        description="Optional scrollable element description. If None, scrolls the entire view"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Optional direct element ID if known"
    )
    amount: int = Field(
        default=3,
        description="Number of scroll units (e.g., wheel clicks or swipe distance)"
    )
    wait_for_element: bool = Field(
        default=False,
        description="Whether to wait for the element to be available before scrolling"
    )
    timeout: float = Field(
        default=10.0,
        description="Maximum time to wait for element in seconds"
    )


class WaitArgs(BaseModel):
    """Arguments for waiting operations."""
    
    element_query: Optional[str] = Field(
        default=None,
        description="Element to wait for. If None, waits for specified duration"
    )
    element_id: Optional[str] = Field(
        default=None,
        description="Optional direct element ID if known"
    )
    timeout: float = Field(
        default=10.0,
        description="Maximum time to wait in seconds"
    )
    condition: Literal["visible", "clickable", "invisible"] = Field(
        default="visible",
        description="Condition to wait for"
    )


class DragArgs(BaseModel):
    """Arguments for drag and drop operations."""
    
    source_query: str = Field(
        description="Description of the source element to drag from"
    )
    target_query: str = Field(
        description="Description of the target element to drag to"
    )
    source_id: Optional[str] = Field(
        default=None,
        description="Optional direct source element ID"
    )
    target_id: Optional[str] = Field(
        default=None,
        description="Optional direct target element ID"
    )