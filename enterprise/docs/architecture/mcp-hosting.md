# MCP Server 托管架构

## 位置

`enterprise/apps/gateway/internal/mcphost/` — 协议、registry、backend、transport。

与 LLM 主线共用进程与中间件链（auth → policy stage `mcp_tool` → quota → audit），handler 独立分支。

## 组件

```
Router
  └── /mcp/{server}/streamable-http | sse | messages
        └── mcphost.Host
              ├── Registry (PG: mcp_servers + mcp_tools)
              ├── Backend (echo | openapi | custom-go 留口)
              └── Transport (StreamableHTTP | SSE)
```

## 数据模型

- `mcp_servers` — server 元数据 + `backend_config`（OpenAPI 原文可存 `openapi_json` / gzip `openapi_blob`）
- `mcp_tools` — 启用工具清单 + JSON Schema
- `gateway_audit_events.mcp_*` — 工具调用审计（nullable，Blake2b 链兼容）

## OpenAPI → MCP

每个通过白名单的 `operationId` 映射为一个 MCP tool；parameters + requestBody 合并为 `inputSchema`；`oneOf`/`anyOf` 降级为 object + 描述（P1）。

Made-with: Damon Li
