# Enterprise Gateway MCP 托管

网关进程内嵌 MCP Server 托管（`enterprise/apps/gateway/internal/mcphost`），与聊天主线共用 **auth → 策略阶段 `mcp_tool` → quota → audit**。默认关闭：未把 `GATEWAY_MCP_HOSTING` 设为 `on` / `1` / `true` 时不挂 MCP 路由，行为与未接入前一致。

![MCP 托管：Registry、Backend、Transport](/docs/svg/ent-mcp-zh.svg?v=2)

*示意图：同一 Go 进程里，Host 解析 Registry / 授权 / backend，再走 Streamable HTTP 或 SSE。*

## 何时用

- 业务系统、IDE 或 MCP 客户端用 PAT / JWT **直连网关**调用企业内工具
- 管理员在 `/admin/mcp-servers` 登记 OpenAPI 或使用内置 echo，员工按 entitlement 看见清单

不要把这条链路写成 Desktop 的 `mcp_connect`，也不要把 `apps/edge-agent`（仍是 skeleton）写成 MCP 宿主。

## 开关与依赖

```bash
export GATEWAY_MCP_HOSTING=on
export DATABASE_URL=postgres://...
# 可选：全局限流，默认 60
export GATEWAY_MCP_TOOL_CALLS_PER_MINUTE=60
```

`HostingEnabled()` 只认 `on` / `1` / `true`（大小写不敏感）。未配置 `DATABASE_URL` 时，除内置 `demo` 外，按名称解析会返回 `mcp:server_not_found`。

## 请求怎么走

1. 客户端打 `/mcp/{server}/streamable-http`（推荐）或旧 SSE 握手
2. `mcphost.Host.ResolveServer`：先认内置 `demo`，再查 PG `mcp_servers`（`tenant_id + name + status=active`）
3. `EntitlementChecker`：若 capability pack 治理该 server，撤销则拒绝；未治理则回退调用方 scopes
4. Backend：`echo`（demo / ping）或 `openapi`（白名单 `operationId` → MCP tool）。`custom-go` **只是留口，未落地**
5. 每次 `tools/call` 过策略、配额，再写 `gateway_audit_events`

OpenAPI → MCP：parameters + requestBody 合并为 `inputSchema`；`oneOf` / `anyOf` 降级为 object + 描述。

## 端点

| 路径 | 说明 |
|------|------|
| `GET /mcp/registry` | PAT/JWT 鉴权，返回当前身份可见的 server 清单（含 endpoint 提示） |
| `POST /mcp/{server}/streamable-http` | Streamable HTTP（推荐） |
| `GET /mcp/{server}/sse` | 旧版 SSE 握手 |
| `POST /mcp/{server}/messages?session=…` | SSE 消息通道 |

另有 `/v1/mcp/{server_id}/*` 代理入口；`GATEWAY_MCP_HOSTING` 关闭时该路径同样不可用。

内置 smoke server：`demo`（echo / ping），无需 PG 行。

## 鉴权 Scopes

| Scope | 能力 |
|-------|------|
| `mcp:server:{name}:read` | `tools/list` |
| `mcp:server:{name}:invoke` | `tools/call` |
| `mcp:*` | 超级 scope（开发 / 管理员 PAT） |

清单接口还会按 `CanListTools` 过滤：没有读权限的 server 不会出现在 `/mcp/registry`。

## 限流

- 维度：`tool_calls_per_minute`（默认 60）
- 覆盖顺序：server 行上的 `rate_limit` → `GATEWAY_MCP_TOOL_CALLS_PER_MINUTE` → 默认 60
- 命中返回 JSON-RPC error `mcp:rate_limited`（HTTP 200 + error body），走 `quota.Tracker.CheckMCPToolCall`

## 审计

每次 `tools/call` 写入 `gateway_audit_events`（`event_type=mcp_tool_call`）：

`mcp_server`, `mcp_tool_name`, `mcp_input_hash`, `mcp_output_hash`, `mcp_status`, `latency_ms`

输入 / 输出只存哈希，不落明文。Blake2b 链字段与 LLM 审计兼容（MCP 列可空）。

## Admin 控制台

`/admin/mcp-servers`：CRUD、OpenAPI 导入、近 1 小时健康统计（来自审计表）。PG 表：

- `mcp_servers` — 元数据 + `backend_config`（OpenAPI 原文可存 `openapi_json` / gzip `openapi_blob`）
- `mcp_tools` — 启用工具清单 + JSON Schema

## 验证

```bash
cd enterprise/apps/gateway
GATEWAY_MCP_HOSTING=on go test ./internal/mcphost/... -count=1
bash ../../scripts/e2e-mcp-hosting.sh
```

## 相关文档

- 架构：[architecture/mcp-hosting.md](../architecture/mcp-hosting.md)
- 运维：[runbooks/mcp-hosting.md](../runbooks/mcp-hosting.md)
- PAT：[api-tokens.md](./api-tokens.md) · [keypool-pat-overview.md](./keypool-pat-overview.md)

Made-with: Damon Li
