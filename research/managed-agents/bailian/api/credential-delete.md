---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/credential-delete
fetched: 2026-10-23
title: 删除 Credential
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Credential

> 永久删除指定 Credential，删除后不可恢复。

<meta property="og:title" content="删除 Credential" />

## 前提 <span id="h-delete-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-delete-endpoint" />

<strong>DELETE</strong> `/vaults/{vault_id}/credentials/{credential_id}`

## 路径参数 <span id="h-delete-path" />

| **参数**          | **必填** | **类型** | **说明**                     |
| --------------- | ------ | ------ | -------------------------- |
| `vault_id`      | 是      | string | Vault ID，格式 vlt\_xxx       |
| `credential_id` | 是      | string | Credential ID，格式 cred\_xxx |

## 请求示例 <span id="h-delete-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/vaults/vlt_xxx/credentials/cred_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-delete-resp" />

```json
{
  "id": "cred_xxx",
  "type": "credential_deleted",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-delete-dto" />

| **字段**       | **类型** | **说明**                  |
| ------------ | ------ | ----------------------- |
| `id`         | string | 已删除的 Credential ID      |
| `type`       | string | 固定为 credential\_deleted |
| `request_id` | string | 请求唯一标识                  |

## 错误码 <span id="h-delete-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
