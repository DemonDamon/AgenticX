# MA-00 协议与 Manifest 冻结、威胁模型

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W0）

## 1. 目标

把总规划第 5、6 节的资源模型、Agent Manifest、事件协议、错误码和 PAT scope 落成两份可执行代码：Python（单一事实来源）与 TS（类型 + 同语义校验器），并用同一组 JSON fixture 证明两端结论一致。同时落两份文档：协议说明与威胁模型。

本子规划**只新增文件**，不修改任何现有 Python / TS 模块（唯一例外：`enterprise/packages/core-api/package.json` 加 test 脚本，`enterprise/packages/core-api/src/index.ts` 加一行 re-export）。

## 2. In scope / Out of scope

In scope（只能创建或修改这些文件）：
- 新建 `agenticx/managed/__init__.py`
- 新建 `agenticx/managed/protocol.py`
- 新建 `agenticx/managed/manifest.py`
- 新建 `agenticx/managed/errors.py`
- 新建 `tests/managed/__init__.py`（空文件）
- 新建 `tests/managed/test_protocol.py`
- 新建 `tests/managed/test_manifest.py`
- 新建 `tests/managed/test_fixture_parity.py`
- 新建 `tests/fixtures/managed_agents/manifest_cases.json`
- 新建 `tests/fixtures/managed_agents/event_cases.json`
- 新建 `enterprise/packages/core-api/src/managed-agents.ts`
- 新建 `enterprise/packages/core-api/src/__tests__/managed-agents.test.ts`
- 修改 `enterprise/packages/core-api/src/index.ts`：追加 `export * from "./managed-agents";`
- 修改 `enterprise/packages/core-api/package.json`：`scripts` 增加 `"test": "vitest run"`（vitest 已在 `enterprise/package.json` devDependencies，可直接解析）
- 新建 `docs/managed-agents/protocol.md`
- 新建 `docs/managed-agents/threat-model.md`

Out of scope：任何运行时、存储、HTTP 路由、数据库迁移、Studio、Desktop 代码。不得 import `agenticx.studio`、`agenticx.runtime`。

## 3. Python 模块设计

### 3.1 `agenticx/managed/errors.py`

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class MAErrorCode:
    code: str
    http_status: int

class MAError(Exception):
    def __init__(self, code: MAErrorCode, message: str, details: dict | None = None): ...
    # 属性：code(str), http_status(int), message(str), details(dict)
    def to_dict(self) -> dict:  # {"error": {"code":..., "message":..., "details": {...}}}
```

模块级常量（名称与值逐字照抄）：

| 常量 | code | http_status |
|------|------|-------------|
| `INVALID_REQUEST` | `invalid_request` | 400 |
| `INVALID_EVENT_BATCH` | `invalid_event_batch` | 400 |
| `DUPLICATE_RESOLUTION` | `duplicate_resolution` | 400 |
| `MANIFEST_INVALID` | `manifest_invalid` | 400 |
| `UNAUTHORIZED` | `unauthorized` | 401 |
| `FORBIDDEN_SCOPE` | `forbidden_scope` | 403 |
| `SESSION_NOT_FOUND` | `session_not_found` | 404 |
| `AGENT_NOT_FOUND` | `agent_not_found` | 404 |
| `AGENT_VERSION_NOT_FOUND` | `agent_version_not_found` | 404 |
| `ENVIRONMENT_NOT_FOUND` | `environment_not_found` | 404 |
| `RESOLUTION_NOT_FOUND` | `resolution_not_found` | 404 |
| `SESSION_REQUIRES_ACTION` | `session_requires_action` | 409 |
| `RESOLUTION_CONFLICT` | `resolution_conflict` | 409 |
| `WORK_LEASE_LOST` | `work_lease_lost` | 409 |
| `SESSION_TERMINATED` | `session_terminated` | 409 |
| `INTERNAL` | `internal_error` | 500 |

另导出 `ALL_ERROR_CODES: tuple[MAErrorCode, ...]`（上表全部，按表格顺序）。

### 3.2 `agenticx/managed/protocol.py`

使用 pydantic v2（仓库已依赖 `pydantic>=2`）。全部模型 `model_config = ConfigDict(extra="forbid")`，除非下文另注。

**常量与字面量（逐字）：**

```python
PROTOCOL_VERSION = "agx-ma/2026-11"
MANIFEST_SCHEMA = "agx.agent/v1"

SessionStatus = Literal["idle", "running", "rescheduling", "terminated", "archived"]
StopReasonType = Literal["end_turn", "requires_action", "retries_exhausted", "refusal",
                         "max_tool_rounds", "budget_exceeded", "policy_blocked"]
EnvironmentType = Literal["cloud", "desktop_worker"]
SessionSource = Literal["portal", "desktop", "api", "schedule", "channel", "eval"]
ToolPolicy = Literal["always_allow", "always_ask"]
WorkItemStatus = Literal["queued", "claimed", "running", "completed", "failed", "stopped"]
RetryStatusType = Literal["retrying", "exhausted", "terminal"]

