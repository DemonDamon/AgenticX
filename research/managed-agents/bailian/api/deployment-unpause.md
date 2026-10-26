---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-unpause
fetched: 2026-10-23
title: 恢复 Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 恢复 Deployment

> 将已暂停的 Deployment 恢复为活跃状态。

<meta property="og:title" content="恢复 Deployment" />

## 前提 <span id="h-unpause-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-unpause-endpoint" />

<strong>POST</strong> `/deployments/{deployment_id}/unpause`

## 路径参数 <span id="h-unpause-path" />

| **参数**          | **必填** | **类型** | **说明**        |
| --------------- | ------ | ------ | ------------- |
| `deployment_id` | 是      | string | Deployment ID |

## 请求示例 <span id="h-unpause-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments/depl_xxx/unpause" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-unpause-resp" />

```json
{
  "id": "depl_xxx",
  "type": "deployment",
  "name": "Daily Report Generator",
  "description": "Generates daily sales reports",
  "agent": {
    "id": "agent_xxx",
    "version": 13
  },
  "environment_id": "env_xxx",
  "schedule": {
    "cron": "0 9 * * *"
  },
  "initial_events": [],
  "resources": [],
  "vault_ids": [],
  "metadata": {},
  "status": "active",
  "paused_reason": null,
  "archived_at": null,
  "created_at": "2026-07-20T10:00:00Z",
  "updated_at": "2026-07-28T02:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-unpause-dto" />

| **字段**           | **类型**         | **说明**            |
| ---------------- | -------------- | ----------------- |
| `id`             | string         | Deployment ID     |
| `type`           | string         | 固定值 deployment    |
| `name`           | string         | Deployment 名称     |
| `description`    | string         | Deployment 描述     |
| `agent`          | object         | —                 |
| `environment_id` | string         | —                 |
| `schedule`       | object         | 定时触发配置            |
| `initial_events` | array\<object> | —                 |
| `resources`      | array\<object> | —                 |
| `vault_ids`      | array\<string> | —                 |
| `metadata`       | object         | —                 |
| `status`         | string         | —                 |
| `paused_reason`  | string \       | null              | — |
| `archived_at`    | string \       | null              | — |
| `created_at`     | string         | —                 |
| `updated_at`     | string         | —                 |
| `request_id`     | string         | 本次请求的唯一标识，排查问题时附带 |

## 错误码 <span id="h-unpause-err" />

| **状态码** | **错误码**                     | **说明**                                 |
| ------- | --------------------------- | -------------------------------------- |
| 400     | `InvalidParameter`          | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`             | Invalid API-key provided.              |
| 409     | `DEPLOYMENT_STATE_CONFLICT` | Cannot unpause an archived deployment. |
