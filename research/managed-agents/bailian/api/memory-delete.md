---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/memory-delete
fetched: 2026-10-23
title: 删除 Memory
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Memory

> 删除当前记忆文件，并产生 deleted 版本；历史版本仍可通过版本接口查询。

<meta property="og:title" content="删除 Memory" />

## 前提 <span id="h-delete-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-delete-endpoint" />

<strong>DELETE</strong> `/memory_stores/{memory_store_id}/memories/{memory_id}`

## 路径参数 <span id="h-delete-path" />

| **参数**            | **必填** | **类型** | **说明** |
| ----------------- | ------ | ------ | ------ |
| `memory_store_id` | 是      | string | 记忆库 ID |
| `memory_id`       | 是      | string | 记忆 ID  |

## 请求示例 <span id="h-delete-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/memory_stores/memstore_xxx/memories/mem_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-delete-resp" />

```json
{
  "id": "mem_xxx",
  "type": "memory_deleted"
}
```

### 响应字段 <span id="h-delete-dto" />

| **字段** | **类型** | **说明** |
| ------ | ------ | ------ |
| `id`   | string | —      |
| `type` | string | —      |

## 错误码 <span id="h-delete-err" />

| **状态码** | **错误码**            | **说明**           |
| ------- | ------------------ | ---------------- |
| 401     | `InvalidApiKey`    | API Key 缺失、错误或失效 |
| 403     | `permission_error` | 身份或资源访问权限不足      |
| 404     | `not_found_error`  | 资源不存在或不属于当前工作空间  |