CLIENT_EVENT_TYPES: tuple[str, ...] = (
    "user.message", "user.interrupt", "user.tool_confirmation", "user.custom_tool_result",
)
SERVER_EVENT_TYPES: tuple[str, ...] = (
    "agent.message", "agent.thinking",
    "agent.tool_use", "agent.tool_result",
    "agent.mcp_tool_use", "agent.mcp_tool_result",
    "agent.custom_tool_use",
    "session.status_running", "session.status_idle", "session.status_terminated",
    "session.error", "session.usage",
    "span.model_request_start", "span.model_request_end",
)
PREVIEW_FRAME_TYPES: tuple[str, ...] = ("event_start", "event_delta")

PAT_SCOPES: tuple[str, ...] = (
    "ma:agents:read", "ma:agents:write",
    "ma:environments:read", "ma:environments:write",
    "ma:sessions:read", "ma:sessions:write",
    "ma:worker",
    "ma:vaults:read", "ma:vaults:write",
    "ma:memory:read", "ma:memory:write",
    "ma:admin",
)
MAX_EVENTS_PER_BATCH = 10
SSE_PING_INTERVAL_SECONDS = 15
WORK_LEASE_TTL_SECONDS = 120
WORK_HEARTBEAT_INTERVAL_SECONDS = 15
WORK_STOP_GRACE_SECONDS = 60
WORK_POLL_MAX_WAIT_SECONDS = 25
```

**内容块：**

```python
class TextBlock(BaseModel):      type: Literal["text"]; text: str
class Base64Source(BaseModel):   type: Literal["base64"]; media_type: Literal["image/jpeg","image/png","image/gif","image/webp"]; data: str
class UrlSource(BaseModel):      type: Literal["url"]; url: str   # 必须以 https:// 开头，用 field_validator
class FileSource(BaseModel):     type: Literal["file"]; file_id: str
class ImageBlock(BaseModel):     type: Literal["image"]; source: Annotated[Base64Source | UrlSource | FileSource, Field(discriminator="type")]
class TextDocSource(BaseModel):  type: Literal["text"]; text: str
class DocumentBlock(BaseModel):  type: Literal["document"]; source: Annotated[TextDocSource | FileSource, Field(discriminator="type")]; title: str | None = None
ContentBlock = Annotated[TextBlock | ImageBlock | DocumentBlock, Field(discriminator="type")]
```

**事件公共字段：** 定义 `class EventBase(BaseModel)`，字段全部可选：`id: str | None = None`、`session_id: str | None = None`、`seq: int | None = None`、`thread_id: str | None = None`、`created_at: str | None = None`、`processed_at: str | None = None`。所有事件继承它。

**客户端事件：**

```python
class UserMessage(EventBase):           type: Literal["user.message"]; content: list[ContentBlock] = Field(min_length=1)
class UserInterrupt(EventBase):         type: Literal["user.interrupt"]
class UserToolConfirmation(EventBase):  type: Literal["user.tool_confirmation"]; tool_use_id: str = Field(min_length=1); result: Literal["allow","deny"]; deny_message: str | None = None
    # model_validator(mode="after")：result == "allow" 且 deny_message 非 None → ValueError("deny_message is only allowed with deny")
class UserCustomToolResult(EventBase):  type: Literal["user.custom_tool_result"]; custom_tool_use_id: str = Field(min_length=1); content: list[ContentBlock] = Field(default_factory=list); is_error: bool = False
ClientEvent = Annotated[UserMessage | UserInterrupt | UserToolConfirmation | UserCustomToolResult, Field(discriminator="type")]
```

**服务端事件：**

```python
class StopReason(BaseModel):     type: StopReasonType; event_ids: list[str] = Field(default_factory=list)
    # model_validator：type == "requires_action" 时 event_ids 必须非空；其他 type 时 event_ids 必须为空
class RetryStatus(BaseModel):    type: RetryStatusType
class ErrorInfo(BaseModel):      type: str; message: str; retry_status: RetryStatus; mcp_server: str | None = None
class Usage(BaseModel):          input_tokens: int = 0; output_tokens: int = 0; cache_read_input_tokens: int = 0; tool_calls: int = 0; runtime_ms: int = 0   # 全部 ge=0

