# Firecrawl 本地 MCP 接入指南

本指南用于将 Firecrawl 以本地自托管方式接入 AgenticX 的 MCP 能力。

适用场景：
- 不希望依赖云端 API Key；
- 需要在本地网络中执行网页抓取、结构化提取、周报巡检等任务。

## 1. 启动 Firecrawl 本地服务

```bash
git clone https://github.com/firecrawl/firecrawl.git
cd firecrawl
docker compose build
docker compose up
```

默认情况下，服务通常监听在 `http://127.0.0.1:3002`。

可先做一次 API 连通性检查：

```bash
curl -X POST "http://127.0.0.1:3002/v2/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","formats":["markdown"]}'
```

## 2. 配置 AgenticX MCP

AgenticX 会从多个路径合并 MCP 配置，主配置为 `~/.agenticx/mcp.json`。

可在 `~/.agenticx/mcp.json` 中确认存在 `firecrawl` 配置（或通过 Desktop 设置面板的 MCP Tab 查看）：

```json
{
  "mcpServers": {
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"],
      "env": {
        "FIRECRAWL_API_URL": "http://127.0.0.1:3002"
      },
      "timeout": 120
    }
  }
}
```

说明：
- 本地自托管模式下通常不需要云端 `FIRECRAWL_API_KEY`；
- 若你改了 Firecrawl 监听端口，请同步更新 `FIRECRAWL_API_URL`。

## 3. 在会话中验证连接

建议用以下最小闭环验证：

1) `list_mcps`：确认 `firecrawl` 出现在 servers 列表。  
2) `mcp_connect(name=\"firecrawl\")`：建立连接。  
3) 再次 `list_mcps`：确认 `connected=true` 且出现 `mcp_tool_names`。  
4) `mcp_call`：从 `mcp_tool_names` 中选择真实工具名进行调用。

重要约束：
- `mcp_call.tool_name` 必须来自 `list_mcps` 返回的 `mcp_tool_names`；
- 不要使用臆造名称（如 `web.fetch.*`、`list_tools`）。

## 4. 与日报技能配合建议

对于 `tech-daily-news` 这类巡检任务：
- 优先使用 Firecrawl MCP 做站点列表页抓取与详情页提取；
- 当 Firecrawl 不可用时，再回退到搜索类 MCP（如 bocha）。

## 5. 常见问题

- `tool not connected`：尚未 `mcp_connect`，或连接失败后未重试。  
- `no MCP tools connected`：当前没有任何已连接 MCP 工具，先检查配置路径和服务状态。  
- `npx` 不可用：请先安装 Node.js/npm。  
- 本地 Firecrawl 无响应：检查 Docker 容器是否正常运行、端口是否被占用。

