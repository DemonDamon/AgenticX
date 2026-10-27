---
source: https://docs.bigmodel.cn/cn/managed-agents/events
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 事件与流式输出

事件（Event）是你的应用与会话之间的唯一通信通道：用户消息、Agent 回复、工具调用与结果、状态变化，全部以事件形式流动，并在服务端持久化为事件历史。本页介绍事件类型、三个事件接口的用法，以及自定义工具、审批、打断等进阶场景。

只需在会话空闲、定时任务触发或凭据异常时通知业务系统，可使用 [Webhook 通知](webhooks.md)。Webhook 不传递逐步输出，事件名与本页的 Session 事件流不同。

## 事件类型

### 客户端 → 平台

| 事件 | 说明 |
| - | - |
| **user.message** | 用户消息。content 是非空内容块数组：text / image / document（text 或 file source）。图片支持 base64、url 或 file 来源，格式与限制见[图片输入](#图片输入)。 |
| **user.interrupt** | 请求停止当前工作。平台会主动停止当前模型响应，并向运行中的命令发出停止信号；命令若在宽限期内（当前约 3 秒）没有结束，会被强制终止。可选 reason 字段当前不持久化。 |
| **user.custom\_tool\_result** | 回传自定义工具的执行结果，见下文。 |
| **user.tool\_confirmation** | 批准或拒绝一次 always\_ask 工具调用，见[工具权限](permission-policies.md)。 |

### 图片输入

图片输入需使用账号已开放的视觉模型，例如 **glm-5.3-flash** 或 **glm-5.3-flashx**；纯文本模型会在入队时返回 400。`image` 块必须带 `source`，不能使用 Chat Completions 的 `image_url` 块格式。

| source.type | 必填字段 | 用途 |
| - | - | - |
| `base64` | `media_type`、`data` | 内联标准 Base64 图片；格式为 JPEG、PNG、GIF 或 WebP |
| `file` | `file_id` | 引用通过 [Files API](files.md)上传且当前身份可访问的图片，适合复用 |
| `url` | `url` | 读取公网 HTTPS 图片地址；受账号网络策略限制，须能从平台访问，建议优先上传文件 |

例如，发送已上传的图片：

```json theme={null}
{
  "events": [{
    "type": "user.message",
    "content": [
      {"type": "text", "text": "请解释这张图。"},
      {"type": "image", "source": {"type": "file", "file_id": "file_example"}}
    ]
  }]
}
```

API 每条事件最多 50 张图片，单张解码后最多 50 MiB；1–20 张时，每张宽和高各不超过 8000 px，21–50 张时各不超过 2000 px。图片 Base64 总量最多 112 MiB，带图请求体最多 128 MiB；需要同时满足这些限制。图片无效、不可访问或超限会使整批事件失败，不会部分写入。

**控制台会话输入框仍限制每条消息最多 3 张、每张 5 MiB**，与 API 上限不同。上传文件作为 `image` 来源是给模型读图；挂载为 File Resource 则是给沙箱代码读取，两种方式可按任务分别使用。

`user.custom_tool_result` 同样接受这三种图片来源。新协议下，内置工具和 MCP 工具结果也可包含图片，以有效期 24 小时的 URL 返回；需要长期保留时请及时下载。旧协议的工具结果不返回图片块。

长会话的历史图片仍受单次模型请求预算限制；超出预算时平台保留较新的图片，较早图片会替换为占位文字。需要再次分析历史图片时，应重新提供。

### 平台 → 客户端

| 事件 | 说明 |
| - | - |
| **agent.message** | Agent 的文本回复，content 为内容块数组。本轮不一定有这条事件，结束以 **session.status\_idle** 为准。 |
| **agent.thinking** | 新协议下可带 content 文本块，并可订阅 Thinking delta；旧协议仍是无内容进度信号。 |
| **agent.tool\_use** / **agent.tool\_result** | 内置工具的调用（name、input、evaluated\_permission）与结果（含 is\_error）。 |
| **agent.mcp\_tool\_use** / **agent.mcp\_tool\_result** | MCP 工具的调用与结果，use 额外携带 mcp\_server\_name。 |
| **agent.custom\_tool\_use** | Agent 请求你的应用执行一个自定义工具。 |
| **session.status\_running** | 会话进入执行状态。 |
| **session.status\_idle** | 会话回到空闲。stop\_reason.type ∈ **end\_turn**（本轮结束，也用于中断收尾）/ **requires\_action**（等待你的 resolution，另含 event\_ids）/ **retries\_exhausted**（重试耗尽）/ **refusal**（模型拒答）。是否完成业务任务仍需核对消息、错误与产物。 |
| **session.thread\_status\_running** / **idle** / **rescheduled** / **terminated** | 单个线程的状态变化；idle 带 stop\_reason。Session 状态由所有线程聚合，线程结束不等于整个任务完成。 |
| **session.updated** / **session.deleted** | 会话配置被更新 / 会话被删除（随后服务端关闭事件流）。 |
| **session.error** | 错误通知：`error{type, message, retry_status}`；retry\_status 是包含 type 字段的对象，type 为 retrying、exhausted 或 terminal；MCP 相关错误另含 mcp\_server\_name。 |
| **session.usage** | 会话累计用量快照（input / output / cache\_read token）。 |
| **span.model\_request\_start** / **span.model\_request\_end** | 单次模型请求区间；end 事件含 is\_error 与 model\_usage 用量。 |

每条持久化事件都有全局唯一 **id**。**processed\_at** 在事件被平台处理时写入，不保证唯一。排队中的 **user.message** / **user.interrupt** 在历史接口中可能尚无该字段；公共 SSE 会等平台接手后再推送，并携带 processed\_at。

**event\_start** 与 **event\_delta** 是实时预览帧，没有自身的 id / processed\_at，也不会写入事件历史。

## 集成事件

事件相关的三个接口：

| 接口 | 用途 |
| - | - |
| POST /v1/sessions/:id/events | 发送事件（1–10 条一批，整批原子校验，任一非法则零写入） |
| GET /v1/sessions/:id/events | 列出历史事件（分页、可按 types 与 processed\_at 时间过滤） |
| GET /v1/sessions/:id/events/stream | SSE 实时流（live-only） |

### SSE 实时流

```bash theme={null}
curl -N "$BASE_URL/v1/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

连接语义：

* **live-only**：流只转发连接建立后的实时事件，不回放历史。
* 服务端每 15 秒发送 **: ping** 注释帧保活，客户端应忽略。
* 收到 **session.deleted** 事件后服务端会主动关闭连接。
* 对持久化事件，SSE 与历史接口使用相同的事件类型；同一事件在不同处理阶段的可选字段可能不同。订阅增量预览后，SSE 还会包含历史接口没有的 event\_start / event\_delta。

#### 断线恢复

SSE 不回放历史。断线后先建立新的 SSE 连接并缓存新事件，再从最后一个非空 **processed\_at** 开始补拉历史。使用 **gte** 而不是 gt，避免漏掉时间戳相同的事件；重复事件按 **id** 去重。

```bash theme={null}
# 1. 重新打开实时流
curl -N "$BASE_URL/v1/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"

# 2. 从最后一个非空 processed_at 开始补拉历史
# -g 避免 curl 把查询参数里的方括号当作范围表达式
curl -sS -g "$BASE_URL/v1/sessions/$SESSION_ID/events?order=asc&limit=100&created_at[gte]=$LAST_PROCESSED_AT" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

如果响应的 **next\_page** 非空，将它原样作为下一次请求的 **page**，保持其余过滤条件不变，直到 next\_page 为空。补历史和新流可能重叠：同一 id 只处理一次，但后续补齐的 processed\_at 等字段仍要合并，不能用 null 覆盖已有值。

建立 HTTP 连接不等于服务端订阅已经完成，单次补拉仍可能遇到极短的注册窗口。恢复正在执行的一轮时，应继续用历史接口核对，直到看到 session.status\_idle / session.status\_terminated 等结束状态；不要只依赖新流或单次补拉判断本轮结束。

如果断线前没有可用的 processed\_at，不带时间过滤、按 order=asc 分页回放，再按 id 去重。

### 增量预览（event deltas）

默认情况下，**agent.message** 在内容完整后才作为一条事件下发。若想在 UI 上做逐字流式渲染，用 **event\_deltas** 查询参数订阅增量预览：

```bash theme={null}
curl -N "$BASE_URL/v1/sessions/$SESSION_ID/events/stream?event_deltas[]=agent.message" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

开启后，流上会先出现 **event: event\_start** 帧（`{"type":"event_start","event":{...}}`），随后若干 **event: event\_delta** 帧携带 content\_delta 增量；可订阅 **agent.message** 与 **agent.thinking** 两类。注意：

* 预览帧自身没有 id / processed\_at，**不写入事件历史**；缓冲完成后的完整事件（权威记录）随后照常下发，客户端应以完整事件对齐最终状态。
* **span.model\_request\_end** 会关闭未收敛的预览。
* 本接口的 query 参数白名单只有 event\_deltas（及 beta）；携带其他参数（types、limit 等）返回 400。

### 列出历史事件

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/events?order=asc&limit=100&types=agent.message,agent.tool_use" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22"
```

**limit** 默认 100；**order** 默认 asc；**types** 支持重复参数或逗号分隔，未知类型返回 400。响应的 **next\_page** 非空时，将它作为下一次请求的 **page**，并保持排序与过滤条件不变。

时间过滤参数为 **created\_at\[gt]** / **\[gte]** / **\[lt]** / **\[lte]**，实际比较 processed\_at。gt / lt 不含边界，gte / lte 含边界；尚无处理时间的事件不命中。时间戳不保证唯一，断线补拉使用 gte 并按 id 去重。

## 处理自定义工具调用

Agent 调用自定义工具时的完整回路：

1. 平台派发 **agent.custom\_tool\_use** 事件：含本次调用的 **id**、工具 **name**、按 input\_schema 生成的 **input** 参数对象。
2. 会话进入 **idle**，**session.status\_idle** 的 stop\_reason.type 为 **requires\_action**，event\_ids 列出全部等待中的调用。
3. 你的应用执行工具逻辑。
4. 回发 **user.custom\_tool\_result**：**custom\_tool\_use\_id** 必填（对应调用事件的 id）；**content** 可选（text / image / document，受图片和请求体总量限制）；失败时置 **is\_error: true** 并在 content 中说明错误。省略 content 即空结果，同样合法。
5. 全部等待中的调用被解决后，会话回到 running，Agent 带着结果继续。

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "content-type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.custom_tool_result",
        "custom_tool_use_id": "sevt_ctool_01J...",
        "content": [
          {"type": "text", "text": "{\"temperature\": 22, \"condition\": \"sunny\"}"}
        ]
      }
    ]
  }'
