---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-archive
fetched: 2026-10-23
title: 归档 Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 归档 Credential

> 归档指定 Credential，归档后 Credential 不再注入会话，但仍可查询和恢复。响应中 archived_at 字段已设置归档时间。

<meta property="og:title" content="归档 Credential" />

## 前提 <span id="h-archive-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-archive-endpoint" />

<strong>POST</strong> `/vaults/{vault_id}/credentials/{credential_id}/archive`

## 路径参数 <span id="h-archive-path" />

| **参数**          | **必填** | **类型** | **说明**                     |
| --------------- | ------ | ------ | -------------------------- |
| `vault_id`      | 是      | string | Vault ID，格式 vlt\_xxx       |
| `credential_id` | 是      | string | Credential ID，格式 cred\_xxx |

## 请求示例 <span id="h-archive-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/vaults/vlt_xxx/credentials/cred_xxx/archive" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-archive-resp" />

```json
{
  "id": "cred_xxx",
  "type": "credential",
  "vault_id": "vlt_xxx",
  "display_name": "第三方 API 密钥",
  "auth": {
    "type": "environment_variable",
    "secret_name": "API_KEY",
    "networking": {
      "allowed_hosts": [
        "api.example.com",
        "*.example.com"
      ]
    },
    "injection_location": {
      "header": true
    }
  },
  "metadata": {},
  "archived_at": "2026-07-15T06:00:00Z",
  "created_at": "2026-07-10T08:00:00Z",
  "updated_at": "2026-07-15T06:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-archive-dto" />

| **字段**         | **类型** | **说明**                     |
| -------------- | ------ | -------------------------- |
| `id`           | string | Credential ID，格式 cred\_xxx |
| `type`         | string | 固定为 credential             |
| `vault_id`     | string | 所属 Vault ID                |
| `display_name` | string | Credential 可读名称            |
| `auth`         | object | 认证信息，敏感值已脱敏                |
| `metadata`     | object | 业务自定义键值对                   |
| `archived_at`  | string | 归档时间，ISO 8601              |
| `created_at`   | string | 创建时间，ISO 8601              |
| `updated_at`   | string | 最近更新时间，ISO 8601            |
| `request_id`   | string | 请求唯一标识                     |

## 错误码 <span id="h-archive-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
