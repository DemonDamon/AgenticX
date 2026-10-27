---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-create
fetched: 2026-10-23
title: 创建 Webhook
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Webhook

> 创建一个 Webhook endpoint，订阅具名事件并投递到指定回调地址。Signing Secret 只在本次响应返回，后续查询不再返回。每个 Workspace 最多创建 20 个 Webhook。

<meta property="og:title" content="创建 Webhook" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/webhook_endpoints`

## 请求体 <span id="h-create-req" />

| **字段**        | **必填** | **类型**         | **说明**                                                   |
| ------------- | ------ | -------------- | -------------------------------------------------------- |
| `url`         | 是      | string         | 回调地址；允许 HTTP 或 HTTPS，端口不限，可用域名或公网 IP；私网、回环、链路本地和保留地址会被拒绝 |
| `events`      | 是      | array\<string> | 可订阅的具名事件类型数组，不支持通配订阅                                     |
| `description` | 否      | string         | 描述，最长 256 个字符                                            |

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/webhook_endpoints" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "description": "生产环境会话事件",
      "url": "https://example.com/managedagent/webhooks",
      "events": [
        "session.updated",
        "session.status_idled",
        "session.thread_terminated"
      ]
    }'
  ```
</CodeGroup>

## 响应 <span id="h-create-resp" />

```json
{
  "id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
  "description": "生产环境会话事件",
  "url": "https://example.com/managedagent/webhooks",
  "events": [
    "session.updated",
    "session.status_idled",
    "session.thread_terminated"
  ],
  "status": "ACTIVE",
  "disabled_reason": null,
  "consecutive_fail": 0,
  "last_success_at": null,
  "last_failure_at": null,
  "signing_secret": "whsec_xxx",
  "created_at": "2026-08-06T10:00:00Z",
  "updated_at": "2026-08-06T10:00:00Z",
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-create-dto" />

| **字段**             | **类型**         | **说明**                                      |
| ------------------ | -------------- | ------------------------------------------- |
| `id`               | string         | Webhook ID，格式 wep\_\<ULID>                  |
| `description`      | string \       | null                                        | 描述                 |
| `url`              | string         | 回调地址                                        |
| `events`           | array\<string> | 订阅的具名事件类型                                   |
| `status`           | string         | Webhook 状态                                  |
| `disabled_reason`  | string \       | null                                        | 禁用原因，未禁用时为 null    |
| `consecutive_fail` | integer        | 当前连续失败数，新建时为 0                              |
| `last_success_at`  | string \       | null                                        | 最近成功投递时间，新建时为 null |
| `last_failure_at`  | string \       | null                                        | 最近失败投递时间，新建时为 null |
| `signing_secret`   | string         | 验签密钥，格式 whsec\_ 加标准 Base64 文本。仅在创建和重置成功响应返回 |
| `created_at`       | string         | 创建时间，ISO 8601                               |
| `updated_at`       | string         | 最近更新时间，ISO 8601                             |
| `request_id`       | string         | 本次请求的唯一标识                                   |

## 错误码 <span id="h-create-err" />

| **状态码** | **错误码**         | **说明**                    |
| ------- | --------------- | ------------------------- |
| 400     | `11800016`      | invalid webhook request   |
| 401     | `InvalidApiKey` | Invalid API-key provided. |