class AgentMessage(EventBase):        type: Literal["agent.message"]; content: list[ContentBlock]
class AgentThinking(EventBase):       type: Literal["agent.thinking"]; content: list[TextBlock] = Field(default_factory=list)
class AgentToolUse(EventBase):        type: Literal["agent.tool_use"]; name: str; input: dict[str, Any]; evaluated_policy: ToolPolicy
class AgentToolResult(EventBase):     type: Literal["agent.tool_result"]; tool_use_id: str; content: list[ContentBlock] = Field(default_factory=list); is_error: bool = False
class AgentMcpToolUse(EventBase):     type: Literal["agent.mcp_tool_use"]; mcp_server: str; name: str; input: dict[str, Any]; evaluated_policy: ToolPolicy
class AgentMcpToolResult(EventBase):  type: Literal["agent.mcp_tool_result"]; mcp_tool_use_id: str; content: list[ContentBlock] = Field(default_factory=list); is_error: bool = False
class AgentCustomToolUse(EventBase):  type: Literal["agent.custom_tool_use"]; name: str; input: dict[str, Any]
class SessionStatusRunning(EventBase):    type: Literal["session.status_running"]
class SessionStatusIdle(EventBase):       type: Literal["session.status_idle"]; stop_reason: StopReason
class SessionStatusTerminated(EventBase): type: Literal["session.status_terminated"]; reason: str | None = None
class SessionErrorEvent(EventBase):       type: Literal["session.error"]; error: ErrorInfo
class SessionUsage(EventBase):            type: Literal["session.usage"]; usage: Usage
class SpanModelRequestStart(EventBase):   type: Literal["span.model_request_start"]; model: str
class SpanModelRequestEnd(EventBase):     type: Literal["span.model_request_end"]; model: str; is_error: bool = False; model_usage: Usage = Field(default_factory=Usage)
ServerEvent = Annotated[<上述 14 个类的 Union>, Field(discriminator="type")]
```

**预览帧（不落库，不继承 EventBase）：**

```python
class EventStartFrame(BaseModel): type: Literal["event_start"]; event: dict[str, Any]
class EventDeltaFrame(BaseModel): type: Literal["event_delta"]; event_type: Literal["agent.message","agent.thinking"]; content_delta: str
```

**资源记录（`extra="forbid"`）：**

```python
class AgentRecord(BaseModel):
    id: str; tenant_id: str; slug: str; display_name: str; description: str | None = None
    latest_version: int = Field(ge=1); status: Literal["active","disabled"]
    lifecycle: Literal["draft","published","recalled"]; origin: Literal["enterprise","employee"]
    assignment_keys: list[str]; worker_keys: list[str]; default_environment_id: str | None = None
class AgentVersionRecord(BaseModel):
    agent_id: str; version: int = Field(ge=1); manifest: dict[str, Any]; manifest_hash: str
    created_by: str | None = None; created_at: str; note: str | None = None
class CloudEnvironmentConfig(BaseModel):
    type: Literal["cloud"]; sandbox_backend: Literal["subprocess","docker","remote"] = "docker"
    image: str | None = None; egress_allow_domains: list[str] = Field(default_factory=list)
    idle_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
class DesktopWorkerEnvironmentConfig(BaseModel):
    type: Literal["desktop_worker"]; worker_keys: list[str] = Field(default_factory=list)
EnvironmentConfig = Annotated[CloudEnvironmentConfig | DesktopWorkerEnvironmentConfig, Field(discriminator="type")]
class EnvironmentRecord(BaseModel):
    id: str; tenant_id: str; name: str; type: EnvironmentType; config: EnvironmentConfig; status: Literal["active","disabled"]
    # model_validator：config.type 必须等于 type
class SessionRecord(BaseModel):
    id: str; tenant_id: str; agent_id: str; agent_version: int = Field(ge=1); environment_id: str | None = None
    created_by_user_id: str | None = None; source: SessionSource; status: SessionStatus
    stop_reason: StopReason | None = None; title: str | None = None
    vault_ids: list[str] = Field(default_factory=list); resources: list[dict[str, Any]] = Field(default_factory=list)
    usage: Usage = Field(default_factory=Usage); created_at: str; updated_at: str; archived_at: str | None = None
class WorkItemRecord(BaseModel):
    id: str; session_id: str; environment_id: str; status: WorkItemStatus
    claimed_by_device: str | None = None; lease_expires_at: str | None = None
    attempts: int = Field(default=0, ge=0); last_heartbeat_at: str | None = None
```

**函数：**

```python
def parse_client_events(raw: Any) -> list[ClientEvent]:
    """raw 必须是 {"events": [...]} 形状的 dict。
    - 不是 dict 或无 events 键或 events 不是 list → MAError(INVALID_EVENT_BATCH, "events must be a list")
    - len == 0 或 > MAX_EVENTS_PER_BATCH → MAError(INVALID_EVENT_BATCH, "events must contain 1-10 items")
    - 任一条用 TypeAdapter(ClientEvent) 校验失败 → MAError(INVALID_EVENT_BATCH, f"events[{i}]: invalid", details={"index": i})
    - 同一批中两条 user.tool_confirmation 的 tool_use_id 相同，或两条 user.custom_tool_result 的 custom_tool_use_id 相同 →
      MAError(DUPLICATE_RESOLUTION, f"events[{j}]: duplicate resolution for {id}", details={"index": j})
    整批原子：任何错误都抛异常，不返回部分结果。"""

def parse_server_event(raw: dict[str, Any]) -> ServerEvent:  # TypeAdapter(ServerEvent).validate_python

def event_to_wire(event: BaseModel) -> dict[str, Any]:
    """model_dump(mode="json", exclude_none=True)。用于 SSE 与历史接口输出。"""

def export_json_schemas() -> dict[str, dict]:
    """返回 {"ClientEvent": ..., "ServerEvent": ..., "AgentManifest": ..., "SessionRecord": ..., "EnvironmentRecord": ...}，
    各值为 TypeAdapter(...).json_schema()。AgentManifest 来自 manifest.py。"""
