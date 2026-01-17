"""
AgenticX Implementation of AG-UI (Agent User Interaction) Protocol.
Standardizes communication between AI agents and user-facing applications.

Partially based on: ag-ui-protocol/ag-ui
License: MIT
"""

from enum import Enum
from typing import Annotated, Any, Dict, List, Literal, Optional, Union, AsyncIterator
import time
import json
import uuid
import asyncio
from pydantic import BaseModel, ConfigDict, Field, model_validator  # type: ignore
from pydantic.alias_generators import to_camel  # type: ignore

# --- Core Types (Internalization from ag-ui/core/types.py) ---

class ConfiguredBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        alias_generator=to_camel,
        populate_by_name=True,
    )

class FunctionCall(ConfiguredBaseModel):
    name: str
    arguments: str

class ToolCall(ConfiguredBaseModel):
    id: str
    type: Literal["function"] = "function"
    function: FunctionCall

class BaseMessage(ConfiguredBaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str
    content: Optional[Union[str, List[Any]]] = None
    name: Optional[str] = None

class AssistantMessage(BaseMessage):
    role: Literal["assistant"] = "assistant"
    tool_calls: Optional[List[ToolCall]] = None

class UserMessage(BaseMessage):
    role: Literal["user"] = "user"
    content: Union[str, List[Any]]

class ToolMessage(ConfiguredBaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: Literal["tool"] = "tool"
    content: str
    tool_call_id: str
    error: Optional[str] = None

class ActivityMessage(ConfiguredBaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: Literal["activity"] = "activity"
    activity_type: str
    content: Dict[str, Any]

Message = Annotated[
    Union[AssistantMessage, UserMessage, ToolMessage, ActivityMessage],
    Field(discriminator="role")
]

# --- Event Types (Internalization from ag-ui/core/events.py) ---

class EventType(str, Enum):
    TEXT_MESSAGE_START = "TEXT_MESSAGE_START"
    TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT"
    TEXT_MESSAGE_END = "TEXT_MESSAGE_END"
    TEXT_MESSAGE_CHUNK = "TEXT_MESSAGE_CHUNK"
    TOOL_CALL_START = "TOOL_CALL_START"
    TOOL_CALL_ARGS = "TOOL_CALL_ARGS"
    TOOL_CALL_END = "TOOL_CALL_END"
    TOOL_CALL_RESULT = "TOOL_CALL_RESULT"
    ACTIVITY_SNAPSHOT = "ACTIVITY_SNAPSHOT"
    ACTIVITY_DELTA = "ACTIVITY_DELTA"
    RUN_STARTED = "RUN_STARTED"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"
    STATE_SNAPSHOT = "STATE_SNAPSHOT"
    STATE_DELTA = "STATE_DELTA"
    CUSTOM = "CUSTOM"

class BaseEvent(ConfiguredBaseModel):
    type: EventType
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    raw_event: Optional[Any] = None

class TextMessageChunkEvent(BaseEvent):
    type: Literal[EventType.TEXT_MESSAGE_CHUNK] = EventType.TEXT_MESSAGE_CHUNK
    message_id: str
    role: str = "assistant"
    delta: str

class ToolCallStartEvent(BaseEvent):
    type: Literal[EventType.TOOL_CALL_START] = EventType.TOOL_CALL_START
    tool_call_id: str
    tool_call_name: str
    parent_message_id: Optional[str] = None

class ToolCallArgsEvent(BaseEvent):
    type: Literal[EventType.TOOL_CALL_ARGS] = EventType.TOOL_CALL_ARGS
    tool_call_id: str
    delta: str

class ToolCallEndEvent(BaseEvent):
    type: Literal[EventType.TOOL_CALL_END] = EventType.TOOL_CALL_END
    tool_call_id: str

class RunStartedEvent(BaseEvent):
    type: Literal[EventType.RUN_STARTED] = EventType.RUN_STARTED
    run_id: str
    thread_id: Optional[str] = None

class RunFinishedEvent(BaseEvent):
    type: Literal[EventType.RUN_FINISHED] = EventType.RUN_FINISHED
    run_id: str
    result: Optional[Any] = None

class RunErrorEvent(BaseEvent):
    type: Literal[EventType.RUN_ERROR] = EventType.RUN_ERROR
    message: str
    code: Optional[str] = None

class StateSnapshotEvent(BaseEvent):
    type: Literal[EventType.STATE_SNAPSHOT] = EventType.STATE_SNAPSHOT
    snapshot: Any

class StateDeltaEvent(BaseEvent):
    type: Literal[EventType.STATE_DELTA] = EventType.STATE_DELTA
    delta: List[Any]  # JSON Patch (RFC 6902)

class ActivitySnapshotEvent(BaseEvent):
    type: Literal[EventType.ACTIVITY_SNAPSHOT] = EventType.ACTIVITY_SNAPSHOT
    message_id: str
    activity_type: str
    content: Any
    replace: bool = True

class CustomEvent(BaseEvent):
    type: Literal[EventType.CUSTOM] = EventType.CUSTOM
    name: str
    value: Any

Event = Annotated[
    Union[
        TextMessageChunkEvent,
        ToolCallStartEvent,
        ToolCallArgsEvent,
        ToolCallEndEvent,
        RunStartedEvent,
        RunFinishedEvent,
        RunErrorEvent,
        StateSnapshotEvent,
        StateDeltaEvent,
        ActivitySnapshotEvent,
        CustomEvent,
    ],
    Field(discriminator="type")
]

# --- Encoder (Internalization from ag-ui/encoder/encoder.py) ---

class AgUiEncoder:
    """Encodes AG-UI events into SSE format."""
    
    @staticmethod
    def encode(event: BaseEvent) -> str:
        """Encodes an event into an SSE string."""
        json_data = event.model_dump_json(by_alias=True, exclude_none=True)
        return f"data: {json_data}\n\n"

# --- Callback Handler (AgenticX Integration) ---

from ..observability.callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..core.event import (
    TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, AnyEvent
)

class AgUiCallbackHandler(BaseCallbackHandler):
    """
    AgenticX Callback Handler that emits AG-UI compatible events.
    """
    def __init__(self, config: Optional[CallbackHandlerConfig] = None):
        super().__init__(config)
        self.queue: asyncio.Queue[BaseEvent] = asyncio.Queue()
        self._current_run_id: Optional[str] = None
        self._current_message_id: Optional[str] = None

    def on_event(self, event: AnyEvent):
        """Handle AgenticX events and convert them to AG-UI events."""
        super().on_event(event) # This will trigger _handle_* methods if defined
        
        # We can also directly map here for simplicity
        if isinstance(event, TaskStartEvent):
            self._current_run_id = event.task_id
            self.queue.put_nowait(RunStartedEvent(run_id=event.task_id))
            
        elif isinstance(event, TaskEndEvent):
            self.queue.put_nowait(RunFinishedEvent(run_id=event.task_id, result=event.result))
            
        elif isinstance(event, ToolCallEvent):
            self.queue.put_nowait(ToolCallStartEvent(
                tool_call_id=str(uuid.uuid4()),
                tool_call_name=event.tool_name,
                parent_message_id=self._current_message_id
            ))
            # Note: ToolCallArgs could be added if AgenticX supports streaming tool args
            
        elif isinstance(event, ToolResultEvent):
            # In ag-ui, results are often sent as TOOL_CALL_RESULT
            # We need the original tool_call_id. For now, we simulate.
            # A real implementation would track tool_call_ids in a map.
            pass
            
        elif isinstance(event, LLMResponseEvent):
            msg_id = str(uuid.uuid4())
            self._current_message_id = msg_id
            self.queue.put_nowait(TextMessageChunkEvent(
                message_id=msg_id,
                delta=event.response
            ))
            
        elif isinstance(event, ErrorEvent):
            self.queue.put_nowait(RunErrorEvent(
                message=event.error_message,
                code=event.error_type
            ))
            
        # P1: Activity Support (Mining Step)
        elif event.type == "mining_step_update":
            step_data = event.data.get("step", {})
            self.queue.put_nowait(ActivitySnapshotEvent(
                message_id=str(uuid.uuid4()),
                activity_type="mining_step",
                content=step_data
            ))

        # P2: State Sync (Snapshot & Delta)
        elif event.type == "state_update":
            if "delta" in event.data:
                self.queue.put_nowait(StateDeltaEvent(
                    delta=event.data["delta"]
                ))
            elif "snapshot" in event.data:
                self.queue.put_nowait(StateSnapshotEvent(
                    snapshot=event.data["snapshot"]
                ))

    async def get_event_stream(self) -> AsyncIterator[BaseEvent]:
        """Async generator that yields AG-UI events from the queue."""
        while True:
            event = await self.queue.get()
            yield event
            if isinstance(event, (RunFinishedEvent, RunErrorEvent)):
                break

