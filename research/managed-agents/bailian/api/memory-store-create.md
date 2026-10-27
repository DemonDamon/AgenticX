---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-store-create
fetched: 2026-10-23
title: 创建 Memory Store
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Memory Store

> 创建一个记忆库，用于保存智能体的长期工作笔记。

<meta property="og:title" content="创建 Memory Store" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/memory_stores`

## 请求体 <span id="h-create-req" />

| **字段**        | **必填** | **类型** | **说明**             |
| ------------- | ------ | ------ | ------------------ |
| `name`        | 是      | string | 记忆库名称，1-255 字符     |
| `description` | 否      | string | 用途说明，缺省返回空字符串      |
| `metadata`    | 否      | object | 业务自定义键值对元数据，缺省为空对象 |

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/memory_stores" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{"name": "项目知识库","description": "项目约定、决策记录与排查笔记"}'
  ```
</CodeGroup>

## 响应 <span id="h-create-resp" />

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
  "updated_at": "2026-09-17T08:00:00Z"
}
```

### 响应字段 <span id="h-create-dto" />

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

## 错误码 <span id="h-create-err" />

| **状态码** | **错误码**                 | **说明**              |
| ------- | ----------------------- | ------------------- |
| 400     | `invalid_request_error` | 参数、路径、limit 或分页游标非法 |
| 401     | `InvalidApiKey`         | API Key 缺失、错误或失效    |
| 403     | `permission_error`      | 身份或资源访问权限不足         |
