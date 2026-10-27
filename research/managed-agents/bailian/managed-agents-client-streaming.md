---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-client-streaming
fetched: 2026-10-23
title: 进阶：构建对话客户端
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：构建对话客户端

> 把 Managed Agents 接入网页或移动端产品：SSE 增量拼接、思考与回合状态处理、断线恢复不重复提交，以及会话内动态挂载与撤下附件。

<meta property="og:title" content="进阶：构建对话客户端" />

## 概述 <span id="h-cs-intro" />

本篇讲把 Managed Agents 接入已有网页或移动端产品的客户端工程：提交问题后逐步呈现答案，在一个对话里追加或撤下文件，断线后恢复而不重复执行任务。示例统一用 REST/curl。

## 场景：产品里的对话该怎么呈现 <span id="h-cs-scenario" />

产品已有自己的对话界面，现在把 Managed Agents 作为回答引擎接进去。三个体验要求决定了客户端协议怎么设计：

- 答案要**逐段呈现**，而不是等整段生成完才出现；思考过程要有指示器；
- 附件可以**在对话中追加和撤下**，不影响已有对话；
- 页面刷新或网络断开后，**恢复对话但绝不重复提交**。

## 在 UI 与 Managed Agents 之间加一层业务后端 <span id="h-cs-arch" />

```text
网页 / 移动端 UI
  → 已鉴权的业务后端（对话归属、回合 ID）
    → Managed Agents Session + Event API
    ← SSE 事件帧
  ← 产品事件（答案更新、活动进度、回合状态）
```

API Key 保留在后端。业务后端持久化业务对话与 `session_id` 的映射，后续回合复用同一个 Session；Agent 和 Environment 的准备属于应用初始化（见[入门篇](managed-agents-data-analysis.md)），不要在每次发消息时重新创建。

接收一条输入时分配业务 `turn_id`。同一回合内可能出现**多条有序的助手消息**：Agent 可能先说话，再调用工具，然后继续说话——一个回合不一定只有一条消息，各条都要分别保存、保持顺序。

## 先订阅，再提交输入 <span id="h-cs-subscribe" />

发送事件与订阅事件流是两个独立接口。先用一条连接建立 SSE 事件流，确认流已建立后，再通过另一条连接 `POST` 输入：

```bash
curl -N --no-buffer --get "$AGENTSTUDIO_URL/sessions/$SESSION_ID/events/stream" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  --data-urlencode 'event_deltas[]=message' \
  --data-urlencode 'event_deltas[]=reasoning'
```

<Warning>
  **顺序不可颠倒**：SSE 不重放历史事件。先发送再订阅，可能错过快速回复或即时错误；也不要让订阅流占用唯一可用于提交请求的连接。
</Warning>

工程细节：

- 前端可以立即回显输入；等待答案时，后端报告已经确认的阶段（正在连接、已提交、运行中）；
- 及时刷新下游输出流，并关闭代理的响应缓冲——缓冲会吞掉「流式」效果；
- 连接超时、首个业务事件超时、空闲超时和整轮总超时分别设置；保活注释不代表业务取得进展；
- 按帧解析 SSE：忽略注释行，接受 `data:` 与 `data: `（带空格）两种写法；先合并多行 `data`，再解码 JSON，按 JSON 中的 `type` 分发。

## 增量拼接与去重 <span id="h-cs-delta" />

开启 `event_deltas[]` 后，被声明类型的事件先下发一帧 `event_start`（`event.id` 即最终完整消息的 ID），随后按生成顺序下发若干 `event_delta` 增量帧，最后下发聚合后的完整消息。客户端按帧类型分流：

| 上游事件帧           | 后端处理                                  | UI 效果               |
| --------------- | ------------------------------------- | ------------------- |
| `event_start`   | 登记 `event.id` 和 `event.type`          | 创建临时消息，或开启思考指示器     |
| `event_delta`   | 按到达顺序向 `(event_id, delta.index)` 追加文本 | 更新已有答案块             |
| 完整的助手 `message` | 用完整 `content` 替换该事件的临时内容              | 将同一条消息置为完整，不再新增副本   |
| 完整的 `reasoning` | 结束该次思考活动                              | 清除思考指示器，但当前回合可能仍在运行 |

最小的文本缓冲操作：

