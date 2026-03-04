"""
LLM Hooks 系统

提供 LLM 调用的可定制钩子机制，支持在调用前后插入自定义逻辑。
参考自 crewAI hooks/llm_hooks.py

Usage:
    from agenticx.hooks import (
        LLMCallHookContext,
        register_before_llm_call_hook,
        register_after_llm_call_hook,
    )
    
    # 注册调用前钩子
    def log_before_call(context: LLMCallHookContext) -> bool | None:
        print(f"LLM call with {len(context.messages)} messages")
        return None  # 允许执行
    
    register_before_llm_call_hook(log_before_call)
    
    # 注册调用后钩子
    def sanitize_response(context: LLMCallHookContext) -> str | None:
        if context.response and "SECRET" in context.response:
            return context.response.replace("SECRET", "[REDACTED]")
        return None  # 保持原响应
    
    register_after_llm_call_hook(sanitize_response)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import logging

from .types import BeforeLLMCallHookType, AfterLLMCallHookType
from .registry import get_global_hook_registry
from .types import HookEvent, HookHandler


logger = logging.getLogger(__name__)


@dataclass
class LLMCallHookContext:
    """LLM 调用钩子上下文
    
    提供钩子访问执行状态的能力，允许修改消息、响应和执行器属性。
    
    Attributes:
        messages: 消息列表（可变引用，可在 before 和 after 钩子中修改）
            IMPORTANT: 原地修改（如 append, extend），不要替换整个列表
        agent_id: Agent ID（可选）
        agent_name: Agent 名称（可选）
        task_id: 任务 ID（可选）
        iterations: 当前迭代次数
        response: LLM 响应字符串（仅在 after_llm_call 钩子中设置）
        model_name: 模型名称（可选）
        metadata: 额外元数据
    
    Example:
        >>> def my_hook(context: LLMCallHookContext) -> None:
        ...     print(f"Agent {context.agent_name} is calling LLM")
        ...     print(f"Messages: {len(context.messages)}")
    """
    
    messages: List[Dict[str, Any]]
    agent_id: Optional[str] = None
    agent_name: Optional[str] = None
    task_id: Optional[str] = None
    iterations: int = 0
    response: Optional[str] = None
    model_name: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        """确保 messages 是列表"""
        if self.messages is None:
            self.messages = []
        if self.metadata is None:
            self.metadata = {}


# 全局钩子注册表
_before_llm_call_hooks: List[BeforeLLMCallHookType] = []
_after_llm_call_hooks: List[AfterLLMCallHookType] = []
_before_wrapper_map: Dict[int, HookHandler] = {}
_after_wrapper_map: Dict[int, HookHandler] = {}


def register_before_llm_call_hook(hook: BeforeLLMCallHookType) -> None:
    """注册全局 before_llm_call 钩子
    
    全局钩子会自动应用到所有 LLM 调用。
    
    Args:
        hook: 接收 LLMCallHookContext 的函数，可以：
            - 原地修改 context.messages（append, extend, remove）
            - 返回 False 阻止 LLM 执行
            - 返回 True 或 None 允许执行
            IMPORTANT: 原地修改消息，不要替换列表
    
    Example:
        >>> def log_llm_calls(context: LLMCallHookContext) -> None:
        ...     print(f"LLM call by {context.agent_name}")
        ...     return None  # 允许执行
        >>>
        >>> register_before_llm_call_hook(log_llm_calls)
        >>>
        >>> def block_excessive_iterations(context: LLMCallHookContext) -> bool | None:
        ...     if context.iterations > 10:
        ...         print("Blocked: Too many iterations")
        ...         return False  # 阻止执行
        ...     return None  # 允许执行
        >>>
        >>> register_before_llm_call_hook(block_excessive_iterations)
    """
    if hook not in _before_llm_call_hooks:
        _before_llm_call_hooks.append(hook)
        wrapper = _to_before_llm_hook_handler(hook)
        _before_wrapper_map[id(hook)] = wrapper
        get_global_hook_registry().register("llm:before_call", wrapper)


def register_after_llm_call_hook(hook: AfterLLMCallHookType) -> None:
    """注册全局 after_llm_call 钩子
    
    全局钩子会自动应用到所有 LLM 调用。
    
    Args:
        hook: 接收 LLMCallHookContext 的函数，可以：
            - 修改响应：返回修改后的响应字符串
            - 保持原响应：返回 None
            - 原地修改 context.messages（修改会持久化到下一次迭代）
            IMPORTANT: 原地修改消息，不要替换列表
    
    Example:
        >>> def sanitize_response(context: LLMCallHookContext) -> str | None:
        ...     if context.response and "SECRET" in context.response:
        ...         return context.response.replace("SECRET", "[REDACTED]")
        ...     return None
        >>>
        >>> register_after_llm_call_hook(sanitize_response)
    """
    if hook not in _after_llm_call_hooks:
        _after_llm_call_hooks.append(hook)
        wrapper = _to_after_llm_hook_handler(hook)
        _after_wrapper_map[id(hook)] = wrapper
        get_global_hook_registry().register("llm:after_call", wrapper)


def get_before_llm_call_hooks() -> List[BeforeLLMCallHookType]:
    """获取所有已注册的 before_llm_call 钩子
    
    Returns:
        已注册的 before 钩子列表（副本）
    """
    return _before_llm_call_hooks.copy()


def get_after_llm_call_hooks() -> List[AfterLLMCallHookType]:
    """获取所有已注册的 after_llm_call 钩子
    
    Returns:
        已注册的 after 钩子列表（副本）
    """
    return _after_llm_call_hooks.copy()


def unregister_before_llm_call_hook(hook: BeforeLLMCallHookType) -> bool:
    """注销指定的 before_llm_call 钩子
    
    Args:
        hook: 要注销的钩子函数
        
    Returns:
        True 如果钩子被找到并移除，False 否则
    
    Example:
        >>> def my_hook(context: LLMCallHookContext) -> None:
        ...     print("Before LLM call")
        >>>
        >>> register_before_llm_call_hook(my_hook)
        >>> unregister_before_llm_call_hook(my_hook)
        True
    """
    try:
        _before_llm_call_hooks.remove(hook)
        wrapper = _before_wrapper_map.pop(id(hook), None)
        if wrapper is not None:
            get_global_hook_registry().unregister("llm:before_call", wrapper)
        return True
    except ValueError:
        return False


def unregister_after_llm_call_hook(hook: AfterLLMCallHookType) -> bool:
    """注销指定的 after_llm_call 钩子
    
    Args:
        hook: 要注销的钩子函数
        
    Returns:
        True 如果钩子被找到并移除，False 否则
    
    Example:
        >>> def my_hook(context: LLMCallHookContext) -> str | None:
        ...     return None
        >>>
        >>> register_after_llm_call_hook(my_hook)
        >>> unregister_after_llm_call_hook(my_hook)
        True
    """
    try:
        _after_llm_call_hooks.remove(hook)
        wrapper = _after_wrapper_map.pop(id(hook), None)
        if wrapper is not None:
            get_global_hook_registry().unregister("llm:after_call", wrapper)
        return True
    except ValueError:
        return False


def clear_before_llm_call_hooks() -> int:
    """清除所有已注册的 before_llm_call 钩子
    
    Returns:
        被清除的钩子数量
    
    Example:
        >>> register_before_llm_call_hook(hook1)
        >>> register_before_llm_call_hook(hook2)
        >>> clear_before_llm_call_hooks()
        2
    """
    count = len(_before_llm_call_hooks)
    for hook in _before_llm_call_hooks:
        wrapper = _before_wrapper_map.pop(id(hook), None)
        if wrapper is not None:
            get_global_hook_registry().unregister("llm:before_call", wrapper)
    _before_llm_call_hooks.clear()
    return count


def clear_after_llm_call_hooks() -> int:
    """清除所有已注册的 after_llm_call 钩子
    
    Returns:
        被清除的钩子数量
    
    Example:
        >>> register_after_llm_call_hook(hook1)
        >>> register_after_llm_call_hook(hook2)
        >>> clear_after_llm_call_hooks()
        2
    """
    count = len(_after_llm_call_hooks)
    for hook in _after_llm_call_hooks:
        wrapper = _after_wrapper_map.pop(id(hook), None)
        if wrapper is not None:
            get_global_hook_registry().unregister("llm:after_call", wrapper)
    _after_llm_call_hooks.clear()
    return count


def clear_all_llm_call_hooks() -> tuple[int, int]:
    """清除所有已注册的 LLM 调用钩子（before 和 after）
    
    Returns:
        (before_hooks_cleared, after_hooks_cleared) 元组
    
    Example:
        >>> register_before_llm_call_hook(before_hook)
        >>> register_after_llm_call_hook(after_hook)
        >>> clear_all_llm_call_hooks()
        (1, 1)
    """
    before_count = clear_before_llm_call_hooks()
    after_count = clear_after_llm_call_hooks()
    return (before_count, after_count)


def execute_before_llm_call_hooks(context: LLMCallHookContext) -> bool:
    """执行所有 before_llm_call 钩子
    
    Args:
        context: LLM 调用上下文
        
    Returns:
        True 如果所有钩子允许执行，False 如果任何钩子阻止执行
    """
    event = HookEvent(
        type="llm",
        action="before_call",
        agent_id=context.agent_id or "",
        task_id=context.task_id,
        context={"llm_context": context},
    )
    if not get_global_hook_registry().trigger_sync(event):
        return False

    return True


def execute_after_llm_call_hooks(context: LLMCallHookContext) -> str | None:
    """执行所有 after_llm_call 钩子
    
    Args:
        context: LLM 调用上下文（包含响应）
        
    Returns:
        修改后的响应，如果任何钩子修改了响应；否则返回 None
    """
    event = HookEvent(
        type="llm",
        action="after_call",
        agent_id=context.agent_id or "",
        task_id=context.task_id,
        context={"llm_context": context, "response": context.response},
    )
    get_global_hook_registry().trigger_sync(event)
    event_response = event.context.get("response")
    if isinstance(event_response, str):
        context.response = event_response
        modified_response = event_response
    else:
        modified_response = None
    return modified_response


def _to_before_llm_hook_handler(hook: BeforeLLMCallHookType) -> HookHandler:
    async def _handler(event: HookEvent) -> Optional[bool]:
        ctx = event.context.get("llm_context")
        if not isinstance(ctx, LLMCallHookContext):
            return True
        result = hook(ctx)
        if result is False:
            return False
        return True

    return _handler


def _to_after_llm_hook_handler(hook: AfterLLMCallHookType) -> HookHandler:
    async def _handler(event: HookEvent) -> Optional[bool]:
        ctx = event.context.get("llm_context")
        if not isinstance(ctx, LLMCallHookContext):
            return True
        result = hook(ctx)
        if isinstance(result, str):
            event.context["response"] = result
        return True

    return _handler


__all__ = [
    "LLMCallHookContext",
    "register_before_llm_call_hook",
    "register_after_llm_call_hook",
    "get_before_llm_call_hooks",
    "get_after_llm_call_hooks",
    "unregister_before_llm_call_hook",
    "unregister_after_llm_call_hook",
    "clear_before_llm_call_hooks",
    "clear_after_llm_call_hooks",
    "clear_all_llm_call_hooks",
    "execute_before_llm_call_hooks",
    "execute_after_llm_call_hooks",
]