```

TypeAdapter 在模块级缓存（`_CLIENT_EVENT_ADAPTER = TypeAdapter(ClientEvent)` 等），不在函数内创建。

### 3.3 `agenticx/managed/manifest.py`

**设计原则：** 校验器是**过程式**实现（逐字段检查、收集错误字符串），**不**依赖 pydantic 的错误信息；校验通过后再构造 pydantic 模型作为类型载体。这是为了让 TS 实现可以逐条复刻出完全相同的错误字符串。

**常量：**

```python
MAX_MANIFEST_BYTES = 262144        # 256 KiB，按 json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8") 计
MAX_SYSTEM_BYTES = 65536
TOP_LEVEL_KEYS = ("schema","model","system","tools","mcp_servers","skills","multiagent","runtime","metadata")
SYSTEM_MANAGED_METADATA_KEYS = ("model","description","agentName")
TOOL_TYPES = ("agx_builtin","mcp","custom")
TOOL_POLICIES = ("always_allow","always_ask")
MCP_TRANSPORTS = ("http","sse")
MCP_TRANSPORT_ALIASES = {"streamable-http": "http", "streamable_http": "http"}
SKILL_SOURCES = ("builtin","tenant")
MODEL_RE = re.compile(r"^[^/\s]+/\S+$")
CUSTOM_TOOL_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
DEFAULT_MAX_TOOL_ROUNDS = 40
```

**pydantic 载体模型**（`extra="forbid"`）：`ToolConfig{name:str, policy:ToolPolicy|None=None, enabled:bool=True}`、`BuiltinToolset{type:Literal["agx_builtin"], default_policy:ToolPolicy="always_allow", configs:list[ToolConfig]=[]}`、`McpToolset{type:Literal["mcp"], server:str, default_policy:ToolPolicy="always_allow", configs:list[ToolConfig]=[]}`、`CustomTool{type:Literal["custom"], name:str, description:str, input_schema:dict}`、`McpServer{name:str, url:str, transport:Literal["http","sse"]="http"}`、`SkillRef{source:Literal["builtin","tenant"], id:str, version:str|None=None}`、`RuntimeLimits{max_tool_rounds:int=40, max_session_tokens:int|None=None}`、`AgentManifest{schema_:str=Field(alias="schema"), model:str, system:str="", tools:list[...discriminated...]=[], mcp_servers:list[McpServer]=[], skills:list[SkillRef]=[], multiagent:None=None, runtime:RuntimeLimits=RuntimeLimits(), metadata:dict[str,Any]={}}`，`AgentManifest` 设置 `populate_by_name=True`，导出时用 `by_alias=True`。

**主函数：**

```python
@dataclass
class ManifestResult:
    ok: bool
    errors: list[str]                    # 已排序（sorted()，按 Python 默认字符串序）
    manifest: AgentManifest | None       # ok 时非空
    normalized: dict[str, Any] | None    # ok 时非空，规范化后的 JSON dict
    manifest_hash: str | None            # ok 时非空

