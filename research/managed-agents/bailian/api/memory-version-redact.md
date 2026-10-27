---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-version-redact
fetched: 2026-10-23
title: 擦除 Memory Version
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 擦除 Memory Version

> 擦除指定版本的正文，不可逆，重复调用幂等。

<meta property="og:title" content="擦除 Memory Version" />

## 前提 <span id="h-redact-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-redact-endpoint" />

<strong>POST</strong> `/memory_stores/{memory_store_id}/memory_versions/{memory_version_id}/redact`

## 路径参数 <span id="h-redact-path" />

| **参数**              | **必填** | **类型** | **说明** |
| ------------------- | ------ | ------ | ------ |
| `memory_store_id`   | 是      | string | 记忆库 ID |
| `memory_version_id` | 是      | string | 版本 ID  |

## 请求示例 <span id="h-redact-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memory_versions/memver_xxx/redact" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-redact-resp" />

```json
{
  "id": "memver_xxx",
  "type": "memory_version",
  "memory_store_id": "memstore_xxx",
  "memory_id": "mem_xxx",
  "operation": "modified",
  "path": "/notes/project.md",
  "created_at": "2026-09-17T08:30:00Z",
  "redacted_at": "2026-09-17T09:30:00Z"
}
```

### 响应字段 <span id="h-redact-dto" />

| **字段**            | **类型**                             | **说明**                 |
| ----------------- | ---------------------------------- | ---------------------- |
| `id`              | string                             | 版本 ID，格式 memver\_xxx   |
| `type`            | string                             | 固定为 memory\_version    |
| `memory_store_id` | string                             | 所属记忆库 ID               |
| `memory_id`       | string                             | 对应的记忆 ID               |
| `operation`       | `created` / `modified` / `deleted` | 产生该版本的操作类型             |
| `path`            | string                             | 该版本快照中的路径              |
| `redacted_at`     | string \                           | null                   | 正文被擦除的时间；未擦除时省略或为 null |
| `created_at`      | string                             | 版本产生时间，ISO 8601 UTC    |

## 错误码 <span id="h-redact-err" />

| **状态码** | **错误码**            | **说明**           |
| ------- | ------------------ | ---------------- |
| 401     | `InvalidApiKey`    | API Key 缺失、错误或失效 |
| 403     | `permission_error` | 身份或资源访问权限不足      |
| 404     | `not_found_error`  | 资源不存在或不属于当前工作空间  |
