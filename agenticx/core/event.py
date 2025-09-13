""" 
M5 的 Event 系统定义了 TaskStartEvent, ToolCallEvent, ErrorEvent 等12种事件类型，
这与 Trae-Agent 的 TrajectoryRecorder 记录的内容异曲同工，但在架构上更为原生
"""

from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, Union, Literal, Callable, Generic, TypeVar
from datetime import datetime, timezone
import uuid

# 定义类型变量用于泛型
EventType = TypeVar('EventType', bound=str)

class Event(BaseModel, Generic[EventType]):
    """
    Base class for all events in the AgenticX framework.
    Events form the core of the state management system following the 12-Factor Agents principle.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the event.")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="When the event occurred.")
    type: EventType = Field(description="The type of event (e.g., 'task_start', 'tool_call', 'error').")
    data: Dict[str, Any] = Field(description="Event-specific data payload.", default_factory=dict)
    agent_id: Optional[str] = Field(description="ID of the agent that generated this event.", default=None)
    task_id: Optional[str] = Field(description="ID of the task this event relates to.", default=None)
    
    # 为了向后兼容，允许不指定泛型参数
    def __init__(self, **data: Any) -> None:
        # 如果没有显式指定type，从data中获取
        if 'type' not in data and hasattr(self, 'type'):
            # 这是子类的情况，type已经在类定义中指定
            pass
        super().__init__(**data)

# 为了向后兼容，创建一个非泛型的别名
EventStr = Event[str]

class TaskStartEvent(Event[Literal["task_start"]]):
    """Event fired when a task starts execution."""
    type: Literal["task_start"] = "task_start"
    task_description: str = Field(description="Description of the task being started.")

class TaskEndEvent(Event[Literal["task_end"]]):
    """Event fired when a task completes."""
    type: Literal["task_end"] = "task_end"
    success: bool = Field(description="Whether the task completed successfully.")
    result: Optional[Any] = Field(description="The result of the task execution.", default=None)

class ToolCallEvent(Event[Literal["tool_call"]]):
    """Event fired when an agent decides to call a tool."""
    type: Literal["tool_call"] = "tool_call"
    tool_name: str = Field(description="Name of the tool being called.")
    tool_args: Dict[str, Any] = Field(description="Arguments passed to the tool.", default_factory=dict)
    intent: str = Field(description="The agent's intent behind this tool call.")

class ToolResultEvent(Event[Literal["tool_result"]]):
    """Event fired when a tool call completes."""
    type: Literal["tool_result"] = "tool_result"
    tool_name: str = Field(description="Name of the tool that was called.")
    success: bool = Field(description="Whether the tool call was successful.")
    result: Optional[Any] = Field(description="The result of the tool execution.", default=None)
    error: Optional[str] = Field(description="Error message if the tool call failed.", default=None)

class ErrorEvent(Event[Literal["error"]]):
    """Event fired when an error occurs."""
    type: Literal["error"] = "error"
    error_type: str = Field(description="Type of error (e.g., 'tool_error', 'parsing_error').")
    error_message: str = Field(description="Human-readable error message.")
    recoverable: bool = Field(description="Whether this error can be recovered from.", default=True)

class LLMCallEvent(Event[Literal["llm_call"]]):
    """Event fired when an LLM is called."""
    type: Literal["llm_call"] = "llm_call"
    prompt: str = Field(description="The prompt sent to the LLM.")
    model: str = Field(description="The model used for the call.")

class LLMResponseEvent(Event[Literal["llm_response"]]):
    """Event fired when an LLM responds."""
    type: Literal["llm_response"] = "llm_response"
    response: str = Field(description="The response from the LLM.")
    token_usage: Optional[Dict[str, int]] = Field(description="Token usage information.", default=None)
    cost: Optional[float] = Field(description="Cost of the LLM call.", default=None)

class HumanRequestEvent(Event[Literal["human_request"]]):
    """Event fired when human input is requested."""
    type: Literal["human_request"] = "human_request"
    question: str = Field(description="The question or request for human input.")
    context: Optional[str] = Field(description="Additional context for the human.", default=None)
    urgency: str = Field(description="Urgency level (low, medium, high).", default="medium")

class HumanResponseEvent(Event[Literal["human_response"]]):
    """Event fired when human provides input."""
    type: Literal["human_response"] = "human_response"
    response: str = Field(description="The human's response.")
    request_id: str = Field(description="ID of the original human request event.")

class FinishTaskEvent(Event[Literal["finish_task"]]):
    """Event fired when an agent decides the task is complete."""
    type: Literal["finish_task"] = "finish_task"
    final_result: Any = Field(description="The final result of the task.")
    reasoning: Optional[str] = Field(description="Agent's reasoning for why the task is complete.", default=None)

class ReplanningRequiredEvent(Event[Literal["replanning_required"]]):
    """Event indicating that the current plan has failed and requires replanning."""
    type: Literal["replanning_required"] = "replanning_required"
    reason: str = Field(description="Reason for the replanning request.")
    current_state: Optional[Any] = Field(description="The current state snapshot.", default=None)

class ActionCorrectionEvent(Event[Literal["action_correction"]]):
    """Event carrying a corrected action for the executor to retry."""
    type: Literal["action_correction"] = "action_correction"
    action: Dict[str, Any] = Field(description="The corrected action to be executed.")

# Union type for all event types
AnyEvent = Union[
    TaskStartEvent,
    TaskEndEvent,
    ToolCallEvent,
    ToolResultEvent,
    ErrorEvent,
    LLMCallEvent,
    LLMResponseEvent,
    HumanRequestEvent,
    HumanResponseEvent,
    FinishTaskEvent,
    ReplanningRequiredEvent,
    ActionCorrectionEvent,
    Event[str]  # Fallback for custom events
]

class EventLog(BaseModel):
    """
    An ordered log of events that represents the complete state of an agent's execution.
    This is the core of the "stateless reducer" pattern from 12-Factor Agents.
    """
    events: List[AnyEvent] = Field(description="Ordered list of events.", default_factory=list)
    agent_id: Optional[str] = Field(description="ID of the agent this log belongs to.", default=None)
    task_id: Optional[str] = Field(description="ID of the task this log relates to.", default=None)
    
    def append(self, event: AnyEvent) -> None:
        """Add an event to the log."""
        self.events.append(event)
    
    def add_event(self, event: AnyEvent) -> None:
        """Add an event to the log (alias for append)."""
        self.append(event)
    
    def get_last_event(self) -> Optional[AnyEvent]:
        """Get the most recent event."""
        return self.events[-1] if self.events else None
    
    def get_events_by_type(self, event_type: str) -> List[AnyEvent]:
        """Get all events of a specific type."""
        return [event for event in self.events if event.type == event_type]
    
    def get_current_state(self) -> Dict[str, Any]:
        """
        Derive the current state from the event log.
        This implements the "reduce" pattern where state = f(events).
        """
        if not self.events:
            return {"status": "initialized", "step_count": 0}
        
        last_event = self.get_last_event()
        step_count = len(self.events)
        
        # Determine current status based on the last event
        if isinstance(last_event, TaskEndEvent):
            status = "completed" if last_event.success else "failed"
        elif isinstance(last_event, FinishTaskEvent):
            status = "completed"
        elif isinstance(last_event, ErrorEvent) and not last_event.recoverable:
            status = "failed"
        elif isinstance(last_event, HumanRequestEvent):
            status = "waiting_for_human"
        elif isinstance(last_event, ToolCallEvent):
            status = "executing_tool"
        elif isinstance(last_event, TaskStartEvent):
            status = "running"
        else:
            status = "running"
        
        return {
            "status": status,
            "step_count": step_count,
            "last_event_type": last_event.type if last_event else None,
            "last_event_id": last_event.id if last_event else None
        }
    
    def can_continue(self) -> bool:
        """Check if execution can continue based on current state."""
        state = self.get_current_state()
        status = state.get("status", "")
        if isinstance(status, str) and status in ["running", "executing_tool"]:
            return True
        return False
    
    def needs_human_input(self) -> bool:
        """Check if execution is waiting for human input."""
        return self.get_current_state()["status"] == "waiting_for_human"
    
    def is_complete(self) -> bool:
        """Check if the task is complete."""
        return self.get_current_state()["status"] in ["completed", "failed"]


def listens_to(event_type: str) -> Callable:
    """装饰器，用于标记事件监听器方法
    
    Args:
        event_type: 要监听的事件类型
    
    Returns:
        装饰器函数
    """
    def decorator(func: Callable) -> Callable:
        # 为函数添加事件类型标记
        setattr(func, "_listens_to", event_type)
        return func
    return decorator