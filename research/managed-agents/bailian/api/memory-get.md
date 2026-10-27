---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-get
fetched: 2026-10-23
title: 获取 Memory
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Memory

> 读取单个记忆，包含正文。

<meta property="og:title" content="获取 Memory" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/memory_stores/{memory_store_id}/memories/{memory_id}`

## 路径参数 <span id="h-get-path" />

| **参数**            | **必填** | **类型** | **说明** |
| ----------------- | ------ | ------ | ------ |
| `memory_store_id` | 是      | string | 记忆库 ID |
| `memory_id`       | 是      | string | 记忆 ID  |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memories/mem_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

```json
{
  "id": "mem_xxx",
  "type": "memory",
  "memory_store_id": "memstore_xxx",
  "path": "/notes/project.md",
  "content": "# 项目约定\n默认开发环境为预发环境。\n",
  "content_sha256": "e3b0c44b98fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "content_size_bytes": 47,
  "memory_version_id": "memver_xxx",
  "created_at": "2026-09-17T08:00:00Z",
  "updated_at": "2026-09-17T08:00:00Z"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**               | **类型**  | **说明**                         |
| -------------------- | ------- | ------------------------------ |
| `id`                 | string  | 记忆 ID，格式 mem\_xxx              |
| `type`               | string  | 固定为 memory                     |
| `memory_store_id`    | string  | 所属记忆库 ID                       |
| `path`               | string  | 记忆库内路径，以 / 开头                  |
| `content`            | string  | 正文，UTF-8 文本；view=full 或单条读取时返回 |
| `content_sha256`     | string  | 正文的 SHA256 哈希，可用作条件更新的乐观锁      |
| `content_size_bytes` | integer | 正文的 UTF-8 字节数                  |
| `memory_version_id`  | string  | 当前版本 ID，格式 memver\_xxx         |
| `created_at`         | string  | 创建时间，ISO 8601 UTC              |
| `updated_at`         | string  | 最近更新时间，ISO 8601 UTC            |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**            | **说明**           |
| ------- | ------------------ | ---------------- |
| 401     | `InvalidApiKey`    | API Key 缺失、错误或失效 |
| 403     | `permission_error` | 身份或资源访问权限不足      |
| 404     | `not_found_error`  | 资源不存在或不属于当前工作空间  |
