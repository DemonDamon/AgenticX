---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-pause
fetched: 2026-10-23
title: 暂停 Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 暂停 Deployment

> 暂停指定 Deployment，停止定时触发。

<meta property="og:title" content="暂停 Deployment" />

## 前提 <span id="h-pause-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-pause-endpoint" />

<strong>POST</strong> `/deployments/{deployment_id}/pause`

## 路径参数 <span id="h-pause-path" />

| **参数**          | **必填** | **类型** | **说明**        |
| --------------- | ------ | ------ | ------------- |
| `deployment_id` | 是      | string | Deployment ID |

## 请求示例 <span id="h-pause-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments/depl_xxx/pause" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-pause-resp" />

```json
{
  "id": "depl_xxx",
  "type": "deployment",
  "name": "每日订单汇总",
  "status": "paused",
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
    "next_run_at": null
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
  "paused_reason": {
    "type": "manual"
  },
  "archived_at": null,
  "created_at": "2026-07-28T01:00:00Z",
  "updated_at": "2026-07-28T01:00:00Z",
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-pause-dto" />

| **字段**           | **类型**         | **说明**                            |
| ---------------- | -------------- | --------------------------------- |
| `id`             | string         | Deployment ID                     |
| `type`           | string         | 固定为 `deployment`                  |
| `name`           | string         | Deployment 名称                     |
| `description`    | string         | Deployment 用途说明                   |
| `agent`          | object         | 关联 Agent 在锁定版本的快照                 |
| `environment_id` | string         | 关联 Environment ID                 |
| `schedule`       | object         | 定时触发配置。暂停后 `next_run_at` 为 `null` |
| `initial_events` | array\<object> | 触发时发送给 Agent 的初始事件                |
| `resources`      | array\<object> | 挂载的文件资源                           |
| `vault_ids`      | array\<string> | 关联 Vault ID 列表                    |
| `metadata`       | object         | 业务自定义键值对                          |
| `status`         | string         | 此操作后固定为 `paused`                  |
| `paused_reason`  | object         | 暂停原因                              |
| `archived_at`    | string \       | null                              | 归档时间，未归档时为 `null` |
| `created_at`     | string         | 创建时间，ISO 8601                     |
| `updated_at`     | string         | 最近更新时间，ISO 8601                   |
| `request_id`     | string         | 请求唯一标识                            |

## 错误码 <span id="h-pause-err" />

| **状态码** | **错误码**                     | **说明**                                 |
| ------- | --------------------------- | -------------------------------------- |
| 400     | `InvalidParameter`          | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`             | Invalid API-key provided.              |
| 409     | `DEPLOYMENT_STATE_CONFLICT` | Cannot pause an archived deployment.   |
