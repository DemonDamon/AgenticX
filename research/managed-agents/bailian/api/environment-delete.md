---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/environment-delete
fetched: 2026-10-23
title: 删除 Environment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Environment

> 硬删除：环境配置一并清除，不可恢复。若需保留配置请改用归档接口。

<meta property="og:title" content="删除 Environment" />

## 前提 <span id="h-ed-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-ed-endpoint" />

<strong>DELETE</strong> `/environments/{environment_id}`

## 请求示例 <span id="h-ed-eg" />

<CodeGroup>
  ```bash
  curl -X DELETE "$AGENTSTUDIO_URL/environments/env_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  client.environments.delete("env_xxx")
  ```

  ```java
  client.environments().delete("env_xxx");
  ```
</CodeGroup>

## 响应示例 <span id="h-ed-resp" />

```json
{
  "id": "env_xxx",
  "type": "environment_deleted",
  "request_id": "xxx"
}
```

### 响应字段

| 字段           | 类型     | 说明                        |
| ------------ | ------ | ------------------------- |
| `id`         | string | 被删除的环境 ID                 |
| `type`       | string | 固定为 `environment_deleted` |
| `request_id` | string | 本次请求的唯一标识                 |
