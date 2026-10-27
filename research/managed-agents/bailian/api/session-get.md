---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-get
fetched: 2026-10-23
title: 获取 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Session

> 返回会话元数据、嵌入的智能体快照与资源列表。事件历史与消息内容通过事件 API 获取。

<meta property="og:title" content="获取 Session" />

## 前提 <span id="h-sg-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-sg-endpoint" />

<strong>GET</strong> `/sessions/{session_id}`

## 请求示例 <span id="h-sg-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/sessions/sesn_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  session = client.sessions.retrieve("sesn_xxx")
  print(session.id, session.status, session.title)
  ```

  ```java
  Session session = client.sessions().retrieve("sesn_xxx");
  System.out.println(session.getId() + " " + session.getStatus() + " " + session.getTitle());
  ```
</CodeGroup>

## 响应示例 <span id="h-sg-resp" />

```json
{
  "id": "sesn_xxx",
  "type": "session",
  "status": "idle",
  "stop_reason": {
    "type": "requires_action",
    "pending_batch_id": "response_xxx:9f2c...",
    "pending_call_ids": [
      "call_xxx"
    ]
  },
  "agent": {
    "id": "agent_xxx",
    "type": "agent",
    "version": 1,
    "name": "data-analyst",
    "description": null,
    "model": {"id": "qwen3.7-max"},
    "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
    "tools": []
  },
  "environment_id": "env_xxx",
  "title": "Q3 销售数据分析",
  "metadata": {"biz_ticket_id": "1234"},
  "archived_at": null,
  "created_at": "2026-05-28T08:23:11Z",
  "updated_at": "2026-05-28T08:23:25Z",
  "request_id": "xxx",
  "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"},
  "vault_ids": ["vlt_xxx"],
  "mcp_configs": [{"mcp_server_name": "crm", "headers": {"X-Tenant-Id": "tenant-demo"}}]
}
```

响应为 Session 对象。字段如下：

### 响应字段 <span id="h-sg-dto" />

| 字段                          | 类型              | 说明                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | string          | 会话 ID，格式 `sesn_<ULID>`                                                                                                                                                                                                                                                                                                                |
| `type`                      | string          | 固定为 `session`                                                                                                                                                                                                                                                                                                                               |
| `status`                    | string          | 会话状态：`idle` / `running` / `terminated`                                                                                                                                                                                                                                                                                                      |
| `stop_reason`               | object / null   | 会话回到 `idle` 的原因，判别联合。`null`（`running`，或 `idle` 刚创建尚未产生结束原因）/ `{"type":"end_turn"}`（模型主动结束）/ `{"type":"retries_exhausted"}`（重试耗尽）/ `{"type":"requires_action","pending_batch_id":"...","pending_call_ids":[...]}`（等待工具审批，`pending_call_ids` 为待裁决调用列表）。仅在 `status=idle` 时用于判断交互状态；`running` 时为 `null`；`terminated` 是终态，客户端不应依赖其 `stop_reason` |
| `agent`                     | object          | 智能体配置完整快照，含 `id` / `version` / `name` / `model` / `system` / `tools` 等；会话级覆盖（若已设置）已并入快照                                                                                                                                                                                                                                                     |
| `environment_id`            | string          | 绑定的运行环境 ID                                                                                                                                                                                                                                                                                                                                  |
| `title` / `metadata`        | string / object | 会话标题与业务自定义元数据                                                                                                                                                                                                                                                                                                                               |
| `archived_at`               | string / null   | 归档时间，未归档时为 `null`                                                                                                                                                                                                                                                                                                                           |
| `created_at` / `updated_at` | string          | 创建 / 最近更新时间，ISO 8601                                                                                                                                                                                                                                                                                                                        |
| `request_id`                | string          | 本次请求的唯一标识                                                                                                                                                                                                                                                                                                                                   |
| `environment_variables`     | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取                                                                                                                                                                                                                                                                                                            |
| `vault_ids`                 | array of string | 绑定的 Vault ID 列表                                                                                                                                                                                                                                                                                                                             |
| `mcp_configs`               | array of object | 会话级 MCP 请求头，每项含 `mcp_server_name` 与 `headers`；未配置时为空数组                                                                                                                                                                                                                                                                                      |