def validate_manifest(raw: Any) -> ManifestResult: ...
def normalize_manifest(raw: dict[str, Any]) -> dict[str, Any]: ...   # 前提：已通过校验
def manifest_hash(normalized: dict[str, Any]) -> str: ...
def canonical_json(value: Any) -> str: ...
```

**校验规则与错误字符串（逐字，`<i>` `<j>` 为数组下标，`<k>` 为键名，`<v>` 为原值的 JSON 字符串表示，如 `"foo"` 或 `3`）：**

先做两个短路检查，命中即只返回这一条错误：
1. `raw` 不是 dict → `manifest: must be a JSON object`
2. 序列化字节数 > 262144 → `manifest: exceeds 262144 bytes`

之后**收集全部错误**（不短路），规则如下：

| # | 条件 | 错误字符串 |
|---|------|-----------|
| 1 | 顶层出现 `TOP_LEVEL_KEYS` 之外的键 | `manifest.<k>: unknown field` |
| 2 | `schema` 缺失或不等于 `agx.agent/v1` | `manifest.schema: must be "agx.agent/v1"` |
| 3 | `model` 缺失 | `manifest.model: is required` |
| 4 | `model` 不是字符串或不匹配 `MODEL_RE` | `manifest.model: must be "<providerId>/<modelName>"` |
| 5 | `system` 存在且不是字符串 | `manifest.system: must be a string` |
| 6 | `system` 的 UTF-8 字节数 > 65536 | `manifest.system: exceeds 65536 bytes` |
| 7 | `tools` 存在且不是数组 | `manifest.tools: must be an array` |
| 8 | `tools[i]` 不是对象 | `manifest.tools[<i>]: must be an object` |
| 9 | `tools[i].type` 不在 `TOOL_TYPES` | `manifest.tools[<i>].type: must be one of [agx_builtin,mcp,custom], got <v>`（`type` 缺失时 `<v>` 为 `null`）；该条目其余字段不再检查 |
| 10 | `agx_builtin` 条目出现 `type/default_policy/configs` 之外的键；`mcp` 条目出现 `type/server/default_policy/configs` 之外的键；`custom` 条目出现 `type/name/description/input_schema` 之外的键 | `manifest.tools[<i>].<k>: unknown field` |
| 11 | `default_policy` 存在且不在 `TOOL_POLICIES` | `manifest.tools[<i>].default_policy: must be one of [always_allow,always_ask]` |
| 12 | `configs` 存在且不是数组 | `manifest.tools[<i>].configs: must be an array` |
| 13 | `configs[j]` 不是对象 | `manifest.tools[<i>].configs[<j>]: must be an object` |
| 14 | `configs[j]` 出现 `name/policy/enabled` 之外的键 | `manifest.tools[<i>].configs[<j>].<k>: unknown field` |
| 15 | `configs[j].name` 缺失或不是非空字符串 | `manifest.tools[<i>].configs[<j>].name: is required` |
| 16 | `configs[j].policy` 存在、非 null 且不在 `TOOL_POLICIES` | `manifest.tools[<i>].configs[<j>].policy: must be one of [always_allow,always_ask]` |
| 17 | `configs[j].enabled` 存在且不是布尔 | `manifest.tools[<i>].configs[<j>].enabled: must be a boolean` |
| 18 | 同一 toolset 内 `configs[j].name` 与之前某个 config 重复 | `manifest.tools[<i>].configs[<j>].name: duplicate tool "<name>"` |
| 19 | `mcp` 条目 `server` 缺失或不是非空字符串 | `manifest.tools[<i>].server: is required` |
| 20 | `mcp` 条目 `server` 不在 `mcp_servers[].name` 中（只在 `mcp_servers` 本身是数组时检查） | `manifest.tools[<i>].server: references undeclared mcp server "<server>"` |
| 21 | 两个 `mcp` 条目的 `server` 相同 | `manifest.tools[<i>].server: duplicate toolset for mcp server "<server>"`（报在后出现的那个） |
| 22 | 两个 `agx_builtin` 条目 | `manifest.tools[<i>].type: duplicate agx_builtin toolset`（报在后出现的那个） |
| 23 | `custom` 条目 `name` 不是字符串或不匹配 `CUSTOM_TOOL_NAME_RE` | `manifest.tools[<i>].name: must match ^[A-Za-z][A-Za-z0-9_]{0,63}$` |
| 24 | `custom` 条目 `name` 与之前某个 custom 重复 | `manifest.tools[<i>].name: duplicate custom tool "<name>"` |
| 25 | `custom` 条目 `description` 缺失或不是非空字符串 | `manifest.tools[<i>].description: is required` |
| 26 | `custom` 条目 `input_schema` 不是对象 | `manifest.tools[<i>].input_schema: must be an object` |
| 27 | `mcp_servers` 存在且不是数组 | `manifest.mcp_servers: must be an array` |
| 28 | `mcp_servers[i]` 不是对象 | `manifest.mcp_servers[<i>]: must be an object` |
| 29 | `mcp_servers[i]` 含 `headers` 或 `env` 键 | `manifest.mcp_servers[<i>].<k>: secrets are not allowed in manifest`（`<k>` 为 headers 或 env，分别报） |
| 30 | `mcp_servers[i]` 出现 `name/url/transport/headers/env` 之外的键 | `manifest.mcp_servers[<i>].<k>: unknown field` |
| 31 | `name` 缺失或不是非空字符串 | `manifest.mcp_servers[<i>].name: is required` |
| 32 | `name` 与之前某个重复 | `manifest.mcp_servers[<i>].name: duplicate mcp server "<name>"` |
| 33 | `url` 缺失或不是非空字符串 | `manifest.mcp_servers[<i>].url: is required` |
| 34 | `url` 不以 `https://` 或 `http://` 开头 | `manifest.mcp_servers[<i>].url: must start with http:// or https://` |
| 35 | `transport` 存在，经别名归一后不在 `MCP_TRANSPORTS` | `manifest.mcp_servers[<i>].transport: must be one of [http,sse]` |
| 36 | `skills` 存在且不是数组 | `manifest.skills: must be an array` |
| 37 | `skills[i]` 不是对象 | `manifest.skills[<i>]: must be an object` |
| 38 | `skills[i]` 出现 `source/id/version` 之外的键 | `manifest.skills[<i>].<k>: unknown field` |
| 39 | `source` 不在 `SKILL_SOURCES` | `manifest.skills[<i>].source: must be one of [builtin,tenant]` |
| 40 | `id` 缺失或不是非空字符串 | `manifest.skills[<i>].id: is required` |
| 41 | `version` 存在、非 null 且不是非空字符串 | `manifest.skills[<i>].version: must be a string` |
| 42 | `multiagent` 存在且不是 null | `manifest.multiagent: must be null` |
| 43 | `runtime` 存在且不是对象 | `manifest.runtime: must be an object` |
| 44 | `runtime` 出现 `max_tool_rounds/max_session_tokens` 之外的键 | `manifest.runtime.<k>: unknown field` |
| 45 | `max_tool_rounds` 存在且不是 1–500 的整数（布尔不算整数） | `manifest.runtime.max_tool_rounds: must be an integer between 1 and 500` |
| 46 | `max_session_tokens` 存在、非 null 且不是 ≥1000 的整数 | `manifest.runtime.max_session_tokens: must be null or an integer >= 1000` |
| 47 | `metadata` 存在且不是对象 | `manifest.metadata: must be an object` |

