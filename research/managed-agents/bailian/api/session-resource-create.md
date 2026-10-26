---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/session-resource-create
fetched: 2026-10-23
title: 运行时挂载资源
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 运行时挂载资源

> 在会话运行期间动态挂载一个文件。服务端会将文件复制一份内部副本，并把挂载路径加上 /mnt/session/uploads/ 前缀。此操作不产生会话事件。

<meta property="og:title" content="运行时挂载资源" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/sessions/{session_id}/resources`

## 路径参数 <span id="h-create-path" />

| **参数**       | **必填** | **类型** | **说明**                 |
| ------------ | ------ | ------ | ---------------------- |
| `session_id` | 是      | string | 会话 ID，格式 sesn\_\<ULID> |

## 请求体 <span id="h-create-req" />

| **字段**       | **必填** | **类型** | **说明**             |
| ------------ | ------ | ------ | ------------------ |
| `type`       | 是      | string | 资源类型，固定为 file      |
| `file_id`    | 是      | string | 已上传的文件 ID          |
| `mount_path` | 是      | string | 挂载路径，以 /uploads 开头 |

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/sessions/sesn_xxx/resources" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "type": "file",
      "file_id": "file_xxx",
      "mount_path": "/uploads/workspace/late.csv"
    }'
  ```
</CodeGroup>

## 响应 <span id="h-create-resp" />

```json
{
  "id": "sesrsc_xxx",
  "type": "file",
  "file_id": "file_xxx",
  "mount_path": "/mnt/session/uploads/workspace/late.csv",
  "created_at": "2026-05-28T08:25:00Z",
  "updated_at": "2026-05-28T08:25:00Z",
  "request_id": "xxx"
}
```

### 响应字段 <span id="h-create-dto" />

| **字段**       | **类型** | **说明**                       |
| ------------ | ------ | ---------------------------- |
| `id`         | string | 资源 ID，格式 sesrsc\_\<ULID>     |
| `type`       | string | 资源类型，固定为 file                |
| `file_id`    | string | 内部副本的文件 ID，与请求中的 file\_id 不同 |
| `mount_path` | string | 会话内的完整挂载路径                   |
| `created_at` | string | 创建时间，ISO 8601                |
| `updated_at` | string | 最近更新时间，ISO 8601              |
| `request_id` | string | 本次请求的唯一标识                    |

## 错误码 <span id="h-create-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
