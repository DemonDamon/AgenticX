---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-get
fetched: 2026-10-23
title: 获取 Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Deployment

> 根据 ID 获取单个 Deployment 的详细信息。

<meta property="og:title" content="获取 Deployment" />

## 前提 <span id="h-get-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-get-endpoint" />

<strong>GET</strong> `/deployments/{deployment_id}`

## 路径参数 <span id="h-get-path" />

| **参数**          | **必填** | **类型** | **说明**        |
| --------------- | ------ | ------ | ------------- |
| `deployment_id` | 是      | string | Deployment ID |

## 请求示例 <span id="h-get-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/deployments/depl_xxx" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-get-resp" />

```json
{
  "id": "depl_xxx",
  "type": "deployment",
  "name": "每日订单汇总",
  "status": "active",
  "agent": {
    "id": "agent_xxx",
    "version": 12
  },
  "environment_id": "env_xxx",
  "schedule": {
    "type": "cron",
    "expression": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai",
    "last_run_at": null,
    "next_run_at": "2026-07-28T01:00:00Z"
  },
  "initial_events": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "汇总昨日订单数据"
        }
      ]
    }
  ],
  "resources": [],
  "vault_ids": [],
  "metadata": {},
  "paused_reason": null,
  "archived_at": null,
  "created_at": "2026-07-28T01:00:00Z",
  "updated_at": "2026-07-28T01:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-get-dto" />

| **字段**           | **类型**         | **说明**            |
| ---------------- | -------------- | ----------------- |
| `id`             | string         | Deployment ID     |
| `type`           | string         | 固定值 deployment    |
| `name`           | string         | Deployment 名称     |
| `description`    | string         | 部署用途描述            |
| `agent`          | object         | —                 |
| `environment_id` | string         | —                 |
| `schedule`       | object         | —                 |
| `initial_events` | array\<object> | —                 |
| `resources`      | array\<object> | —                 |
| `vault_ids`      | array\<string> | —                 |
| `metadata`       | object         | —                 |
| `status`         | string         | —                 |
| `paused_reason`  | object \       | null              | 暂停原因，仅暂停状态时返回 |
| `archived_at`    | string \       | null              | —             |
| `created_at`     | string         | —                 |
| `updated_at`     | string         | —                 |
| `request_id`     | string         | 本次请求的唯一标识，排查问题时附带 |

## 错误码 <span id="h-get-err" />

| **状态码** | **错误码**                | **说明**                                 |
| ------- | ---------------------- | -------------------------------------- |
| 400     | `InvalidParameter`     | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`        | Invalid API-key provided.              |
| 404     | `DEPLOYMENT_NOT_FOUND` | Deployment not found.                  |
