"""Managed Agents wire protocol ``agx-ma/2026-11``.

Author: Damon Li


Pydantic models use ``extra="forbid"``. Event parsers raise ``MAError`` for batch
failures so callers never observe a partial accept.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

from agenticx.managed.errors import DUPLICATE_RESOLUTION, INVALID_EVENT_BATCH, MAError
from agenticx.managed.manifest import AgentManifest

PROTOCOL_VERSION = "agx-ma/2026-11"
MANIFEST_SCHEMA = "agx.agent/v1"

SessionStatus = Literal["idle", "running", "rescheduling", "terminated", "archived"]
StopReasonType = Literal[
    "end_turn",
    "requires_action",
    "retries_exhausted",
    "refusal",
    "max_tool_rounds",
    "budget_exceeded",
    "policy_blocked",
]
EnvironmentType = Literal["cloud", "desktop_worker"]
SessionSource = Literal["portal", "desktop", "api", "schedule", "channel", "eval"]
ToolPolicy = Literal["always_allow", "always_ask"]
WorkItemStatus = Literal["queued", "claimed", "running", "completed", "failed", "stopped"]
RetryStatusType = Literal["retrying", "exhausted", "terminal"]
ImageMediaType = Literal["image/jpeg", "image/png", "image/gif", "image/webp"]

CLIENT_EVENT_TYPES: tuple[str, ...] = (
    "user.message",
    "user.interrupt",
    "user.tool_confirmation",
    "user.custom_tool_result",
)
SERVER_EVENT_TYPES: tuple[str, ...] = (
    "agent.message",
    "agent.thinking",
    "agent.tool_use",
    "agent.tool_result",
    "agent.mcp_tool_use",
    "agent.mcp_tool_result",
    "agent.custom_tool_use",
    "session.status_running",
    "session.status_idle",
    "session.status_terminated",
    "session.error",
    "session.usage",
    "span.model_request_start",
    "span.model_request_end",
    "session.task_created",
    "session.task_completed",
    "session.thread_created",
    "session.thread_status_running",
    "session.thread_status_idle",
    "session.thread_status_terminated",
    "agent.thread_message_sent",
    "agent.thread_message_received",
)
PREVIEW_FRAME_TYPES: tuple[str, ...] = ("event_start", "event_delta")

PAT_SCOPES: tuple[str, ...] = (
    "ma:agents:read",
    "ma:agents:write",
    "ma:environments:read",
    "ma:environments:write",
    "ma:sessions:read",
    "ma:sessions:write",
    "ma:sessions:on_behalf",
    "ma:worker",
    "ma:vaults:read",
    "ma:vaults:write",
    "ma:memory:read",
    "ma:memory:write",
    "ma:schedules:read",
    "ma:schedules:write",
    "ma:webhooks:read",
    "ma:webhooks:write",
    "ma:channels:read",
    "ma:channels:write",
    "ma:admin",
)
MAX_EVENTS_PER_BATCH = 10
SSE_PING_INTERVAL_SECONDS = 15
WORK_LEASE_TTL_SECONDS = 120
WORK_HEARTBEAT_INTERVAL_SECONDS = 15
WORK_STOP_GRACE_SECONDS = 60
WORK_POLL_MAX_WAIT_SECONDS = 25


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextBlock(_StrictModel):
    type: Literal["text"]
    text: str


class Base64Source(_StrictModel):
    type: Literal["base64"]
    media_type: ImageMediaType
    data: str


class UrlSource(_StrictModel):
    type: Literal["url"]
    url: str

    @field_validator("url")
    @classmethod
    def _https_url(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("url must start with https://")
        return value


class FileSource(_StrictModel):
    type: Literal["file"]
    file_id: str


class ImageBlock(_StrictModel):
    type: Literal["image"]
    source: Annotated[Base64Source | UrlSource | FileSource, Field(discriminator="type")]


class TextDocSource(_StrictModel):
    type: Literal["text"]
    text: str


class DocumentBlock(_StrictModel):
    type: Literal["document"]
    source: Annotated[TextDocSource | FileSource, Field(discriminator="type")]
    title: str | None = None


ContentBlock = Annotated[
    TextBlock | ImageBlock | DocumentBlock,
    Field(discriminator="type"),
]


class EventBase(_StrictModel):
    id: str | None = None
    session_id: str | None = None
    seq: int | None = None
    thread_id: str | None = None
    created_at: str | None = None
    processed_at: str | None = None


class UserMessage(EventBase):
    type: Literal["user.message"]
    content: list[ContentBlock] = Field(min_length=1)


class UserInterrupt(EventBase):
    type: Literal["user.interrupt"]


class UserToolConfirmation(EventBase):
    type: Literal["user.tool_confirmation"]
    tool_use_id: str = Field(min_length=1)
    result: Literal["allow", "deny"]
    deny_message: str | None = None

    @model_validator(mode="after")
    def _deny_message_only_with_deny(self) -> Self:
        if self.result == "allow" and self.deny_message is not None:
            raise ValueError("deny_message is only allowed with deny")
        return self


class UserCustomToolResult(EventBase):
    type: Literal["user.custom_tool_result"]
    custom_tool_use_id: str = Field(min_length=1)
    content: list[ContentBlock] = Field(default_factory=list)
    is_error: bool = False


ClientEvent = Annotated[
    UserMessage | UserInterrupt | UserToolConfirmation | UserCustomToolResult,
    Field(discriminator="type"),
]


class StopReason(_StrictModel):
    type: StopReasonType
    event_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _event_ids_match_type(self) -> Self:
        if self.type == "requires_action":
            if not self.event_ids:
                raise ValueError("requires_action requires non-empty event_ids")
        elif self.event_ids:
            raise ValueError("event_ids must be empty unless type is requires_action")
        return self


class RetryStatus(_StrictModel):
    type: RetryStatusType


class ErrorInfo(_StrictModel):
    type: str
    message: str
    retry_status: RetryStatus
    mcp_server: str | None = None


class Usage(_StrictModel):
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cache_read_input_tokens: int = Field(default=0, ge=0)
    tool_calls: int = Field(default=0, ge=0)
    runtime_ms: int = Field(default=0, ge=0)


class AgentMessage(EventBase):
    type: Literal["agent.message"]
    content: list[ContentBlock]


class AgentThinking(EventBase):
    type: Literal["agent.thinking"]
    content: list[TextBlock] = Field(default_factory=list)


class AgentToolUse(EventBase):
    type: Literal["agent.tool_use"]
    name: str
    input: dict[str, Any]
    evaluated_policy: ToolPolicy


class AgentToolResult(EventBase):
    type: Literal["agent.tool_result"]
    tool_use_id: str
    content: list[ContentBlock] = Field(default_factory=list)
    is_error: bool = False


class AgentMcpToolUse(EventBase):
    type: Literal["agent.mcp_tool_use"]
    mcp_server: str
    name: str
    input: dict[str, Any]
    evaluated_policy: ToolPolicy


class AgentMcpToolResult(EventBase):
    type: Literal["agent.mcp_tool_result"]
    mcp_tool_use_id: str
    content: list[ContentBlock] = Field(default_factory=list)
    is_error: bool = False


class AgentCustomToolUse(EventBase):
    type: Literal["agent.custom_tool_use"]
    name: str
    input: dict[str, Any]


class SessionStatusRunning(EventBase):
    type: Literal["session.status_running"]


class SessionStatusIdle(EventBase):
    type: Literal["session.status_idle"]
    stop_reason: StopReason


class SessionStatusTerminated(EventBase):
    type: Literal["session.status_terminated"]
    reason: str | None = None


class SessionErrorEvent(EventBase):
    type: Literal["session.error"]
    error: ErrorInfo


class SessionUsage(EventBase):
    type: Literal["session.usage"]
    usage: Usage


class SpanModelRequestStart(EventBase):
    type: Literal["span.model_request_start"]
    model: str


class SpanModelRequestEnd(EventBase):
    type: Literal["span.model_request_end"]
    model: str
    is_error: bool = False
    model_usage: Usage = Field(default_factory=Usage)


class TaskToolRef(_StrictModel):
    name: str
    tool_use_id: str | None = None


class TaskResult(_StrictModel):
    status: Literal["ok", "error"]
    exit_code: int | None = None
    output: str = ""


class TaskError(_StrictModel):
    type: str
    message: str


class SessionTaskCreated(EventBase):
    type: Literal["session.task_created"]
    task_id: str
    tool: TaskToolRef
    summary: str
    log_path: str | None = None


class SessionTaskCompleted(EventBase):
    type: Literal["session.task_completed"]
    task_id: str
    state: Literal["succeeded", "failed", "cancelled"]
    summary: str = ""
    result: TaskResult | None = None
    error: TaskError | None = None
    duration_ms: int = Field(default=0, ge=0)


class ThreadAgentRef(_StrictModel):
    type: Literal["self", "agent", "advisor"]
    agent_id: str | None = None
    agent_version: int | None = None
    name: str | None = None
    model: str | None = None


class SessionThreadCreated(EventBase):
    type: Literal["session.thread_created"]
    agent: ThreadAgentRef
    parent_thread_id: str | None = None  # null = primary thread


class SessionThreadStatusRunning(EventBase):
    type: Literal["session.thread_status_running"]


class SessionThreadStatusIdle(EventBase):
    type: Literal["session.thread_status_idle"]
    stop_reason: StopReason


class SessionThreadStatusTerminated(EventBase):
    type: Literal["session.thread_status_terminated"]
    reason: Literal["completed", "archived", "context_lost", "host_restarted", "session_closed"]


class AgentThreadMessageSent(EventBase):
    type: Literal["agent.thread_message_sent"]
    to_thread_id: str | None = None  # null = primary
    to_agent_name: str
    content: list[ContentBlock]


class AgentThreadMessageReceived(EventBase):
    type: Literal["agent.thread_message_received"]
    from_thread_id: str | None = None  # null = primary
    from_agent_name: str
    content: list[ContentBlock]


ServerEvent = Annotated[
    AgentMessage
    | AgentThinking
    | AgentToolUse
    | AgentToolResult
    | AgentMcpToolUse
    | AgentMcpToolResult
    | AgentCustomToolUse
    | SessionStatusRunning
    | SessionStatusIdle
    | SessionStatusTerminated
    | SessionErrorEvent
    | SessionUsage
    | SpanModelRequestStart
    | SpanModelRequestEnd
    | SessionTaskCreated
    | SessionTaskCompleted
    | SessionThreadCreated
    | SessionThreadStatusRunning
    | SessionThreadStatusIdle
    | SessionThreadStatusTerminated
    | AgentThreadMessageSent
    | AgentThreadMessageReceived,
    Field(discriminator="type"),
]


class EventStartFrame(_StrictModel):
    type: Literal["event_start"]
    event: dict[str, Any]


class EventDeltaFrame(_StrictModel):
    type: Literal["event_delta"]
    event_type: Literal["agent.message", "agent.thinking"]
    content_delta: str


class AgentRecord(_StrictModel):
    id: str
    tenant_id: str
    slug: str
    display_name: str
    description: str | None = None
    latest_version: int = Field(ge=1)
    status: Literal["active", "disabled"]
    lifecycle: Literal["draft", "published", "recalled"]
    origin: Literal["enterprise", "employee"]
    assignment_keys: list[str]
    worker_keys: list[str]
    default_environment_id: str | None = None


class AgentVersionRecord(_StrictModel):
    agent_id: str
    version: int = Field(ge=1)
    manifest: dict[str, Any]
    manifest_hash: str
    created_by: str | None = None
    created_at: str
    note: str | None = None


class CloudEnvironmentConfig(_StrictModel):
    type: Literal["cloud"]
    sandbox_backend: Literal["subprocess", "docker", "remote"] = "docker"
    image: str | None = None
    egress_allow_domains: list[str] = Field(default_factory=list)
    idle_ttl_seconds: int = Field(default=3600, ge=60, le=86400)


class DesktopWorkerEnvironmentConfig(_StrictModel):
    type: Literal["desktop_worker"]
    worker_keys: list[str] = Field(default_factory=list)


EnvironmentConfig = Annotated[
    CloudEnvironmentConfig | DesktopWorkerEnvironmentConfig,
    Field(discriminator="type"),
]


class EnvironmentRecord(_StrictModel):
    id: str
    tenant_id: str
    name: str
    type: EnvironmentType
    config: EnvironmentConfig
    status: Literal["active", "disabled"]

    @model_validator(mode="after")
    def _config_type_matches(self) -> Self:
        if self.config.type != self.type:
            raise ValueError("config.type must equal type")
        return self


class SessionRecord(_StrictModel):
    id: str
    tenant_id: str
    agent_id: str
    agent_version: int = Field(ge=1)
    environment_id: str | None = None
    created_by_user_id: str | None = None
    source: SessionSource
    status: SessionStatus
    stop_reason: StopReason | None = None
    title: str | None = None
    vault_ids: list[str] = Field(default_factory=list)
    resources: list[dict[str, Any]] = Field(default_factory=list)
    usage: Usage = Field(default_factory=Usage)
    created_at: str
    updated_at: str
    archived_at: str | None = None


class WorkItemRecord(_StrictModel):
    id: str
    session_id: str
    environment_id: str
    status: WorkItemStatus
    claimed_by_device: str | None = None
    lease_expires_at: str | None = None
    attempts: int = Field(default=0, ge=0)
    last_heartbeat_at: str | None = None


_CLIENT_EVENT_ADAPTER: TypeAdapter[Any] = TypeAdapter(ClientEvent)
_SERVER_EVENT_ADAPTER: TypeAdapter[Any] = TypeAdapter(ServerEvent)
_AGENT_MANIFEST_ADAPTER: TypeAdapter[AgentManifest] = TypeAdapter(AgentManifest)
_SESSION_RECORD_ADAPTER: TypeAdapter[SessionRecord] = TypeAdapter(SessionRecord)
_ENVIRONMENT_RECORD_ADAPTER: TypeAdapter[EnvironmentRecord] = TypeAdapter(EnvironmentRecord)


def parse_client_events(raw: Any) -> list[Any]:
    """Parse one atomic client batch. Any error raises and nothing is returned."""
    if not isinstance(raw, dict) or "events" not in raw or not isinstance(raw.get("events"), list):
        raise MAError(INVALID_EVENT_BATCH, "events must be a list")
    events = raw["events"]
    if len(events) == 0 or len(events) > MAX_EVENTS_PER_BATCH:
        raise MAError(INVALID_EVENT_BATCH, "events must contain 1-10 items")

    parsed: list[Any] = []
    seen_confirmations: set[str] = set()
    seen_custom_results: set[str] = set()
    for index, item in enumerate(events):
        try:
            event = _CLIENT_EVENT_ADAPTER.validate_python(item)
        except ValidationError:
            raise MAError(
                INVALID_EVENT_BATCH,
                f"events[{index}]: invalid",
                details={"index": index},
            ) from None
        if isinstance(event, UserToolConfirmation):
            if event.tool_use_id in seen_confirmations:
                raise MAError(
                    DUPLICATE_RESOLUTION,
                    f"events[{index}]: duplicate resolution for {event.tool_use_id}",
                    details={"index": index},
                )
            seen_confirmations.add(event.tool_use_id)
        elif isinstance(event, UserCustomToolResult):
            if event.custom_tool_use_id in seen_custom_results:
                raise MAError(
                    DUPLICATE_RESOLUTION,
                    f"events[{index}]: duplicate resolution for {event.custom_tool_use_id}",
                    details={"index": index},
                )
            seen_custom_results.add(event.custom_tool_use_id)
        parsed.append(event)
    return parsed


def parse_server_event(raw: dict[str, Any]) -> Any:
    return _SERVER_EVENT_ADAPTER.validate_python(raw)


def event_to_wire(event: BaseModel) -> dict[str, Any]:
    """JSON object for SSE and history responses. Null fields are omitted."""
    dumped = event.model_dump(mode="json", exclude_none=True)
    if not isinstance(dumped, dict):
        raise TypeError("event_to_wire expected an object")
    return dumped


def export_json_schemas() -> dict[str, dict]:
    return {
        "ClientEvent": _CLIENT_EVENT_ADAPTER.json_schema(),
        "ServerEvent": _SERVER_EVENT_ADAPTER.json_schema(),
        "AgentManifest": _AGENT_MANIFEST_ADAPTER.json_schema(),
        "SessionRecord": _SESSION_RECORD_ADAPTER.json_schema(),
        "EnvironmentRecord": _ENVIRONMENT_RECORD_ADAPTER.json_schema(),
    }
