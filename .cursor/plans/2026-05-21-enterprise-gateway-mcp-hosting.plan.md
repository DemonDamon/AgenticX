---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise Gateway：MCP Server 托管 + OpenAPI → MCP 转换

- **Plan-Id**: 2026-05-21-enterprise-gateway-mcp-hosting
- **Plan-File**: `.cursor/plans/2026-05-21-enterprise-gateway-mcp-hosting.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-21
- **关联背景**:
  - 调研对象：[higress-group/higress](https://github.com/higress-group/higress)（CNCF Sandbox，AI Native Gateway，MCP 托管为其核心差异化能力）
  - 对照体验入口：<https://mcp.higress.ai/>（Higress 托管的 Remote MCP Server 平台）
  - 与本仓 Machi Desktop 的 MCP 客户端能力强协同：`agenticx/mcp_*`、`desktop/electron/main.ts` 的 MCP 状态轮询
  - 关联 plan（互补）：
    - `2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md` —— PAT 鉴权链路（本 plan 的入口认证依赖）
    - `2026-05-21-enterprise-gateway-roadmap.plan.md` —— 总览

## 1. 背景与定位

### 1.1 为什么是 MCP Server 托管

Higress 在 AI 网关赛道最强的差异化不是 LLM 反代，而是 **「Remote MCP Server 托管平台」** —— 把企业内部 OpenAPI、数据库、SaaS 工具一键变成符合 MCP 协议的远程工具池，让任何 MCP 客户端（Claude Desktop / Machi / Cline / Cursor）通过单一鉴权入口、统一审计、统一限流调用。

对我们的价值面：

| 维度 | 价值 |
|---|---|
| 产品差异化 | new-api 完全没有；国内同类网关里 Higress 唯一在做，且 Apache 2.0 |
| Machi 生态联动 | Machi Desktop 已是 MCP 客户端高地；企业版自带"私有 MCP 平台"形成端 + 云闭环 |
| 客户落地价值 | 客户内部 OA / 投研系统 / 工单系统 → 一键 MCP 化暴露给员工 AI 助手 |
| 审计合规 | 所有 Agent 工具调用通过同一网关，沿用 Blake2b 链 + 三通道策略 |
| 商业模式 | MCP 托管按工具调用次数 / 数据出域字节 计量，独立计费维度 |

### 1.2 现状盘点

| 模块 | 现状 | 涉及文件 |
|---|---|---|
| 网关协议面 | 仅 `/v1/chat/completions`、`/v1/embeddings`；无 MCP | `enterprise/apps/gateway/internal/server/server.go` |
| MCP 客户端能力 | Machi 已成熟（stdio + streamable-http） | `agenticx/mcp_*` |
| 插件 manifest | YAML 描述，无运行时（Plan 4 要补） | `enterprise/plugins/*/manifest.yaml` |
| Admin MCP UI | 无 | — |

## 2. 目标与非目标

### 2.1 目标（FR）

- **FR-1 MCP Server 容器化定义**：以 `mcp_servers` PG 表表达一个托管的 MCP Server，含 `name / transport(streamable-http|sse) / backend_type(openapi|graphql|sql|custom-go|wasm) / auth_required_scopes[] / rate_limit / tools[]`。
- **FR-2 OpenAPI → MCP 转换器**：上传 OpenAPI 3.x 规范 → 自动生成 MCP Tool Schema（每个 operation = 一个 tool），保留路径参数 / query / body / response schema；含 **白名单过滤**（仅暴露明确允许的 operationId）。
- **FR-3 多 transport 端点**：网关同时暴露
  - `POST /mcp/{server}/streamable-http`（最新规范，推荐）
  - `GET  /mcp/{server}/sse` + `POST /mcp/{server}/messages`（旧规范兼容）
  - `WS   /mcp/{server}/ws`（可选，第二阶段）
- **FR-4 MCP 鉴权与多租户**：复用 `Bearer agx-pat-...`（来自 keypool plan）或 JWT；按 `scopes` 控制可见工具子集；`tenant_id / dept_id / user_id` 注入所有 tool 调用上下文。
- **FR-5 工具调用审计**：每次 `tools/call` 写一条 `gateway_audit_events`，字段含 `mcp_server / tool_name / input_hash / output_hash / latency_ms / status`；进 Blake2b 链。
- **FR-6 限流与配额**：MCP 工具调用与 LLM 调用**配额账本统一**（沿用 Plan keypool 的 `quota_rules`）；新增 `tool_calls_per_minute` 维度；命中策略评估时 `request.kind=mcp_tool` 区分。
- **FR-7 Admin MCP 管理 UI**：admin-console 新增 `/admin/mcp-servers` 页，含 list / create / OpenAPI 上传 / 工具白名单选择 / scopes 绑定 / 健康面板（最近调用次数 + 错误率）。
- **FR-8 Machi 一键发现**：网关暴露 `GET /mcp/registry`（需 PAT 鉴权），返回当前用户可访问的 MCP Server 清单 + 端点 URL；Machi Desktop 设置页"远程 MCP 注册中心"输入 gateway URL + PAT 即可批量添加。

### 2.2 非功能（NFR）

- **NFR-1 协议合规**：严格遵循 [MCP 规范](https://modelcontextprotocol.io)（2025-03-26 / 2025-06-18 版本）；通过 `@modelcontextprotocol/inspector` 互通测试。
- **NFR-2 后端隔离**：每个 MCP Server 的"backend 执行"在独立 goroutine + ctx 超时；OpenAPI 后端默认 30s 超时、可配。
- **NFR-3 零侵入 LLM 主线**：MCP 路径与 `/v1/*` 共用同一进程同一中间件链（auth → policy → audit），但 handler 分支；不污染 chat completion 热路径。
- **NFR-4 私有化友好**：MCP 注册表落 PG，无外部依赖；Redis 仅用于限流计数，可降级单实例内存。
- **NFR-5 协议演进**：transport 抽象成 `MCPTransport` 接口，未来增 `WebSocket` 不动 handler。

### 2.3 验收（AC）

- **AC-1** 用 [`@modelcontextprotocol/inspector`](https://github.com/modelcontextprotocol/inspector) 连接 `http://gateway/mcp/demo/streamable-http`，能成功 `list_tools` 与 `tools/call`。
- **AC-2** 上传 [Petstore OpenAPI](https://petstore3.swagger.io/api/v3/openapi.json)，admin UI 勾选 3 个 operationId，Machi Desktop 通过 PAT 添加远程 MCP 后能在工具列表里看到这 3 个 tool；调用 `findPetsByStatus` 返回真实结果。
- **AC-3** 同一 PAT 在 1 分钟内连续调用同一 tool 超过 `tool_calls_per_minute`（默认 60）→ 返回 `mcp:rate_limited`，审计事件可见。
- **AC-4** 吊销 PAT 后 5s 内 streamable-http 长连接被服务端主动关闭，新连接 401。
- **AC-5** Admin 健康面板能展示某 server 的"最近 1h 调用次数 / 失败率 / p50 latency"，数据来自 `gateway_audit_events`。
- **AC-6** 集成测试 `mcp/integration_test.go` 覆盖：streamable-http happy path、SSE happy path、未授权 401、超出 scopes 403、限流 429。
- **AC-7** 与现有 LLM 流程并发跑：50 路 `/v1/chat/completions` + 50 路 MCP `tools/call`，无相互拖慢（p95 不退化超过 10%）。

### 2.4 非目标（明确不做）

- ❌ **不**实现完整的 Higress Wasm-based MCP plugin（那是 Higress 用 Envoy/Wasm 的实现选型；我们 Go 网关直接原生 handler）。
- ❌ **不**做"自动 MCP Marketplace 公网分发"——只面向租户私有；公网托管走 Machi `mcp.higress.ai` 的客户场景另议。
- ❌ **不**做 MCP 的 `sampling` / `roots` / `elicitation` 高级特性（当期只 `tools` + 基础 `prompts/resources` 占位）。
- ❌ **不**复刻 `openapi-to-mcp` Higress 工具的 CLI；做成 admin-console 内置导入 UI。
- ❌ **不**改 `gateway_audit_events` 主结构，新增 `mcp_*` 可空字段。

## 3. 架构设计

### 3.1 与现有模块的位置关系

```
┌──────────────────────────────────────────────────────────────┐
│ enterprise/apps/gateway                                      │
│                                                              │
│  Router (chi)                                                │
│  ├── /v1/chat/completions   (已有 LLM 主线)                   │
│  ├── /v1/embeddings                                          │
│  └── /mcp/{server}/...      ★ 本 plan 新增                    │
│       │                                                      │
│       ├── auth.PAT/JWT     (来自 keypool plan)                │
│       ├── policy.Evaluate(kind=mcp_tool)  现有三通道复用       │
│       ├── mcphost.Resolve(server)  ★ 新增                     │
│       │     ├── OpenAPIBackend                               │
│       │     ├── CustomGoBackend                              │
│       │     └── WasmBackend (留口，Plan 4 落地)               │
│       ├── quota.Check(kind=mcp_tool)  现有 tracker 扩展       │
│       ├── transport.{StreamableHTTP|SSE|WS}.Handle           │
│       └── audit.Write(mcp_server, tool_name, …)              │
│                                                              │
│  internal/mcphost/   ★ 新包                                   │
│  ├── registry.go         MCP Server 配置中心 (PG)             │
│  ├── transport_shttp.go  streamable-http handler              │
│  ├── transport_sse.go    SSE handler                          │
│  ├── backend.go          Backend 接口                         │
│  ├── backend_openapi.go  OpenAPI → MCP                        │
│  ├── backend_custom.go   Go 内置后端（admin 自定义工具）       │
│  ├── openapi_loader.go   spec 解析 + tool schema 生成         │
│  └── audit.go            审计字段补充                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 数据模型（PG 新增）

- `mcp_servers`：`id / tenant_id / name / display_name / transport / backend_type / backend_config jsonb / required_scopes text[] / status / created_at / updated_at`
- `mcp_tools`：`id / server_id / tool_name / description / input_schema jsonb / output_schema jsonb / enabled / source_operation_id (nullable) / metadata jsonb`
- `mcp_call_stats`（可选 / 物化视图）：`server_id / tool_name / window_start / call_count / fail_count / p50_latency_ms`

不引入新表存 OpenAPI 原文，原文存 `mcp_servers.backend_config.openapi_blob`（gzip + base64）。

### 3.3 关键接口

```go
// mcphost/backend.go
type Backend interface {
    Name() string
    ListTools(ctx context.Context) ([]Tool, error)
    CallTool(ctx context.Context, name string, args map[string]any) (Result, error)
}

// transport 抽象
type Transport interface {
    Handle(w http.ResponseWriter, r *http.Request, server *Server, backend Backend) error
}
```

OpenAPI 后端转换规则（节选）：

| OpenAPI 元素 | MCP Tool 字段 |
|---|---|
| `operationId` | `tool.name`（保留原值；admin 可重命名） |
| `summary + description` | `tool.description` |
| `parameters[*]` + `requestBody` | `tool.inputSchema` JSON Schema（合并） |
| `responses['200'].content.schema` | `tool.outputSchema`（best-effort） |
| `x-mcp-disabled: true` | 视为白名单关闭 |

### 3.4 鉴权与 scopes

- PAT 鉴权链路：来自 `2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md` FR-3 的 `Authorization: Bearer agx-pat-...`
- scopes 模型：`mcp:server:{server_name}:read` / `mcp:server:{server_name}:invoke`；不存在的 scope 等价 403
- `mcp_servers.required_scopes` 是"调用任何 tool 的最低门槛"；单 tool 可在 `mcp_tools.metadata.scopes` 进一步约束

## 4. 实施分期

| 阶段 | 周期感 | 交付物 | 前置 |
|---|---|---|---|
| **P0 协议基线** | 1.5 周 | `streamable-http` + `SSE` 双通道；内置 `echo` 后端通互通测试 | keypool PAT FR-3 |
| **P1 OpenAPI 后端** | 1.5 周 | OpenAPI 3.x 解析 → tool schema；admin 上传 + 白名单 | P0 |
| **P2 审计与配额** | 1 周 | `gateway_audit_events` 新字段 + Blake2b 链兼容；`tool_calls_per_minute` 限流 | P0、quota tracker 扩展 |
| **P3 Admin UI** | 1.5 周 | `/admin/mcp-servers` CRUD + 健康面板 + OpenAPI 导入向导 | P0/P1 |
| **P4 Machi 端联动** | 0.5 周 | `GET /mcp/registry` + Desktop 设置「远程 MCP 注册中心」一键发现 | P0 |
| **P5 加固与文档** | 1 周 | Inspector 互通用例、并发回归、`docs/runbooks/mcp-hosting.md` | 全 |

总周期 ~7 周。可与多协议入站 plan（Plan 2）并行（两条路径不共改文件）。

## 5. 测试与验证

- **互通**：`@modelcontextprotocol/inspector` + Claude Desktop + Machi Desktop 三客户端轮跑
- **单测**：`mcphost/openapi_loader_test.go`（Petstore + GitHub OpenAPI 两份夹具）、`transport_shttp_test.go`、`backend_openapi_test.go`
- **集成**：`scripts/e2e-mcp-hosting.sh`：启 gateway → 上传 Petstore → 走 PAT 列 tools → 调 tool → 审计可查
- **审计链**：`verify-audit-chain.sh` 在 MCP 事件混入后仍连续
- **并发**：`scripts/perf-mcp-vs-llm.sh` 50+50 路对照

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| MCP 规范快速迭代 | 在 `transport` 接口里隔离版本；optional fields ignore-unknown |
| OpenAPI 转换语义差异 | 仅当 `operation` 通过白名单且 schema 完整时启用；模糊 case 在 UI 标红"需手工修正" |
| 长连接 SSE 与 streaming LLM 抢资源 | 网关进程级 `mcp_connection_limit_per_pat`（默认 4） |
| Backend 后端调用拖死网关 | ctx 30s 默认 + 单后端 `MaxConcurrentInvocations` |
| 审计字段新增破坏 hash 链 | 字段顺序锁定 + 仅追加 nullable 字段 |

**回退**：所有 MCP handler 在 `GATEWAY_MCP_HOSTING=on` env 启用；关闭即与今日行为一致。

## 7. 与 Higress 能力对照

| Higress 能力 | 本 plan |
|---|---|
| MCP Server 托管（plugin 机制） | ✅ FR-1/3 但用原生 Go handler，不绑 Envoy/Wasm |
| OpenAPI → MCP 转换 | ✅ FR-2（admin 内置 UI，无独立 CLI） |
| 多 transport（SSE / streamable-http） | ✅ FR-3 |
| 工具调用审计 | ✅ FR-5（沿用 Blake2b 链） |
| 工具调用限流 | ✅ FR-6 |
| MCP Marketplace 公网托管 | ❌ 当期不做 |
| Wasm 自定义后端 | 🟡 留口 `WasmBackend`，Plan 4 落地 |
| 服务发现集成 Nacos/Consul | ❌ 与 2B 私有化错位 |

## 8. 文档与归档

- 实施同步：`enterprise/docs/runbooks/mcp-hosting.md`（运维）+ `enterprise/docs/architecture/mcp-hosting.md`（架构）
- 用户引导：`docs/guides/machi-remote-mcp.md`（Machi 客户端如何接入）
- 合规：实现不复制 Higress 源码；以 MCP 官方规范 + OpenAPI 3.x 规范为准

## 9. 待澄清问题

1. **是否需要在 MCP transport 层加 mTLS**？当前默认 PAT over TLS 即可；客户高合规场景再单独开 plan。
2. **MCP `resources` / `prompts` 是否当期占位**？建议占位 endpoint 返回空列表，避免客户端误判 server 缺能力。
3. **OpenAPI 中的 `oneOf` / `anyOf` schema** 转 MCP `inputSchema` 时是否降级为 `object` + 文字说明？倾向 P1 先降级，P5 加 best-effort 转换。

---

**Made-with: Damon Li**
