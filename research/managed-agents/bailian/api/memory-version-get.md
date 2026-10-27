---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-version-get
fetched: 2026-10-23
title: 获取 Memory Version
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Memory Version

> 读取指定历史版本。

<meta property="og:title" content="获取 Memory Version" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/memory_stores/{memory_store_id}/memory_versions/{memory_version_id}`

## 路径参数 <span id="h-get-path" />

| **参数**              | **必填** | **类型** | **说明** |
| ------------------- | ------ | ------ | ------ |
| `memory_store_id`   | 是      | string | 记忆库 ID |
| `memory_version_id` | 是      | string | 版本 ID  |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memory_versions/memver_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

```json
{
  "id": "memver_xxx",
  "type": "memory_version",
  "memory_store_id": "memstore_xxx",
  "memory_id": "mem_xxx",
  "operation": "modified",
  "path": "/notes/project.md",
  "content": "# 项目约定\n默认开发环境为预发环境。\n变更需要补充回归测试。\n",
  "content_sha256": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  "content_size_bytes": 68,
  "created_at": "2026-09-17T08:30:00Z"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**               | **类型**                             | **说明**                 |
| -------------------- | ---------------------------------- | ---------------------- |
| `id`                 | string                             | 版本 ID，格式 memver\_xxx   |
| `type`               | string                             | 固定为 memory\_version    |
| `memory_store_id`    | string                             | 所属记忆库 ID               |
| `memory_id`          | string                             | 对应的记忆 ID               |
| `operation`          | `created` / `modified` / `deleted` | 产生该版本的操作类型             |
| `path`               | string                             | 该版本快照中的路径              |
| `content`            | string                             | 该版本正文；已擦除时不含此字段        |
| `content_sha256`     | string                             | 该版本正文的 SHA256 哈希       |
| `content_size_bytes` | integer                            | 该版本正文的 UTF-8 字节数       |
| `redacted_at`        | string \                           | null                   | 正文被擦除的时间；未擦除时省略或为 null |
| `created_at`         | string                             | 版本产生时间，ISO 8601 UTC    |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**            | **说明**           |
| ------- | ------------------ | ---------------- |
| 401     | `InvalidApiKey`    | API Key 缺失、错误或失效 |
| 403     | `permission_error` | 身份或资源访问权限不足      |
| 404     | `not_found_error`  | 资源不存在或不属于当前工作空间  |
