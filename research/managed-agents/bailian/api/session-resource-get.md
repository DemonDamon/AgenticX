---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-resource-get
fetched: 2026-10-23
title: 查询会话资源详情
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 查询会话资源详情

> 查询会话中单个已挂载资源的详情。

<meta property="og:title" content="查询会话资源详情" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/sessions/{session_id}/resources/{resource_id}`

## 路径参数 <span id="h-get-path" />

| **参数**        | **必填** | **类型** | **说明**                   |
| ------------- | ------ | ------ | ------------------------ |
| `session_id`  | 是      | string | 会话 ID，格式 sesn\_\<ULID>   |
| `resource_id` | 是      | string | 资源 ID，格式 sesrsc\_\<ULID> |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/sessions/sesn_xxx/resources/sesrsc_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

```json
{
  "id": "sesrsc_xxx",
  "type": "file",
  "file_id": "file_xxx",
  "mount_path": "/mnt/session/uploads/data.csv",
  "created_at": "2026-05-28T08:23:11Z",
  "updated_at": "2026-05-28T08:23:11Z",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**       | **类型** | **说明**                              |
| ------------ | ------ | ----------------------------------- |
| `id`         | string | 资源 ID，格式 sesrsc\_\<ULID>            |
| `type`       | string | 资源类型，固定为 file                       |
| `file_id`    | string | 内部副本的文件 ID                          |
| `mount_path` | string | 加上 /mnt/session/uploads/ 前缀后的完整挂载路径 |
| `created_at` | string | 创建时间，ISO 8601                       |
| `updated_at` | string | 最近更新时间，ISO 8601                     |
| `request_id` | string | 本次请求的唯一标识                           |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
