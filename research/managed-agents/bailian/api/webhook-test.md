---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-test
fetched: 2026-10-23
title: 测试 Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 测试 Webhook

> 向当前 Webhook 发送一次 webhook.test POST 请求，回调地址返回 2xx 后才返回成功。请求体为空。测试不重试，不保存投递记录，不影响连续失败计数。3xx 或安全校验失败仍会按安全规则禁用当前 Webhook。

<meta property="og:title" content="测试 Webhook" />

## 前提 <span id="h-test-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-test-endpoint" />

<strong>POST</strong> `/webhook_endpoints/{id}/test`

## 路径参数 <span id="h-test-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## 请求示例 <span id="h-test-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP/test" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-test-resp" />

```json
{
  "type": "event",
  "id": "whe_01JXX8JY9BBM4BK4C2P7K3M3ZR",
  "created_at": "2026-08-06T10:30:21.123Z",
  "data": {
    "id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
    "type": "webhook.test",
    "workspace_id": "ws_xxx"
  },
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-test-dto" />

| **字段**              | **类型** | **说明**                |
| ------------------- | ------ | --------------------- |
| `type`              | string | 固定为 event             |
| `id`                | string | 事件 ID，格式 whe\_\<ULID> |
| `created_at`        | string | 事件创建时间，ISO 8601       |
| `data`              | object | 事件载荷                  |
| `data.id`           | string | Webhook ID            |
| `data.type`         | string | 固定为 webhook.test      |
| `data.workspace_id` | string | 工作空间 ID               |
| `request_id`        | string | 本次请求的唯一标识，排查问题时附带     |

## 错误码 <span id="h-test-err" />

| **状态码** | **错误码**    | **说明**                                                             |
| ------- | ---------- | ------------------------------------------------------------------ |
| 404     | `11800001` | webhook not found                                                  |
| 409     | —          | Webhook 未启用                                                        |
| 502     | `11800015` | Webhook endpoint returned HTTP 408, response body: request timeout |
