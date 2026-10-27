---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-update
fetched: 2026-10-23
title: 更新 Memory
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Memory

> 修改记忆正文、重命名或同时原子修改。

<meta property="og:title" content="更新 Memory" />

## 前提 <span id="h-update-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-update-endpoint" />

<strong>POST</strong> `/memory_stores/{memory_store_id}/memories/{memory_id}`

## 路径参数 <span id="h-update-path" />

| **参数**            | **必填** | **类型** | **说明** |
| ----------------- | ------ | ------ | ------ |
| `memory_store_id` | 是      | string | 记忆库 ID |
| `memory_id`       | 是      | string | 记忆 ID  |

## 请求体 <span id="h-update-req" />

| **字段**         | **必填** | **类型** | **说明**                                    |
| -------------- | ------ | ------ | ----------------------------------------- |
| `path`         | 否      | string | 新路径（重命名），规则与创建一致；记忆 ID 保持不变               |
| `content`      | 否      | string | 新正文，最大 102400 UTF-8 bytes                 |
| `precondition` | 否      | object | 可选的乐观锁：携带读取时的 content\_sha256，内容已被修改时返回冲突 |

## 请求示例 <span id="h-update-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memories/mem_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"content": "# 项目约定\n默认开发环境为预发环境。\n变更需要补充回归测试。\n","precondition": {"type": "content_sha256","content_sha256": "e3b0c44b98fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}}'
  ```
</CodeGroup>

## 响应 <span id="h-update-resp" />

```json
{
  "id": "mem_xxx",
  "type": "memory",
  "memory_store_id": "memstore_xxx",
  "path": "/notes/project.md",
  "content_sha256": "e3b0c44b98fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "content_size_bytes": 47,
  "memory_version_id": "memver_yyy",
  "created_at": "2026-09-17T08:00:00Z",
  "updated_at": "2026-09-17T08:30:00Z"
}
```

### 响应字段 <span id="h-update-dto" />

| **字段**               | **类型**  | **说明**                    |
| -------------------- | ------- | ------------------------- |
| `id`                 | string  | 记忆 ID，格式 mem\_xxx         |
| `type`               | string  | 固定为 memory                |
| `memory_store_id`    | string  | 所属记忆库 ID                  |
| `path`               | string  | 记忆库内路径，以 / 开头             |
| `content_sha256`     | string  | 正文的 SHA256 哈希，可用作条件更新的乐观锁 |
| `content_size_bytes` | integer | 正文的 UTF-8 字节数             |
| `memory_version_id`  | string  | 当前版本 ID，格式 memver\_xxx    |
| `created_at`         | string  | 创建时间，ISO 8601 UTC         |
| `updated_at`         | string  | 最近更新时间，ISO 8601 UTC       |

## 错误码 <span id="h-update-err" />

| **状态码** | **错误码**                        | **说明**                |
| ------- | ------------------------------ | --------------------- |
| 400     | `invalid_request_error`        | 参数、路径、limit 或分页游标非法   |
| 401     | `InvalidApiKey`                | API Key 缺失、错误或失效      |
| 403     | `permission_error`             | 身份或资源访问权限不足           |
| 404     | `not_found_error`              | 资源不存在或不属于当前工作空间       |
| 409     | `memory_path_conflict_error` 等 | 路径冲突、条件更新冲突或对已归档记忆库写入 |
