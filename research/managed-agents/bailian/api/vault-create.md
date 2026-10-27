---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/vault-create
fetched: 2026-10-23
title: 创建 Vault
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Vault

> 创建一个 Vault，用于集中存储和管理 Credential。

<meta property="og:title" content="创建 Vault" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/vaults`

## 请求体 <span id="h-create-req" />

| **字段**         | **必填** | **类型** | **说明**               |
| -------------- | ------ | ------ | -------------------- |
| `display_name` | 是      | string | Vault 的可读名称，1-255 字符 |
| `metadata`     | 否      | object | 业务自定义键值对元数据          |

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/vaults" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "display_name": "生产环境密钥箱",
      "metadata": {
        "environment": "production"
      }
    }'
  ```
</CodeGroup>

## 响应 <span id="h-create-resp" />

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

### 响应字段 <span id="h-create-dto" />

| **字段**         | **类型**         | **说明**               |
| -------------- | -------------- | -------------------- |
| `id`           | string         | Vault ID，格式 vlt\_xxx |
| `type`         | string         | 固定为 vault            |
| `display_name` | string         | Vault 可读名称           |
| `metadata`     | object         | 业务自定义键值对             |
| `archived_at`  | string \       | null                 | 归档时间，未归档时为 null |
| `created_at`   | string         | 创建时间，ISO 8601        |
| `updated_at`   | string         | 最近更新时间，ISO 8601      |

## 错误码 <span id="h-create-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