```python
buffers = {}

def append_text_delta(event):
    delta = event["delta"]
    key = (event["event_id"], delta["index"])
    content = delta.get("content", {})
    if content.get("type") == "text":
        buffers[key] = buffers.get(key, "") + content.get("text", "")
    return key
```

三个常见问题：

1. **`delta.index` 标识的是内容块，不是片段序号**。相同键下的多个片段都必须追加，即使文本内容相同也不能去重——例如 index 0 上的 `"3"` 和 `"23"` 应拼成 `"323"`；收到最终完整消息 `"323"` 后，替换已有缓冲，而不是再拼成 `"323323"`。
2. **按已登记的事件类型分流**，避免把 reasoning 文本拼进答案；过滤输入的回显，只有 `role: assistant` 的完整消息才属于助手对话记录。
3. **MultiAgent 输出先按线程隔离**再决定是否加入主答案，见[多智能体篇](managed-agents-multiagent-proposal.md)。

后端可以给 UI 一套精简的自定义协议，例如：

```json
{"type":"answer.updated","turn_id":"turn_1","event_id":"msg_1","block_index":0,"text":"323"}
```

这是应用自行定义的事件，不是 Managed Agents API 字段。`text` 表示该内容块当前累积的完整快照，UI 每次更新都替换该块。下游事件可能重放或乱序时，使用稳定的事件／内容块键以及后端分配的修订号；最终消息替换时移除不再有效的临时内容块。渲染模型文本前做好转义，不要直接注入未经处理的 HTML。

## 思考与回合完成分开处理 <span id="h-cs-reasoning" />

Thinking 使用 `reasoning` 事件。实测收到 reasoning 的开始帧和最终帧，**不要求中间一定有非空的 reasoning 增量**——活动尚未结束时显示思考指示器；不要补造思考文本，也不要把没有文本当成错误。

回合真正的结束以 `session_status` 的 `stop_reason` 为准，映射为产品状态：

| 观察到的状态                       | 产品行为                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `running`                    | 保持回合活跃，随事件展示答案或工具进度                                                 |
| `idle` + `end_turn`          | 标记本轮完成                                                              |
| `idle` + `requires_action`   | 显示需要处理的状态（审批流程见[事件流](managed-agents-event-stream.md)） |
| `idle` + `retries_exhausted` | 标记本轮失败，保留已有对话                                                       |
| `terminated`                 | 停止加载，展示终止结果                                                         |
| `error`                      | 读取顶层 `error.code` / `error.message`，保留诊断 ID，并核对 Session 状态          |

**HTTP 200、收到一条完整助手消息、某次 reasoning 结束或 SSE 连接关闭，都不能单独证明本轮成功**：前一条助手消息之后还可能继续调用工具或产生更多消息。工具进度按 call ID 保存；回合结束或被中断时，统一收束 UI 上仍在等待的活动。

## 断线恢复：不重复提交 <span id="h-cs-recovery" />

页面刷新后，先恢复后端保存的回合和消息。如果后端与 Managed Agents 的上游连接还在，让 UI 重新接入这条业务流，而不是再次发起回合。

如果上游连接已断开：保留 Session ID，通过分页 Event List 恢复完整消息。先建立新的实时订阅，并在核对历史时**缓冲新事件**，避免漏掉恢复期间完成的结果；完整事件按 ID 新增或更新，归入正确的回合，用完整消息替换不完整文本。恢复后的流可能只有某条消息的后半段，不能直接当作完整答案；回合进入终态后，再核对一次历史。

<Warning>
  **不要用 `(event_id, index)` 对单个增量去重，也不要仅因连接关闭就重新发送原始输入**。上游流没有可续传的增量游标；如果是提交请求本身超时，先检查历史，再决定是否可以安全重发。
</Warning>

<Note>
  实测证据（2026-10-15）：在收到首个答案增量后断开，先打开替代订阅流再获取分页历史；只提交了一次输入，随后产生的多条助手消息按 ID 合并后与最终历史完全一致。
</Note>

## 让对话追加附件 <span id="h-cs-attach" />

附件控件需要独立于答案流的生命周期：

```text
已选择 → 上传中 → 检查中 → 挂载中 → 就绪
                   └→ 已拒绝    └→ 超时
就绪 → 移除中 → 已移除
```

这些是应用 UI 状态，不是平台状态值清单。每个附件都要在后端关联所属业务对话、上传获得的 `file_id`、返回的资源 ID，以及完整挂载路径；后端在执行操作前校验归属。

