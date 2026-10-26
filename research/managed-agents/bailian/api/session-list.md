---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-list
fetched: 2026-10-23
title: 列出 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Session

> 分页列出会话，按 created_at 倒序返回。支持按智能体、状态、创建时间范围过滤。

<meta property="og:title" content="列出 Session" />

## 前提 <span id="h-sl-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-sl-endpoint" />

<strong>GET</strong> `/sessions`

## Query 参数 <span id="h-sl-q" />

| 参数                                    | 类型     | 默认 | 说明                                                  |
| ------------------------------------- | ------ | -- | --------------------------------------------------- |
| `agent_id`                            | string | —  | 按智能体过滤                                              |
| `statuses[]`                          | string | —  | 多状态过滤，可重复传入。如 `?statuses[]=idle&statuses[]=running` |
| `created_at[gte]` / `created_at[lte]` | string | —  | 创建时间范围，ISO 8601                                     |
| `limit`                               | int    | 20 | 每页数量，最大 100                                         |
| `page`                                | string | —  | 首次不传，后续传上一次响应的 `next_page`                          |

## 请求示例 <span id="h-sl-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/sessions?agent_id=agent_xxx&statuses[]=idle&limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for session in client.sessions.list(
      limit=20,
      agent_id="agent_xxx",
      statuses=["idle"],
  ):
      print(session.id, session.status, session.title)
  ```

  ```java
  CursorPage<Session> page = client.sessions().list(SessionListParam.builder()
      .limit(20)
      .agentId("agent_xxx")
      .statuses(Arrays.asList("idle"))
      .build());
  for (Session s : page.getData()) {
      System.out.println(s.getId() + " " + s.getStatus() + " " + s.getTitle());
  }
  ```
</CodeGroup>

## 响应示例 <span id="h-sl-resp" />

```json
{
  "data": [
    {
      "id": "sesn_xxx",
      "type": "session",
      "status": "idle",
      "stop_reason": null,
      "agent": {
        "id": "agent_xxx",
        "type": "agent",
        "version": 1,
        "name": "data-analyst",
        "model": {"id": "qwen3.7-max"},
        "system": "你是数据分析专家，使用 pandas 处理 CSV 文件。",
        "tools": []
      },
      "environment_id": "env_xxx",
      "title": "Q3 销售数据分析",
      "metadata": {"biz_ticket_id": "1234"},
      "archived_at": null,
      "created_at": "2026-05-28T08:23:11.456000Z",
      "updated_at": "2026-05-28T08:23:25.789000Z",
      "environment_variables": {"API_BASE_URL": "https://api.example.com", "LOG_LEVEL": "info"}
    }
  ],
  "next_page": "xxx",
  "request_id": "xxx"
}
```

响应包含 `data`（Session 对象数组）与 `next_page`（下一页游标）。Session 对象字段如下：

### Session 对象字段 <span id="h-sl-dto" />

| 字段                          | 类型              | 说明                                                                                                                                                                                               |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | string          | 会话 ID，格式 `sesn_<ULID>`                                                                                                                                                                     |
| `type`                      | string          | 固定为 `session`                                                                                                                                                                                    |
| `status`                    | string          | 会话状态：`idle` / `running` / `terminated`                                                                                                                                                           |
| `stop_reason`               | object / null   | 会话回到 `idle` 的原因，判别联合。`null` / `{"type":"end_turn"}` / `{"type":"retries_exhausted"}` / `{"type":"requires_action","pending_batch_id":"...","pending_call_ids":[...]}`。仅在 `status=idle` 时用于判断交互状态 |
| `agent`                     | object          | 智能体配置快照，含 `id` / `version` / `name` / `model` / `system` / `tools` 等                                                                                                                             |
| `environment_id`            | string          | 绑定的运行环境 ID                                                                                                                                                                                       |
| `title` / `metadata`        | string / object | 会话标题与业务自定义元数据                                                                                                                                                                                    |
| `archived_at`               | string / null   | 归档时间，未归档时为 `null`                                                                                                                                                                                |
| `created_at` / `updated_at` | string          | 创建 / 最近更新时间，ISO 8601                                                                                                                                                                             |
| `environment_variables`     | object          | 会话运行时注入的环境变量，字符串键值对，沙箱代码中可直接按名读取                                                                                                                                                                 |
