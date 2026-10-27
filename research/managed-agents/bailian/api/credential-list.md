---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-list
fetched: 2026-10-23
title: 列出 Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Credential

> 分页列出指定 Vault 下的所有 Credential。

<meta property="og:title" content="列出 Credential" />

## 前提 <span id="h-list-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-endpoint" />

<strong>GET</strong> `/vaults/{vault_id}/credentials`

## 路径参数 <span id="h-list-path" />

| **参数**     | **必填** | **类型** | **说明**               |
| ---------- | ------ | ------ | -------------------- |
| `vault_id` | 是      | string | Vault ID，格式 vlt\_xxx |

## Query 参数 <span id="h-list-query" />

| **参数**             | **必填** | **类型**  | **说明**                       |
| ------------------ | ------ | ------- | ---------------------------- |
| `include_archived` | 否      | boolean | 是否包含已归档的 Credential，默认 false |
| `limit`            | 否      | integer | 每页返回数量，默认 20，最大 100          |
| `page`             | 否      | string  | 分页游标，从上一次响应的 next\_page 获取   |

## 请求示例 <span id="h-list-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/vaults/vlt_xxx/credentials?include_archived=true&limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-resp" />

响应包含 `data`（密钥对象数组）与 `next_page`（下一页游标，无更多数据时为 `null`）。

```json
{
  "data": [
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
  ],
  "next_page": null
}
```

### 响应字段 <span id="h-list-dto" />

| **字段**                | **类型**         | **说明**                     |
| --------------------- | -------------- | -------------------------- |
| `data`                | array\<object> | Credential 对象数组            |
| `data[].id`           | string         | Credential ID，格式 cred\_xxx |
| `data[].type`         | string         | 固定为 credential             |
| `data[].vault_id`     | string         | 所属 Vault ID                |
| `data[].display_name` | string         | Credential 可读名称            |
| `data[].auth`         | object         | 认证信息，敏感值已脱敏                |
| `data[].metadata`     | object         | 业务自定义键值对                   |
| `data[].archived_at`  | string \       | null                       | 归档时间，未归档时为 null    |
| `data[].created_at`   | string         | 创建时间，ISO 8601              |
| `data[].updated_at`   | string         | 最近更新时间，ISO 8601            |
| `data[].request_id`   | string         | 请求唯一标识                     |
| `next_page`           | string \       | null                       | 下一页游标，无更多数据时为 null |

## 错误码 <span id="h-list-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
