---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-event-stream
fetched: 2026-10-23
title: 会话事件流（SSE）
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 会话事件流（SSE）

> 会话内的全部交互以事件形式记录。通过 API 订阅时以 SSE（Server-Sent Events）事件流推送。

<meta property="og:title" content="会话事件流（SSE）" />

## 服务端推送事件 <span id="h-server-events" />

智能体处理消息过程中，服务端按以下类型推送事件：

| **type**                         | **说明**                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message`                        | 助手输出消息                                                                                                                                                                                                                                                             |
| `tool_call` / `tool_call_output` | 内置工具调用请求与执行结果                                                                                                                                                                                                                                                      |
| `mcp_call` / `mcp_call_output`   | MCP 工具调用请求与执行结果                                                                                                                                                                                                                                                    |
| `tool_approval_request`          | 工具审批请求。当工具需要审批时单独发送一次，`data` 携带 `batch_id`、`call_id`、`name`、`arguments`、`tool_type`（`builtin` 或 `mcp`，MCP 额外含 `server_label`）。是否需要审批以本事件为准                                                                                                                         |
| `tool_approval_response`         | **该事件是双向的**：既可由客户端上行提交裁决，也可由服务端下行补发。当会话处于 `requires_action` 时若发送纯 `interrupt`，服务端会为当前批次内所有尚未执行的调用（含已裁决但因批次未收齐而未执行的调用）补发一条 `role=user`、`type=tool_approval_response`、`result=deny` 的下行事件，并伴随对应的 `tool_call_output` / `mcp_call_output`（`is_error=true`），用于把审批卡片置为终态 |
| `session_status`                 | 会话状态变更，携带 `stop_reason`（详见 [管理会话](managed-agents-session-operations.md)）                                                                                                                                                                             |
| `error`                          | 运行期错误。错误详情位于 Message 顶层的 `error` 对象中，通过 `error.code` 和 `error.message` 读取；不在 `content[].data` 中。例如 `pending_tool_approval_unresolved`、`invalid_tool_approval`。此类错误不是 `POST /sessions/{session_id}/events` 的同步 4xx 响应，需要通过事件流或 `GET /events?types=error` 获取         |

## 客户端发送事件 <span id="h-client-events" />

通过 **POST** `/sessions/{session_id}/events` 向会话写入事件。

| **type**                 | **说明**                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `message`                | 发送消息，触发智能体进入 `running`                                                                                       |
| `tool_approval_response` | 回应审批：收到 `tool_approval_request` 后，用 `batch_id` + `call_id` 引用该次调用并给出裁决（`allow` / `deny`）。该类型同时也是服务端下行事件（见上表） |
| `interrupt`              | 中断当前处理；用于结束当前整批待审批调用。在 `requires_action` 下发送纯 `interrupt` 会触发服务端为批次内尚未执行的调用（含已裁决未执行项）补发 `deny`（见 工具审批）       |

发送 `message` 事件触发智能体处理。完整参数详见[发送 Event API](api/event-post.md)。

<CodeGroup>
  ```bash
  curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events" \
    -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "input": [
        {
          "role": "user",
          "type": "message",
          "content": [
            {"type": "text", "text": "分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势"}
          ]
        }
      ]
    }'
  ```

  ```python
  client.sessions.events.send(
      "sesn_xxx",
      events=[user_message("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")],
  )
  ```

  ```java
  client.sessions().events().send("sesn_xxx",
      Collections.singletonList(
          ClientEvents.userMessage("分析 /mnt/session/uploads/sales.csv 中 Q3 的销售趋势")));
  ```
</CodeGroup>

## SSE 订阅 <span id="h-sse" />

发送事件与订阅事件流是**两个独立接口**：`POST /sessions/{session_id}/events` 仅受理输入，事件入队后即返回；`GET /sessions/{session_id}/events/stream` 才是 SSE 接口。给 `POST` 加 `Accept: text/event-stream` **不会**把它变成长连接——SSE 始终是下面这条 `GET` 请求。

这个顺序会直接影响审批链路：`tool_call` 的审批请求只在产生时发送一次。若先 `POST` 消息、再建立事件流，快速任务可能在订阅建立前就已挂起，客户端会错过该请求。推荐时序为：

1. 先用一条连接通过 `GET /events/stream` 建立 SSE 事件流。
2. 再用另一条连接 `POST` 用户事件。
3. 若断线或错过事件，先 `GET /sessions/{session_id}` 读取 `stop_reason.pending_batch_id` 与 `pending_call_ids`，再以 `GET /events?types=tool_approval_request&order=desc` **倒序**拉取事件；客户端按 `batch_id` 过滤并以 `call_id` 对齐，凑齐 `pending_call_ids` 后即可停止，据此还原审批卡片。第一页未凑齐时，读取响应中的 `next_page`；其非空时，将该值按不透明字符串进行 URL 编码，并作为下一次请求的 `page=<next_page>` 参数，同时保持相同的 `types=tool_approval_request`、`order=desc` 和 `limit`——Event List 默认 `order=asc`、每页 20 条，不倒序、不翻页时历史较长会永远读不到当前批次。是否需要审批以 `stop_reason` 为准：只要 Session 仍返回 `requires_action`，就表示存在待裁决调用。刚发生状态变化时，若 Session 快照或过滤后的事件列表仍未反映最新状态（刚产生的事件可能有短暂延迟），应在有限窗口内重试拉取，**不要**把一次空结果当作"无需审批"。

**恢复示例（历史超过一页）**：会话历史已有 30 条 `tool_approval_request`，Session 返回 `pending_batch_id=response_xxx:9f2c...`、`pending_call_ids=["call_3"]`。倒序拉取：

```bash
curl "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events?types=tool_approval_request&order=desc&limit=20" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

