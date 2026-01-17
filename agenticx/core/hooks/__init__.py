"""
Hooks 系统

提供 LLM 和 Tool 调用的钩子机制，支持全局和 Agent 级别的钩子。

参考 crewAI Hooks 设计。
"""

from .types import LLMCallHookContext, ToolCallHookContext
from .llm_hooks import (
    LLMHookFunction,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    unregister_before_llm_call_hook,
    unregister_after_llm_call_hook,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
    clear_all_llm_hooks,
    get_registered_llm_hooks,
)
from .tool_hooks import (
    ToolHookFunction,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    unregister_before_tool_call_hook,
    unregister_after_tool_call_hook,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
    clear_all_tool_hooks,
    get_registered_tool_hooks,
)

__all__ = [
    # Types
    "LLMCallHookContext",
    "ToolCallHookContext",
    # LLM Hooks
    "LLMHookFunction",
    "register_before_llm_call_hook",
    "register_after_llm_call_hook",
    "unregister_before_llm_call_hook",
    "unregister_after_llm_call_hook",
    "execute_before_llm_call_hooks",
    "execute_after_llm_call_hooks",
    "clear_all_llm_hooks",
    "get_registered_llm_hooks",
    # Tool Hooks
    "ToolHookFunction",
    "register_before_tool_call_hook",
    "register_after_tool_call_hook",
    "unregister_before_tool_call_hook",
    "unregister_after_tool_call_hook",
    "execute_before_tool_call_hooks",
    "execute_after_tool_call_hooks",
    "clear_all_tool_hooks",
    "get_registered_tool_hooks",
]
