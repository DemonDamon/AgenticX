---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/event-list
fetched: 2026-10-23
title: 列出 Event
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Event

> 分页查询会话历史事件，返回结构同 SSE 帧的 data。支持时间窗口过滤与排序。

<meta property="og:title" content="列出 Event" />

## 前提 <span id="h-el-prereq" />

已创建会话，详见[创建 Session](session-create.md)。`{session_id}` 形如 `sesn_xxx...`。

## 接口 <span id="h-el-endpoint" />

<strong>GET</strong> `/sessions/{session_id}/events`

返回结构同 SSE 帧的 `data`。事件信封字段含义详见[订阅 Event SSE 事件流](event-sse-stream.md)中的<strong>事件信封</strong>一节。

## Query 参数 <span id="h-el-q" />

| 参数                                            | 类型     | 默认    | 说明                                                                                   |
| --------------------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------ |
| `types`                                       | string | —     | 按事件类型过滤，可重复传入。如 `?types=message&types=tool_approval_request`。用 `types=error` 补拉运行期错误 |
| `order`                                       | string | `asc` | 排序方向：`asc`（升序） / `desc`（降序）                                                          |
| `created_at[gt]` / `[gte]` / `[lt]` / `[lte]` | string | —     | 按时间窗口过滤，ISO 8601；四个比较运算符可组合                                                          |
| `limit`                                       | int    | 20    | 每页数量，最大 100                                                                          |
| `page`                                        | string | —     | 首次不传，后续传上一次响应的 `next_page`                                                           |

## 请求示例 <span id="h-el-eg" />

<CodeGroup>
  ```bash
  curl "$AGENTSTUDIO_URL/sessions/sesn_xxx/events?order=asc&limit=100" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY"
  ```

  ```python
  for event in client.sessions.events.list(
      "sesn_xxx",
      limit=100,
      order="asc",
  ):
      print(event.type, event.created_at)
  ```

  ```java
  CursorPage<SessionEvent> events = client.sessions().events().list("sesn_xxx",
      SessionEventListParam.builder()
          .limit(100)
          .order("asc")
          .build());
  for (SessionEvent ev : events.getData()) {
      System.out.println("[" + ev.getType() + "] " + ev.getCreatedAt());
  }
  ```
</CodeGroup>

## 响应说明 <span id="h-el-resp" />

返回 `data`（事件 Message 对象数组，结构同 SSE 帧的 `data` 字段，详见[订阅 Event SSE 事件流](event-sse-stream.md)）、`next_page`（下一页游标，无更多数据时不返回或为 `null`）与 `request_id`。`type=error` 为独立分支：错误详情位于 Message 顶层的 `error` 对象（`error.code` / `error.message`），不在 `content[].data` 中。Message 对象字段如下：

### 响应字段 <span id="h-el-dto" />

| 字段                  | 类型             | 说明                                                                                                                                                              |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`              | array\<object> | 事件 Message 对象数组，按 `order` 排序                                                                                                                                    |
| `data[].object`     | string         | 恒为 `message`                                                                                                                                                    |
| `data[].id`         | string         | 事件 ID，前缀 `msg_` 或 `out_`                                                                                                                                        |
| `data[].created_at` | string         | 事件时间戳，ISO 8601                                                                                                                                                  |
| `data[].status`     | string         | 恒为 `completed`                                                                                                                                                  |
| `data[].role`       | string         | `user` / `assistant` / `tool`                                                                                                                                   |
| `data[].type`       | string         | 事件类型，取值同 SSE 服务端推送事件，详见[订阅 Event SSE 事件流](event-sse-stream.md)                                                                                    |
| `data[].content`    | array\<object> | ContentBlock 数组，结构同发送侧                                                                                                                                          |
| `data[].is_error`   | bool           | 仅工具输出事件（`tool_call_output` / `mcp_call_output`）出现，写在 Message 顶层：`true` 表示该次工具执行失败或被中断 / 拒绝；此时 `data` 仍为 ToolCallOutput / McpCallOutput，至少含 `call_id` 与 `output` |
| `data[].metadata`   | object         | 事件附加信息（如 `thread_id`、`call_id` 等）                                                                                                                               |
| `next_page`         | string / null  | 下一页游标；无更多数据时不返回或为 `null`                                                                                                                                        |
| `request_id`        | string         | 本次请求的唯一标识                                                                                                                                                       |
