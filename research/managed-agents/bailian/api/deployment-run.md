---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/deployment-run
fetched: 2026-10-23
title: 触发 Deployment Run
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 触发 Deployment Run

> 手动触发一次 Deployment 执行。

<meta property="og:title" content="触发 Deployment Run" />

## 前提 <span id="h-run-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-run-endpoint" />

<strong>POST</strong> `/deployments/{deployment_id}/run`

## 路径参数 <span id="h-run-path" />

| **参数**          | **必填** | **类型** | **说明**        |
| --------------- | ------ | ------ | ------------- |
| `deployment_id` | 是      | string | Deployment ID |

## 请求示例 <span id="h-run-eg" />

<CodeGroup>
  ```bash
  curl -X POST "$AGENTSTUDIO_URL/deployments/depl_xxx/run" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-run-resp" />

```json
{
  "id": "drun_xxx",
  "type": "deployment_run",
  "deployment_id": "depl_xxx",
  "agent": {
    "id": "agent_xxx",
    "version": 13
  },
  "session_id": null,
  "trigger_source": "manual",
  "status": "running",
  "error": null,
  "started_at": "2026-07-28T02:00:00Z",
  "finished_at": null,
  "request_id": "req_xxx"
}
```

### 响应字段 <span id="h-run-dto" />

| **字段**           | **类型**         | **说明**                 |
| ---------------- | -------------- | ---------------------- |
| `id`             | string         | Deployment Run ID      |
| `type`           | string         | 固定值 deployment\_run    |
| `deployment_id`  | string         | —                      |
| `agent`          | object         | —                      |
| `session_id`     | string \       | null                   | 异步 Session 创建完成前为 null |
| `trigger_source` | string         | —                      |
| `status`         | string         | —                      |
| `error`          | object \       | null                   | 错误信息，仅运行失败时返回          |
| `started_at`     | string         | ISO 8601 时间戳           |
| `finished_at`    | string \       | null                   | —                      |
| `request_id`     | string         | 本次请求的唯一标识，排查问题时附带      |

## 错误码 <span id="h-run-err" />

| **状态码** | **错误码**                       | **说明**                                 |
| ------- | ----------------------------- | -------------------------------------- |
| 400     | `InvalidParameter`            | Required parameter missing or invalid. |
| 401     | `InvalidApiKey`               | Invalid API-key provided.              |
| 409     | `DEPLOYMENT_TRIGGER_CONFLICT` | Concurrent trigger conflict.           |
