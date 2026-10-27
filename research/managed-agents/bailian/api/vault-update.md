---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/vault-update
fetched: 2026-10-23
title: 更新 Vault
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Vault

> 使用补丁语义更新 Vault 的名称或元数据。display_name 和 metadata 至少提供一个。

<meta property="og:title" content="更新 Vault" />

## 前提 <span id="h-update-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-update-endpoint" />

<strong>POST</strong> `/vaults/{vault_id}`

## 路径参数 <span id="h-update-path" />

| **参数**     | **必填** | **类型** | **说明**               |
| ---------- | ------ | ------ | -------------------- |
| `vault_id` | 是      | string | Vault ID，格式 vlt\_xxx |

## 请求体 <span id="h-update-req" />

display\_name 和 metadata 至少提供一个。

| **字段**         | **必填** | **类型** | **说明**                          |
| -------------- | ------ | ------ | ------------------------------- |
| `display_name` | 否      | string | 新的可读名称，1-255 字符                 |
| `metadata`     | 否      | object | 补丁语义：键设为字符串则追加或覆盖，设为 null 则删除该键 |

## 请求示例 <span id="h-update-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/vaults/vlt_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "display_name": "生产环境密钥箱（已更名）",
      "metadata": {
        "environment": "production",
        "deprecated_key": null
      }
    }'
  ```
</CodeGroup>

## 响应 <span id="h-update-resp" />

```json
{
  "id": "vlt_xxx",
  "type": "vault",
  "display_name": "生产环境密钥箱（已更名）",
  "metadata": {
    "environment": "production"
  },
  "archived_at": null,
  "created_at": "2026-06-20T10:00:00Z",
  "updated_at": "2026-07-01T14:30:00Z"
}
```

### 响应字段 <span id="h-update-dto" />

| **字段**         | **类型**         | **说明**               |
| -------------- | -------------- | -------------------- |
| `id`           | string         | Vault ID，格式 vlt\_xxx |
| `type`         | string         | 固定为 vault            |
| `display_name` | string         | Vault 可读名称           |
| `metadata`     | object         | 业务自定义键值对             |
| `archived_at`  | string \       | null                 | 归档时间，未归档时为 null |
| `created_at`   | string         | 创建时间，ISO 8601        |
| `updated_at`   | string         | 最近更新时间，ISO 8601      |

## 错误码 <span id="h-update-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
