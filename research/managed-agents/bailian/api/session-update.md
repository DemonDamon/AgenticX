---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-update
fetched: 2026-10-23
title: 更新 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Session

> 修改会话的 title、metadata、environment_variables、vault_ids、会话级智能体配置与会话级 MCP 请求头。会话更新是唯一会触发 session.updated 事件的操作。

<meta property="og:title" content="更新 Session" />

## 前提 <span id="h-su-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-su-endpoint" />

<strong>POST</strong> `/sessions/{session_id}`

支持修改 `title`、`metadata`、`environment_variables`、`vault_ids`、会话级智能体配置（`agent`）与会话级 MCP 请求头（`mcp_configs`）。数组与对象字段整体替换，空值清空。<strong>会话更新是唯一会触发</strong>`session.updated`<strong>事件的操作</strong>。

## 请求体 <span id="h-su-req" />

| 字段                      | 必填 | 类型              | 说明                                                                                                                                                                    |
| ----------------------- | -- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                 | 否  | string          | 会话标题。省略保持原值，`null` 不执行更新                                                                                                                                              |
| `metadata`              | 否  | object          | 业务自定义键值。整体替换；省略保持原值，`null` 不执行更新                                                                                                                                      |
| `environment_variables` | 否  | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取。整体替换；空对象清空，省略保持原值                                                                                                                    |
| `vault_ids`             | 否  | array of string | 整体替换 Vault 绑定；空数组清空，省略保持原值                                                                                                                                            |
| `agent`                 | 否  | object          | 会话级智能体配置 patch，只能携带 `system` / `tools` / `mcp_servers` / `skills` 覆盖字段，携带其他字段（如 `type` / `id` / `version` / `model`）返回 invalid\_parameter。见[会话级配置 patch](#h-su-agent) |
| `mcp_configs`           | 否  | array           | 整体替换会话级 MCP 请求头，结构与[创建 Session](session-create.md)一致；空数组清空，省略保持原值，`null` 非法                                                                             |

## 会话级配置 patch <span id="h-su-agent" />

`agent` patch 只修改本会话的配置快照，不生成智能体新版本。子字段取值语义（与创建 Session 的覆盖语义一致）：

| 取值               | 效果                 |
| ---------------- | ------------------ |
| 省略               | 保留已有覆盖             |
| `null`           | 删除该字段覆盖，重新继承智能体源配置 |
| `[]`（数组字段）       | 明确覆盖为空             |
| `""`（仅 `system`） | 明确使用空提示词           |

## 请求示例 <span id="h-su-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions/sesn_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Q3 销售复盘",
      "metadata": {"biz_ticket_id": "1234", "status": "done"},
      "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"},
      "agent": {
        "system": "你是本会话专用的项目分析助手。",
        "skills": []
      },
      "mcp_configs": [
        {"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}
      ]
    }'
  ```

  ```python
  session = client.sessions.update(
      "sesn_xxx",
      title="Q3 销售复盘",
      metadata={"biz_ticket_id": "1234", "status": "done"},
      environment_variables={"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"},
      agent={"system": "你是本会话专用的项目分析助手。", "skills": []},
      mcp_configs=[{"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}],
  )
  ```

  ```java
  Map<String, String> metadata = new HashMap<>();
  metadata.put("biz_ticket_id", "1234");
  metadata.put("status", "done");

  Map<String, String> environmentVariables = new HashMap<>();
  environmentVariables.put("API_BASE_URL", "https://api.example.com");
  environmentVariables.put("LOG_LEVEL", "info");

  Map<String, Object> agentPatch = Map.of(
      "system", "你是本会话专用的项目分析助手。",
      "skills", List.of());
  Map<String, String> headers = Map.of("X-Tenant-Id", "tenant-demo");

  Session updated = client.sessions().update("sesn_xxx",
      SessionUpdateParam.builder()
          .title("Q3 销售复盘")
          .metadata(metadata)
          .environmentVariables(environmentVariables)
          .agent(agentPatch)
          .mcpConfigs(List.of(Map.of(
              "mcp_server_name", "crm",
              "headers", headers)))
          .build());
  ```
</CodeGroup>

## 响应示例 <span id="h-su-resp" />

返回更新后的会话详情：`title` / `metadata` 等覆盖后的新值、`agent`（覆盖已并入的完整快照）、`mcp_configs`、`vault_ids`、`updated_at` 与 `request_id`。

```json
{
  "id": "sesn_xxx",
  "type": "session",
  "status": "idle",
  "title": "Q3 销售复盘",
  "metadata": {"biz_ticket_id": "1234", "status": "done"},
  "updated_at": "2026-05-28T09:30:00Z",
  "request_id": "xxx",
  "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"},
  "agent": {
    "id": "agent_xxx",
    "type": "agent",
    "version": 1,
    "name": "data-analyst",
    "system": "你是本会话专用的项目分析助手。",
    "tools": [],
    "mcp_servers": [],
    "skills": []
  },
  "vault_ids": ["vlt_xxx"],
  "mcp_configs": [{"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}]
}
```

### 响应字段 <span id="h-su-dto" />

| 字段                      | 类型              | 说明                                                                 |
| ----------------------- | --------------- | ------------------------------------------------------------------ |
| `id`                    | string          | 会话 ID                                                              |
| `type`                  | string          | 固定为 `session`                                                      |
| `status`                | string          | 当前会话状态（更新不改变状态）                                                    |
| `title` / `metadata`    | string / object | 请求体覆盖后的新值                                                          |
| `updated_at`            | string          | 最近更新时间，ISO 8601                                                    |
| `request_id`            | string          | 本次请求的唯一标识                                                          |
| `environment_variables` | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取                                   |
| `agent`                 | object          | 更新后的智能体配置快照，会话级覆盖已并入。字段同[获取 Session](session-get.md) |
| `vault_ids`             | array of string | 更新后的 Vault 绑定                                                      |
| `mcp_configs`           | array of object | 更新后的会话级 MCP 请求头，每项含 `mcp_server_name` 与 `headers`                  |
