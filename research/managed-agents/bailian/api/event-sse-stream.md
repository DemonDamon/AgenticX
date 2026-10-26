---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/event-sse-stream
fetched: 2026-10-23
title: 订阅 Event SSE 事件流
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 订阅 Event SSE 事件流

> 通过 SSE 实时订阅会话事件流：助手输出消息、工具调用、状态变更。连接建立后服务端立即下发 : connected 注释行。

<meta property="og:title" content="订阅 Event SSE 事件流" />

## 前提 <span id="h-es-prereq" />

已创建会话，详见[创建 Session](session-create.md)。`{session_id}` 形如 `sesn_xxx...`。

## 接口 <span id="h-es-endpoint" />

<strong>GET</strong> `/sessions/{session_id}/events/stream`

请求需带 `Accept: text/event-stream`。连接建立后服务端立即下发 `: connected` 注释行，随后实时推送会话事件。

## 事件信封 <span id="h-es-envelope" />

`data` 字段是 Message 对象，公共字段如下：

| 字段           | 类型     | 说明                                                                                         |
| ------------ | ------ | ------------------------------------------------------------------------------------------ |
| `object`     | string | 恒为 `message`                                                                               |
| `id`         | string | 事件 ID（前缀 `msg_` 或 `out_`）。客户端用此 ID 在业务层去重                                                  |
| `created_at` | string | ISO 8601 时间戳                                                                               |
| `role`       | string | `user` / `assistant` / `tool`                                                              |
| `type`       | string | 事件类型，见下表                                                                                   |
| `status`     | string | 固定为 `completed`                                                                            |
| `content`    | array  | ContentBlock 数组，结构同发送侧                                                                     |
| `is_error`   | bool   | 仅工具输出事件（`tool_call_output` / `mcp_call_output`）出现，写在 Message 顶层：`true` 表示该次工具执行失败或被中断 / 拒绝 |
| `metadata`   | object | 事件附加信息（如 thread\_id、call\_id 等）                                                            |

## 服务端推送事件类型 <span id="h-es-server-types" />

| type                     | 含义                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `message`                | 助手输出消息，可流式分块                                                                                     |
| `tool_call`              | 内置工具调用请求                                                                                         |
| `tool_call_output`       | 内置工具执行结果                                                                                         |
| `tool_approval_request`  | 工具审批请求，当工具需要审批时单独发送一次，`data` 携带 `batch_id`、`call_id`、`name`、`arguments`、`tool_type`。是否需要审批以本事件为准 |
| `tool_approval_response` | 工具审批裁决。客户端上行提交裁决，服务端也会下行补发                                                                       |
| `function_call`          | 自托管函数调用请求，需客户端回填 `function_call_output`                                                          |
| `function_call_output`   | 服务端确认收到的函数结果回显                                                                                   |
| `mcp_call`               | MCP 工具调用请求                                                                                       |
| `mcp_call_output`        | MCP 工具执行结果                                                                                       |
| `session_status`         | 会话状态变更（含 `stop_reason`，见下文）                                                                      |
| `error`                  | 运行期错误事件。错误详情位于 Message 顶层的 `error` 对象（`error.code` / `error.message`），不在 `content[].data` 中      |

## `session_status` 与 `stop_reason` <span id="h-es-status-stop" />

`data.content[0].data` 携带具体状态：

```json
{
  "object": "message",
  "type": "session_status",
  "content": [{
    "type": "data",
    "data": {
      "session_status": "idle",
      "stop_reason": {"type": "end_turn"}
    }
  }]
}
```

- `session_status`：`running` / `idle` / `terminated`
- `stop_reason` 仅在状态切到 `idle` 时出现，三种取值：

  - `{"type": "end_turn"}`：本轮正常结束
  - `{"type": "requires_action", "pending_batch_id": "...", "pending_call_ids": [...]}`：等待客户端响应（如审批工具调用、回填函数结果），`pending_call_ids` 列出待裁决的工具调用
  - `{"type": "retries_exhausted"}`：重试已耗尽，本轮失败

## 订阅示例 <span id="h-es-eg" />

<CodeGroup>
  ```bash
  curl -N "$AGENTSTUDIO_URL/sessions/sesn_xxx/events/stream" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Accept: text/event-stream"
  ```

  ```python
  with client.sessions.events.stream("sesn_xxx", timeout=120.0) as stream:
      for event in stream:
          if event.type == "message":
              for block in (event.content or []):
                  if getattr(block, "type", None) == "text":
                      print(block.text, end="", flush=True)
          elif event.type == "session_status":
              if event.session_status in ("idle", "terminated"):
                  break
  ```

  ```java
  try (AgentStudioEventStream stream = client.sessions().events().stream("sesn_xxx", 120_000L)) {
      for (Message event : stream) {
          if ("message".equals(event.getType()) && event.getContent() != null) {
              for (ContentBlock block : event.getContent()) {
                  if (block instanceof ContentBlock.Text)
                      System.out.print(((ContentBlock.Text) block).getText());
              }
          } else if ("session_status".equals(event.getType())) {
              break;
          }
      }
  }
  ```
