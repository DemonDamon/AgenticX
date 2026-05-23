# MCP Server 托管运维手册

## 启用

网关进程需设置：

```bash
export GATEWAY_MCP_HOSTING=on
export DATABASE_URL=postgres://...
```

未设置 `GATEWAY_MCP_HOSTING` 时，网关行为与未接入 MCP 前一致。

## 端点

| 路径 | 说明 |
|------|------|
| `GET /mcp/registry` | PAT/JWT 鉴权，返回当前用户可见 MCP Server 清单 |
| `POST /mcp/{server}/streamable-http` | Streamable HTTP（推荐） |
| `GET /mcp/{server}/sse` | 旧版 SSE 握手 |
| `POST /mcp/{server}/messages?session=…` | SSE 消息通道 |

内置 smoke server：`demo`（echo / ping），无需 PG 配置。

## 鉴权 Scopes

- `mcp:server:{name}:read` — `tools/list`
- `mcp:server:{name}:invoke` — `tools/call`
- `mcp:*` — 超级 scope（开发/管理员 PAT）

## 限流

- 维度：`tool_calls_per_minute`（默认 60，可通过 server `rate_limit` 或 `GATEWAY_MCP_TOOL_CALLS_PER_MINUTE` 覆盖）
- 命中返回 JSON-RPC error `mcp:rate_limited`（HTTP 200 + error body）

## 审计

每次 `tools/call` 写入 `gateway_audit_events`（`event_type=mcp_tool_call`），字段：

`mcp_server`, `mcp_tool_name`, `mcp_input_hash`, `mcp_output_hash`, `mcp_status`, `latency_ms`

## Admin 控制台

`/admin/mcp-servers`：CRUD、OpenAPI 导入、1h 健康统计（来自审计表）。

## 验证

```bash
cd enterprise/apps/gateway
GATEWAY_MCP_HOSTING=on go test ./internal/mcphost/... -count=1
bash ../../scripts/e2e-mcp-hosting.sh
```

Made-with: Damon Li
