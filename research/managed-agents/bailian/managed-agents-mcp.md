---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-mcp
fetched: 2026-10-23
title: Agent MCP
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Agent MCP

> MCP（Model Context Protocol）是大模型与外部工具之间的标准协议。在控制台 MCP 管理页面按服务卡片浏览与管理。

<meta property="og:title" content="Agent MCP" />

## 类型 <span id="h-mcp-type" />

- **市场**：阿里云百炼托管，覆盖联网搜索、文档处理、地理数据可视化、图像服务、地图服务、数据库等分类，开箱即用。
- **自定义**：点击**创建MCP服务**接入自有 MCP 服务器或第三方服务。支持四种类型：插件、脚本部署、AI 网关、阿里云 OpenAPI。

## 服务卡片 <span id="h-mcp-card" />

每张卡片显示名称、描述、服务 ID、分类标签、用户数与调用次数。

## 挂载到智能体 <span id="h-mcp-attach" />

在智能体编辑页的**MCP 服务器**区点击**添加 MCP 服务**，从下拉选择已开通的服务。挂载后该服务下的全部工具默认启用，可在工具列表中按需关闭单个工具。通过 API 创建或更新智能体时，在 `mcp_servers` 字段中指定服务名称与类型，详见[创建 Agent API](api/agent-create.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "my-agent",
      "model": {"id": "qwen3.8-max"},
      "mcp_servers": [
        {"type": "official", "name": "web_search"}
      ]
    }'
  ```

  ```python
  agent = client.agents.create(
      name="my-agent",
      model="qwen3.8-max",
      mcp_servers=[
          {"type": "official", "name": "web_search"},
      ],
  )
  print(agent.id)
  ```

  ```java
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("my-agent")
      .model("qwen3.8-max")
      .mcpServers(List.of(McpServerConfig.builder()
          .type("official")
          .name("web_search")
          .build()))
      .build());
  System.out.println(agent.getId());
  ```
</CodeGroup>

## 调用与审批 <span id="h-mcp-call" />

智能体调用 MCP 工具时，事件面板会展示工具调用与执行结果。审批机制与内置工具相同，详见[发起会话](managed-agents-session-event.md)。

## 下一步

- [定义 Agent](managed-agents-agent-definition.md)：在智能体上挂载 MCP 服务。
- [发起会话](managed-agents-session-event.md)：观察智能体如何调用 MCP 工具。
