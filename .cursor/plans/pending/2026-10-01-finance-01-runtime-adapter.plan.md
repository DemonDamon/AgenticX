# A01 · 通用 MCP 安全与外部研究运行事件适配

Planned-with: Manus
Suggested-Impl-Model: **代码专精中档**（涉及 Python 协议模型、异步传输接线、向后兼容和安全失败路径；不需要前端视觉重构或领域模型推理）
Parent-Plan: [金融垂类研究智能体：双仓 Master Plan（canonical planning branch）](https://github.com/DemonDamon/FinnewsHunter/blob/docs/finance-agent-master-plan-20261001/.cursor/plans/pending/2026-10-01-finance-agent-master.plan.md)；合并后的固定位置：[main pending](https://github.com/DemonDamon/FinnewsHunter/blob/main/.cursor/plans/pending/2026-10-01-finance-agent-master.plan.md)
Plan-Id: 2026-10-01-finance-01-runtime-adapter
Plan-Type: 子计划 A01（pending；仅规划，未实施）
预计边界: **7–10 个工作日，最多两周**

> 本计划只补齐 AgenticX 的通用安全与事件适配原语。它**不**创建金融领域模型、ResearchRun 数据表、领域 MCP server、金融业务 API、业务事件持久化或 Near 工作台 UI。FinnewsHunter 仍是 C0 所定义的 Evidence/Claim/ResearchRun/RunEvent 权威；A02/A03 才消费本计划交付的泛化接口。

## 1. 目标与完成定义

在不另起远程 MCP 客户端、不过度改写 Core Runtime 的前提下，交付三个可组合的通用能力：

1. **安全的远程主体绑定**：受保护远程 MCP 只能通过 HTTPS、经验证的非空主体上下文和不落盘的凭据解析器建连；本机 Desktop 管理 token 绝不作为上游服务 bearer token 透传。
2. **结构化 MCP 结果与 provenance 保真**：保留 MCP SDK 的 `structuredContent` 与不可泄漏的来源元数据，让异步 ReAct 的 `ToolResultEvent`、工具消息 `metadata` 和后续适配器能够判断结果来自哪个 server/tool/transport，而不改变现有模型可读文本的默认行为。
3. **只读外部 run 事件适配器**：把调用方提供的异步事件流转换成通用 `RuntimeEvent`，对 event id 去重、单 run 序号单调性和含时区时间戳执行 fail-closed 校验；适配器不发起任意 URL 请求、不写业务状态、不伪造完成事件，也不承担断线回放持久化。

完成后，A02 可把已认证主体、受保护端点和密钥引用解析器注入现有 MCP 连接路径；A03 可消费统一的外部事件与 MCP provenance。A01 自身不要求任何金融服务已上线，因此可与 F01 并行。

## 2. 冻结契约、依赖与边界

### 2.1 必须遵守的 C0 约束

- C0 §1 的 MCP v1 只允许领域服务暴露 `finnews.search_articles`、`finnews.get_evidence`、`finnews.get_market_snapshot`、`finnews.start_research`、`finnews.get_run`；本计划**不**在 AgenticX 复制、过滤或新增这些工具定义。
- C0 §1「身份/权限」要求 HTTP 与 MCP 使用同一 principal、远程仅受保护 HTTPS + 机密存储、未认证/无权/失联 fail closed。本计划提供通用绑定与解析接口；实际领域 scope（例如 `research:create`）仍由领域服务授权，不能写入 AgenticX Core。
- C0 §1 的 `RunEventV1` 字段、事件枚举、`Last-Event-ID` 回放语义及严格递增 `seq` 由 FinnewsHunter 定义。本计划只验证调用方给出的**通用**事件信封，不能在 AgenticX 再定义金融事件类型或业务状态机。
- C0 §3/§4：A01 只依赖 C0，可与 F01 并行；A02、F03 依赖 A01。实现开始前先把本文件从 `pending/` 移到 `.cursor/plans/` 根目录。

### 2.2 In scope

- 在 `remote_v2.py` 导出唯一的 `ProtectedRemoteMcpFacade`：它以 `MCPServerConfig(remote_security=...)`、已认证 `PrincipalContext` 和 `CredentialResolver` 三者为唯一 protected 输入；历史 stdio/URL MCP 仍走 legacy 路径。protected 配置中 `headers` 字段必须缺席，不能以空字典、环境替换或后续赋值承载任何静态 header。
- 无秘钥字段的 `PrincipalContext`、凭据解析 Protocol、连接时主体绑定，以及确认状态中仅可持久化的主体摘要。
- 在**现有** `MCPHub`、`RemoteToolV2` 与 `ReActAgent` 之间传递有界 structured result sidecar 和来源元数据。
- 新建不联网的只读 `ExternalRunEventAdapter`，以注入的 `AsyncIterator[Mapping[str, Any]]` 为输入，输出现有 `RuntimeEvent`。
- 为配置验证、连接 fail-closed、provenance、ReAct 事件、外部事件去重/乱序分别建立单测。

### 2.3 Out of scope / 明确禁止

- 不修改 FinnewsHunter 的模型、迁移、认证实现、REST/MCP endpoint、RunEvent 持久化、SSE replay log、证据许可或行情/公告口径。
- 不新增第二个 MCP client、HTTP 抓取器、任意 URL/SSE proxy、浏览器直连、交易工具或付费工具；外部事件 adapter 只接收调用方已经建立的事件迭代器。
- 不把 `RunEventV1` 的金融事件字符串、`ResearchRunV1`、`EvidenceV1`、`ClaimV1`、`research:create` 或任何金融字段写入 `agenticx/` 通用模型。
- 不把 bearer token、refresh token、cookie、Desktop token、原始 Authorization header 或任意 static header 写进 protected `MCPServerConfig`、`mcp.json`、确认 checkpoint、日志、provenance、`ToolResultEvent` 或 SSE。`headers` 仅保留给明确未启用 `remote_security.mode="protected"` 的历史 legacy 配置。
- 不接管 Studio 的会话内存缓冲、跨进程协调总线或领域业务 run 数据库；不能将 `SessionEventHub` 的 ring buffer 宣称为业务事件账本。
- 不改 Desktop/`desktop/`、不改 Near Finance UI、不开新 REST 路由、不改 `agenticx/studio/server.py` 的 import 区或任意 `/api/mcp/*` handler。

## 3. 基线、根因与证据

| 观察 | 代码证据 | 根因 / 对 A01 的影响 |
|---|---|---|
| 远程 MCP URL 可直接配任意 `headers`，transport 建连时原样传给 SDK | `agenticx/tools/remote_v2.py` L88–154 定义 `url`/`headers`；L295–311 将 `dict(headers)` 传给 streamable HTTP/SSE | 没有受保护端点、主体绑定、凭据引用或静态敏感 header 防线；若未来直接复用 Desktop token，容易越权或泄漏。|
| MCP 配置序列化仍会将 remote `headers` 写回 JSON | `agenticx/cli/studio_mcp.py::_serialize_server_config`，L459–487，尤其 L475–481 | 已有远程配置机制必须兼容，但受保护模式不能继续把实际认证值放进 `mcp.json`。|
| Studio 的 `/api/mcp/connect` 使用 `X-AGX-Desktop-Token` 做**本机管理**校验，随后调用不带上游主体的 `mcp_connect_async` | `agenticx/studio/server.py` L5173–5248；`agenticx/cli/studio_mcp.py::mcp_connect_async` L689–724 | 本机管理认证与远程服务 principal 不是同一概念。A01 应提供下游可注入的参数，而不是错误地复用该 header 或在 server route 中拼接领域认证。|
| RemoteToolV2 与 MCPHub 都优先返回首个 text/blob；structured content 没有 sidecar/provenance | `remote_v2.py::RemoteToolV2._arun` L700–735；`mcp_hub.py::MCPHub.extract_tool_result` L266–290 | 结构化上游结果可能被转为裸字符串，来源（server、transport、原始工具名）也丢失，无法支持可审计的下游展示。|
| async ReAct 把任意工具结果立即字符串化，`ToolResultEvent` 没有 metadata 字段 | `react_agent_async.py::_execute_one_tool` L195–232、`_append_tool_outcome` L380–416；`agent_events.py::ToolResultEvent` L52–61 | 即使 hub 层保留 sidecar，也没有稳定位置传给事件消费者。|
| 通用 Runtime 已有 `RuntimeEvent` 与 SSE 序列化，Studio session hub 只有进程内 ring buffer | `runtime/events.py::RuntimeEvent` L58–89；`studio/server.py::_runtime_event_to_sse_lines` L343–366；`studio/session_event_hub.py::SessionEventHub` L34–107 | 可复用现有事件壳，但不存在只读外部 run event adapter；也不能误用 session ring buffer 代替领域持久化 replay。|
| 现有 references 仅解析 `web_search` / `knowledge_search` | `agenticx/studio/references.py::structured_payload_for_tool_result` L160–199 | 不应借用它去硬编码金融证据或领域 schema；MCP provenance 必须是独立、通用的 sidecar。|
| 确认 gate 已保存任意 `context` 到 pending state，但没有主体类型或敏感字段投影 | `runtime/confirm.py::AsyncConfirmGate.request_confirm/export_state` L204–264 | 需要一个不带认证材料的 principal 表达，并在确认持久化边界消除常见 secret 键。|

## 4. 文件清单与精确落点

### 4.1 计划新增 / 修改

| 操作 | 文件 | 精确落点 / 目的 |
|---|---|---|
| 修改 | `agenticx/runtime/confirm.py` | 在 `CONFIRM_RISK_LOW` 常量区之后（约 L18）新增 `PrincipalContext`、`CredentialResolver` Protocol、`principal_public_context()` 与确认状态净化函数；在 `AsyncConfirmGate.request_confirm()`（L204）及 `RiskAwareAutoConfirmGate.request_confirm()`（L326）只保存净化后的 context。|
| 修改 | `agenticx/tools/remote_v2.py` | `MCPServerConfig`（L88）新增显式 `remote_security` 配置模型，并导出唯一 `ProtectedRemoteMcpFacade`；facade 强制 `credential_ref` + `PrincipalContext` + `CredentialResolver`，protected 配置拒绝 `headers` 键。`MCPClientV2` 仅由 facade 取得一次性 resolver headers；`_create_session()`（L239）在 transport 前验证；`RemoteToolV2._arun()`（L700）返回兼容 `str` 的 result carrier。|
| 修改 | `agenticx/cli/mcp_schema.json` | `$defs.serverConfig.properties`（L31–78）为 `remote_security` 添加 schema：当 mode 为 protected 时，`credential_ref` 必填且 `headers` 属性整体禁止（包括 `{}`）；legacy 才保留 root-map / `mcpServers` 的历史 headers 兼容。|
| 修改 | `agenticx/cli/studio_mcp.py` | `_serialize_server_config()`（L459）序列化**引用**和 security mode 而非解析值；`mcp_connect_async()`（L689）/自动连接辅助函数增加可选 principal 与 resolver 参数，并保持旧调用签名有效。|
| 修改 | `agenticx/tools/mcp_hub.py` | `_ToolRoute`（L42）补足来源描述；`MCPHubTool._arun()`（L81）与 `extract_tool_result()`（L266）生成 provenance-aware carrier，保留原始 text/blob 返回优先级和错误语义。|
| 修改 | `agenticx/agents/agent_events.py` | `ToolResultEvent`（L52）增加默认空的 `metadata: Dict[str, Any]`，使现有构造者零改动。|
| 修改 | `agenticx/agents/react_agent_async.py` | `_execute_one_tool()`（L195）改为内部 outcome（模型文本 + event metadata）；`_append_tool_outcome()`（L380）将安全的 metadata 同时写入工具消息及 `ToolResultEvent`，不把 sidecar混进模型文本。|
| 修改 | `agenticx/runtime/events.py` | `EventType`（L29）新增通用 `EXTERNAL_RUN_EVENT = "external_run_event"`，保留既有工具 SSE `id` 归一化行为不变。|
| 新建 | `agenticx/runtime/external_run_events.py` | 定义只读的 `ExternalRunEvent`, `ExternalRunEventAdapter`, `ExternalRunEventValidationError` 和有界 payload 校验；只接受注入的异步输入，输出 `RuntimeEvent`。|
| 修改 | `agenticx/runtime/__init__.py` | 在既有 confirm/runtime export 区（L3–20、L65–94）显式导出新的通用主体、凭据 Protocol、外部事件 adapter/types，避免消费者导入私有模块。|
| 新建 | `tests/test_mcp_remote_security.py` | 受保护 URL、主体、resolver、无敏感落盘与旧 remote 配置兼容测试。|
| 修改 | `tests/test_mcp_hub_extract_errors.py` | 在现有多 block error 回归外，断言成功 MCP 结果包含正确的非敏感 provenance。|
| 新建 | `tests/test_react_async_provenance.py` | 用返回 result carrier 的 fake `BaseTool` 验证 ReAct 的工具消息和 `ToolResultEvent` 同时带 metadata，LLM 可读文本不变。|
| 新建 | `tests/test_runtime_principal_context.py` | principal 的非空/无 secret 表达和确认 checkpoint 脱敏回归。|
| 新建 | `tests/test_external_run_events.py` | 外部事件合法转换、去重、乱序/无时区/越界 payload fail-closed 测试。|
| 修改 | `tests/test_mcp_schema.py` | 新 remote_security schema 的合法/非法组合及历史 `headers` URL MCP 的兼容性测试。|

### 4.2 本计划明确不触碰

| 文件/区域 | 不触碰原因 |
|---|---|
| `agenticx/studio/server.py`，尤其 import 区与 `/api/mcp/*` routes | 这些是本机 Studio 管理 API，不是远程金融服务网关；改动会扩大到 A02 并触发该文件的强制冷启动验证。A01 的 `RuntimeEvent` 已可被现有 `_runtime_event_to_sse_lines()` 透明序列化。|
| `agenticx/studio/session_event_hub.py` | 它是内存 replay buffer，不可作为 C0 `RunEventV1` 的权威账本或断线回放实现。|
| `agenticx/studio/references.py`、`agenticx/runtime/agent_runtime.py` | 现有 references 只处理 Web/KB；本计划的 metadata 先覆盖 canonical async ReAct。将金融证据映射进 Studio 或通用 AgentRuntime 属于 A02/A03 的消费者工作。|
| `agenticx/tools/credentials.py` | 复用其或平台机密存储由后续集成提供 resolver；本计划不新建、迁移或写入任何秘密。|
| `desktop/`、FinnewsHunter 任意文件、数据库/迁移、领域 API/MCP fixtures | 分别属于 A02/A03 与 F01/F02/F03 的所有权，避免跨仓/跨节点写同一工作树。|

## 5. 功能需求（FR）与实施意图

### FR-1：无秘密的主体上下文与确认状态投影

**落点：** `agenticx/runtime/confirm.py`，锚点 `PROTECTED_CONFIRM_RISKS`、`AsyncConfirmGate.request_confirm()`、`RiskAwareAutoConfirmGate.request_confirm()`。

**Before：** 确认 gate 接收任意 `Dict[str, Any]`，将其复制到 `_pending_meta`、`last_request` 和 `export_state()`；没有类型区分本机 UI token、外部服务主体或普通展示数据。

**After：** 新增不可变 `PrincipalContext`，最小字段为 `principal_id`、`authenticated`、`scopes`；禁止设计 `token`、`authorization`、`cookie`、`secret` 或 raw header 字段。提供：

```text
principal = PrincipalContext(principal_id, authenticated=True, scopes=frozenset(...))
principal.require_authenticated()              # 未认证抛出可分类错误
public = principal_public_context(principal)   # 只含 id / auth 状态 / scope 摘要
safe_context = sanitize_confirm_context(context)
# 递归删除 authorization/access_token/refresh_token/cookie/set-cookie 等键；
# request_id、risk、tool、public principal 摘要保持不变。
```

`AsyncConfirmGate` 和 `RiskAwareAutoConfirmGate` 必须先净化后才保存或导出 context。**不得**让缺失 principal 自动等价为已认证，也不得把领域 scope 写成 Core 常量；scope 判断由调用方传入通用字符串。

**验收：**

- `tests/test_runtime_principal_context.py::test_principal_context_requires_nonempty_authenticated_id`：空 id 或 `authenticated=False` 不能通过 `require_authenticated()`。
- `...::test_confirm_state_redacts_auth_material_but_keeps_public_principal`：传入嵌套 `authorization`/`refresh_token`/`cookie` 后，`last_request`、`export_state()["pending"]` 的 JSON 中均无原值；`request_id`、`risk`、`principal_id` 仍可见。
- `...::test_risk_aware_gate_uses_sanitized_context_for_delegate`：protected action 仍请求 delegate，且 delegate 只收到安全摘要；不得因脱敏改变 `risk` 的 fail-closed 判定。

### FR-2：`ProtectedRemoteMcpFacade` 的 HTTPS、主体绑定、凭据引用与无 static-header 配置

**落点：** `agenticx/tools/remote_v2.py::MCPServerConfig/_validate_transport/MCPClientV2.__init__/_create_session`，`agenticx/cli/mcp_schema.json::$defs.serverConfig`，`agenticx/cli/studio_mcp.py::_serialize_server_config/mcp_connect_async`。

**Before：** 远程 URL 可为任意 scheme，`headers` 可包含 bearer token 并被序列化；`MCPClientV2` 无调用方主体与凭据解析边界。

**After：** 增加可选 `remote_security` 配置，而非替代历史配置：

```text
remote_security = {
  mode: "legacy" | "protected",          # 默认 legacy，保持历史 stdio/URL MCP 行为
  credential_ref: "opaque-reference"      # protected 必填；不是 token，不能含 Bearer 值
}

if mode == "protected":
    require transport in {streamable_http, sse}
    require url.scheme == "https" and no URL userinfo/query/fragment
    require `headers` property is absent from MCPServerConfig input
        # `{}`、任何 static header、环境值或后续 config mutation 都拒绝；不能以空值规避 schema
    require PrincipalContext.authenticated and principal_id
    require injected CredentialResolver(credential_ref, principal)
    transient_headers = resolver_result    # 只由 facade 交给本次 SDK session；绝不配置化/日志化/序列化
else:
    preserve current transport inference and existing headers behavior
```

`ProtectedRemoteMcpFacade` 在**打开 SDK transport 之前**执行 protected preflight，并将成功主体绑定在 client 生命周期内；它是创建 protected `MCPClientV2` 的唯一入口，同一持久化 client 不得被不同 `principal_id` 重绑定。出现 `headers` 属性、resolver 缺失、返回非字符串 header、空 credential、TLS/建连失败或主体未认证时均抛出明确的 `ToolError`，不降级到 `legacy`、不重试成匿名连接。日志只可记录 server name、transport、endpoint origin（`scheme://host[:port]`）和异常类型，不能记录 URL query、headers 或 resolver 结果。

`mcp_connect_async()` / `auto_connect_servers_async()` 必须经 `ProtectedRemoteMcpFacade` 处理 protected 配置，并增加 keyword-only 的可选 `principal_context` 与 `credential_resolver`；默认值保持 legacy 旧调用兼容。新 protected config 经过没有主体、resolver 或 façade调用的旧 Studio route 时必须受控失败；A02 只能调用本 façade，不能补写 headers 或绕开其 preflight。

**验收：**

- `tests/test_mcp_remote_security.py::test_protected_remote_config_rejects_http_query_any_headers_property_and_missing_credential_ref`：`http://`、query/userinfo URL、任何 `headers` 属性（含 `{}` 或 sentinel 值）、无 `credential_ref` 分别在 schema/model/preflight 阶段失败。
- `...::test_protected_client_requires_authenticated_bound_principal_and_resolver_before_transport`：未认证主体/缺 resolver 抛 `ToolError`，并断言替身 `streamablehttp_client` 从未被调用。
- `...::test_protected_client_uses_resolver_headers_without_exposing_them`：resolver 收到同一个 `principal_id` 与 ref；构造的 SDK headers 可用，但 client/config/provenance/log-capture 中不出现 sentinel secret。
- `...::test_legacy_remote_http_fixture_remains_supported` 与既有 `tests/test_mcp_remote_streamable_http.py::test_streamable_http_discover_and_call`：未声明 protected 的本地 mock 仍可发现、调用、复用 session。
- `tests/test_mcp_schema.py`：protected 合法 JSON（无 `headers` key）通过；含 `headers` key 的 protected 组合均不通过；原有 root URL + `headers` 的 legacy fixture 保持通过。

### FR-3：MCP 结构化结果与非敏感 provenance carrier

**落点：** `agenticx/tools/remote_v2.py::RemoteToolV2._arun`，`agenticx/tools/mcp_hub.py::_ToolRoute/MCPHubTool._arun/MCPHub.extract_tool_result`。

**Before：** 两个路径取第一个 text/blob 后就返回，既不保留 `structuredContent`，也不知道 `routed_name` 对应哪个 remote server/transport。

**After：** 在已有模块内新增一个**兼容 `str` 的** `MCPToolResult` carrier（或等价的 str-compatible object），保证所有既有 `str(result)`、JSON 工具上下文和 `mcp_call_tool_async()` 行为不变；旁路保留：

```text
model_text: 保持当前优先级（第一个 text -> blob -> structuredContent -> None）
metadata = {
  "provenance": {
    "kind": "mcp",
    "server_name": configured name,
    "transport": "stdio" | "streamable_http" | "sse",
    "endpoint_origin": only scheme://host[:port] for remote, else "",
    "original_tool_name": upstream name,
    "routed_tool_name": hub name,
    "principal_bound": bool
  },
  "structured_content": JSON-compatible MCP structuredContent or null
}
```

规则：不得重排/改写上游 `structuredContent` 的业务字段，不从中解析金融字段，不在 metadata 写 headers、credential ref、principal id、URL path/query、args 或异常堆栈；对无法 JSON 序列化或超过明确字节上限的 sidecar，保留模型文本、标记 `structured_content_omitted=true` 和长度/原因，不能静默伪装完整结果。`isError` 继续抛 `ToolError`，沿用当前多 text block 拼接行为。

**验收：**

- 扩展 `tests/test_mcp_hub_extract_errors.py::test_extract_tool_result_joins_multiple_error_text_blocks`，原断言仍通过。
- 新增 `...::test_extract_success_result_preserves_text_structured_sidecar_and_redacted_provenance`：fake result 同时含 text 和 `structuredContent`；`str(result)` 等于原 text，metadata 有 server/original/routed name 与 structured mapping，不含 sentinel header/ref/principal 值。
- `tests/test_mcp_remote_security.py::test_provenance_origin_strips_path_query_and_credentials`：`https://host:443/path?token=...`（legacy only）产生的 origin 至多为 `https://host:443`，绝无 path/query/token。
- 回归命令必须覆盖 `tests/test_mcp_hub_extract_errors.py` 与 `tests/test_studio_mcp_call_async.py`，确保 fake client / hub 的返回仍可字符串化。

### FR-4：异步 ReAct 把 provenance 传给事件消费者而不污染模型上下文

**落点：** `agenticx/agents/agent_events.py::ToolResultEvent`，`agenticx/agents/react_agent_async.py::_execute_one_tool/_append_tool_outcome`。

**Before：** `_execute_one_tool()` 调 `str`/JSON 后返回单一 `body`；`_append_tool_outcome()` 只有可选 metadata 写进 message，返回的 typed event 没有 metadata，调用循环也不传递它。

**After：** `_execute_one_tool()` 产生仅在本模块使用的 outcome：

```text
outcome = { model_content: str, success_hint: bool, metadata: safe_mcp_metadata | {} }
messages.append({role:"tool", tool_call_id, content: outcome.model_content,
                 metadata: outcome.metadata if nonempty})
yield ToolResultEvent(..., content=outcome.model_content,
                      success=..., metadata=outcome.metadata)
```

普通 `BaseTool`、异常、offload placeholder 和 replay 恢复继续走原有文本/ledger 逻辑；只有识别到 FR-3 carrier 时才附 metadata。不得将 `structured_content` 拼进 `content`、改变 `stable_call_id`/ledger canonical key、将 metadata 写入 `CallLedger.record_result()`，也不得修改 `AgentRuntime` 的金融业务处理。

**验收：**

- `tests/test_react_async_provenance.py::test_mcp_result_metadata_reaches_tool_message_and_typed_event`：一个 fake tool 返回 carrier；`ToolResultEvent.metadata["provenance"]`、最终 `messages` 的 tool row metadata 一致；`content` 仅为原模型文本。
- `...::test_plain_tool_and_tool_error_keep_existing_metadata_free_behavior`：普通字符串与抛错工具仍生成既有 `ERROR:`/success 判定，不凭空出现 provenance。
- `...::test_structured_sidecar_is_not_serialized_into_model_content_or_ledger`：sidecar sentinel 不在下一轮传给 LLM 的 tool `content`，也不在 ledger recorded text；事件 metadata 中存在有界 sidecar。

### FR-5：只读、无领域耦合的外部 run 事件适配器

**落点：** 新建 `agenticx/runtime/external_run_events.py`；`agenticx/runtime/events.py::EventType`；`agenticx/runtime/__init__.py`。

**Before：** Runtime 可以生成/透传本地 `RuntimeEvent`，Studio 可以序列化它们，但没有一个可复用的、显式只读的外部事件流校验与去重层。`SessionEventHub` 仅将本机 session event 放进内存缓冲。

**After：** 建立注入式 adapter，不提供 URL、HTTP client 或持久层：

```text
adapter = ExternalRunEventAdapter(
    source_id="configured-external-service",
    principal=validated PrincipalContext,
    run_id=expected_run_id,
    allowed_event_types=caller_supplied_or_none,
)

async for raw in pre_authenticated_async_iterator:
    event = validate(raw)  # event_id, run_id, seq>0, type, occurred_at(ISO-8601+offset), payload mapping
    if event_id already seen for (source_id, run_id):
        continue                         # replay duplicate
    if event.run_id != expected_run_id or event.seq <= last_seq:
        raise ExternalRunEventValidationError  # fail closed; no synthetic terminal frame
    yield RuntimeEvent("external_run_event", {
       "source_id": source_id,
       "event": event.public_dict(),
       "provenance": {"kind": "external_run", "principal_bound": true},
    })
```

`payload` 必须为 JSON-compatible mapping，递归深度和 UTF-8 serialized byte count 有明确上限；非法时间（缺 offset）、空 id/run id/type、非正序号、重复 id 但内容冲突、乱序新 event、过大/不可序列化 payload 均 fail closed。`allowed_event_types` 是调用方注入的通用字符串集合；Core 不内置任何金融类型。adapter 只保留进程内 dedupe/last-seq 状态并可暴露最后接受的 `event_id` 作为**调用方**的 resume cursor；不得自己发 `Last-Event-ID` 请求、写数据库、发送 ACK、创建/取消/完成远程 run。

现有 Studio SSE `_runtime_event_to_sse_lines()` 已会序列化未知于 UI 的 `RuntimeEvent.type`，因此 A01 不改 `server.py`。A02 负责把经 HTTPS、同一 principal 认证的实际流作为 iterator 注入；FinnewsHunter 继续负责权威 SSE 及可回放事件账本。

**验收：**

- `tests/test_external_run_events.py::test_adapter_emits_read_only_external_runtime_event_with_preserved_envelope`：输入通用事件信封后得到 `EventType.EXTERNAL_RUN_EVENT.value`，保留 event_id/run_id/seq/type/occurred_at/payload，且 provenance 无 principal id 或 token。
- `...::test_adapter_deduplicates_identical_event_id_and_exposes_last_accepted_cursor`：同一 `(source, run, event_id)` 重放仅 yield 一次，cursor 等于最后被接受 id。
- `...::test_adapter_rejects_conflicting_duplicate_out_of_order_wrong_run_and_naive_timestamp`：四种输入各自抛 `ExternalRunEventValidationError`，不 yield `completed` 或其他补偿事件。
- `...::test_adapter_rejects_oversized_or_non_mapping_payload_and_unauthenticated_principal`：边界失败发生在消费者看到事件之前。
- `...::test_allowed_types_is_caller_supplied_not_finance_hardcoded`：允许一个测试自定义 type；未在 `allowed_event_types` 的 type 失败，验证 Core 没有金融枚举依赖。

## 6. 执行顺序（TDD）

1. **先加失败测试**：FR-1 → FR-2 配置/preflight → FR-3 carrier → FR-4 ReAct → FR-5 adapter。每一步先只运行目标测试确认其在新接口缺失时失败。
2. 实现 FR-1 与 FR-2。先完成 protected preflight 与 legacy 不回归，再接 resolver；禁止先改 Studio route 规避主体校验。
3. 实现 FR-3。只在既有 remote_v2 / MCPHub 链路加 carrier，不复制工具发现、连接重试或 SDK session 管理。
4. 实现 FR-4。确认 typed event 与消息 metadata 均来自同一安全投影，随后跑现有 async MCP 测试。
5. 实现 FR-5。adapter 必须无网络副作用；用纯 async generator 单测序列、去重和失败路径。
6. 最后更新 public exports、schema 序列化，跑全量指定回归。实现中若主分支锚点迁移，以本文函数/代码锚点重新定位，不扩大范围。

## 7. 可执行验收与命令

在 AgenticX 仓根目录执行。所有命令均为**实施完成后的**验收命令；本计划当前不声称其已经通过。

```bash
# 1) 主体与受保护 remote MCP；同时回归真实 streamable HTTP fixture
python -m pytest \
  tests/test_runtime_principal_context.py \
  tests/test_mcp_remote_security.py \
  tests/test_mcp_remote_streamable_http.py \
  tests/test_mcp_schema.py -q

# 2) Hub、Studio async 调用的字符串兼容性与 ReAct metadata
python -m pytest \
  tests/test_mcp_hub_extract_errors.py \
  tests/test_studio_mcp_call_async.py \
  tests/test_react_async_provenance.py -q

# 3) 外部事件 adapter 仅用内存 async generator 验收，无真实服务/网络依赖
python -m pytest tests/test_external_run_events.py -q

# 4) 合并前的聚焦回归
python -m pytest \
  tests/test_mcp_remote_sse.py \
  tests/test_mcp_remote_streamable_http.py \
  tests/test_mcp_hub_extract_errors.py \
  tests/test_studio_mcp_call_async.py \
  tests/test_mcp_schema.py \
  tests/test_runtime_principal_context.py \
  tests/test_react_async_provenance.py \
  tests/test_external_run_events.py -q
```

额外人工检查（不含联网或 git 操作）：

- `rg -n -i 'authorization|access_token|refresh_token|cookie'` 覆盖新增测试 fixture 与 adapter/provenance 序列化输出，确认 sentinel secret 只允许出现在测试输入，不出现在断言的公开 metadata、日志或配置序列化结果。
- 审查 diff：`agenticx/studio/server.py`、`agenticx/studio/session_event_hub.py`、`desktop/`、FinnewsHunter 文件必须不在变更列表；没有金融 event/type/model 字符串进入通用模块。
- 验证 protected 模式的任何失败都发生在 transport 建立前，且不会回退到 `legacy`、匿名或静态 header。

## 8. 失败处理、停止条件与回滚

| 失败/风险 | 必须行为 | 回滚 / 处置 |
|---|---|---|
| 受保护 URL 非 HTTPS、主体未认证、resolver 缺失/失败、TLS/远程连接失败 | 在 SDK transport 前或当次调用处抛可分类错误；**不**匿名重试、**不**降级 legacy、**不**借用 Desktop token。 | 配置/credential integration 修正前保持工具不可用；若需撤销实现，仅回退 A01 自己的原子提交，历史 legacy config 保持原行为。|
| 新 carrier 影响普通工具/模型文本或 ledger | carrier 必须是 str-compatible，且 metadata 是 sidecar；发现破坏即停止合并。 | 删除 carrier 的注入点并恢复原文本优先级，不触碰 MCP transport/session 逻辑。|
| 上游结构化内容过大或不可序列化 | 结果文本仍按既有路径返回；event metadata 标记 omitted/原因，不能伪称完整。 | 调整明确的通用上限需新评审；不可改为无界 SSE/日志写入。|
| 外部事件重复、乱序、时间缺少 offset、payload 非法 | 重复同一 event id 才安全跳过；其它冲突一律 fail closed，不生成 completed/failed 补偿业务事件。 | 由领域服务/消费者使用权威 `Last-Event-ID` replay 重新建立流；adapter 不持久化或修复业务状态。|
| C0 改动、主体无法端到端传递、事实/证据无法回指 | 停止 A01 后续集成，先修订 C0 与跨仓契约 fixtures。 | 不自行放宽 schema、HTTPS、principal 或事件顺序要求。|

本计划为增量接口：`remote_security.mode` 默认 `legacy`，不需要迁移已有 stdio/remote 配置；只有调用方显式选择 `protected` 才启用严格 fail-closed。回滚不删除外部领域的任何 run/event，因为 A01 从不拥有它们。

## 9. 依赖、交接与后续 PR

### 前置与交接

- **前置：** C0 两仓规划 PR 已审阅，尤其 C0 的 principal、MCP v1 和 RunEventV1 语义冻结；A01 可与 F01 并行。
- **A02 的输入：** 唯一的 `ProtectedRemoteMcpFacade`、`PrincipalContext`、`CredentialResolver`、`remote_security.mode="protected"`、绑定 client 参数、`ExternalRunEventAdapter`。A02 必须使用 façade 和来自机密存储的 resolver；protected `MCPServerConfig` 不得含 `headers`，更不得把本机管理 header 传给 resolver。
- **F02/F03/A03 的输入：** 仅把 C0 fixtures 或领域服务流交给 adapter；事件类型 allowlist、领域 payload 解释、许可展示、run 持久化和 UI 所有权仍分别留在其计划中。
- **不阻塞项：** A01 不等待 F01 的数据库或 F02 的实际 server；其测试使用 fake resolver、mock MCP 与纯内存 async generator。

### 未来独立实施分支 / PR

- **实施分支：** 从 AgenticX 最新 `main` 新建 `feat/finance-a01-runtime-adapter`。
- **PR 目标：** AgenticX `main`；一个节点一个 PR，仅包含本计划列出的通用文件和测试，不能在 FinnewsHunter 父仓提交嵌套 `AgenticX/` checkout。
- **PR 必附：** 本文 §7 四组命令结果、C0 contract version/链接、A02/F02 消费依赖说明、确认没有静态 secret/金融模型/业务持久化的 diff 审查结论。
- **合并门槛：** C0 规划 PR 已批准；A01 安全、schema、MCP legacy 回归、ReAct provenance、外部事件乱序/去重测试全绿；安全审查确认受保护路径没有 fallback。合并 A01 后，A02 才可把真实受保护连接与 fixture 流接入。
- **本轮限制：** 当前交付只创建本 `pending` 计划文档；不实施代码、不运行实现测试、不执行 git add/commit/push/PR。规划 PR 的分支、提交 trailer、作者与 `Impl-Model` 以用户确认和 `AGENTS.md` 为准，禁止编造模型名称或完成状态。
