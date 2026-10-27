---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-create
fetched: 2026-10-23
title: 创建 Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Deployment

> 创建一个新的部署，绑定 Agent 并配置触发方式。

<meta property="og:title" content="创建 Deployment" />

## 前提 <span id="h-create-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-create-endpoint" />

<strong>POST</strong> `/deployments`

## 请求体 <span id="h-create-req" />

| **字段**           | **必填** | **类型**         | **说明**                      |
| ---------------- | ------ | -------------- | --------------------------- |
| `name`           | 是      | string         | Deployment 名称，最长 256 字符     |
| `description`    | 否      | string         | 部署用途描述                      |
| `agent`          | 是      | object         | 关联的 Agent                   |
| `environment_id` | 否      | string         | 关联的 Environment ID          |
| `schedule`       | 否      | object         | 定时触发配置；不传则为手动触发             |
| `initial_events` | 是      | array\<object> | 触发时发送给 Agent 的初始事件列表，1-50 项 |
| `resources`      | 否      | array\<object> | 挂载文件资源列表                    |
| `vault_ids`      | 否      | array\<string> | 关联的 Vault ID 列表             |
| `metadata`       | 否      | object         | 业务自定义键值对                    |

## 请求示例 <span id="h-create-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "每日订单汇总",
      "agent": {
        "id": "agent_xxx",
        "version": 12
      },
      "environment_id": "env_xxx",
      "schedule": {
        "type": "cron",
        "expression": "0 9 * * 1-5",
        "timezone": "Asia/Shanghai"
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
      ]
    }'
  ```
</CodeGroup>

## 响应 <span id="h-create-resp" />

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

### 响应字段 <span id="h-create-dto" />

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

## 错误码 <span id="h-create-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
