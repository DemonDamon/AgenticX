---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/agent-archive
fetched: 2026-10-23
title: 归档 Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Agent

> 软归档：智能体保留但默认不出现在列表中（除非 include_archived=true），且不可用于新建会话；已有会话不受影响。响应返回完整 Agent 对象，archived_at 字段被填入归档时间。

<meta property="og:title" content="归档 Agent" />

## 前提 <span id="h-arc-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-arc-endpoint" />

<strong>POST</strong> `/agents/{agent_id}/archive`

## 语义 <span id="h-arc-semantic" />

软归档：响应返回完整 agent 对象，`archived_at` 字段被填入归档时间。归档后默认不出现在列表中（除非 `include_archived=true`），不可用于新建会话，已有会话不受影响。

## 请求示例 <span id="h-arc-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/agents/agent_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.agents.archive("agent_xxx")
  ```

  ```java
  client.agents().archive("agent_xxx");
  ```
</CodeGroup>

## 响应说明 <span id="h-arc-resp" />

响应为 Agent 对象，结构同[创建 Agent](agent-create.md)响应，唯一差异是 `archived_at` 字段被填入归档时间（不再为 `null`）。字段如下：

### 响应字段 <span id="h-arc-dto" />

| 字段                                                                       | 类型             | 说明                              |
| ------------------------------------------------------------------------ | -------------- | ------------------------------- |
| `id`                                                                     | string         | 智能体 ID                          |
| `type`                                                                   | string         | 固定为 `agent`                     |
| `version`                                                                | int            | 当前版本号（归档不改变版本）                  |
| `name` / `description` / `system`                                        | string         | 智能体名称、用途说明、系统提示词                |
| `model` / `tools` / `mcp_servers` / `skills` / `multiagent` / `metadata` | object / array | 模型、工具包、MCP 引用、技能、多智能体协作配置、业务元数据 |
| `archived_at`                                                            | string         | 归档时间，ISO 8601；归档接口返回的对象中该字段一定非空 |
| `created_at` / `updated_at`                                              | string         | 创建 / 最近更新时间                     |
| `workspace_id`                                                           | string         | 所属工作空间 ID                       |
| `request_id`                                                             | string         | 本次请求的唯一标识                       |
