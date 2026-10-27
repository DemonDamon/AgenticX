---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-store-list
fetched: 2026-10-23
title: 列出 Memory Store
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Memory Store

> 分页列出当前工作空间的记忆库，按创建时间倒序。

<meta property="og:title" content="列出 Memory Store" />

## 前提 <span id="h-list-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-endpoint" />

<strong>GET</strong> `/memory_stores`

## Query 参数 <span id="h-list-query" />

| **参数**             | **必填** | **类型**  | **说明**                              |
| ------------------ | ------ | ------- | ----------------------------------- |
| `include_archived` | 否      | boolean | 默认 false 只返回未归档；true 同时返回未归档与已归档    |
| `limit`            | 否      | integer | 单页条数，1-100，默认 20                    |
| `page`             | 否      | string  | 分页游标。首次不传，后续传上一次响应的 next\_page 翻下一页 |

## 请求示例 <span id="h-list-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/memory_stores" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-resp" />

```json
{
  "data": [
    {
      "id": "memstore_xxx",
      "type": "memory_store",
      "name": "项目知识库",
      "description": "项目约定、决策记录与排查笔记",
      "metadata": {
        "team": "data"
      },
      "created_at": "2026-09-17T08:00:00Z",
      "updated_at": "2026-09-17T08:00:00Z"
    }
  ],
  "next_page": null
}
```

### 响应字段 <span id="h-list-dto" />

| **字段**        | **类型**         | **说明**                     |
| ------------- | -------------- | -------------------------- |
| `data`        | array\<object> | 记忆库数组                      |
| `id`          | string         | 记忆库 ID，格式 memstore\_xxx    |
| `type`        | string         | 固定为 memory\_store          |
| `name`        | string         | 记忆库名称，1-255 字符             |
| `description` | string         | 用途说明；未填写时为空字符串             |
| `metadata`    | object         | 业务自定义键值对元数据                |
| `archived_at` | string \       | null                       | 归档时间，未归档时省略或为 null         |
| `created_at`  | string         | 创建时间，ISO 8601 UTC          |
| `updated_at`  | string         | 最近更新时间，ISO 8601 UTC        |
| `next_page`   | string \       | null                       | 下一页游标；响应不含该字段或为 null 时表示末页 |

## 错误码 <span id="h-list-err" />

| **状态码** | **错误码**                 | **说明**              |
| ------- | ----------------------- | ------------------- |
| 400     | `invalid_request_error` | 参数、路径、limit 或分页游标非法 |
| 401     | `InvalidApiKey`         | API Key 缺失、错误或失效    |
| 403     | `permission_error`      | 身份或资源访问权限不足         |