```

### requires\_action 期间的发送约束

* 主线程处于 idle(requires\_action) 时，发送接口只接受 resolution 事件（user.custom\_tool\_result / user.tool\_confirmation）与 user.interrupt；此时发 **user.message** 会整批被拒（400），消息不会排队。要在这个窗口转向，先单独发送 **user.interrupt** 取消等待组，再发送 **user.message** 开始新一轮；把 message 和 interrupt 放在同一批仍然会被整批拒绝。
* resolution 匹配错误分三类：目标 ID 未知 / 跨会话 / 类型不匹配返回 404；目标已被解决或取消返回 409；同一批里两条 resolution 指向同一个等待事件，解析阶段直接 400。任一项失败整批拒绝、零写入。

## 打断与引导

* **running 期间**：可以继续发送 user.message 与 user.interrupt。interrupt 入队后接口立即返回；平台接手后会停止当前模型响应，并向运行中的命令发出停止信号——命令在宽限期内（当前约 3 秒）没有自行结束的，会被强制终止，本轮必然停下。会话在完成收尾前仍为 running，随后以 **session.status\_idle(end\_turn)** 结束本轮。
* **中断在事件流里的样子**：依次是 **user.interrupt**（平台接手后才进入公共 SSE，携带 processed\_at）→ 若中断时模型请求还在途，补一条 `is_error: true` 的 **span.model\_request\_end** 为它收口 → **session.status\_idle(end\_turn)**。中断不产生 session.error，也不计入重试。
* interrupt 之前尚未处理的消息会被跳过，interrupt 之后提交的消息会在下一轮执行。
* **idle(requires\_action) 期间**：发送 user.interrupt 会取消整组等待中的自定义工具调用与审批请求。取消以一组 **session.status\_idle(end\_turn)** 收口，不产生逐条回执；整组作废后，再对原 event\_ids 提交 resolution 会返回 409。取消后接着发送的 user.message 会成为新一轮的输入。
* **idle(end\_turn) 期间**：对已经停下来的会话发送 user.interrupt 不会触发执行，也不会改变会话状态；事件本身仍会记入历史。继续对话直接发送新的 user.message 即可。
* **恢复空闲会话**：对处于 idle(end\_turn) 的会话直接发送新的 user.message 即可继续。对话历史会保留；沙箱文件的跨轮行为见[创建会话](create-session.md#跨轮保留沙箱文件)。

## 会话事件数据加密

创建会话时加上 **x-events-encrypted: true**，业务内容型事件会按你在开放平台登记的密钥加密后再落库。开关只在创建时生效，之后不能改，也不会出现在 Session 响应里。

启用前先到开放平台用户中心提交日志加密密钥：[https://bigmodel.cn/usercenter/safety-mgmt/logkeys](https://bigmodel.cn/usercenter/safety-mgmt/logkeys) 。创建时平台会先探测密钥：没有可用密钥或加密服务不可达，会返回 400，且不会创建会话。

```bash theme={null}
curl -sS "$BASE_URL/v1/sessions" \
  -H "Authorization: Bearer $ZHIPUAI_API_KEY" \
  -H "zai-version: 2026-05-26" \
  -H "zai-beta: managed-agents-2026-09-22" \
  -H "x-events-encrypted: true" \
  -H "content-type: application/json" \
  -d "{\"agent\": \"$AGENT_ID\", \"environment_id\": \"$ENVIRONMENT_ID\"}"