</CodeGroup>

响应（节选）：

```text
: connected

event: message
data: {"object":"message","id":"msg_001","created_at":"2025-10-24T08:15:30.500Z","role":"assistant","type":"message","status":"completed","content":[{"type":"text","text":"开始分析"}]}

event: message
data: {"object":"message","id":"out_8f2a","created_at":"2025-10-24T08:15:32.100Z","role":"assistant","type":"tool_call","status":"completed","content":[{"type":"data","data":{"name":"bash","arguments":{"command":"head -5 /mnt/session/uploads/sales.csv"},"call_id":"call_xxx"}}]}

:keepalive

event: message
data: {"object":"message","id":"msg_002","created_at":"2025-10-24T08:15:35.800Z","role":"assistant","type":"session_status","status":"completed","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"end_turn"}}}]}
```

## Delta 增量流 <span id="h-es-delta" />

默认情况下，每个事件仅在生成完成后下发一帧完整 Message（`status: "completed"`）。若希望文本类事件（如 `message`、`reasoning`）在生成过程中流式逐块推送，可在请求时用 `event_deltas[]` 查询参数为指定事件类型开启增量流。该参数可重复传入以声明多个类型；未声明的事件类型仍按单帧完整 Message 下发。

```bash
curl -N --no-buffer --get "$AGENTSTUDIO_URL/sessions/sesn_xxx/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Accept: text/event-stream" \
  --data-urlencode 'event_deltas[]=message' \
  --data-urlencode 'event_deltas[]=reasoning'
```

开启后，被声明类型的事件按以下顺序推送三类帧，客户端按 `event_id` 归并到同一事件：

| 帧 `type`                | 说明                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `event_start`           | 事件开始帧，`event.id` 即该事件最终完整 Message 的 `id`，`event.type` 为事件类型（`message` / `reasoning`）；该帧自身不含 `object` / `content` |
| `event_delta`           | 增量帧，`event_id` 对应 `event_start` 的 `event.id`；`delta.content` 为本次新增的 ContentBlock 片段，`delta.index` 为内容块序号         |
| `message` / `reasoning` | 事件结束时下发的完整 Message（`object: "message"`、`status: "completed"`），`content` 为聚合后的完整内容，与未开启增量时一致                      |

`event_delta` 帧字段：

| 字段              | 说明                                                                         |
| --------------- | -------------------------------------------------------------------------- |
| `type`          | 恒为 `event_delta`                                                           |
| `event_id`      | 所属事件 ID，等于 `event_start` 的 `event.id`，也等于最终完整 Message 的 `id`；用于将增量帧归并到对应事件 |
| `delta.type`    | 恒为 `content_delta`                                                         |
| `delta.index`   | 内容块在 `content` 数组中的序号                                                      |
| `delta.content` | 本次新增的 ContentBlock 片段，如 `{"type":"text","text":"…"}`                       |

示例流（`reasoning` 与 `message` 均开启增量）：

```text
: connected

event: message
data: {"object":"message","status":"completed","id":"sevt_status_running_xxx","type":"session_status","content":[{"type":"data","data":{"session_status":"running"}}]}

event: message
data: {"type":"event_start","event":{"id":"msg_reasoning_xxx","type":"reasoning"}}

event: message
data: {"object":"message","status":"completed","id":"msg_reasoning_xxx","role":"assistant","type":"reasoning"}

event: message
data: {"type":"event_start","event":{"id":"msg_answer_xxx","type":"message"}}

event: message
data: {"type":"event_delta","event_id":"msg_answer_xxx","delta":{"type":"content_delta","index":0,"content":{"type":"text","text":"快速"}}}

event: message
data: {"type":"event_delta","event_id":"msg_answer_xxx","delta":{"type":"content_delta","index":0,"content":{"type":"text","text":"排序是一种分治算法。"}}}

event: message
data: {"object":"message","status":"completed","id":"msg_answer_xxx","role":"assistant","type":"message","content":[{"type":"text","text":"快速排序是一种分治算法。"}]}

event: message
data: {"object":"message","status":"completed","id":"sevt_status_idle_xxx","type":"session_status","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"end_turn"}}}]}
```

<Note>拼接文本时按 `event_id` + `delta.index` 顺序累加各 `event_delta` 的 `delta.content`；事件结束时下发的完整 Message 携带聚合后的完整内容，可用于校验。`reasoning` 事件可能只有 `event_start` 与完整 Message、不含 `event_delta`（思考预览不携带思考文本）。</Note>
