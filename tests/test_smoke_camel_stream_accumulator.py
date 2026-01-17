"""
Smoke tests for StreamContentAccumulator.

Tests basic functionality of stream content accumulation,
including incremental content, tool status, and reasoning content.
"""

import pytest
from agenticx.core.stream_accumulator import StreamContentAccumulator


def test_accumulator_initialization():
    """Test accumulator initialization."""
    accumulator = StreamContentAccumulator()
    
    assert accumulator.base_content == ""
    assert accumulator.current_content == []
    assert accumulator.tool_status_messages == []
    assert accumulator.reasoning_content == []
    assert accumulator.is_reasoning_phase is True


def test_set_base_content():
    """Test setting base content."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Initial context: ")
    
    assert accumulator.base_content == "Initial context: "


def test_add_streaming_content():
    """Test adding streaming content chunks."""
    accumulator = StreamContentAccumulator()
    
    accumulator.add_streaming_content("Hello")
    assert accumulator.current_content == ["Hello"]
    assert accumulator.is_reasoning_phase is False
    
    accumulator.add_streaming_content(" World")
    assert accumulator.current_content == ["Hello", " World"]


def test_add_reasoning_content():
    """Test adding reasoning content."""
    accumulator = StreamContentAccumulator()
    
    accumulator.add_reasoning_content("Step 1: ")
    assert accumulator.reasoning_content == ["Step 1: "]
    
    accumulator.add_reasoning_content("Analyze the problem")
    assert accumulator.reasoning_content == ["Step 1: ", "Analyze the problem"]


def test_add_tool_status():
    """Test adding tool status messages."""
    accumulator = StreamContentAccumulator()
    
    accumulator.add_tool_status("[Tool: search]")
    assert accumulator.tool_status_messages == ["[Tool: search]"]
    
    accumulator.add_tool_status(" [Tool: calculate]")
    assert accumulator.tool_status_messages == ["[Tool: search]", " [Tool: calculate]"]


def test_get_full_content():
    """Test getting complete accumulated content."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Base: ")
    accumulator.add_tool_status("[Tool: search]")
    accumulator.add_streaming_content("Hello")
    accumulator.add_streaming_content(" World")
    
    full_content = accumulator.get_full_content()
    assert full_content == "Base: [Tool: search]Hello World"


def test_get_full_reasoning_content():
    """Test getting complete reasoning content."""
    accumulator = StreamContentAccumulator()
    accumulator.add_reasoning_content("Step 1: ")
    accumulator.add_reasoning_content("Analyze")
    
    reasoning = accumulator.get_full_reasoning_content()
    assert reasoning == "Step 1: Analyze"


def test_get_content_with_new_status():
    """Test getting content with new status without modifying state."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Base: ")
    accumulator.add_tool_status("[Tool: search]")
    accumulator.add_streaming_content("Hello")
    
    content_with_status = accumulator.get_content_with_new_status(" [Tool: new]")
    assert content_with_status == "Base: [Tool: search] [Tool: new]Hello"
    
    # State should not be modified
    assert accumulator.tool_status_messages == ["[Tool: search]"]


def test_reset_streaming_content():
    """Test resetting streaming content while keeping base and tool status."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Base: ")
    accumulator.add_tool_status("[Tool: search]")
    accumulator.add_streaming_content("Hello")
    accumulator.add_reasoning_content("Reasoning")
    
    accumulator.reset_streaming_content()
    
    assert accumulator.base_content == "Base: "
    assert accumulator.tool_status_messages == ["[Tool: search]"]
    assert accumulator.current_content == []
    assert accumulator.reasoning_content == []
    assert accumulator.is_reasoning_phase is True


def test_reset_all():
    """Test resetting all accumulated content."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Base: ")
    accumulator.add_tool_status("[Tool: search]")
    accumulator.add_streaming_content("Hello")
    accumulator.add_reasoning_content("Reasoning")
    
    accumulator.reset_all()
    
    assert accumulator.base_content == ""
    assert accumulator.tool_status_messages == []
    assert accumulator.current_content == []
    assert accumulator.reasoning_content == []
    assert accumulator.is_reasoning_phase is True


def test_incremental_content_accumulation():
    """Test incremental content accumulation scenario."""
    accumulator = StreamContentAccumulator()
    
    # Simulate streaming response
    chunks = ["The", " answer", " is", " 42"]
    for chunk in chunks:
        accumulator.add_streaming_content(chunk)
    
    assert accumulator.get_full_content() == "The answer is 42"


def test_tool_status_integration():
    """Test tool status integration with content."""
    accumulator = StreamContentAccumulator()
    accumulator.set_base_content("Context: ")
    
    # Simulate tool calls
    accumulator.add_tool_status("[Tool: search]")
    accumulator.add_streaming_content("Found results")
    accumulator.add_tool_status(" [Tool: process]")
    accumulator.add_streaming_content("Processed")
    
    full_content = accumulator.get_full_content()
    assert "[Tool: search]" in full_content
    assert "[Tool: process]" in full_content
    assert "Found results" in full_content
    assert "Processed" in full_content
