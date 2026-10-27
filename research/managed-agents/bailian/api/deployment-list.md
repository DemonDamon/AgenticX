---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-list
fetched: 2026-10-23
title: 列出 Deployment
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Deployment

> 分页查询 Deployment 列表，支持按 Agent、状态、关键词等条件筛选。

<meta property="og:title" content="列出 Deployment" />

## 前提 <span id="h-list-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-endpoint" />

<strong>GET</strong> `/deployments`

## Query 参数 <span id="h-list-query" />

| **参数**             | **必填** | **类型**  | **说明**                         |
| ------------------ | ------ | ------- | ------------------------------ |
| `agent_id`         | 否      | string  | 按 Agent ID 筛选                  |
| `keyword`          | 否      | string  | 按 ID 或名称模糊搜索                   |
| `status`           | 否      | string  | 按状态筛选：`active` 或 `paused`      |
| `include_archived` | 否      | boolean | 是否包含已归档的 Deployment，默认 `false` |
| `limit`            | 否      | integer | 每页返回数量，最大 100，默认 `20`          |
| `page`             | 否      | string  | 分页游标                           |
| `created_at[gte]`  | 否      | string  | 创建时间下界，RFC 3339                |
| `created_at[lte]`  | 否      | string  | 创建时间上界，RFC 3339                |

## 请求示例 <span id="h-list-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/deployments?agent_id=agent_xxx&keyword=data&status=active&include_archived=true&limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-resp" />

响应包含 `data`（部署对象数组）与 `next_page`（下一页游标，无更多数据时为 `null`）。

```json
{
  "data": [
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
      "initial_events": [],
      "resources": [],
      "vault_ids": [],
      "metadata": {},
      "paused_reason": null,
      "archived_at": null,
      "created_at": "2026-07-28T01:00:00Z",
      "updated_at": "2026-07-28T01:00:00Z",
      "request_id": "req_xxx"
    }
  ],
  "next_page": null
}
```

### 响应字段 <span id="h-list-dto" />

| **字段**                  | **类型**         | **说明**                            |
| ----------------------- | -------------- | --------------------------------- |
| `data`                  | array\<object> | 部署对象数组                            |
| `data[].id`             | string         | Deployment ID                     |
| `data[].type`           | string         | 固定为 `deployment`                  |
| `data[].name`           | string         | Deployment 名称                     |
| `data[].description`    | string         | Deployment 用途说明                   |
| `data[].agent`          | object         | 关联 Agent 在锁定版本的快照                 |
| `data[].environment_id` | string         | 关联 Environment ID                 |
| `data[].schedule`       | object         | 定时触发配置                            |
| `data[].initial_events` | array\<object> | 触发时发送给 Agent 的初始事件                |
| `data[].resources`      | array\<object> | 挂载的文件资源                           |
| `data[].vault_ids`      | array\<string> | 关联 Vault ID 列表                    |
| `data[].metadata`       | object         | 业务自定义键值对                          |
| `data[].status`         | string         | Deployment 状态：`active` 或 `paused` |
| `data[].paused_reason`  | object \       | null                              | 暂停原因；仅状态为 `paused` 时返回 |
| `data[].archived_at`    | string \       | null                              | 归档时间，未归档时为 `null`      |
| `data[].created_at`     | string         | 创建时间，ISO 8601                     |
| `data[].updated_at`     | string         | 最近更新时间，ISO 8601                   |
| `data[].request_id`     | string         | 请求唯一标识                            |
| `next_page`             | string \       | null                              | 下一页游标；无更多数据时为 `null`   |

## 错误码 <span id="h-list-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
