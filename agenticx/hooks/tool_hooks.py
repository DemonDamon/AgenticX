"""
Tool Hooks 系统

提供 Tool 调用的可定制钩子机制，支持在调用前后插入自定义逻辑。
参考自 crewAI hooks/tool_hooks.py

Usage:
    from agenticx.hooks import (
        ToolCallHookContext,
        register_before_tool_call_hook,
        register_after_tool_call_hook,
    )
    
    # 注册调用前钩子
    def log_tool_usage(context: ToolCallHookContext) -> bool | None:
        print(f"Executing tool: {context.tool_name}")
        return None  # 允许执行
    
    register_before_tool_call_hook(log_tool_usage)
    
    # 注册调用后钩子
    def sanitize_output(context: ToolCallHookContext) -> str | None:
        if context.tool_result and "SECRET_KEY" in context.tool_result:
            return context.tool_result.replace("SECRET_KEY=...", "[REDACTED]")
        return None  # 保持原结果
    
    register_after_tool_call_hook(sanitize_output)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING
import logging

from .types import BeforeToolCallHookType, AfterToolCallHookType

if TYPE_CHECKING:
    from ..tools.base import BaseTool


logger = logging.getLogger(__name__)


@dataclass
class ToolCallHookContext:
    """Tool 调用钩子上下文
    
    提供钩子访问工具调用状态的能力，允许修改输入参数和结果。
    
    Attributes:
        tool_name: 工具名称
        tool_input: 工具输入参数（可变字典，可在 before 钩子中修改）
            IMPORTANT: 原地修改（如 context.tool_input['key'] = value），
            不要替换整个字典
        tool: 工具实例引用（可选）
        agent_id: Agent ID（可选）
        agent_name: Agent 名称（可选）
        task_id: 任务 ID（可选）
        tool_result: 工具执行结果（仅在 after_tool_call 钩子中设置）
        metadata: 额外元数据
    
    Example:
        >>> def my_hook(context: ToolCallHookContext) -> None:
        ...     print(f"Executing tool: {context.tool_name}")
        ...     print(f"Input: {context.tool_input}")
    """
    
    tool_name: str
    tool_input: Dict[str, Any]
    tool: Optional[Any] = None  # BaseTool 类型，避免循环导入
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    task_id: Optional[str] = None
    tool_result: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """确保 tool_input 和 metadata 是字典"""
        if self.tool_input is None:
            self.tool_input = {}
        if self.metadata is None:
            self.metadata = {}


# 全局钩子注册表
_before_tool_call_hooks: List[BeforeToolCallHookType] = []
_after_tool_call_hooks: List[AfterToolCallHookType] = []


def register_before_tool_call_hook(hook: BeforeToolCallHookType) -> None:
    """注册全局 before_tool_call 钩子
    
    全局钩子会自动应用到所有工具调用。
    
    Args:
        hook: 接收 ToolCallHookContext 的函数，可以：
            - 原地修改 tool_input（如 context.tool_input['key'] = value）
            - 返回 False 阻止工具执行
            - 返回 True 或 None 允许执行
            IMPORTANT: 原地修改 tool_input，不要替换字典
    
    Example:
        >>> def log_tool_usage(context: ToolCallHookContext) -> None:
        ...     print(f"Executing tool: {context.tool_name}")
        ...     return None  # 允许执行
        >>>
        >>> register_before_tool_call_hook(log_tool_usage)
        >>>
        >>> def block_dangerous_tools(context: ToolCallHookContext) -> bool | None:
        ...     if context.tool_name == "delete_database":
        ...         print("Blocked dangerous tool execution!")
        ...         return False  # 阻止执行
        ...     return None  # 允许执行
        >>>
        >>> register_before_tool_call_hook(block_dangerous_tools)
    """
    if hook not in _before_tool_call_hooks:
        _before_tool_call_hooks.append(hook)


def register_after_tool_call_hook(hook: AfterToolCallHookType) -> None:
    """注册全局 after_tool_call 钩子
    
    全局钩子会自动应用到所有工具调用。
    
    Args:
        hook: 接收 ToolCallHookContext 的函数，可以修改工具结果。
            返回修改后的结果字符串，或 None 保持原结果。
            tool_result 在 context.tool_result 中可用。
    
    Example:
        >>> def sanitize_output(context: ToolCallHookContext) -> str | None:
        ...     if context.tool_result and "SECRET_KEY" in context.tool_result:
        ...         return context.tool_result.replace("SECRET_KEY=...", "[REDACTED]")
        ...     return None  # 保持原结果
        >>>
        >>> register_after_tool_call_hook(sanitize_output)
        >>>
        >>> def log_tool_results(context: ToolCallHookContext) -> None:
        ...     print(f"Tool {context.tool_name} returned: {context.tool_result[:100]}")
        ...     return None  # 保持原结果
        >>>
        >>> register_after_tool_call_hook(log_tool_results)
    """
    if hook not in _after_tool_call_hooks:
        _after_tool_call_hooks.append(hook)


def get_before_tool_call_hooks() -> List[BeforeToolCallHookType]:
    """获取所有已注册的 before_tool_call 钩子
    
    Returns:
        已注册的 before 钩子列表（副本）
    """
    return _before_tool_call_hooks.copy()


def get_after_tool_call_hooks() -> List[AfterToolCallHookType]:
    """获取所有已注册的 after_tool_call 钩子
    
    Returns:
        已注册的 after 钩子列表（副本）
    """
    return _after_tool_call_hooks.copy()


def unregister_before_tool_call_hook(hook: BeforeToolCallHookType) -> bool:
    """注销指定的 before_tool_call 钩子
    
    Args:
        hook: 要注销的钩子函数
        
    Returns:
        True 如果钩子被找到并移除，False 否则
    
    Example:
        >>> def my_hook(context: ToolCallHookContext) -> None:
        ...     print("Before tool call")
        >>>
        >>> register_before_tool_call_hook(my_hook)
        >>> unregister_before_tool_call_hook(my_hook)
        True
    """
    try:
        _before_tool_call_hooks.remove(hook)
        return True
    except ValueError:
        return False


def unregister_after_tool_call_hook(hook: AfterToolCallHookType) -> bool:
    """注销指定的 after_tool_call 钩子
    
    Args:
        hook: 要注销的钩子函数
        
    Returns:
        True 如果钩子被找到并移除，False 否则
    
    Example:
        >>> def my_hook(context: ToolCallHookContext) -> str | None:
        ...     return None
        >>>
        >>> register_after_tool_call_hook(my_hook)
        >>> unregister_after_tool_call_hook(my_hook)
        True
    """
    try:
        _after_tool_call_hooks.remove(hook)
        return True
    except ValueError:
        return False


def clear_before_tool_call_hooks() -> int:
    """清除所有已注册的 before_tool_call 钩子
    
    Returns:
        被清除的钩子数量
    
    Example:
        >>> register_before_tool_call_hook(hook1)
        >>> register_before_tool_call_hook(hook2)
        >>> clear_before_tool_call_hooks()
        2
    """
    count = len(_before_tool_call_hooks)
    _before_tool_call_hooks.clear()
    return count


def clear_after_tool_call_hooks() -> int:
    """清除所有已注册的 after_tool_call 钩子
    
    Returns:
        被清除的钩子数量
    
    Example:
        >>> register_after_tool_call_hook(hook1)
        >>> register_after_tool_call_hook(hook2)
        >>> clear_after_tool_call_hooks()
        2
    """
    count = len(_after_tool_call_hooks)
    _after_tool_call_hooks.clear()
    return count


def clear_all_tool_call_hooks() -> tuple[int, int]:
    """清除所有已注册的工具调用钩子（before 和 after）
    
    Returns:
        (before_hooks_cleared, after_hooks_cleared) 元组
    
    Example:
        >>> register_before_tool_call_hook(before_hook)
        >>> register_after_tool_call_hook(after_hook)
        >>> clear_all_tool_call_hooks()
        (1, 1)
    """
    before_count = clear_before_tool_call_hooks()
    after_count = clear_after_tool_call_hooks()
    return (before_count, after_count)


def execute_before_tool_call_hooks(context: ToolCallHookContext) -> bool:
    """执行所有 before_tool_call 钩子
    
    Args:
        context: 工具调用上下文
        
    Returns:
        True 如果所有钩子允许执行，False 如果任何钩子阻止执行
    """
    for hook in _before_tool_call_hooks:
        try:
            result = hook(context)
            if result is False:
                logger.debug(f"Tool call blocked by hook: {hook.__name__ if hasattr(hook, '__name__') else hook}")
                return False
        except Exception as e:
            logger.warning(f"Error in before_tool_call hook: {e}")
            # 钩子错误不应阻止执行
    return True


def execute_after_tool_call_hooks(context: ToolCallHookContext) -> str | None:
    """执行所有 after_tool_call 钩子
    
    Args:
        context: 工具调用上下文（包含结果）
        
    Returns:
        修改后的结果，如果任何钩子修改了结果；否则返回 None
    """
    modified_result = None
    for hook in _after_tool_call_hooks:
        try:
            result = hook(context)
            if result is not None:
                modified_result = result
                # 更新上下文中的结果，以便后续钩子可以看到修改
                context.tool_result = result
        except Exception as e:
            logger.warning(f"Error in after_tool_call hook: {e}")
            # 钩子错误不应影响结果
    return modified_result


__all__ = [
    "ToolCallHookContext",
    "register_before_tool_call_hook",
    "register_after_tool_call_hook",
    "get_before_tool_call_hooks",
    "get_after_tool_call_hooks",
    "unregister_before_tool_call_hook",
    "unregister_after_tool_call_hook",
    "clear_before_tool_call_hooks",
    "clear_after_tool_call_hooks",
    "clear_all_tool_call_hooks",
    "execute_before_tool_call_hooks",
    "execute_after_tool_call_hooks",
]

