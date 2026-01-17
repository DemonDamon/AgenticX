"""
Hooks 系统类型定义

参考 crewAI Hooks 设计，提供 LLM 和 Tool 调用的钩子上下文类型。

"""

from typing import Any, Dict, List, Optional, TYPE_CHECKING
from dataclasses import dataclass, field
from datetime import datetime

if TYPE_CHECKING:
    from ..agent import Agent
    from ..message import Message


@dataclass
class LLMCallHookContext:
    """LLM 调用钩子上下文
    
    在 LLM 调用前后传递的上下文信息。
    """
    agent_id: str
    task_id: Optional[str] = None
    messages: List[Any] = field(default_factory=list)  # List[Message] in practice
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    iteration: int = 0
    timestamp: datetime = field(default_factory=datetime.now)
    
    # After call fields
    response: Optional[Any] = None  # LLM response
    tokens_used: Optional[int] = None
    cost: Optional[float] = None
    duration_ms: Optional[float] = None
    error: Optional[Exception] = None


@dataclass
class ToolCallHookContext:
    """工具调用钩子上下文
    
    在工具调用前后传递的上下文信息。
    """
    agent_id: str
    task_id: Optional[str] = None
    tool_name: str = ""
    tool_args: Dict[str, Any] = field(default_factory=dict)
    iteration: int = 0
    timestamp: datetime = field(default_factory=datetime.now)
    
    # After call fields
    result: Optional[Any] = None
    success: bool = True
    duration_ms: Optional[float] = None
    error: Optional[Exception] = None