```

取值必须是精确小写的 **true** 或 **false**（省略等于 false）。**True** / **1** / **yes** 都会 400。

### 加密范围

| 分类 | 事件类型 | 落库 |
| - | - | - |
| 用户内容 | user.message、user.tool\_result、user.custom\_tool\_result、user.tool\_confirmation、user.define\_outcome | payload 加密 |
| Agent 内容 | agent.message、agent.thinking、agent.tool\_use / tool\_result、custom / MCP 工具的 use 与 result、thread 消息 | payload 加密 |
| 系统与评测 | system.message、session.updated、span.outcome\_evaluation\_end | payload 加密 |
| 控制与遥测 | user.interrupt、session 状态、thread 状态、模型请求 span、session.error、session.usage | 保持明文，供调度与排障 |

同一会话可以同时有明文控制事件和加密业务事件。Agent 执行时平台会临时解密必要内容——这是降低落库暴露面的静态加密，不是平台自己也解不开的端到端零知识。

### 列表与流里长什么样

加密事件不会回明文 content，而是给一个独立信封。GET /v1/sessions/:id/events 与 SSE 都走同一套形状：

```json theme={null}
{
  "id": "sevt_xxxxxxxxxxxx",
  "type": "user.message",
  "processed_at": "2026-08-05T08:06:00.000Z",
  "encrypted": {
    "version": "v1",
    "salt": "base64-salt",
    "data": "base64-ciphertext"
  }
}
```

用你持有的客户密钥，按 version + salt 解密 data，即可还原原来的 payload。控制类事件仍然是普通 JSON，没有 encrypted 字段。

## 跟踪用量

两个粒度、三处入口：**span.model\_request\_end** 携带单次模型请求的 **model\_usage**；会话累计用量既通过 **session.usage** 事件推送，也可从 GET /v1/sessions/:id 的 **usage** 字段读取（input\_tokens / output\_tokens / cache\_read\_input\_tokens）。

## 调试建议

* UI 状态机以 **session.status\_\*** 事件为权威依据；不要仅凭一条 evaluated\_permission: "ask" 的工具事件就渲染审批 UI，等待 idle(requires\_action) 的 event\_ids 确认。也不要假定每轮结束都有 **agent.message**。
* 排查问题时优先回读事件历史（order=asc），完整的事件序列几乎总能还原现场。
* 长连接注意处理 15 秒 ping 帧与网络中断重连；重连后先补齐缺口再继续消费流。
* JSON 与 SSE 均使用 UTF-8；客户端应显式按 UTF-8 解码。

## 子线程事件与主流

Session events 列表与实时流都是主线程浓缩视图：子线程生命周期、跨线程消息、阻塞审批会同步出现；子线程其他完整工作事件通过 Thread events/stream 读取。

| 事件 | 主要字段与含义 |
| - | - |
| session.thread\_created | session\_thread\_id、agent\_name；新协议另有 workflow\_run\_id:null |
| session.thread\_status\_running / idle / rescheduled / terminated | 当前线程状态；idle 查看 stop\_reason，新协议 stop\_details:null |
| agent.thread\_message\_sent | to\_session\_thread\_id、to\_agent\_name、content；相对当前线程的发送 |
| agent.thread\_message\_received | from\_session\_thread\_id、from\_agent\_name、content；收到任务或报告 |
| agent.thread\_context\_compacted | 线程上下文压缩通知；不是业务任务完成 |

同一消息在主流可能是 sent、在子流是 received。cross-post 的 session\_thread\_id 指明来源线程；from/to 字段标明通信双方。详细 API 和 ID 说明见[会话线程](threads.md)。

子线程等待审批只暂停它自己。tool\_use\_id/custom\_tool\_use\_id 足以让平台路由结果，不要把 user.message 当成 resolution；新协议返回的子线程 resolution 可带 session\_thread\_id。

## Thinking、审批和中断边界

使用新协议并订阅 event\_deltas\[]=agent.thinking 时，可收到思考文本预览；旧协议不下发文本 delta。agent.message 与 agent.thinking 的最终事件用于对齐预览，思考内容并不是用户可执行指令。落库加密包含 Thinking 文本，但实时 SSE 不等于密文历史接口；使用自己的接收端权限保护实时业务内容。

可在 user.interrupt 加 session\_thread\_id 只停目标线程，省略则停止 Session 所有活跃线程。中断返回成功仅代表接纳；等待相应 idle(end\_turn) 确认收尾。正常中断不作为 session.error，且取消不保证撤销已经产生的外部副作用。

## 下一步

> **[工具权限](permission-policies.md)**
>
> 工具审批的完整流程

> **[管理会话](session-operations.md)**
>
> 状态机与运维操作

> **[本页对应 OpenAPI](api-reference.md#sessions)**
>
> Session：发送事件、列出事件、订阅实时事件


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.