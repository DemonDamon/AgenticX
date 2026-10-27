---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-list
fetched: 2026-10-23
title: 列出 Memory
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Memory

> 列出记忆库内的记忆文件，按路径排序，支持路径前缀过滤。

<meta property="og:title" content="列出 Memory" />

## 前提 <span id="h-list-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-endpoint" />

<strong>GET</strong> `/memory_stores/{memory_store_id}/memories`

## 路径参数 <span id="h-list-path" />

| **参数**            | **必填** | **类型** | **说明** |
| ----------------- | ------ | ------ | ------ |
| `memory_store_id` | 是      | string | 记忆库 ID |

## Query 参数 <span id="h-list-query" />

| **参数**        | **必填** | **类型**           | **说明**                                          |
| ------------- | ------ | ---------------- | ----------------------------------------------- |
| `path_prefix` | 否      | string           | 目录前缀过滤，以 / 开头和结尾，例如 /notes/；最大 1024 UTF-8 bytes |
| `depth`       | 否      | 0 / 1            | 0 递归列举全部文件（默认）；1 只列举当前层文件，并通过 prefixes 返回子目录    |
| `view`        | 否      | `basic` / `full` | basic 不含正文（默认）；full 含正文                         |
| `limit`       | 否      | integer          | 单页条数。basic 为 1-100 默认 20；full 为 1-20            |
| `page`        | 否      | string           | 分页游标。翻页时保持其余查询参数与 limit 不变                      |

## 请求示例 <span id="h-list-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memories" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-resp" />

```json
{
  "data": [
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
  ],
  "prefixes": [],
  "next_page": null
}
```

### 响应字段 <span id="h-list-dto" />

| **字段**               | **类型**         | **说明**                         |
| -------------------- | -------------- | ------------------------------ |
| `data`               | array\<object> | 记忆数组；view=basic 时不含 content    |
| `id`                 | string         | 记忆 ID，格式 mem\_xxx              |
| `type`               | string         | 固定为 memory                     |
| `memory_store_id`    | string         | 所属记忆库 ID                       |
| `path`               | string         | 记忆库内路径，以 / 开头                  |
| `content`            | string         | 正文，UTF-8 文本；view=full 或单条读取时返回 |
| `content_sha256`     | string         | 正文的 SHA256 哈希，可用作条件更新的乐观锁      |
| `content_size_bytes` | integer        | 正文的 UTF-8 字节数                  |
| `memory_version_id`  | string         | 当前版本 ID，格式 memver\_xxx         |
| `created_at`         | string         | 创建时间，ISO 8601 UTC              |
| `updated_at`         | string         | 最近更新时间，ISO 8601 UTC            |
| `prefixes`           | array\<string> | depth=1 时返回当前层下的子目录前缀          |
| `next_page`          | string \       | null                           | 下一页游标；无更多数据时不含该字段 |

## 错误码 <span id="h-list-err" />

| **状态码** | **错误码**                 | **说明**              |
| ------- | ----------------------- | ------------------- |
| 400     | `invalid_request_error` | 参数、路径、limit 或分页游标非法 |
| 401     | `InvalidApiKey`         | API Key 缺失、错误或失效    |
| 403     | `permission_error`      | 身份或资源访问权限不足         |
| 404     | `not_found_error`       | 资源不存在或不属于当前工作空间     |
