# MCP Server 托管架构

位置：`enterprise/apps/gateway/internal/mcphost/` — 协议、registry、backend、transport。

与 LLM 主线共用进程与中间件链（auth → policy stage `mcp_tool` → quota → audit），handler 独立分支。默认关闭，见 [gateway/mcp-hosting-overview.md](../gateway/mcp-hosting-overview.md)。

![MCP Host 组件](/docs/svg/ent-mcp-zh.svg?v=2)

*示意图：`/mcp/{server}/*` 进入 Host，再拆成 Registry、Backend、Transport。*

## 组件

| 组件 | 职责 | 源码 |
|------|------|------|
| Router | 挂 `GET /mcp/registry` 与三种 transport | `internal/server/mcp_handlers.go` |
| Host | 解析 server、算 EffectiveScopes、调 backend | `mcphost/host.go` |
| Registry | 读 `mcp_servers` + `mcp_tools`；内置 `demo` | `mcphost/registry.go` |
| Entitlement | capability pack 可收回授权 | `mcphost/entitlement.go` |
| Backend | `echo` / `openapi`；`custom-go` 留口 | `mcphost` backends |
| Transport | Streamable HTTP 或 SSE + messages | Host 返回的 endpoint map |

## 数据模型

- `mcp_servers` — server 元数据 + `backend_config`（OpenAPI 原文可存 `openapi_json` / gzip `openapi_blob`）
- `mcp_tools` — 启用工具清单 + JSON Schema
- `gateway_audit_events.mcp_*` — 工具调用审计（nullable，Blake2b 链兼容）

## OpenAPI → MCP

每个通过白名单的 `operationId` 映射为一个 MCP tool；parameters + requestBody 合并为 `inputSchema`；`oneOf`/`anyOf` 降级为 object + 描述。

## 未落地

- `custom-go` backend
- `apps/edge-agent` 作为 MCP 宿主（该二进制仍是 skeleton）

运维步骤见 [runbooks/mcp-hosting.md](../runbooks/mcp-hosting.md)。

Made-with: Damon Li
