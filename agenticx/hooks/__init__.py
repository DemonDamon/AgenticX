"""AgenticX hooks package.

Author: Damon Li

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
    HookEvent,
    HookHandler,
)
from .registry import HookRegistry, get_global_hook_registry
from .loader import (
    discover_hooks,
    discover_declarative_hooks,
    load_hooks,
    build_hook_search_paths,
    get_hook_settings_from_config,
)
from .status import build_hook_status
from .declarative import (
    DeclarativeHookConfig,
    DeclarativeHookExecutor,
    DeclarativeAgentHook,
    create_declarative_agent_hook,
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


def register_hook(event_key: str, handler: HookHandler) -> None:
    """Register a unified event hook handler."""
    get_global_hook_registry().register(event_key, handler)


def unregister_hook(event_key: str, handler: HookHandler) -> bool:
    """Unregister a unified event hook handler."""
    return get_global_hook_registry().unregister(event_key, handler)


def clear_hooks() -> None:
    """Clear all unified event hooks."""
    get_global_hook_registry().clear()


async def trigger_hook_event(event: HookEvent) -> bool:
    """Trigger a unified event asynchronously."""
    return await get_global_hook_registry().trigger(event)


def trigger_hook_event_sync(event: HookEvent) -> bool:
    """Trigger a unified event synchronously."""
    return get_global_hook_registry().trigger_sync(event)


def load_discovered_hooks(workspace_dir: str | None = None) -> int:
    """Discover and load hooks from bundled, managed, and workspace directories."""
    from pathlib import Path

    root = Path(workspace_dir).resolve() if workspace_dir else Path.cwd()
    return load_hooks(root)

__all__ = [
    # Types
    "BeforeLLMCallHookType",
    "AfterLLMCallHookType",
    "BeforeToolCallHookType",
    "AfterToolCallHookType",
    "HookEvent",
    "HookHandler",
    "HookRegistry",
    "discover_hooks",
    "build_hook_status",
    "load_discovered_hooks",
    "discover_declarative_hooks",
    "build_hook_search_paths",
    "get_hook_settings_from_config",
    "DeclarativeHookConfig",
    "DeclarativeHookExecutor",
    "DeclarativeAgentHook",
    "create_declarative_agent_hook",
    "register_hook",
    "unregister_hook",
    "clear_hooks",
    "trigger_hook_event",
    "trigger_hook_event_sync",
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

