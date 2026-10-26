---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-reset-secret
fetched: 2026-10-23
title: 重置 Signing Secret
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 重置 Signing Secret

> 重置 Webhook 的 Signing Secret。请求体为空。新的 Signing Secret 只在本次响应返回，后续投递使用重置后的 Secret 重新计算签名。

<meta property="og:title" content="重置 Signing Secret" />

## 前提 <span id="h-reset-secret-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-reset-secret-endpoint" />

<strong>POST</strong> `/webhook_endpoints/{id}/reset_secret`

## 路径参数 <span id="h-reset-secret-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## 请求示例 <span id="h-reset-secret-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP/reset_secret" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-reset-secret-resp" />

```json
{
  "id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
  "signing_secret": "whsec_new_xxx",
  "updated_at": "2026-08-06T10:35:00Z",
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-reset-secret-dto" />

| **字段**           | **类型** | **说明**                                   |
| ---------------- | ------ | ---------------------------------------- |
| `id`             | string | —                                        |
| `signing_secret` | string | 新的验签密钥，格式 whsec\_ 加标准 Base64 文本。仅在本次响应返回 |
| `updated_at`     | string | —                                        |
| `request_id`     | string | 本次请求的唯一标识，排查问题时附带                        |

## 错误码 <span id="h-reset-secret-err" />

| **状态码** | **错误码**    | **说明**                                 |
| ------- | ---------- | -------------------------------------- |
| 404     | `11800005` | failed to reset webhook signing secret |
