---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-archive
fetched: 2026-10-23
title: 归档 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Session

> 归档会话：status 置为 terminated 终态，archived_at 填入归档时间，事件历史仍可查询。

<meta property="og:title" content="归档 Session" />

## 前提 <span id="h-sa-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-sa-endpoint" />

<strong>POST</strong> `/sessions/{session_id}/archive`

## 请求示例 <span id="h-sa-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions/sesn_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.sessions.archive("sesn_xxx")
  ```

  ```java
  client.sessions().archive("sesn_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-sa-resp" />

返回完整 session 对象，`status` 置为 `terminated`，`archived_at` 被填入归档时间。

```json
{
  "id": "sesn_xxx",
  "type": "session",
  "status": "terminated",
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
  "archived_at": "2026-05-28T11:00:00Z",
  "created_at": "2026-05-28T08:23:11Z",
  "updated_at": "2026-05-28T11:00:00Z",
  "request_id": "xxx"
}
```

响应为 Session 对象。字段如下：

### 响应字段 <span id="h-sa-dto" />

| 字段                          | 类型              | 说明                              |
| --------------------------- | --------------- | ------------------------------- |
| `id`                        | string          | 会话 ID                           |
| `type`                      | string          | 固定为 `session`                   |
| `status`                    | string          | 归档后置为 `terminated`（终态）          |
| `agent`                     | object          | 智能体配置快照                         |
| `environment_id`            | string          | 绑定的运行环境 ID                      |
| `title` / `metadata`        | string / object | 会话标题、业务元数据                      |
| `archived_at`               | string          | 归档时间，ISO 8601；归档接口返回的对象中该字段一定非空 |
| `created_at` / `updated_at` | string          | 创建 / 最近更新时间                     |
| `request_id`                | string          | 本次请求的唯一标识                       |