按[入门篇](managed-agents-data-analysis.md)的上传流程等到文件变为 `available`，然后把它加入**已有 Session**：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/sessions/$SESSION_ID/resources" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H "Content-Type: application/json" \
  -d '{"type": "file", "file_id": "<available_file_id>", "mount_path": "/uploads/late.txt"}'
```

三个返回字段的处理要点：

- 返回的 `sesrsc_...` 资源 ID 要与上传的 `file_id` **分开保存**——撤下时用的是资源 ID；
- 返回的 `mount_path` 已经是完整沙箱路径；
- 返回的 `file_id` 可能指向服务端复制出的文件。

<Warning>
  **挂载资源本身不会提交消息，也不会生成 Session 事件**。附件 UI 的状态要根据后端操作结果和**运行时检查**更新，不能仅因资源列表中出现了附件就标记为可读。
</Warning>

运行时确认的做法：在下一轮让 Agent 在截止时间内等待路径出现，再读取核对。实测用的跟进消息：

```text
用 bash 在最多 60 秒内等待 /mnt/session/uploads/late.txt 出现
（test -f，每次间隔 2 秒）。读取它并汇总 amount 列，不要使用联网工具。
```

Agent 读到文件后返回 `350`。**用截止时间而不是固定传播延迟**：实测多数情况第一次工具尝试就发现路径，早期偶有约 35 秒的等待。只有运行时确认可访问后才标记为就绪，否则显示超时。

业务跟进时，还要在消息里说明新文件是追加数据、替换先前输入，还是补充参考资料——**单纯挂载不会要求 Agent 修改答案**。如果当前回合仍在运行，客户端可以先完成上传，把跟进消息排到下一轮；不要承诺正在执行的工具会自动使用新输入重新开始。实测流程是在同一个 Session 的两轮之间应用变更。

<Note>
  本测试工作空间拒绝上传 `.csv`（HTTP 415），相同内容以 `.txt` 上传则成功。附件上传前先确认目标格式被允许。
</Note>

## 撤下附件：不重置对话 <span id="h-cs-detach" />

撤下用先前保存的**资源 ID**调用：

```bash
curl -s -X DELETE "$AGENTSTUDIO_URL/sessions/$SESSION_ID/resources/$RESOURCE_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

在核对以下两层状态时，UI 显示「移除中」：

1. 分页查询 `GET /sessions/{id}/resources`，确认资源 ID 已不存在；
2. 在后续回合让 Agent 在截止时间内等待完整路径消失，并明确要求它**不要自行删除文件**，否则可能掩盖卸载失败。

两项检查都已实测通过。若超时，保留相关 ID 并提供状态恢复，不要直接显示移除成功。卸载的是 Session 中的挂载副本，不是上传的源文件；已经读入对话的信息和派生产物仍会保留——「已移除」只表示附件不再挂载，不表示 Agent 已经忘记其内容。

<Note>
  记忆库（Memory Store）需要在创建会话时挂载，不走这条动态挂载流程，见[进阶：跨会话工作记忆交接](managed-agents-memory-handoff.md)。
</Note>

## 接入验收清单 <span id="h-cs-checklist" />

- 短文本答案：增量拼接与最终完整消息一致，没有重复答案；
- reasoning 没有文本增量：思考指示器仍能正常开始和结束；
- 工具调用前后有多条助手消息：同一回合下各条消息保持正确顺序；
- 审批暂停或失败：`requires_action` 和错误不会被误显示为成功完成；
- 页面刷新和上游断线：恢复历史时不重复消息，也不重新执行输入；
- 一轮结束后追加附件：运行时确认就绪后，同一个 Session 能读取附件；
- 撤下附件：资源条目和沙箱路径消失，之前的对话消息仍保留。

<Note>
  本页记录的 SDK 版本（1.27.3）`events.stream()` 没有 `event_deltas` 参数，增量流请使用文档规定的 REST SSE 查询参数；采用其他 SDK 版本时先核实参数支持情况。
</Note>

## 下一步 <span id="h-cs-next" />

- [事件流（SSE）](managed-agents-event-stream.md)：帧结构、审批链路与恢复的完整协议参考。
- [入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)：上传、挂载、产物取回的基础链路。
- [进阶：跨会话工作记忆交接](managed-agents-memory-handoff.md)：记忆库挂载（与动态文件挂载的时机差异）。
