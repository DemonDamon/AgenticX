"""
Stream Content Accumulator for managing streaming LLM responses.

This module provides StreamContentAccumulator class for accumulating
streaming content across multiple chunks, supporting incremental and
cumulative content modes.

Inspired by CAMEL-AI's StreamContentAccumulator implementation.
"""

from typing import List


class StreamContentAccumulator:
    """
    Manages content accumulation across streaming responses to ensure
    all responses contain complete cumulative content.
    
    This class tracks:
    - Base content (content before tool calls)
    - Streaming content fragments (incremental chunks)
    - Tool status messages (tool call status updates)
    - Reasoning content (agent reasoning steps)
    
    Example:
        >>> accumulator = StreamContentAccumulator()
        >>> accumulator.set_base_content("Initial context")
        >>> accumulator.add_streaming_content("Hello")
        >>> accumulator.add_streaming_content(" World")
        >>> print(accumulator.get_full_content())
        "Initial contextHello World"
    """
    
    def __init__(self):
        """Initialize the accumulator with empty state."""
        self.base_content = ""  # Content before tool calls
        self.current_content: List[str] = []  # Accumulated streaming fragments
        self.tool_status_messages: List[str] = []  # Accumulated tool status messages
        self.reasoning_content: List[str] = []  # Accumulated reasoning content
        self.is_reasoning_phase = True  # Track if we're in reasoning phase
    
    def set_base_content(self, content: str) -> None:
        """
        Set the base content (usually empty or pre-tool content).
        
        Args:
            content: Base content string
        """
        self.base_content = content
    
    def add_streaming_content(self, new_content: str) -> None:
        """
        Add new streaming content chunk.
        
        Args:
            new_content: New content chunk to add
        """
        self.current_content.append(new_content)
        self.is_reasoning_phase = False  # Once we get content, we're past reasoning
    
    def add_reasoning_content(self, new_reasoning: str) -> None:
        """
        Add new reasoning content chunk.
        
        Args:
            new_reasoning: New reasoning content to add
        """
        self.reasoning_content.append(new_reasoning)
    
    def add_tool_status(self, status_message: str) -> None:
        """
        Add a tool status message.
        
        Args:
            status_message: Tool status message to add
        """
        self.tool_status_messages.append(status_message)
    
    def get_full_content(self) -> str:
        """
        Get the complete accumulated content.
        
        Returns:
            Complete content string combining base, tool status, and streaming content
        """
        tool_messages = "".join(self.tool_status_messages)
        current = "".join(self.current_content)
        return self.base_content + tool_messages + current
    
    def get_full_reasoning_content(self) -> str:
        """
        Get the complete accumulated reasoning content.
        
        Returns:
            Complete reasoning content string
        """
        return "".join(self.reasoning_content)
    
    def get_content_with_new_status(self, status_message: str) -> str:
        """
        Get content with a new status message appended (without modifying state).
        
        Args:
            status_message: New status message to include
            
        Returns:
            Content string with the new status message appended
        """
        tool_messages = "".join([*self.tool_status_messages, status_message])
        current = "".join(self.current_content)
        return self.base_content + tool_messages + current
    
    def reset_streaming_content(self) -> None:
        """
        Reset only the streaming content, keep base and tool status.
        
        This is useful when starting a new streaming response but
        preserving the context from previous interactions.
        """
        self.current_content = []
        self.reasoning_content = []
        self.is_reasoning_phase = True
    
    def reset_all(self) -> None:
        """
        Reset all accumulated content.
        
        This clears all state including base content, streaming content,
        tool status messages, and reasoning content.
        """
        self.base_content = ""
        self.current_content = []
        self.tool_status_messages = []
        self.reasoning_content = []
        self.is_reasoning_phase = True
