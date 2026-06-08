---
name: Gateway MCP Server 托管/反代（统一鉴权 + 限流 + 审计的 MCP 入口）
overview: 网关当前只有 MCP 工具调用限流（quota.CheckMCPToolCall），没有 MCP Server 托管能力。借鉴 Higress mcp-server 插件「网关侧统一托管 MCP 工具、复用鉴权/限流/审计」的范式，新增 streamable-HTTP MCP 反向代理：admin 注册上游 MCP Server，gateway 暴露 /v1/mcp/{server_id}/* 统一入口，经 JWT 鉴权 + MCP 调用限流 + 审计后转发到上游。仅改 enterprise/，不引入 Envoy/Wasm。
todos:
  - id: t1-registry
    content: gateway 新增 mcp 包，定义 MCPServer 配置结构与内存注册表（从 runtime JSON / admin internal 拉取）
    status: completed
  - id: t2-proxy-handler
    content: 新增 /v1/mcp/{server_id}/* 反代 handler（JWT 鉴权 → CheckMCPToolCall 限流 → 转发 → 审计）
    status: completed
  - id: t3-router-wire
    content: Router() 注册 MCP 路由；env GATEWAY_MCP_HOSTING 总开关默认 off
    status: completed
  - id: t4-admin-registry
    content: admin-console 新增 MCP Server 注册页（CRUD + 启停 + 上游 URL/鉴权），落 PG runtime 表
    status: completed
  - id: t5-audit
    content: MCP 调用写 audit event_type=mcp_tool_call（server_id/tool/主体）
    status: completed
  - id: t6-smoke
    content: go test 覆盖反代转发、限流命中、鉴权失败、未启用 404；admin typecheck
    status: completed
isProject: false
---

# Gateway MCP Server 托管/反代

**Plan-Id**: 2026-06-08-gateway-mcp-server-hosting
**Plan-File**: `.cursor/plans/2026-06-08-gateway-mcp-server-hosting.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**优先级**: P1（顺序第 3）
**依赖**: 无（建议在 Provider/LB 之后；与 RPM 限流可并行）
**调研依据**: `research/codedeepresearch/higress/higress_enterprise_gap_analysis.md`（G-H3）；`higress_proposal.md` §4.2；Higress `plugins/wasm-go/extensions/mcp-server/`、`mcp-router/`

## 背景 / 现状（已直读核验）

- `enterprise/apps/gateway/internal/quota/`：已有 `CheckMCPToolCall(ctx, tool, limit)`（`mcp_test.go` L7-18，返回 `mcp:rate_limited`），**仅限流，无托管/反代**。
- `enterprise/apps/gateway/internal/server/server.go` `Router()` L559-599：已有 chat/embeddings/claude/gemini/responses + internal 路由，**无 MCP 路由**。
- 对照 Higress `mcp-server`（网关侧托管 MCP 工具，统一鉴权/限流/观测，要求 Higress ≥ 2.1.0）。
- AgenticX 侧已有 MCP 生态概念（Machi Desktop MCP），但 **enterprise gateway 不托管 MCP**。

**目标**：让 enterprise gateway 成为企业 MCP 统一入口——admin 注册上游 MCP Server，客户端经网关访问，复用既有鉴权/限流/审计，**不引入 Envoy/Wasm**，用 Go 反向代理实现。

## 需求

- FR-1: 新增 `mcp` 包，定义 `MCPServer{ ID, Name, UpstreamURL, AuthHeader(optional), Enabled, ToolRateLimit }` 与内存 `Registry`（支持 Get/List/Replace）。
- FR-2: 配置来源：runtime JSON（env `GATEWAY_MCP_SERVERS_FILE`）或 admin internal 远程 URL（env `GATEWAY_REMOTE_MCP_SERVERS_URL`，~5s 轮询，与现有 runtimeconfig 模式一致）。
- FR-3: 新增反代 handler `GET|POST /v1/mcp/{server_id}/*`：
  1. JWT/PAT 鉴权（复用 `identityFromRequest`）；
  2. 查 Registry，未找到或 `Enabled=false` → 404；
  3. `CheckMCPToolCall(quotaCtx, server_id, limit)` 限流，命中 → 429 + quota 错误；
  4. 反向代理到 `UpstreamURL`（保留 path 尾段、透传 body；如配置 `AuthHeader` 则注入上游鉴权，剥离客户端 Authorization）；
  5. 支持 streamable-HTTP（SSE 透传，不缓冲整包）。
- FR-4: 总开关 env `GATEWAY_MCP_HOSTING`（默认 `off`）；off 时路由不注册（或统一 404），零行为变化。
- FR-5: 每次 MCP 调用写 audit：`event_type=mcp_tool_call`，metadata 含 `server_id`、`tool`（若可从 body 的 `method`/`params.name` 解析）、tenant/dept/user/session 主体。
- FR-6: admin-console 新增「MCP Server 注册」页：CRUD + 启停 + 上游 URL/鉴权 header/限流值，**真写 PG**（新增 runtime 表，禁止 mock）。
- NFR-1: `GATEWAY_MCP_HOSTING=off` 时，现有路由与行为完全不变。
- NFR-2: 反代不得记录/透传上游鉴权密钥到 audit 或日志。
- NFR-3: 流式响应禁止整包缓冲，逐 chunk flush。
- NFR-4: 上游不可达/超时返回结构化网关错误（非裸 500），含 server_id。
- AC-1: 注册 server A，客户端 `POST /v1/mcp/A/...` 经鉴权后转发到 A 的 UpstreamURL，响应回传。
- AC-2: 未注册 server_id → 404；`Enabled=false` → 404。
- AC-3: 限流命中 → 429 + `mcp:rate_limited`。
- AC-4: 缺/错 JWT → 401。
- AC-5: `GATEWAY_MCP_HOSTING=off` → 路由不可用且既有测试全绿。
- AC-6: audit 出现 `mcp_tool_call` 事件且不含上游密钥。
- AC-7: admin MCP 页 CRUD 真写 PG，刷新后保留；typecheck 通过。

## 改动范围（严格）

### 修改
1. `enterprise/apps/gateway/internal/server/server.go`：`Router()` 在 `GATEWAY_MCP_HOSTING=on` 时注册 `/v1/mcp/{server_id}/*`；接线 Registry。
2. `enterprise/apps/gateway/internal/runtimeconfig/`：增加 MCP servers 轮询拉取（仿 providers/quota）。
3. `enterprise/apps/admin-console/src/app/...`（gateway 区）：新增 MCP Server 注册页 + API route + store。
4. enterprise drizzle schema：新增 `enterprise_runtime_mcp_servers` 表 + 迁移。

### 新增
5. `enterprise/apps/gateway/internal/mcp/registry.go` + `registry_test.go`
6. `enterprise/apps/gateway/internal/mcp/handler.go`（反代）+ `handler_test.go`
7. admin internal API：`/api/internal/mcp-servers-snapshot`（供 gateway 拉取）

### 不动
- chat/embeddings/policy/metering/既有 quota 计数逻辑（仅复用 CheckMCPToolCall）。
- `agenticx/`、`desktop/`、Machi 侧 MCP。

## 关键数据结构

```go
// mcp/registry.go
type MCPServer struct {
    ID            string `json:"id"`
    Name          string `json:"name"`
    UpstreamURL   string `json:"upstreamUrl"`
    AuthHeader    string `json:"authHeader,omitempty"`   // 注入上游，如 "Bearer xxx"；不进 audit
    Enabled       bool   `json:"enabled"`
    ToolRateLimit int    `json:"toolRateLimit,omitempty"` // 0=用默认
}

type Registry interface {
    Get(id string) (MCPServer, bool)
    List() []MCPServer
    Replace(servers []MCPServer)
}
```

PG 表 `enterprise_runtime_mcp_servers`：`tenant_id` 主键域 + `config` JSON（整包，沿用 token-quota 整包 JSON 模式）。

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/mcp/... -count=1`（AC-1~AC-4, AC-6）。
2. `GATEWAY_MCP_HOSTING=off`：`go test ./internal/server/... -count=1` 全绿（AC-5）。
3. `cd enterprise/apps/gateway && go build ./...`。
4. `pnpm -C enterprise exec turbo run typecheck --filter=admin-console`（AC-7）。
5. 手动：起本地 mock MCP server，admin 注册，curl `/v1/mcp/<id>/...` 验证转发与 audit。

## 规范备注（务必遵守）

- **no-scope-creep**：仅实现 MCP 托管反代；不改 chat 链路、不动既有 quota 计数算法。
- **绝不 mock**：admin MCP 注册必须真写 PG，失败明确报错（参考 enterprise「绝对不能再 mock」原则）。
- **安全**：上游 AuthHeader 不得出现在 audit/日志/前端响应。
- **commit**：`/commit --spec=.cursor/plans/2026-06-08-gateway-mcp-server-hosting.plan.md`，message 含：
  - `Plan-Id: 2026-06-08-gateway-mcp-server-hosting`
  - `Plan-File: .cursor/plans/2026-06-08-gateway-mcp-server-hosting.plan.md`
  - `Made-with: Damon Li`
- 只 add 本任务文件；DB 迁移与共享 migrator 三端（admin/portal/CLI）一致（参考 runtime 表迁移规范）。

## 回滚

- `GATEWAY_MCP_HOSTING=off`（默认）即停用；删除 mcp 包 + Router 注册 + admin 页；PG 表保留不影响其他功能（或 down 迁移）。