「整数」判定：Python 中 `isinstance(x, int) and not isinstance(x, bool)`；TS 中 `typeof x === "number" && Number.isInteger(x)`。浮点 `3.0` 在 Python 中是 float，不算整数；TS 中 `3.0 === 3` 会算整数——**fixture 中禁止出现 `3.0` 这类值**，避免两端不一致。

**规范化（`normalize_manifest`，在校验通过后执行，返回新 dict，不修改输入）：**
- 补默认值：`system=""`、`tools=[]`、`mcp_servers=[]`、`skills=[]`、`multiagent=None`、`runtime={"max_tool_rounds": 40, "max_session_tokens": None}`（runtime 存在时只补缺失键）、`metadata={}`。
- `agx_builtin` / `mcp` 条目缺 `default_policy` 时补 `"always_allow"`；缺 `configs` 时补 `[]`；每个 config 缺 `enabled` 时补 `True`，缺 `policy` 时补 `None`。
- `mcp_servers[].transport` 缺失补 `"http"`；别名归一。
- `skills[].version` 缺失补 `None`。
- 从 `metadata` 中删除 `SYSTEM_MANAGED_METADATA_KEYS` 里的键（静默，不报错）。

**`canonical_json(value)`**：`json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`。
**`manifest_hash(normalized)`**：`"sha256:" + hashlib.sha256(canonical_json(normalized).encode("utf-8")).hexdigest()`。

### 3.4 `agenticx/managed/__init__.py`

re-export：`PROTOCOL_VERSION`、`MANIFEST_SCHEMA`、`parse_client_events`、`parse_server_event`、`event_to_wire`、`export_json_schemas`、`validate_manifest`、`normalize_manifest`、`manifest_hash`、`canonical_json`、`ManifestResult`、`AgentManifest`、`MAError`。用 `__all__` 列出。

## 4. TS 模块设计：`enterprise/packages/core-api/src/managed-agents.ts`

不新增任何依赖。导出：

1. 与 Python 同名、同值的常量：`PROTOCOL_VERSION`、`MANIFEST_SCHEMA`、`CLIENT_EVENT_TYPES`、`SERVER_EVENT_TYPES`、`PAT_SCOPES`、`MAX_EVENTS_PER_BATCH`、`SSE_PING_INTERVAL_SECONDS`、`WORK_LEASE_TTL_SECONDS`、`WORK_HEARTBEAT_INTERVAL_SECONDS`、`WORK_STOP_GRACE_SECONDS`、`WORK_POLL_MAX_WAIT_SECONDS`、`MAX_MANIFEST_BYTES`、`MAX_SYSTEM_BYTES`，全部 `as const`。
2. 错误码：`export const MA_ERROR_CODES = { invalid_request: 400, ... } as const;`（与 3.1 表一致）与 `export type MAErrorCode = keyof typeof MA_ERROR_CODES;`。
3. 类型：与 3.2 一一对应的 TS 类型（字符串联合类型、内容块、各事件 interface、`ClientEvent` / `ServerEvent` 判别联合、资源记录、`AgentManifest` 等）。字段名保持 snake_case，与 wire 格式一致。
4. 函数：
   - `validateManifest(raw: unknown): ManifestResult`，`ManifestResult = { ok: boolean; errors: string[]; normalized: Record<string, unknown> | null; manifestHash: string | null }`。规则、错误字符串、规范化逻辑与第 3.3 节**逐字一致**；`errors` 用 `[...errors].sort()` 排序（JS 默认按 UTF-16 码元排序，fixture 只用 ASCII 错误串，因此与 Python 一致）。
   - 字节数计算：`new TextEncoder().encode(JSON.stringify(raw)).length`。注意 Python 用 `separators=(",", ":")`，与 `JSON.stringify` 默认无空格一致。
   - `canonicalJson(value: unknown): string`：递归按键名排序（`Object.keys(obj).sort()`），`JSON.stringify` 输出无空格；数组保持顺序；`null` 原样。
   - `manifestHash(normalized)`：用 `node:crypto` 的 `createHash("sha256")`，返回 `"sha256:" + hex`。（core-api 运行在 Node 侧；如需浏览器侧使用后续再加，不在本子规划。）
   - `isClientEventType(t: string): t is ClientEventType`、`isServerEventType(t: string): t is ServerEventType`。
   - `validateClientEventBatch(raw: unknown): { ok: true; events: ClientEvent[] } | { ok: false; code: MAErrorCode; index: number | null }`：规则与 Python `parse_client_events` 相同（批量形状、1–10 条、每条的必填字段与枚举、`allow` 不得带 `deny_message`、重复 resolution）。每条事件校验只做 3.2 中写明的约束：类型字面量、必填字段、`content` 非空（仅 user.message）、内容块类型与 source 类型、`media_type` 枚举、url 必须 `https://`。
5. 在任何对联合类型的 `switch` 中，`default` 分支写 `const _exhaustive: never = x;`（仓库规则 typescript-exhaustive-switch）。

## 5. Fixture

### 5.1 `tests/fixtures/managed_agents/manifest_cases.json`

格式：`{"cases": [{"name": str, "input": any, "ok": bool, "errors": [str], "normalized": object|null}]}`。`errors` 为排序后的期望错误；`ok=true` 时 `errors=[]` 且必须给出完整 `normalized`；`ok=false` 时 `normalized=null`。**不在 fixture 里写 hash**，parity 测试分别在两端计算 hash 后与对方比较（见第 6 节）。

