from abc import ABC, abstractmethod
from pydantic import BaseModel, Field, ConfigDict  # type: ignore
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

    # ---- run/arun：与 agenticx.tools.base.BaseTool 对齐的别名 --------------
    # 框架里并存两套工具基类：这一套用 execute/aexecute，agenticx/tools/base.py
    # 那一套用 run/arun。而 ToolExecutor（AgentExecutor 调工具也走它）只认
    # run/arun —— 于是文档和示例里最常见的写法
    #
    #     from agenticx import tool, ToolExecutor
    #     @tool()
    #     def add(x: int, y: int) -> int: ...
    #     ToolExecutor().execute(add, x=3, y=4)
    #
    # 会直接失败：`'FunctionTool' object has no attribute 'run'`，而且还要按重试
    # 策略连试 4 次才放弃。（agenticx.tool 指向本模块，是因为 agenticx/__init__.py
    # 末尾那段"便捷导入"在 `from .tools import ...` 之后又把 tool/BaseTool 覆盖回
    # core 版本。）补上别名，两套基类在调用侧就一致了。
    def run(self, **kwargs) -> Any:
        """``execute`` 的别名，供只认 run/arun 的调用方使用。"""
        return self.execute(**kwargs)

    async def arun(self, **kwargs) -> Any:
        """``aexecute`` 的别名，供只认 run/arun 的调用方使用。"""
        return await self.aexecute(**kwargs)


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
            # Run sync function in executor for async compatibility.
            # 用 get_running_loop：这里一定在协程里，而 get_event_loop 在
            # asyncio.run() 跑过之后会抛 "There is no current event loop"。
            loop = asyncio.get_running_loop()
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