最新事件先出现；按 `batch_id=response_xxx:9f2c...` 过滤、以 `call_id` 对齐，凑齐 `pending_call_ids` 即完成还原。第一页未凑齐时，读取响应中的 `next_page`，URL 编码后作为 `page` 参数请求第二页：

```bash
curl "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events?types=tool_approval_request&order=desc&limit=20&page={URL-encoded-next_page}" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

详见 [Event List API](api/event-list.md)。

建立事件流：

```bash
curl -N "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Accept: text/event-stream"
```

事件以 `data: <JSON>` 行推送。一次需要审批的调用，流中依次出现 `tool_call`、`tool_approval_request`、`session_status`（`idle` + `requires_action`）三帧：

```text
event: message
data: {"type":"tool_call","role":"assistant","content":[{"type":"data","data":{"call_id":"call_xxx","name":"bash","arguments":"{\"command\": \"ls /workspace\"}"}}]}

event: message
data: {"type":"tool_approval_request","role":"assistant","content":[{"type":"data","data":{"batch_id":"response_xxx:9f2c...","call_id":"call_xxx","name":"bash","arguments":"{\"command\": \"ls /workspace\"}","tool_type":"builtin"}}]}

event: message
data: {"type":"session_status","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"requires_action","pending_batch_id":"response_xxx:9f2c...","pending_call_ids":["call_xxx"]}}}]}
```

处理要点：

- **审批卡片来自 `tool_approval_request`**，其 `data.batch_id` + `data.call_id` 共同标识一次审批。请以该事件为准归拢待审批调用，不要从历史 `tool_call` 或请求 / 响应的数量反推。
- **当前待裁决项以 `session_status` 的 `stop_reason.pending_call_ids` 为准**。逐条裁决后状态仍为 `requires_action`，`pending_call_ids` 仅缩减为剩余项，直到全部裁决收齐后这些待审批（`always_ask`）工具才执行、模型才恢复（`always_allow` 工具不受此屏障约束，见下方「批量与逐条裁决」）。
- `session_status` 为 `terminated` 时结束；`stop_reason` 为 `end_turn` / `retries_exhausted` 时本轮真正结束。

<Warning>
  `POST /events` 是异步接口，HTTP 200 只表示事件已入队受理，**不代表** agent 已开始处理或裁决已生效。下列错误都是本次运行随后产生的**事件/终态**（`type=error`），而非本次 POST 的同步 4xx，需通过 SSE 事件流或 `GET /events?types=error` 观察。

  存在待审批调用（`requires_action`）时，两类混合输入按**不同错误码**收口，裁决均不消费、`pending_call_ids` 保持不变：

  - **单独发送普通 `message`**，或**同批发送 `message` + `tool_approval_response`**：先被受理为 200，随后本次运行以 `pending_tool_approval_unresolved` 反馈——当前批次审批仍未收齐。
  - **同批发送 `interrupt` + `tool_approval_response`**：因**控制消息冲突**被拒，错误码为 `invalid_tool_approval`；本次裁决不生效，当前批次仍存在，`pending_call_ids` 不变。
  - **允许的组合**：`interrupt` + 普通 `message` 可在同一请求中混发，语义为先结束当前审批批次、再开始聊天。

  同一请求内的多条 `tool_approval_response` 必须属于同一个 `batch_id`。因此看到 `requires_action` 后，请先完成当前批次审批（`tool_approval_response`），或单独发送 `interrupt` 结束整批（不要与 `tool_approval_response` 同发），再继续聊天。
</Warning>

**契约用例一（`message` + `tool_approval_response` → `pending_tool_approval_unresolved`）**——在 `pending_call_ids` 为 `["call_xxx"]` 时混在同一次 POST：

```json
{
  "input": [
    {"role": "user", "type": "tool_approval_response", "content": [
      {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_xxx", "result": "allow"}}
    ]},
    {"role": "user", "type": "message", "content": [
      {"type": "text", "text": "顺便再帮我看下日志"}
    ]}
  ]
}
```

裁决不消费，随后本次运行以 `pending_tool_approval_unresolved` 反馈，`GET /sessions/{session_id}` 仍返回 `requires_action` 且 `pending_call_ids` 仍为 `["call_xxx"]`（与提交前一致）。

**契约用例二（`interrupt` + `tool_approval_response` → `invalid_tool_approval`）**——在 `pending_call_ids` 为 `["call_xxx"]` 时混在同一次 POST：

```json
{
  "input": [
    {"role": "user", "type": "interrupt"},
    {"role": "user", "type": "tool_approval_response", "content": [
      {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_xxx", "result": "allow"}}
    ]}
  ]
}
```

因控制消息冲突被拒，错误码为 `invalid_tool_approval`；本次裁决不生效，`GET /sessions/{session_id}` 仍返回 `requires_action` 且 `pending_call_ids` 仍为 `["call_xxx"]`。

## Delta 增量流 <span id="h-delta" />

默认每个事件在生成完成后作为一帧完整 Message（`status: "completed"`）下发。如需让文本类事件（`message`、`reasoning`）在生成过程中逐块推送，可在订阅时通过 `event_deltas[]` 查询参数为指定类型开启增量流：

```bash
curl -N --no-buffer --get \
  "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  --data-urlencode 'event_deltas[]=message' \
  --data-urlencode 'event_deltas[]=reasoning'
```

开启后，被声明类型的事件先下发一帧 `type=event_start`（`event.id` 即最终完整 Message 的 `id`），随后按生成顺序下发若干 `type=event_delta` 增量帧（`delta.content` 为新增的 ContentBlock 片段），最后下发聚合后的完整 Message（`status: "completed"`）。客户端按 `event_id` + `delta.index` 顺序累加各增量片段，完整 Message 可用于校验。未声明的事件类型仍按单帧完整 Message 下发。完整帧结构与示例流见 [会话事件流（SSE）API](api/event-sse-stream.md)。

## 工具审批

当某个工具被设为**每次询问**（见 [Agent 工具配置](managed-agents-builtin-tools.md)）时，智能体调用它会先暂停等待确认。此时你会收到一个 `tool_approval_request` 事件——是否需要审批以该事件为准，而非从 `tool_call` 的 `metadata` 推断。客户端需向会话发送一个 `tool_approval_response` 事件，用 `batch_id` + `call_id` 引用该次调用并给出裁决。

一个 `tool_approval_request` 事件示例（SSE `data:` 帧内的 JSON）：

```json
{
  "object": "message",
  "type": "tool_approval_request",
  "id": "msg_approval_xxx",
  "role": "assistant",
  "status": "completed",
  "content": [
    {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_xxx", "name": "bash", "arguments": "{\"command\": \"rm -rf /tmp/cache\"}", "tool_type": "builtin"}}
  ]
}
```

`data` 字段说明：

| 字段          | 类型     | 说明                                         |
| ----------- | ------ | ------------------------------------------ |
| `batch_id`  | string | 本次审批所属批次；同一轮多个待审批调用共享同一 `batch_id`         |
| `call_id`   | string | 待审批的工具调用 ID                                |
| `name`      | string | 工具名                                        |
| `arguments` | string | 冻结后的调用参数（JSON 字符串）                         |
| `tool_type` | string | `builtin` 或 `mcp`；MCP 类型额外含 `server_label` |

回应审批时，发送 `tool_approval_response`，其 `data` 字段为：

| 字段             | 类型     | 必填 | 说明                                                                             |
| -------------- | ------ | -- | ------------------------------------------------------------------------------ |
| `batch_id`     | string | 是  | 对应 `tool_approval_request` 的 `batch_id`；与 `call_id` 共同标识一次审批，不能只按 `call_id` 匹配 |
| `call_id`      | string | 是  | 待裁决的工具调用 ID                                                                    |
| `result`       | string | 是  | 裁决结果，`allow`（批准执行）或 `deny`（拒绝执行）                                               |
| `deny_message` | string | 否  | 仅在 `result` 为 `deny` 时使用，作为工具输出回传给模型                                           |

**批准执行：**

```bash
curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {
        "role": "user",
        "type": "tool_approval_response",
        "content": [
          {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_xxx", "result": "allow"}}
        ]
      }
    ]
  }'
```

**拒绝执行：**

```bash
curl -X POST "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio/sessions/sesn_xxx/events" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [
      {
        "role": "user",
        "type": "tool_approval_response",
        "content": [
          {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_xxx", "result": "deny", "deny_message": "该操作未获授权"}}
        ]
      }
    ]
  }'
```

**批量与逐条裁决**：同一批多个调用共享一个 `batch_id`，可在一次 POST 中提交多条 `tool_approval_response`，也可分多次提交。

审批屏障**只覆盖 `always_ask` 集合**，不是整轮工具的事务边界，请勿把审批当作整轮工具的原子屏障：

- `always_allow` 调用**正常执行、不受审批阻塞**——即使模型输出顺序里 `always_ask` 排在前面，`always_allow` 调用也可能在审批完成前就已先行执行。
- `always_ask` 调用在本批**全部裁决收齐前均不执行**，会话也不会继续生成后续回复。
- 全部每次询问（`always_ask`）调用的裁决收齐后，仅在这些调用之间按其原始调用顺序处理：`allow` 执行，`deny` 不执行并返回 `is_error` 为 `true` 的配对工具输出（`tool_call_output` 或 `mcp_call_output`），`deny_message` 作为错误内容回传给模型，智能体随后继续处理。

**时序示例（同一轮：1 个自动允许调用 + 2 个每次询问调用）**。模型按 `call_1`（`always_ask`）、`call_2`（`always_allow`）、`call_3`（`always_ask`）的顺序输出三个工具调用：

- `call_2`（自动允许）不受屏障阻塞，可能在 `call_1` / `call_3` 的审批尚未收齐时就先执行完毕。
- `call_1`、`call_3` 进入待审批，`pending_call_ids` 为 `["call_1","call_3"]`；二者**全部**裁决收齐前都不执行。
- 收齐后仅在这两个每次询问调用之间按原始顺序处理：先 `call_1`、后 `call_3`，各自按 `allow`/`deny` 执行，随后智能体继续处理。

常见错误码：

| 错误码                                 | 触发条件                                                                                                  | 裁决是否消费                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pending_tool_approval_unresolved`  | 待审批期间**单独发送普通 `message`**，或**同批发送 `message` + `tool_approval_response`**；作为随后产生的 `type=error` 事件/终态反馈 | 不消费，`pending_call_ids` 不变                                                                                       |
| `invalid_tool_approval`             | **同批发送 `interrupt` + `tool_approval_response`** 等控制消息冲突；或本次提交没有命中当前批次中的任何调用、报文本身或批次组合非法。幂等语义见下方说明     | 本次提交不产生新的生效裁决。若当前批次仍存在，`pending_call_ids` 不变；若批次已结束、过期或不存在，后续状态可能不再包含待审批项，以最新 `session_status` 或 Session 查询结果为准 |
| `tool_approval_service_unavailable` | 审批服务暂不可用，相关工具不会执行                                                                                     | —                                                                                                               |
| `malformed_model_tool_call`         | 工具调用标识无效，相关工具不会执行                                                                                     | —                                                                                                               |

`invalid_tool_approval` 的幂等语义（可安全重试的关键）：

- **首次裁决生效**：审批身份是复合身份 `(batch_id, call_id)`，`call_id` 只在批次内唯一。同一 `batch_id` 内，同一 `(batch_id, call_id)` 的裁决以**首次到达**的为准，之后针对同一 `(batch_id, call_id)` 的裁决不会覆盖它——重复提交、超时重试都不会回滚已生效的决定。不得按 `call_id` 做会话级去重：不同批次可合法复用同一 `call_id`。
- **部分命中**：同一个正确 `batch_id` 内，若一次提交同时包含有效 `call_id`（待裁决）与未知或已裁决的 `call_id`，**有效项仍会生效**，本次不返回 `invalid_tool_approval`。其中已裁决项只要仍属于当前批次，就是**幂等接受**（保持首次生效的决定，不算落空）；仅未知项（不属于当前批次的 `call_id`）按落空忽略。
- **收口条件**：仅当本次非空提交**全部落空**（没有命中当前批次中的任何调用：批次已结束或不存在、`batch_id` 不匹配，或 `call_id` 全部不属于当前批次；当前批次内已裁决项的重复提交按幂等接受，不算落空），或报文本身非法、批次组合非法时，才以 `invalid_tool_approval` 收口。
- **对工具执行状态不可据此判断**：收到 `invalid_tool_approval` 不能判断更早请求或工具的执行状态——它**既不能**证明更早的工具没有执行，**也不能**证明其已经开始或完成。客户端**不得**把该错误当作工具完成信号，也不得据此撤销任何已生效的裁决；工具结果以配对的 `tool_call_output` / `mcp_call_output`（顶层 `is_error`）为准。

**契约用例（跨批复用相同 `call_id`）**：第一批（`batch_id` 为 `response_a:1f2e...`）与第二批（`batch_id` 为 `response_b:3c4d...`）都包含 `call_id` 为 `call_xxx` 的待审批调用。第一批全部裁决生效后，第二批的 `(response_b:3c4d..., call_xxx)` 仍可正常提交裁决并生效——首次裁决生效仅限同一 `(batch_id, call_id)`，不会因 `call_id` 相同而被当作重复裁决忽略。

**重试同一裁决**：只要审批批次仍存在，对同一 `(batch_id, call_id)` 重复或反向提交裁决时，首次生效的决定保持不变，本次提交按幂等处理，不返回 `invalid_tool_approval`；如果同一请求还包含待裁决的有效项，继续应用这些有效项。仅当本次非空提交没有命中当前批次中的任何调用（例如批次已结束或不存在、`batch_id` 不匹配，或全部 `call_id` 都不属于当前批次）时，才返回 `invalid_tool_approval`。该错误不能用于判断更早请求或工具的执行状态；工具结果以配对的 `tool_call_output` / `mcp_call_output` 为准。

**示例：待裁决项 + 已裁决项混合**。当前 `pending_call_ids` 为 `["call_b"]`（`call_a` 早前已裁决），一次 POST 提交同时带上二者。一条 `tool_approval_response` 只能含**一个** data 块（`maxItems: 1`），批量裁决须用**多条独立事件**：

```json
{
  "input": [
    {"role": "user", "type": "tool_approval_response", "content": [
      {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_a", "result": "allow"}}
    ]},
    {"role": "user", "type": "tool_approval_response", "content": [
      {"type": "data", "data": {"batch_id": "response_xxx:9f2c...", "call_id": "call_b", "result": "deny", "deny_message": "未授权"}}
    ]}
  ]
}
```

该请求通过 OpenAPI 校验（两条事件各含单个 data 块）。有效项 `call_b` 的 `deny` **生效**；`call_a` 早前已裁决且仍属于当前批次，按**幂等接受**（保持首次决定），本次**不返回** `invalid_tool_approval`。裁决收齐后 `call_b` 按 `deny` 处理，`pending_call_ids` 清空。一条响应只能有一个 data 块；批量裁决请用多条事件。

### interrupt 后的服务端下行事件

在 `requires_action` 下发送纯 `interrupt` 时，服务端会为当前批次内所有尚未执行的调用补发中断终态，包括此前已经裁决、但因批次尚未收齐而未执行的调用；每个调用都会收到一条下行 `tool_approval_response`（`role=user`、`result=deny`）及对应的 `tool_call_output` / `mcp_call_output`（`is_error=true`）。客户端据此把对应审批卡片置为终态。严格解析器应识别下行 `tool_approval_response`，否则会丢事件、卡片可能一直显示待确认。

**契约用例（部分裁决后中断）**：同批有 `call_1`、`call_2` 两个待审批调用，先提交 `call_1` 的 `allow`（`call_2` 仍待裁决），再发送纯 `interrupt`。由于批次尚未收齐，`call_1` 虽已裁决但尚未执行；服务端会为 `call_1`、`call_2` **两者**补发中断终态——各自收到一条下行 `tool_approval_response`（`result=deny`）与配对工具输出（`is_error=true`）。客户端应把 `call_1` 的审批卡片也置为终态，不得保留为"已批准将执行"。

下行 `tool_approval_response` 的 `data` 含 `deny_message`，工具输出事件的 `is_error` 写在 **Message 顶层**（不是 `content[].data` 里）、`data` 为 `ToolCallOutput` / `McpCallOutput`（至少含 `call_id` 与 `output`）。用户中断时，服务端用固定文案 `The tool call has been interrupted by the user.` **同时**写入下行审批响应的 `deny_message` 与配对工具输出的 `output`。据此还原时应读取顶层 `is_error` 判断成败、读取 `data.output` 取中断输出。

假设 `pending_call_ids` 为 `["call_xxx"]`（内置工具），发送 `{"input":[{"role":"user","type":"interrupt"}]}` 后，流中出现（真实中断序列）：

```text
event: message
data: {"type":"tool_approval_response","role":"user","content":[{"type":"data","data":{"batch_id":"response_xxx:9f2c...","call_id":"call_xxx","result":"deny","deny_message":"The tool call has been interrupted by the user."}}]}

event: message
data: {"type":"tool_call_output","role":"tool","is_error":true,"content":[{"type":"data","data":{"call_id":"call_xxx","output":"The tool call has been interrupted by the user."}}]}

event: message
data: {"type":"session_status","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"end_turn"}}}]}
```

若待裁决的是 MCP 工具（`pending_call_ids` 为 `["mcp_call_xxx"]`），中断后的工具输出帧改用 `mcp_call_output`，结构相同（顶层 `is_error`，`data` 含 `call_id` 与 `output`），文案一致：

```text
event: message
data: {"type":"tool_approval_response","role":"user","content":[{"type":"data","data":{"batch_id":"response_xxx:9f2c...","call_id":"mcp_call_xxx","result":"deny","deny_message":"The tool call has been interrupted by the user."}}]}

event: message
data: {"type":"mcp_call_output","role":"tool","is_error":true,"content":[{"type":"data","data":{"call_id":"mcp_call_xxx","output":"The tool call has been interrupted by the user."}}]}

event: message
data: {"type":"session_status","content":[{"type":"data","data":{"session_status":"idle","stop_reason":{"type":"end_turn"}}}]}
```

<Warning>
  这种请求 / 响应配对**仅用于展示与审计，是尽力而为的**。待审批集合始终以 Session 的 `pending_call_ids` 为准，**不得**按历史 `tool_approval_request` 与 `tool_approval_response` 的数量相减来推算剩余待裁决项。
</Warning>

<Note>
  工具审批仅支持主智能体，不支持在子智能体中使用。
</Note>

## 事件筛选 <span id="h-filter" />

控制台事件面板左上角下拉框可按类型筛选事件，支持以下筛选项：All events、User、Agent、Tool、Tool\_output、Error、Model、System。

## 下一步

- [管理会话](managed-agents-session-operations.md)：了解状态机与工具调用流程。
- [事件流 (SSE) API](api/event-sse-stream.md)：SSE 事件流 API 详细说明。
