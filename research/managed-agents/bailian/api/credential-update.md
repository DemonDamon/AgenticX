---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-update
fetched: 2026-10-23
title: 更新 Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Credential

> 更新指定 Credential 的属性。auth 中的 type 和 secret_name 不可修改。

<meta property="og:title" content="更新 Credential" />

## 前提 <span id="h-update-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-update-endpoint" />

<strong>POST</strong> `/vaults/{vault_id}/credentials/{credential_id}`

## 路径参数 <span id="h-update-path" />

| **参数**          | **必填** | **类型** | **说明**                     |
| --------------- | ------ | ------ | -------------------------- |
| `vault_id`      | 是      | string | Vault ID，格式 vlt\_xxx       |
| `credential_id` | 是      | string | Credential ID，格式 cred\_xxx |

## 请求体 <span id="h-update-req" />

| **字段**         | **必填** | **类型** | **说明**                                                                                |
| -------------- | ------ | ------ | ------------------------------------------------------------------------------------- |
| `auth`         | 否      | object | 认证信息，固定为 environment\_variable 类型。更新时 type 与 secret\_name 不可修改，secret\_value 留空表示不修改。 |
| `display_name` | 否      | string | Credential 可读名称，最大 255 字符                                                             |
| `metadata`     | 否      | object | 业务自定义键值对元数据                                                                           |

<Note>
  `auth.secret_name` 需满足 `^[a-zA-Z][a-zA-Z0-9_]*$`：以字母开头，仅支持字母、数字和下划线。更新时不可修改。
</Note>

## 请求示例 <span id="h-update-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/vaults/vlt_xxx/credentials/cred_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "display_name": "生产环境 API 密钥",
      "auth": {
        "type": "environment_variable",
        "secret_name": "API_KEY",
        "secret_value": "sk-new-value",
        "networking": {
          "allowed_hosts": [
            "api.example.com"
          ]
        },
        "injection_location": {
          "header": true
        }
      }
    }'
  ```
</CodeGroup>

## 响应 <span id="h-update-resp" />

```json
{
  "id": "cred_xxx",
  "type": "credential",
  "vault_id": "vlt_xxx",
  "display_name": "生产环境 API 密钥",
  "auth": {
    "type": "environment_variable",
    "secret_name": "API_KEY",
    "networking": {
      "allowed_hosts": [
        "api.example.com"
      ]
    },
    "injection_location": {
      "header": true
    }
  },
  "metadata": {},
  "archived_at": null,
  "created_at": "2026-07-10T08:00:00Z",
  "updated_at": "2026-07-15T03:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-update-dto" />

| **字段**         | **类型**         | **说明**                     |
| -------------- | -------------- | -------------------------- |
| `id`           | string         | Credential ID，格式 cred\_xxx |
| `type`         | string         | 固定为 credential             |
| `vault_id`     | string         | 所属 Vault ID                |
| `display_name` | string         | Credential 可读名称            |
| `auth`         | object         | 认证信息，敏感值已脱敏                |
| `metadata`     | object         | 业务自定义键值对                   |
| `archived_at`  | string \       | null                       | 归档时间，未归档时为 null |
| `created_at`   | string         | 创建时间，ISO 8601              |
| `updated_at`   | string         | 最近更新时间，ISO 8601            |
| `request_id`   | string         | 请求唯一标识                     |

## 错误码 <span id="h-update-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
