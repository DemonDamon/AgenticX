---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/agent-create
fetched: 2026-10-23
title: 创建 Agent
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Agent

> 创建一个智能体。请求体包含模型、系统提示词、工具包与技能配置；响应返回完整的 Agent 对象，初始 version 为 1。

<meta property="og:title" content="创建 Agent" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/agents`

## 请求体 <span id="h-create-req" />

| 字段            | 必填 | 类型             | 说明                                                                                                                                                                                                                                                                                        |
| ------------- | -- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | 是  | string         | 智能体名称，用于在控制台与列表中辨识                                                                                                                                                                                                                                                                        |
| `description` | 否  | string         | 智能体用途说明                                                                                                                                                                                                                                                                                   |
| `model`       | 是  | object         | 模型配置。必填子字段 `id`（模型 ID，如 qwen3.7-max）；可选子字段 `enable_thinking`（bool，是否启用思考模式）、`max_tokens`（int32，最大生成长度）、`temperature`（double，温度参数，控制随机性）、`thinking_budget`（int32，思考预算长度）                                                                                                                   |
| `system`      | 否  | string         | 系统提示词，定义角色与行为约束                                                                                                                                                                                                                                                                           |
| `tools`       | 否  | array\<object> | 工具包列表，按类型分组。每项含 `type`（`builtin_toolkit` / `mcp_toolkit`）、`default_config`（含 `enabled` 与 `permission_policy`）、`configs`（逐工具配置，覆盖 `default_config`），MCP 类还需 `mcp_server_name`。`builtin_toolkit` 至多一项，`mcp_toolkit` 可多项                                                                     |
| `mcp_servers` | 否  | array\<object> | MCP Server 引用列表，每项含 `type`（`official` / `customer`）与 `name`。`name` 可在百炼控制台 **MCP 管理**菜单的服务卡片上查看（自定义服务在创建时指定）                                                                                                                                                                              |
| `skills`      | 否  | array\<object> | 挂载的技能列表，每项含 `type`（`official` / `customer`）、`skill_id` 与 `version`（必须锁定到具体版本号）。`skill_id` 在百炼控制台 **技能管理**菜单的技能详情页查看                                                                                                                                                                       |
| `multiagent`  | 否  | object         | 多智能体协作配置。不传或为空表示单智能体；配置后该智能体作为 coordinator 编排编队成员。含 `type`（当前仅 `coordinator`）与 `agents`（编队条目列表，1-20 个，传空数组表示清空编队），每项含 `type`（`agent` 引用另一个 Agent / `self` coordinator 自身，编队中最多一个）、`id`（`type=agent` 时必填，最长 64 字符；`type=self` 时不可传）、`version`（`type=agent` 时可选，>=1 不传取最新；`type=self` 时不可传） |
| `metadata`    | 否  | object         | 业务自定义键值，不影响模型行为                                                                                                                                                                                                                                                                           |

`permission_policy.type` 取值 `always_allow`（直接执行） / `always_ask`（每次调用前暂停等待人工确认）。工具审批仅支持主智能体，不支持在子智能体中使用。MCP 工具的审批策略配置在 `tools[].type=mcp_toolkit` 项的 `default_config` / `configs` 中，不在 `mcp_servers[]` 中设置。

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/agents" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "data-analyst",
      "description": "数据分析助手",
      "model": {"id": "qwen3.7-max"},
      "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
      "tools": [
        {
          "type": "builtin_toolkit",
          "default_config": {"enabled": true, "permission_policy": {"type": "always_allow"}},
          "configs": [
            {"name": "bash", "enabled": true, "permission_policy": {"type": "always_ask"}},
            {"name": "read", "enabled": true},
            {"name": "write", "enabled": true}
          ]
        }
      ],
      "mcp_servers": [],
      "skills": [
        {"type": "customer", "skill_id": "skill_xxx", "version": "1.0"}
      ],
      "multiagent": {
        "type": "coordinator",
        "agents": [
          {"type": "self"},
          {"type": "agent", "id": "agent_researcher", "version": 3}
        ]
      },
      "metadata": {"team": "data"}
    }'
  ```

  ```python
  agent = client.agents.create(
      name="data-analyst",
      model="qwen3.8-max",
      description="数据分析助手",
      system_prompt="你是数据分析专家，使用 pandas 处理 CSV 文件。",
      tools=[
          {"type": "builtin_toolkit",
           "default_config": {"enabled": True},
           "configs": [
               {"name": "bash", "enabled": True},
               {"name": "read", "enabled": True},
               {"name": "write", "enabled": True},
           ]}
      ],
      mcp_servers=[],
      skills=[{"type": "customer", "skill_id": "skill_xxx", "version": "1.0"}],
      metadata={"team": "data"},
  )
  print(agent.id)       # "agent_xxx"
  print(agent.version)  # 1
  ```

  ```java
  Agent agent = client.agents().create(AgentCreateParam.builder()
      .name("data-analyst")
      .model("qwen3.7-max")
      .description("数据分析助手")
      .instructions("你是数据分析专家，使用 pandas 处理 CSV 文件。")
      .metadata(Map.of("team", "data"))
      .build());
  System.out.println(agent.getId());       // "agent_xxx"
  System.out.println(agent.getVersion());  // 1
  ```
</CodeGroup>

## 响应示例 <span id="h-create-resp" />

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

### 响应字段 <span id="h-create-dto" />

| 字段                                                                       | 类型             | 说明                             |
| ------------------------------------------------------------------------ | -------------- | ------------------------------ |
| `id`                                                                     | string         | 智能体 ID，格式 `agent_<ULID>` |
| `type`                                                                   | string         | 固定为 `agent`                    |
| `version`                                                                | int            | 当前版本号，每次更新自动递增；会话创建时锁定该值       |
| `name` / `description` / `system`                                        | string         | 同请求体                           |
| `model` / `tools` / `mcp_servers` / `skills` / `multiagent` / `metadata` | object / array | 同请求体                           |
| `archived_at`                                                            | string / null  | 归档时间，未归档时为 `null`              |
| `created_at` / `updated_at`                                              | string         | 创建 / 最近更新时间，ISO 8601           |
| `workspace_id`                                                           | string         | 所属工作空间 ID                      |
| `request_id`                                                             | string         | 本次请求的唯一标识，排查问题时附带              |
