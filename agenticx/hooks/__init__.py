"""
AgenticX Hooks 系统

提供 LLM 和 Tool 调用的可定制钩子机制。
参考自 crewAI hooks 模块。

Usage:
    from agenticx.hooks import (
        # LLM Hooks
        LLMCallHookContext,
        register_before_llm_call_hook,
        register_after_llm_call_hook,
        clear_all_llm_call_hooks,
        
        # Tool Hooks
        ToolCallHookContext,
        register_before_tool_call_hook,
        register_after_tool_call_hook,
        clear_all_tool_call_hooks,
    )
"""

from .types import (
    BeforeLLMCallHookType,
    AfterLLMCallHookType,
    BeforeToolCallHookType,
    AfterToolCallHookType,
)

from .llm_hooks import (
    LLMCallHookContext,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    get_before_llm_call_hooks,
    get_after_llm_call_hooks,
    unregister_before_llm_call_hook,
    unregister_after_llm_call_hook,
    clear_before_llm_call_hooks,
    clear_after_llm_call_hooks,
    clear_all_llm_call_hooks,
)

from .tool_hooks import (
    ToolCallHookContext,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    get_before_tool_call_hooks,
    get_after_tool_call_hooks,
    unregister_before_tool_call_hook,
    unregister_after_tool_call_hook,
    clear_before_tool_call_hooks,
    clear_after_tool_call_hooks,
    clear_all_tool_call_hooks,
)

__all__ = [
    # Types
    "BeforeLLMCallHookType",
    "AfterLLMCallHookType",
    "BeforeToolCallHookType",
    "AfterToolCallHookType",
    # LLM Hooks
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
    # Tool Hooks
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
]

