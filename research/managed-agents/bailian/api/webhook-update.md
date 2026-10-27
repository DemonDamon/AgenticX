---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-update
fetched: 2026-10-23
title: 更新 Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Webhook

> 更新 Webhook 的描述、回调地址或订阅事件。字段缺省表示保持不变。

<meta property="og:title" content="更新 Webhook" />

## 前提 <span id="h-update-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-update-endpoint" />

<strong>PUT</strong> `/webhook_endpoints/{id}`

## 路径参数 <span id="h-update-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## 请求体 <span id="h-update-req" />

| **字段**        | **必填** | **类型**         | **说明**                               |
| ------------- | ------ | -------------- | ------------------------------------ |
| `description` | 否      | string \       | null                                 | 最长 256 个字符；null 或空字符串表示清空，字段缺省表示保持不变 |
| `url`         | 否      | string         | 新回调地址；传入时重新校验，私网、回环、链路本地和保留地址会被拒绝    |
| `events`      | 否      | array\<string> | 使用具名事件类型替换整个订阅列表；字段缺省表示保持不变          |

## 请求示例 <span id="h-update-eg" />

<CodeGroup>
  ```bash
  curl -X PUT "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "description": "生产环境 Agent 与 Session 事件",
      "url": "https://example.com/managedagent/webhooks-v2",
      "events": [
        "agent.updated",
        "session.status_idled"
      ]
    }'
  ```
</CodeGroup>

## 响应 <span id="h-update-resp" />

```json
{
  "id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
  "description": "生产环境 Agent 与 Session 事件",
  "url": "https://example.com/managedagent/webhooks-v2",
  "events": [
    "agent.updated",
    "session.status_idled"
  ],
  "status": "ACTIVE",
  "disabled_reason": null,
  "consecutive_fail": 2,
  "last_success_at": "2026-08-06T10:05:00Z",
  "last_failure_at": "2026-08-06T10:10:00Z",
  "created_at": "2026-08-06T10:00:00Z",
  "updated_at": "2026-08-06T10:15:00Z",
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-update-dto" />

| **字段**             | **类型**         | **说明**            |
| ------------------ | -------------- | ----------------- |
| `id`               | string         | —                 |
| `description`      | string \       | null              | —           |
| `url`              | string         | —                 |
| `events`           | array\<string> | —                 |
| `status`           | string         | —                 |
| `disabled_reason`  | string \       | null              | —           |
| `consecutive_fail` | integer        | 返回更新完成时的当前值       |
| `last_success_at`  | string \       | null              | 返回更新完成时的当前值 |
| `last_failure_at`  | string \       | null              | 返回更新完成时的当前值 |
| `created_at`       | string         | —                 |
| `updated_at`       | string         | —                 |
| `request_id`       | string         | 本次请求的唯一标识，排查问题时附带 |

## 错误码 <span id="h-update-err" />

| **状态码** | **错误码**    | **说明**                  |
| ------- | ---------- | ----------------------- |
| 400     | `11800016` | invalid webhook request |
| 404     | `11800001` | webhook not found       |
