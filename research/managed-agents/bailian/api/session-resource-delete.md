---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-resource-delete
fetched: 2026-10-23
title: 卸载会话资源
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 卸载会话资源

> 从会话中卸载指定资源，同时清除其内部副本。此操作不可恢复。

<meta property="og:title" content="卸载会话资源" />

## 前提 <span id="h-delete-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-delete-endpoint" />

<strong>DELETE</strong> `/sessions/{session_id}/resources/{resource_id}`

## 路径参数 <span id="h-delete-path" />

| **参数**        | **必填** | **类型** | **说明**                   |
| ------------- | ------ | ------ | ------------------------ |
| `session_id`  | 是      | string | 会话 ID，格式 sesn\_\<ULID>   |
| `resource_id` | 是      | string | 资源 ID，格式 sesrsc\_\<ULID> |

## 请求示例 <span id="h-delete-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/sessions/sesn_xxx/resources/sesrsc_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-delete-resp" />

```json
{
  "id": "sesrsc_xxx",
  "type": "session_resource_deleted",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-delete-dto" />

| **字段**       | **类型** | **说明**                                |
| ------------ | ------ | ------------------------------------- |
| `id`         | string | 被卸载的资源 ID                             |
| `type`       | string | 固定为 session\_resource\_deleted，标识卸载成功 |
| `request_id` | string | 本次请求的唯一标识                             |

## 错误码 <span id="h-delete-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
