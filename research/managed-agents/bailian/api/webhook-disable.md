---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-disable
fetched: 2026-10-23
title: 禁用 Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 禁用 Webhook

> 手动禁用 Webhook。请求体为空。禁用后不再投递新的事件，已产生但尚未投递的事件会被取消。

<meta property="og:title" content="禁用 Webhook" />

## 前提 <span id="h-disable-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-disable-endpoint" />

<strong>POST</strong> `/webhook_endpoints/{id}/disable`

## 路径参数 <span id="h-disable-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## 请求示例 <span id="h-disable-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP/disable" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-disable-resp" />

```json
{
  "id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
  "description": "生产环境会话事件",
  "url": "https://example.com/managedagent/webhooks",
  "events": [
    "session.status_idled"
  ],
  "status": "DISABLED",
  "disabled_reason": "MANUAL",
  "consecutive_fail": 2,
  "last_success_at": "2026-08-06T10:05:00Z",
  "last_failure_at": "2026-08-06T10:10:00Z",
  "created_at": "2026-08-06T10:00:00Z",
  "updated_at": "2026-08-06T10:25:00Z",
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-disable-dto" />

| **字段**             | **类型**         | **说明**            |
| ------------------ | -------------- | ----------------- |
| `id`               | string         | —                 |
| `description`      | string \       | null              | —            |
| `url`              | string         | —                 |
| `events`           | array\<string> | —                 |
| `status`           | string         | 禁用后为 DISABLED     |
| `disabled_reason`  | string \       | null              | 手动禁用为 MANUAL |
| `consecutive_fail` | integer        | 返回禁用完成时的当前值       |
| `last_success_at`  | string \       | null              | 返回禁用完成时的当前值  |
| `last_failure_at`  | string \       | null              | 返回禁用完成时的当前值  |
| `created_at`       | string         | —                 |
| `updated_at`       | string         | —                 |
| `request_id`       | string         | 本次请求的唯一标识，排查问题时附带 |

## 错误码 <span id="h-disable-err" />

| **状态码** | **错误码**    | **说明**            |
| ------- | ---------- | ----------------- |
| 404     | `11800001` | webhook not found |
