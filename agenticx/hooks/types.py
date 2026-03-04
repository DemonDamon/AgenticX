"""Hook type definitions and shared event model.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Dict, List, Optional, Protocol, runtime_checkable

if TYPE_CHECKING:
    from .llm_hooks import LLMCallHookContext
    from .tool_hooks import ToolCallHookContext


@dataclass
class HookEvent:
    """Unified hook event passed through the internal hook bus."""

    type: str
    action: str
    agent_id: str
    session_key: str = ""
    task_id: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    messages: List[str] = field(default_factory=list)


HookHandler = Callable[[HookEvent], Awaitable[Optional[bool]]]


@runtime_checkable
class BeforeLLMCallHook(Protocol):
    """Protocol for before_llm_call hooks.
    
    These hooks are called before an LLM is invoked and can modify the messages
    that will be sent to the LLM or block the execution entirely.
    
    Returns:
        False to block LLM execution, True or None to allow execution
    """
    
    def __call__(self, context: "LLMCallHookContext") -> bool | None:
        ...


@runtime_checkable
class AfterLLMCallHook(Protocol):
    """Protocol for after_llm_call hooks.
    
    These hooks are called after an LLM returns a response and can modify
    the response or the message history.
    
    Returns:
        Modified response string, or None to keep the original response
    """
    
    def __call__(self, context: "LLMCallHookContext") -> str | None:
        ...


@runtime_checkable
class BeforeToolCallHook(Protocol):
    """Protocol for before_tool_call hooks.
    
    These hooks are called before a tool is executed and can modify the tool
    input or block the execution entirely.
    
    Returns:
        False to block tool execution, True or None to allow execution
    """
    
    def __call__(self, context: "ToolCallHookContext") -> bool | None:
        ...


@runtime_checkable
class AfterToolCallHook(Protocol):
    """Protocol for after_tool_call hooks.
    
    These hooks are called after a tool executes and can modify the result.
    
    Returns:
        Modified tool result string, or None to keep the original result
    """
    
    def __call__(self, context: "ToolCallHookContext") -> str | None:
        ...


# Type aliases for legacy hook functions
BeforeLLMCallHookType = Callable[["LLMCallHookContext"], bool | None]
AfterLLMCallHookType = Callable[["LLMCallHookContext"], str | None]
BeforeToolCallHookType = Callable[["ToolCallHookContext"], bool | None]
AfterToolCallHookType = Callable[["ToolCallHookContext"], str | None]

__all__ = [
    "BeforeLLMCallHook",
    "AfterLLMCallHook",
    "BeforeToolCallHook",
    "AfterToolCallHook",
    "HookEvent",
    "HookHandler",
    "BeforeLLMCallHookType",
    "AfterLLMCallHookType",
    "BeforeToolCallHookType",
    "AfterToolCallHookType",
]

