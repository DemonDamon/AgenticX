---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-resource-list
fetched: 2026-10-23
title: 列出会话资源
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出会话资源

> 分页列出会话当前已挂载的资源。

<meta property="og:title" content="列出会话资源" />

## 前提 <span id="h-list-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-endpoint" />

<strong>GET</strong> `/sessions/{session_id}/resources`

## 路径参数 <span id="h-list-path" />

| **参数**       | **必填** | **类型** | **说明**                 |
| ------------ | ------ | ------ | ---------------------- |
| `session_id` | 是      | string | 会话 ID，格式 sesn\_\<ULID> |

## Query 参数 <span id="h-list-query" />

| **参数**  | **必填** | **类型**  | **说明**                                |
| ------- | ------ | ------- | ------------------------------------- |
| `limit` | 否      | integer | 每页数量，最大 100，默认 `20`                   |
| `page`  | 否      | string  | 分页游标（opaque token）。首次不传，后续传上一次响应返回的游标 |

## 请求示例 <span id="h-list-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/sessions/sesn_xxx/resources?limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-resp" />

响应包含 `data`（会话资源对象数组）与 `next_page`（下一页游标，无更多数据时为 `null`）。

```json
{
  "data": [
    {
      "id": "sesrsc_xxx",
      "type": "file",
      "file_id": "file_xxx",
      "mount_path": "/mnt/session/uploads/data.csv",
      "created_at": "2026-05-28T08:23:11.456000Z",
      "updated_at": "2026-05-28T08:23:11.456000Z"
    },
    {
      "id": "sesrsc_yyy",
      "type": "file",
      "file_id": "file_yyy",
      "mount_path": "/mnt/session/uploads/late.csv",
      "created_at": "2026-05-28T08:25:00.000000Z",
      "updated_at": "2026-05-28T08:25:00.000000Z"
    }
  ],
  "next_page": "page_xxxxxxxxxxxxx",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-list-dto" />

| **字段**              | **类型**         | **说明**                                |
| ------------------- | -------------- | ------------------------------------- |
| `data`              | array\<object> | 资源对象数组                                |
| `data[].id`         | string         | 资源 ID，格式 sesrsc\_\<ULID>              |
| `data[].type`       | string         | 资源类型，固定为 `file`                       |
| `data[].file_id`    | string         | 内部副本的文件 ID                            |
| `data[].mount_path` | string         | 加上 `/mnt/session/uploads/` 前缀后的完整挂载路径 |
| `data[].created_at` | string         | 创建时间，ISO 8601                         |
| `data[].updated_at` | string         | 最近更新时间，ISO 8601                       |
| `next_page`         | string         | 下一页游标，原样传入 page 参数续翻；无更多数据时为 null     |
| `request_id`        | string         | 本次请求的唯一标识                             |

## 错误码 <span id="h-list-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
