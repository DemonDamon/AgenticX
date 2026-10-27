---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-store-archive
fetched: 2026-10-23
title: 归档 Memory Store
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Memory Store

> 归档记忆库。

<meta property="og:title" content="归档 Memory Store" />

## 前提 <span id="h-archive-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-archive-endpoint" />

<strong>POST</strong> `/memory_stores/{memory_store_id}/archive`

## 路径参数 <span id="h-archive-path" />

| **参数**            | **必填** | **类型** | **说明** |
| ----------------- | ------ | ------ | ------ |
| `memory_store_id` | 是      | string | 记忆库 ID |

## 请求示例 <span id="h-archive-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-archive-resp" />

```json
{
  "id": "memstore_xxx",
  "type": "memory_store",
  "name": "项目知识库",
  "description": "项目约定、决策记录与排查笔记",
  "metadata": {
    "team": "data"
  },
  "created_at": "2026-09-17T08:00:00Z",
  "updated_at": "2026-09-17T09:00:00Z",
  "archived_at": "2026-09-17T09:00:00Z"
}
```

### 响应字段 <span id="h-archive-dto" />

| **字段**        | **类型**         | **说明**                  |
| ------------- | -------------- | ----------------------- |
| `id`          | string         | 记忆库 ID，格式 memstore\_xxx |
| `type`        | string         | 固定为 memory\_store       |
| `name`        | string         | 记忆库名称，1-255 字符          |
| `description` | string         | 用途说明；未填写时为空字符串          |
| `metadata`    | object         | 业务自定义键值对元数据             |
| `archived_at` | string \       | null                    | 归档时间，未归档时省略或为 null |
| `created_at`  | string         | 创建时间，ISO 8601 UTC       |
| `updated_at`  | string         | 最近更新时间，ISO 8601 UTC     |

## 错误码 <span id="h-archive-err" />

| **状态码** | **错误码**            | **说明**           |
| ------- | ------------------ | ---------------- |
| 401     | `InvalidApiKey`    | API Key 缺失、错误或失效 |
| 403     | `permission_error` | 身份或资源访问权限不足      |
| 404     | `not_found_error`  | 资源不存在或不属于当前工作空间  |
