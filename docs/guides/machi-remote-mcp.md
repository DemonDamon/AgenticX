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
