---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/webhook-list-events
fetched: 2026-10-23
title: 查询指定 Webhook 的事件
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 查询指定 Webhook 的事件

> 按 event_id 倒序返回指定 Webhook 最近 7 天的投递事件，每个事件包含当前 Webhook 的 delivery 信息。没有匹配记录时返回空数组；Webhook 删除后，已有投递事件在 7 天保留期内仍可查询。

<meta property="og:title" content="查询指定 Webhook 的事件" />

## 前提 <span id="h-list-events-prereq" />

已完成 Endpoint 与鉴权配置，详见[API 总览与认证](managed-agents-api-overview.md)。

## 接口 <span id="h-list-events-endpoint" />

<strong>GET</strong> `/webhook_endpoints/{id}/events`

## 路径参数 <span id="h-list-events-path" />

| **参数** | **必填** | **类型** | **说明**                     |
| ------ | ------ | ------ | -------------------------- |
| `id`   | 是      | string | Webhook ID，格式 wep\_\<ULID> |

## Query 参数 <span id="h-list-events-query" />

| **参数**  | **必填** | **类型**  | **说明**                            |
| ------- | ------ | ------- | --------------------------------- |
| `limit` | 否      | integer | 每页数量，默认 20，范围 1～100               |
| `page`  | 否      | string  | 不透明分页游标；首页不传，后续传上一页返回的 next\_page |

## 请求示例 <span id="h-list-events-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/webhook_endpoints/wep_01JXX7YQGPRPV1BZXA35QE7WDP/events?limit=20" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```
</CodeGroup>

## 响应 <span id="h-list-events-resp" />

响应包含 `data`（Webhook对象数组）与 `next_page`（下一页游标，无更多数据时为 `null`）。

```json
{
  "data": [
    {
      "type": "event",
      "id": "whe_01JXX8JY9BBM4BK4C2P7K3M3ZR",
      "created_at": "2026-08-06T10:30:21.123Z",
      "data": {
        "id": "sesn_xxx",
        "type": "session.thread_idled",
        "workspace_id": "ws_xxx",
        "session_thread_id": "sthread_xxx"
      },
      "delivery": {
        "webhook_id": "wep_01JXX7YQGPRPV1BZXA35QE7WDP",
        "status": "SUCCEEDED",
        "attempt_count": 1,
        "delivery_at": "2026-08-06T10:30:21.450Z",
        "finish_at": "2026-08-06T10:30:21.780Z",
        "failure_reason": null
      }
    }
  ],
  "next_page": null,
  "request_id": "8e1d16e4"
}
```

### 响应字段 <span id="h-list-events-dto" />

| **字段**                           | **类型**         | **说明**                                     |
| -------------------------------- | -------------- | ------------------------------------------ |
| `data`                           | array\<object> | 事件对象数组                                     |
| `data[].type`                    | string         | 固定为 `event`                                |
| `data[].id`                      | string         | 事件 ID，格式 whe\_\<ULID>；同一事件的所有投递尝试使用相同外层 id |
| `data[].created_at`              | string         | 事件创建时间，ISO 8601                            |
| `data[].data`                    | object         | 事件载荷                                       |
| `data[].data.id`                 | string         | 资源标识；Thread 事件中为 Session 标识                |
| `data[].data.type`               | string         | 事件类型                                       |
| `data[].data.workspace_id`       | string         | 工作空间 ID                                    |
| `data[].data.session_thread_id`  | string         | Thread 事件中为具体 Thread 标识                    |
| `data[].delivery`                | object         | 当前 Webhook 的投递信息                           |
| `data[].delivery.webhook_id`     | string         | Webhook ID                                 |
| `data[].delivery.status`         | string         | 投递状态，如 `SUCCEEDED`                         |
| `data[].delivery.attempt_count`  | integer        | 投递尝试次数                                     |
| `data[].delivery.delivery_at`    | string         | 投递开始时间，ISO 8601                            |
| `data[].delivery.finish_at`      | string         | 投递完成时间，ISO 8601                            |
| `data[].delivery.failure_reason` | string \       | null                                       | 失败原因；成功时为 `null` |
| `next_page`                      | string \       | null                                       | 下一页游标，末页为 null   |
| `request_id`                     | string         | 本次请求的唯一标识，排查问题时附带                          |

## 错误码 <span id="h-list-events-err" />

| **状态码** | **错误码**    | **说明**                      |
| ------- | ---------- | --------------------------- |
| 400     | `11800016` | invalid webhook event query |
