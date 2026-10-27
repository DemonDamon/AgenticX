---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-delete
fetched: 2026-10-23
title: 删除 Session
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Session

> 硬删除：会话元数据、事件历史、内部拷贝的资源一并清除，不可恢复。若需保留事件历史请改用归档接口。

<meta property="og:title" content="删除 Session" />

## 前提 <span id="h-sd-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-sd-endpoint" />

<strong>DELETE</strong> `/sessions/{session_id}`

## 请求示例 <span id="h-sd-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/sessions/sesn_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.sessions.delete("sesn_xxx")
  ```

  ```java
  client.sessions().delete("sesn_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-sd-resp" />

```json
{
  "id": "sesn_xxx",
  "type": "session_deleted",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-sd-dto" />

| 字段           | 类型     | 说明                           |
| ------------ | ------ | ---------------------------- |
| `id`         | string | 被删除的会话 ID                    |
| `type`       | string | 固定为 `session_deleted`，标识删除成功 |
| `request_id` | string | 本次请求的唯一标识                    |
