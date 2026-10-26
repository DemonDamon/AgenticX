---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/agent-get
fetched: 2026-10-23
title: 获取 Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Agent

> 根据智能体 ID 返回完整配置。默认返回最新版本，可通过 version 参数指定历史版本。

<meta property="og:title" content="获取 Agent" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/agents/{agent_id}`

## Query 参数 <span id="h-get-query" />

| 参数        | 必填 | 类型  | 说明                  |
| --------- | -- | --- | ------------------- |
| `version` | 否  | int | 指定要查询的版本号；不传则返回最新版本 |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  # 默认返回最新版本
  curl "$AGENTSTUDIO_URL/agents/agent_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"

  # 指定版本
  curl "$AGENTSTUDIO_URL/agents/agent_xxx?version=3" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  # 默认返回最新版本
  agent = client.agents.retrieve("agent_xxx")

  # 指定版本
  agent = client.agents.retrieve("agent_xxx", version=3)
  ```

  ```java
  // 默认返回最新版本
  Agent agent = client.agents().retrieve("agent_xxx");

  // 指定版本
  Agent agentV2 = client.agents().retrieve("agent_xxx", 2);
  ```
</CodeGroup>

## 响应示例 <span id="h-get-resp" />

```json
{
  "id": "agent_xxx",
  "type": "agent",
  "version": 1,
  "name": "data-analyst",
  "description": "数据分析助手",
  "model": {"id": "qwen3.7-max"},
  "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
  "tools": [],
  "mcp_servers": [],
  "skills": [],
  "multiagent": {
    "type": "coordinator",
    "agents": [
      {"type": "self"},
      {"type": "agent", "id": "agent_researcher", "version": 3}
    ]
  },
  "metadata": {"team": "data"},
  "created_at": "2026-05-28T16:23:11.456+08:00",
  "updated_at": "2026-05-28T16:23:11.456+08:00",
  "archived_at": null,
  "workspace_id": "ws_xxx",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-get-dto" />

| 字段                                                                       | 类型             | 说明                                     |
| ------------------------------------------------------------------------ | -------------- | -------------------------------------- |
| `id`                                                                     | string         | 智能体 ID，格式 `agent_<ULID>`         |
| `type`                                                                   | string         | 固定为 `agent`                            |
| `version`                                                                | int            | 当前版本号，每次更新自动递增；会话创建时锁定该值               |
| `name` / `description` / `system`                                        | string         | 智能体名称、用途说明、系统提示词                       |
| `model` / `tools` / `mcp_servers` / `skills` / `multiagent` / `metadata` | object / array | 模型、工具包、MCP 引用、技能、多智能体协作配置、业务元数据，结构同创建时 |
| `archived_at`                                                            | string / null  | 归档时间，未归档时为 `null`                      |
| `created_at` / `updated_at`                                              | string         | 创建 / 最近更新时间，ISO 8601                   |
| `workspace_id`                                                           | string         | 所属工作空间 ID                              |
| `request_id`                                                             | string         | 本次请求的唯一标识                              |