至少包含以下 24 个 case（名称逐字使用）：

| name | 要点 |
|------|------|
| `minimal_ok` | 只有 `schema` 与 `model` |
| `full_ok` | 三类 tools、两个 mcp_servers（一个 transport 为 `streamable-http`）、两个 skills、runtime、metadata 含 `welcome_message` 与 `model`（后者应被剥离） |
| `not_object` | `input` 为 `[]` |
| `unknown_top_level` | 多一个 `foo` 键 |
| `bad_schema` | `schema` 为 `agx.agent/v0` |
| `missing_model` | 无 `model` |
| `bad_model_format` | `model` 为 `gpt-4o` |
| `system_not_string` | `system` 为 `123` |
| `tools_not_array` | `tools` 为 `{}` |
| `tool_bad_type` | 一个 tool `type` 为 `browser` |
| `tool_missing_type` | 一个 tool 无 `type` |
| `bad_policy` | `default_policy` 为 `never` 且某 config `policy` 为 `sometimes` |
| `duplicate_config_name` | 同 toolset 两个 config 同名 |
| `mcp_undeclared_server` | mcp toolset 引用未声明的 server |
| `mcp_duplicate_toolset` | 两个 mcp toolset 同 server |
| `duplicate_builtin` | 两个 agx_builtin |
| `custom_bad_name` | custom name 为 `1abc` |
| `custom_duplicate` | 两个同名 custom |
| `custom_missing_fields` | custom 缺 description 且 input_schema 为字符串 |
| `mcp_server_secrets` | 一个 server 同时带 `headers` 与 `env` |
| `mcp_server_bad_url_and_transport` | url 为 `ftp://x`，transport 为 `grpc` |
| `skills_bad` | source 为 `market`，缺 id，version 为 `1` |
| `multiagent_not_null` | multiagent 为 `{}` |
| `runtime_bad` | max_tool_rounds 为 `0`，max_session_tokens 为 `10`，多一个键 `x` |

另加 `oversize`：用 `system` 为 300000 个 `a` 构造；该 case 由测试代码动态生成而不写进 JSON 文件（避免文件过大）——两端测试各自生成并断言错误恰为 `["manifest: exceeds 262144 bytes"]`。

### 5.2 `tests/fixtures/managed_agents/event_cases.json`

格式：`{"cases": [{"name": str, "input": any, "ok": bool, "code": str|null, "index": int|null}]}`。至少：

| name | 期望 |
|------|------|
| `single_message_ok` | ok |
| `all_four_types_ok` | 四种客户端事件各一条，ok |
| `not_list` | `{"events": {}}` → `invalid_event_batch`，index null |
| `empty` | `{"events": []}` → `invalid_event_batch`，index null |
| `too_many` | 11 条 interrupt → `invalid_event_batch`，index null |
| `unknown_type` | 第 2 条 type 为 `user.foo` → `invalid_event_batch`，index 1 |
| `empty_content` | user.message content 为 `[]` → `invalid_event_batch`，index 0 |
| `allow_with_deny_message` | → `invalid_event_batch`，index 0 |
| `bad_image_url` | image url 为 `http://x` → `invalid_event_batch`，index 0 |
| `duplicate_confirmation` | 两条同 tool_use_id → `duplicate_resolution`，index 1 |
| `duplicate_custom_result` | 两条同 custom_tool_use_id → `duplicate_resolution`，index 1 |

Python 侧：`ok=false` 时捕获 `MAError`，比较 `err.code`（字符串）与 `err.details.get("index")`。

## 6. 测试

### 6.1 Python

- `tests/managed/test_manifest.py`：
  - `test_manifest_cases`：参数化读取 `manifest_cases.json`，断言 `ok` / `errors` / `normalized` 完全相等。
  - `test_oversize`：动态构造，断言错误列表。
  - `test_hash_stable_under_key_order`：同一 manifest 打乱键顺序，hash 相同。
  - `test_hash_changes_on_content`：改 system 一个字符，hash 不同。
  - `test_normalize_does_not_mutate_input`。
  - `test_manifest_model_roundtrip`：`full_ok` 的 `normalized` 可被 `AgentManifest.model_validate` 解析，`model_dump(by_alias=True)` 与 normalized 相等。
- `tests/managed/test_protocol.py`：
  - `test_event_cases`：参数化读取 `event_cases.json`。
  - `test_server_events_roundtrip`：为 14 种服务端事件各构造一个最小合法 dict，`parse_server_event` 后 `event_to_wire` 与输入相等（输入不含 None 字段）。
  - `test_stop_reason_requires_action_needs_event_ids` 与 `test_stop_reason_end_turn_rejects_event_ids`。
  - `test_environment_record_type_mismatch`：`type="cloud"` 配 `desktop_worker` config → ValidationError。
  - `test_export_json_schemas_keys`：五个键都在。
  - `test_error_codes_unique`：`ALL_ERROR_CODES` 中 code 不重复。
  - `test_module_has_no_runtime_imports`：读取 `agenticx/managed/*.py` 源码，断言不含 `agenticx.studio` 与 `agenticx.runtime` 字样。
