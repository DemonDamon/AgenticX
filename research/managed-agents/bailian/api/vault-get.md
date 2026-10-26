---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/vault-get
fetched: 2026-10-23
title: 获取 Vault
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Vault

> 根据 ID 获取单个 Vault 的详细信息。

<meta property="og:title" content="获取 Vault" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/vaults/{vault_id}`

## 路径参数 <span id="h-get-path" />

| **参数**     | **必填** | **类型** | **说明**               |
| ---------- | ------ | ------ | -------------------- |
| `vault_id` | 是      | string | Vault ID，格式 vlt\_xxx |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/vaults/vlt_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

```json
{
  "id": "vlt_xxx",
  "type": "vault",
  "display_name": "生产环境密钥箱",
  "metadata": {
    "environment": "production"
  },
  "archived_at": null,
  "created_at": "2026-06-20T10:00:00Z",
  "updated_at": "2026-06-20T10:00:00Z"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**         | **类型**         | **说明**               |
| -------------- | -------------- | -------------------- |
| `id`           | string         | Vault ID，格式 vlt\_xxx |
| `type`         | string         | 固定为 vault            |
| `display_name` | string         | Vault 可读名称           |
| `metadata`     | object         | 业务自定义键值对             |
| `archived_at`  | string \       | null                 | 归档时间，未归档时为 null |
| `created_at`   | string         | 创建时间，ISO 8601        |
| `updated_at`   | string         | 最近更新时间，ISO 8601      |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
