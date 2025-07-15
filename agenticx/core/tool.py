from abc import ABC, abstractmethod
from pydantic import BaseModel, Field, ConfigDict
from typing import Callable, Any, Optional, Dict
import inspect
import asyncio

class BaseTool(ABC, BaseModel):
    """
    Abstract base class for all tools in the AgenticX framework.
    """
    name: str = Field(description="The name of the tool.")
    description: str = Field(description="A description of what the tool does.")
    args_schema: Optional[Any] = Field(description="The schema for the tool's arguments (e.g., Pydantic model).", default=None)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @abstractmethod
    def execute(self, **kwargs) -> Any:
        """Execute the tool synchronously."""
        pass

    @abstractmethod
    async def aexecute(self, **kwargs) -> Any:
        """Execute the tool asynchronously."""
        pass

class FunctionTool(BaseTool):
    """
    A tool implementation that wraps a Python function.
    """
    func: Callable[..., Any] = Field(description="The function that implements the tool.")

    def execute(self, **kwargs) -> Any:
        """Execute the wrapped function synchronously."""
        return self.func(**kwargs)

    async def aexecute(self, **kwargs) -> Any:
        """Execute the wrapped function asynchronously."""
        if asyncio.iscoroutinefunction(self.func):
            return await self.func(**kwargs)
        else:
            # Run sync function in executor for async compatibility
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(None, lambda: self.func(**kwargs))

    @classmethod
    def from_function(
        cls, 
        func: Callable[..., Any], 
        name: Optional[str] = None, 
        description: Optional[str] = None
    ) -> "FunctionTool":
        """Create a FunctionTool from a Python function."""
        tool_name = name or func.__name__
        tool_description = description or func.__doc__ or f"Tool: {tool_name}"
        
        # Create args_schema from function signature
        sig = inspect.signature(func)
        # (保持 schema 生成逻辑不变)
        
        return cls(
            name=tool_name,
            description=tool_description,
            func=func,
            args_schema=None # 简化处理
        )

def tool(name: Optional[str] = None, description: Optional[str] = None):
    """
    Decorator to create a Tool from a function.
    
    Args:
        name: Optional name for the tool. If not provided, uses function name.
        description: Optional description. If not provided, uses function docstring.
    
    Returns:
        FunctionTool instance wrapping the decorated function.
    """
    def decorator(func: Callable[..., Any]) -> FunctionTool:
        tool_name = name or func.__name__
        tool_description = description or func.__doc__ or f"Tool: {tool_name}"
        
        # Create args_schema from function signature
        sig = inspect.signature(func)
        args_schema = None
        if sig.parameters:
            # For now, we'll store the signature info as a dict
            # In a full implementation, this could create a Pydantic model
            args_schema = {
                param_name: {
                    "annotation": param.annotation,
                    "default": param.default if param.default != inspect.Parameter.empty else None
                }
                for param_name, param in sig.parameters.items()
            }
        
        return FunctionTool(
            name=tool_name,
            description=tool_description,
            func=func,
            args_schema=args_schema
        )
    
    return decorator 