- `tests/managed/test_fixture_parity.py`：
  - `test_manifest_hashes_match_ts`：读取 `tests/fixtures/managed_agents/expected_hashes.json`（由 TS 测试写出？**不**——避免测试间写文件依赖）。改为：Python 测试为每个 `ok=true` case 计算 hash，并与**硬编码在该测试文件中的常量字典** `EXPECTED_HASHES` 比较；TS 测试中硬编码同一份 `EXPECTED_HASHES`。实施时先跑 Python 得到值，再把同一份字典粘进两边测试。两端都通过即证明 hash 一致。
  - `test_constants_match_ts_source`：用正则读取 `enterprise/packages/core-api/src/managed-agents.ts` 文本，断言 `PROTOCOL_VERSION`、`MANIFEST_SCHEMA` 字面量与 Python 相同，且 `PAT_SCOPES`、`CLIENT_EVENT_TYPES`、`SERVER_EVENT_TYPES` 中每个字符串都出现在 TS 源码里；`MA_ERROR_CODES` 中每个 `code: status` 对都出现。

### 6.2 TS：`enterprise/packages/core-api/src/__tests__/managed-agents.test.ts`

用 vitest。fixture 路径：`path.resolve(__dirname, "../../../../../tests/fixtures/managed_agents/manifest_cases.json")`（从 `enterprise/packages/core-api/src/__tests__/` 回到仓库根）。用例：
- `manifest cases`：遍历断言 `ok` / `errors` / `normalized`（`toEqual`）。
- `oversize`。
- `hash matches python`：硬编码同一份 `EXPECTED_HASHES`。
- `event cases`：遍历断言 `ok` / `code` / `index`。

## 7. 文档

### 7.1 `docs/managed-agents/protocol.md`

面向接入方，中文。章节：概念（Agent / AgentVersion / Environment / Session / Event / WorkItem）、Manifest 字段表与校验规则（直接引用第 3.3 节规则表）、事件类型表、会话状态机（Mermaid stateDiagram，照抄总规划第 6.2 节）、接口清单（照抄总规划第 6.3 节）、续流规则（`seq` + `Last-Event-ID` / `after_seq`）、错误码表、PAT scope 表、版本号 `agx-ma/2026-11`。

### 7.2 `docs/managed-agents/threat-model.md`

五类威胁，每类一个小节，固定四个字段：**资产**、**威胁**、**控制措施**、**负责子规划与验证方式**。
1. 凭证泄露（Manifest 携带明文、工具结果回显、日志与事件落库、沙箱 env 读取）→ 控制：Manifest 拒绝 headers/env（MA-00）、Vault 只写不读（MA-E06）、出站注入与占位值（MA-A06）、`redact_text`（MA-A06）。
2. 跨会话访问（读取其他会话工作目录、订阅其他会话事件流）→ `session_boundary.foreign_session_denial`（MA-A04/MA-E03）、事件 API 按 tenant + session 鉴权（MA-E03）。
3. 跨租户访问（PAT 越权、Worker 领取其他租户 Work）→ PAT scope + tenant 过滤（MA-E02/E03）、Worker 只能领取 `worker_keys` 命中的环境（MA-A05/MA-D01）。
4. 出站滥用（沙箱访问内网、密钥被带到非授权主机）→ `egress_allow_domains`（MA-E03）、`environment_variable` 凭证 `allowed_hosts`（MA-A06）。
5. 经工具结果回流的提示注入（MCP 或网页返回内容诱导调用高危工具）→ 工具权限 `always_ask`（MA-A03）、企业 deny 策略优先（MA-A03）、合规网关响应通道评估（现有）。

## 8. FR / AC

| FR | 内容 | AC |
|----|------|----|
| FR-1 | Python 协议模型与常量 | `pytest tests/managed/test_protocol.py -q` 全绿 |
| FR-2 | Python Manifest 校验 / 规范化 / hash | `pytest tests/managed/test_manifest.py -q` 全绿；24 个 fixture case + oversize 均覆盖 |
| FR-3 | TS 类型与校验器同语义 | `pnpm -C enterprise --filter @agenticx/core-api test` 全绿；`pnpm -C enterprise --filter @agenticx/core-api typecheck` 无错 |
| FR-4 | 双端一致 | `tests/managed/test_fixture_parity.py` 全绿；两端 `EXPECTED_HASHES` 字典逐字相同 |
| FR-5 | 文档 | 两份文档存在，威胁模型五节各含四个字段 |
| NFR-1 | 无副作用 | `git diff --stat` 只出现第 2 节列出的路径 |

## 9. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
pytest tests/managed -q
pnpm -C enterprise --filter @agenticx/core-api test
pnpm -C enterprise --filter @agenticx/core-api typecheck
git status --porcelain -- agenticx tests enterprise/packages/core-api docs/managed-agents
```

## 10. 回滚

全部为新增文件，删除即回滚；`index.ts` 与 `package.json` 各一行改动可直接还原。

## 11. 不变量

- 不修改 `agenticx/` 下任何已存在文件。
- `@agenticx/core-api` 现有导出不变，仅追加。
