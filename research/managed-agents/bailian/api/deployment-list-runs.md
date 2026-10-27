---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-list-runs
fetched: 2026-10-23
title: 列出 Deployment Runs
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Deployment Runs

> 分页列出指定 Deployment 的执行记录。

<meta property="og:title" content="列出 Deployment Runs" />

## 前提 <span id="h-list-runs-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-runs-endpoint" />

<strong>GET</strong> `/deployments/{deployment_id}/runs`

## 路径参数 <span id="h-list-runs-path" />

| **参数**          | **必填** | **类型** | **说明**        |
| --------------- | ------ | ------ | ------------- |
| `deployment_id` | 是      | string | Deployment ID |

## Query 参数 <span id="h-list-runs-query" />

| **参数**  | **必填** | **类型**  | **说明**              |
| ------- | ------ | ------- | ------------------- |
| `limit` | 否      | integer | 分页大小，最大 100，默认 `20` |
| `page`  | 否      | string  | 分页游标                |

## 请求示例 <span id="h-list-runs-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/deployments/depl_xxx/runs?limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-runs-resp" />

响应包含 `data`（部署执行对象数组）与 `next_page`（下一页游标，无更多数据时为 `null`）。

```json
{
  "data": [
    {
      "id": "drun_xxx",
      "type": "deployment_run",
      "deployment_id": "depl_xxx",
      "agent": {
        "id": "agent_xxx",
        "version": 13
      },
      "session_id": "sesn_xxx",
      "trigger_source": "schedule",
      "status": "succeeded",
      "error": null,
      "started_at": "2026-07-28T01:00:00Z",
      "finished_at": "2026-07-28T01:05:00Z",
      "request_id": "req_xxx"
    }
  ],
  "next_page": null
}
```

### 响应字段 <span id="h-list-runs-dto" />

| **字段**                  | **类型**         | **说明**                                |
| ----------------------- | -------------- | ------------------------------------- |
| `data`                  | array\<object> | 部署执行对象数组                              |
| `data[].id`             | string         | Deployment Run ID                     |
| `data[].type`           | string         | 固定为 `deployment_run`                  |
| `data[].deployment_id`  | string         | 关联 Deployment ID                      |
| `data[].agent`          | object         | 关联 Agent；包含 `id` 和 `version`          |
| `data[].session_id`     | string \       | null                                  | Session ID；异步会话创建完成前为 `null` |
| `data[].trigger_source` | string         | 触发来源：`manual` 或 `schedule`            |
| `data[].status`         | string         | 运行状态：`running`、`succeeded` 或 `failed` |
| `data[].error`          | object \       | null                                  | 错误信息；仅运行失败时返回                |
| `data[].started_at`     | string         | 运行开始时间，ISO 8601                       |
| `data[].finished_at`    | string \       | null                                  | 运行结束时间，ISO 8601；运行中为 `null`  |
| `data[].request_id`     | string         | 请求唯一标识                                |
| `next_page`             | string \       | null                                  | 下一页游标；无更多数据时为 `null`         |

## 错误码 <span id="h-list-runs-err" />

| **状态码** | **错误码**            | **说明**                                 |
| ------- | ------------------ | -------------------------------------- |
| 400     | `InvalidParameter` | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`    | Invalid API-key provided.              |
