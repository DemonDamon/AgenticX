"""Base classes for GUI interaction tools."""

from abc import ABC, abstractmethod
from typing import Any, Optional, Dict
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict

from agenticx.core.tool import BaseTool
from agenticx.embodiment.tools.adapters import BasePlatformAdapter


class ToolResult(BaseModel):
    """Standardized result model for GUI tool operations.
    
    This model provides a consistent structure for reporting the results
    of GUI operations, including success status, execution details, and
    any relevant data or error information.
    """
    
    success: bool = Field(description="Whether the operation was successful")
    message: str = Field(description="Human-readable description of the result")
    execution_time: float = Field(description="Time taken to execute the operation in seconds")
    data: Optional[Dict[str, Any]] = Field(default=None, description="Additional result data")
    error: Optional[str] = Field(default=None, description="Error message if operation failed")
    
    model_config = ConfigDict(
        arbitrary_types_allowed=True
    )


class GUIActionTool(BaseTool):
    """Base class for all GUI interaction tools.
    
    This class provides a standardized interface for GUI operations,
    inheriting from agenticx.core.tool.BaseTool to ensure consistency
    with the broader AgenticX tool ecosystem.
    """
    
    platform_adapter: 'BasePlatformAdapter' = Field(description="Platform adapter for GUI operations")
    
    model_config = ConfigDict(
        arbitrary_types_allowed=True
    )
    
    def __init__(self, platform_adapter: 'BasePlatformAdapter'):
        """Initialize the GUI action tool.
        
        Args:
            platform_adapter: Platform-specific adapter for GUI operations
        """
        # Get name and description from class attributes or use defaults
        tool_name = getattr(self, 'name', 'gui_action_tool')
        tool_description = getattr(self, 'description', 'Base GUI action tool')
        
        super().__init__(
            name=tool_name,
            description=tool_description
        )
        # Store platform adapter as instance attribute
        self.platform_adapter = platform_adapter
    
    def execute(self, args=None, **kwargs) -> ToolResult:
        """Execute the GUI action synchronously.
        
        This method runs the async execute method in a sync context.
        
        Args:
            args: Tool-specific arguments object
            **kwargs: Tool-specific arguments as keyword arguments
            
        Returns:
            ToolResult with operation status and details
        """
        import asyncio
        
        # Handle both args object and individual kwargs
        if args is not None:
            final_args = args
        elif 'args' in kwargs:
            final_args = kwargs['args']
        elif len(kwargs) == 1 and not any(k in ['args', 'kwargs'] for k in kwargs.keys()):
            # Single argument that might be the args object
            final_args = list(kwargs.values())[0]
        else:
            final_args = kwargs if kwargs else None
        
        # Run async method in sync context
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If loop is already running, create a new task
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, self.aexecute(final_args))
                    return future.result()
            else:
                return loop.run_until_complete(self.aexecute(final_args))
        except RuntimeError:
            # No event loop exists, create a new one
            return asyncio.run(self.aexecute(final_args))
    
    async def aexecute(self, args: Any = None, **kwargs) -> ToolResult:
        """Execute the GUI action asynchronously.
        
        Args:
            args: Tool-specific arguments (can be None for tools that don't need args)
            **kwargs: Additional keyword arguments
            
        Returns:
            ToolResult with operation status and details
        """
        # Use args if provided, otherwise use kwargs, otherwise None
        if args is not None:
            return await self._execute_action(args)
        elif kwargs:
            return await self._execute_action(kwargs)
        else:
            return await self._execute_action(None)
    
    @abstractmethod
    async def _execute_action(self, args: Any) -> ToolResult:
        """Execute the specific GUI action.
        
        This method should be implemented by concrete tool classes.
        
        Args:
            args: Tool-specific arguments
            
        Returns:
            ToolResult with operation status and details
        """
        pass