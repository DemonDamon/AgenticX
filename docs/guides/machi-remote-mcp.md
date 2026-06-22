> Machi 是 Near 的前身名称；本文档文件名保留旧称以便历史链接不断链。

# Near / 任意 MCP 客户端接入 Enterprise Gateway 远程 MCP

## 前置

1. 网关已启用 `GATEWAY_MCP_HOSTING=on`
2. 已在 admin-console 创建 API Token，scopes 含 `mcp:*` 或目标 server 的 read/invoke scope

## 方式 A：注册中心一键发现

```bash
curl -sS -H "Authorization: Bearer $AGX_GATEWAY_BEARER" \
  http://127.0.0.1:8080/mcp/registry | jq .
```

返回 `data.servers[].endpoints.streamable-http` 完整 URL，按条目添加到 MCP 客户端。

## 方式 B：手动添加 Streamable HTTP

MCP Server URL 示例：

```
http://127.0.0.1:8080/mcp/demo/streamable-http
```

Headers：

```
Authorization: Bearer agx-pat-...
```

## Near 直接配置 remote URL MCP

Near（`agx serve` + Desktop）从 **Phase 1+2** 起支持在 `~/.agenticx/mcp.json` 里写 **远程 URL 型 MCP**，与 stdio 条目并列；单条解析失败不会拖垮整份配置。

### 配置格式

`command` 与 `url` **二选一**（与 `agenticx/cli/mcp_schema.json` 一致）：

```json
{
  "mcpServers": {
    "my_stdio_mcp": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"]
    },
    "my_remote_mcp": {
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      },
      "timeout": 60
    }
  }
}
```

- **`url`**：远程 MCP 地址（Streamable HTTP 或 SSE）。
- **`headers`**：静态鉴权（如 PAT / API token）；Near **不会在日志或 ToolError 里打印 header 值**。
- **`transport`**：可省略。省略时按 URL 推断：`…/sse` → `sse`，否则 → `streamable_http`。
- 修改后重启 `agx serve`，或在 Desktop **设置 → MCP** 中重连对应条目。

### 示例：Tushare 官方 MCP

```json
{
  "mcpServers": {
    "tushareMcp": {
      "url": "https://api.tushare.pro/mcp/?token=YOUR_TUSHARE_TOKEN"
    }
  }
}
```

### 示例：Enterprise Gateway 托管 MCP

将 [方式 A](#方式-a注册中心一键发现) 或 [方式 B](#方式-b手动添加-streamable-http) 得到的 `streamable-http` URL 写入 `url`，PAT 写入 `headers`：

```json
{
  "mcpServers": {
    "gateway_petstore": {
      "url": "http://127.0.0.1:8080/mcp/petstore/streamable-http",
      "headers": {
        "Authorization": "Bearer agx-pat-..."
      }
    }
  }
}
```

### 验证

```bash
# 列出已加载条目（含 transport / url）
curl -sS http://127.0.0.1:<serve_port>/api/mcp/servers | jq .

# 连接指定 remote MCP（需 Desktop token 或本机鉴权）
curl -sS -X POST http://127.0.0.1:<serve_port>/api/mcp/connect \
  -H "Content-Type: application/json" \
  -d '{"name":"gateway_petstore","session_id":"..."}'
```

Desktop **设置 → MCP** 列表中，remote 条目会显示 host、transport 徽章，并可通过 **「添加远程 MCP」** 表单或 **Enterprise Gateway 导入** 写入配置，无需手编 JSON。

## Inspector 互通

```bash
npx @modelcontextprotocol/inspector
```

Transport: Streamable HTTP，URL 填上述地址，Authorization 填 PAT。

## OpenAPI 后端 Server

1. admin `/admin/mcp-servers` 创建 server（如 `petstore`）
2. 粘贴 OpenAPI JSON，白名单勾选 operationId（如 `findPetsByStatus`）
3. PAT 调用 `tools/call` 即可代理到上游 HTTP

Made-with: Damon Li
