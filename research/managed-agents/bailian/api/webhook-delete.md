---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-delete
fetched: 2026-10-23
title: 删除 Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Webhook

> 删除 Webhook。删除后不再投递新的事件，已产生但尚未投递的事件会被取消。已有投递事件在 7 天保留期内仍可查询。

<meta property="og:title" content="删除 Webhook" />

## 前提 <span id="h-delete-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-delete-endpoint" />

<strong>DELETE</strong> `/webhook_endpoints/{id}`

## 路径参数 <span id="h-delete-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## 请求示例 <span id="h-delete-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-delete-resp" />

```json
{
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-delete-dto" />

| **字段**       | **类型** | **说明** |
| ------------ | ------ | ------ |
| `request_id` | string | 请求唯一标识 |

## 错误码 <span id="h-delete-err" />

| **状态码** | **错误码**    | **说明**            |
| ------- | ---------- | ----------------- |
| 404     | `11800001` | webhook not found |
