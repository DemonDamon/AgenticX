---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-get
fetched: 2026-10-23
title: 获取 Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Credential

> 获取指定 Credential 的详情。响应为 Credential 对象，auth 中的敏感值已脱敏。

<meta property="og:title" content="获取 Credential" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/vaults/{vault_id}/credentials/{credential_id}`

## 路径参数 <span id="h-get-path" />

| **参数**          | **必填** | **类型** | **说明**                     |
| --------------- | ------ | ------ | -------------------------- |
| `vault_id`      | 是      | string | Vault ID，格式 vlt\_xxx       |
| `credential_id` | 是      | string | Credential ID，格式 cred\_xxx |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/vaults/vlt_xxx/credentials/cred_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

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
  "archived_at": null,
  "created_at": "2026-07-10T08:00:00Z",
  "updated_at": "2026-07-10T08:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**                           | **类型**         | **说明**                           |
| -------------------------------- | -------------- | -------------------------------- |
| `id`                             | string         | Credential ID，格式 cred\_xxx       |
| `type`                           | string         | 固定为 credential                   |
| `vault_id`                       | string         | 所属 Vault ID                      |
| `display_name`                   | string         | Credential 可读名称                  |
| `auth`                           | object         | 认证信息，敏感值已脱敏（如 secret\_value 不返回） |
| `auth.type`                      | string         | 认证类型，当前仅支持 environment\_variable |
| `auth.secret_name`               | string         | 环境变量名称                           |
| `auth.networking`                | object         | 网络策略                             |
| `auth.networking.allowed_hosts`  | array          | 允许替换真实密钥的域名列表                    |
| `auth.injection_location`        | object         | 替换位置。替换位置为请求头；请求体与查询参数中的占位符不会被替换 |
| `auth.injection_location.header` | boolean        | 是否启用请求头替换                        |
| `metadata`                       | object         | 业务自定义键值对                         |
| `archived_at`                    | string \       | null                             | 归档时间，未归档时为 null |
| `created_at`                     | string         | 创建时间，ISO 8601                    |
| `updated_at`                     | string         | 最近更新时间，ISO 8601                  |
| `request_id`                     | string         | 请求唯一标识                           |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
