---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/agent-versions
fetched: 2026-10-23
title: 列出 Agent 版本
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Agent 版本

> 分页列出某智能体的全部历史版本，按版本号倒序返回。会话创建时锁定当时 version，会话详情中也会嵌入该版本的完整智能体快照。

<meta property="og:title" content="列出 Agent 版本" />

## 前提 <span id="h-ver-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-ver-endpoint" />

<strong>GET</strong> `/agents/{agent_id}/versions`

## Query 参数 <span id="h-ver-query" />

| 参数      | 必填 | 类型     | 说明                                   |
| ------- | -- | ------ | ------------------------------------ |
| `limit` | 否  | int    | 单页条数，默认 20，最大 100                    |
| `page`  | 否  | string | 分页游标。首次不传，后续传上一次响应的 `next_page` 翻下一页 |

## 请求示例 <span id="h-ver-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/agents/agent_xxx/versions" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for version in client.agents.list_versions("agent_xxx", limit=10):
      print(version.version, version.created_at)
  ```

  ```java
  CursorPage<AgentVersion> versions = client.agents().listVersions(
      "agent_xxx", AgentListParam.builder().limit(10).build());
  ```
</CodeGroup>

## 响应说明 <span id="h-ver-resp" />

响应包含 `data`（Agent 对象数组，每项为一个历史版本快照，按版本号倒序排列）、`next_page`（下一页游标，无更多数据时为 `null`）与 `request_id`。每个 Agent 对象的字段同[创建 Agent](agent-create.md)响应，字段说明如下：

### Agent 对象字段 <span id="h-ver-dto" />

| 字段                                                                       | 类型             | 说明                                     |
| ------------------------------------------------------------------------ | -------------- | -------------------------------------- |
| `id`                                                                     | string         | 智能体 ID（所有版本相同）                         |
| `type`                                                                   | string         | 固定为 `agent`                            |
| `version`                                                                | int            | 该版本号；按版本号倒序返回                          |
| `name` / `description` / `system`                                        | string         | 该版本快照中的名称、用途说明、系统提示词                   |
| `model` / `tools` / `mcp_servers` / `skills` / `multiagent` / `metadata` | object / array | 该版本快照中的模型、工具包、MCP 引用、技能、多智能体协作配置、业务元数据 |
| `archived_at`                                                            | string / null  | 归档时间，未归档时为 `null`                      |
| `created_at` / `updated_at`                                              | string         | 该版本的创建 / 更新时间                          |
| `workspace_id`                                                           | string         | 所属工作空间 ID                              |
