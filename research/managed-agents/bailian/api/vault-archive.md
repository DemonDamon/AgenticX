---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/vault-archive
fetched: 2026-10-23
title: 归档 Vault
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Vault

> 软归档指定 Vault。归档后默认不出现在列表中，已绑定会话仍可使用其 Credential。

<meta property="og:title" content="归档 Vault" />

## 前提 <span id="h-archive-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-archive-endpoint" />

<strong>POST</strong> `/vaults/{vault_id}/archive`

## 路径参数 <span id="h-archive-path" />

| **参数**     | **必填** | **类型** | **说明**               |
| ---------- | ------ | ------ | -------------------- |
| `vault_id` | 是      | string | Vault ID，格式 vlt\_xxx |

## 请求示例 <span id="h-archive-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/vaults/vlt_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-archive-resp" />

```json
{
  "id": "vlt_xxx",
  "type": "vault",
  "display_name": "生产环境密钥箱",
  "metadata": {
    "environment": "production"
  },
  "archived_at": "2026-07-10T08:00:00Z",
  "created_at": "2026-06-20T10:00:00Z",
  "updated_at": "2026-07-10T08:00:00Z"
}
```

### 响应字段 <span id="h-archive-dto" />

| **字段**         | **类型**         | **说明**                |
| -------------- | -------------- | --------------------- |
| `id`           | string         | Vault ID，格式 vlt\_xxx  |
| `type`         | string         | 固定为 vault             |
| `display_name` | string         | Vault 可读名称            |
| `metadata`     | object         | 业务自定义键值对              |
| `archived_at`  | string \       | null                  | 归档时间，已填入归档时间，ISO 8601 |
| `created_at`   | string         | 创建时间，ISO 8601         |
| `updated_at`   | string         | 最近更新时间，ISO 8601       |

## 错误码 <span id="h-archive-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
