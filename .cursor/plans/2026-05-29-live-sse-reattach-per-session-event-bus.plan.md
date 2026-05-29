---
name: live-sse-reattach-per-session-event-bus
overview: 评估并设计「切回正在 running 的 session 时真·实时重连 SSE 续看 token 级流式」的方案。核心是把当前 per-request 的 event_queue 提升为 per-session 事件中枢（pub-sub + 环形回放缓冲 + 序号/Last-Event-ID 续传），并新增一个只读重连端点，让前端从磁盘轮询追平升级为无缝实时续看。本 plan 以工作量评估 + 分阶段设计为主，实施前需先完成 Spike。
todos:
  - id: spike-current-stream-lifecycle
    content: Spike — 摸清 _event_stream / event_queue / keep_runtime_after_disconnect 现状与 runtime.run_turn 事件源是否可多订阅
    status: completed
  - id: session-event-hub
    content: 后端 — 新增 per-session 事件中枢（pub-sub + 环形回放缓冲 + 单调 seq），由 ManagedSession/SessionManager 持有，生命周期跟随 session
    status: completed
  - id: refactor-event-stream-to-publisher
    content: 后端 — _event_stream 改为「runtime 只往中枢 publish；SSE 只做 subscribe 转发」，客户端断开仅取消订阅不杀 runtime
    status: completed
  - id: reattach-readonly-endpoint
    content: 后端 — 新增 GET /api/sessions/{id}/stream 只读重连端点，支持 Last-Event-ID 回放缺口后切实时增量
    status: completed
  - id: client-reattach-eventsource
    content: 前端 — ChatPane 回到 running session 时用 reattachStream 重挂订阅替代 2s 磁盘轮询，带 lastSeq 续传
    status: pending
  - id: lifecycle-and-backpressure
    content: 后端 — 中枢生命周期/内存上限/多订阅者背压/慢消费者处理 + session 结束清理
    status: completed
  - id: tests-and-rollout
    content: 测试 — 多订阅者回放/断连重连/无缝续看的单测与冒烟，灰度开关回退到现有轮询
    status: pending
isProject: false
---

# 真·Live SSE 重连：per-session 事件中枢 + 回放（工作量评估）

> 本 plan 是 `2026-05-29-stall-resume-and-action-button-fix` 中 FR-7 的**深化项**。上一轮已用「2s 磁盘轮询追平」堵住数据丢失（功能满足 AC-6 的 ≤2s 延迟界，但不是 token 级丝滑续看）。本 plan 评估把它升级为真正的实时重连所需的工作量与设计，**实施前先做 Spike**，不在评估阶段动代码。

## 背景：为什么现在做不到无缝续看

现状链路（已 trace，引用真实代码）：

- `agenticx/studio/server.py:2114` `event_queue = asyncio.Queue()` —— **per-request 局部**。
- `server.py:2284` `_event_stream()` 是 `StreamingResponse(_event_stream(), media_type="text/event-stream")`（:2484）的生成器：
  - `server.py:2409` `runtime_task = asyncio.create_task(_produce_meta_events())` 把 runtime 跑在独立 task，往 `event_queue` put（:2406 `await event_queue.put(event)`）。
  - SSE 主循环（:2411-2449）从 `event_queue` 取并 `yield`。
- `server.py:2289` 已有 `keep_runtime_after_disconnect` 标志（`protocols.py:47`），客户端断开后 runtime 可继续跑完（:2412-2415, :2455-2466），但 **tail 事件 put 进局部 queue 后无人消费 → 丢失**，只能靠落盘 `messages.json` 兜底。

根因总结：**「算」（runtime task）已经和「传」（SSE 生成器）部分解耦，但中间的 queue 是请求私有的、一次性的、不带回放、不可被第二条连接订阅**。所以一旦原连接 abort，新连接无法"接回"那条流——这不是 Python/并发限制，而是缺一层 per-session 的可订阅+可回放中枢。

## 目标架构

```
runtime.run_turn(...) ──publish(event)──▶  SessionEventHub(session_id)
                                            │  - subscribers: set[Queue]
                                            │  - ring buffer: deque[(seq, event)]  (回放)
                                            │  - seq: 单调递增
                                            ├──▶ SSE conn A (subscribe, 从 seq=N 起)
                                            └──▶ SSE conn B 重连 (Last-Event-ID=M → 回放 M+1..now → 实时)
```

- runtime task 只对 hub `publish`，不认识任何具体连接。
- `/api/chat` 与新的 `/api/sessions/{id}/stream` 都只是 hub 的 subscriber：连接断 → 退订，**hub 与 runtime 照常活着**。
- 每个 event 带单调 `seq`；SSE 帧用标准 `id: <seq>` 行，重连时浏览器/前端带 `Last-Event-ID`，hub 从环形缓冲回放缺口再转实时。

## 功能需求（FR）

### FR-1 Per-session 事件中枢（`agenticx/studio/` 新增模块，挂到 `ManagedSession`/`SessionManager`）
- 新建 `SessionEventHub`：`publish(event)`、`subscribe() -> (queue, current_seq)`、`unsubscribe(queue)`、`replay_since(seq) -> list[event]`。
- 环形缓冲（`collections.deque(maxlen=N)`，N 评估 200~500 帧或按字节上限），保存最近事件供回放；超出窗口的重连退化为「读磁盘快照 + 从最新 seq 续实时」。
- 单调 `seq` 计数；hub 由 `ManagedSession`（`session_manager.py:92`）持有，随 session 创建/销毁。

### FR-2 `_event_stream` 改为发布者（`server.py:2284-2484`）
- `_produce_meta_events` 里 `await event_queue.put(event)` → `hub.publish(event)`。
- SSE 主循环改为从「自己 subscribe 得到的 queue」消费；客户端断开时**只 `hub.unsubscribe`**，runtime task 不再因断开被 cancel（语义并入 `keep_runtime_after_disconnect`，并评估是否默认开启）。
- 保留 `_resolve_chat_end_execution_state` / `clear_interrupt` / `set_execution_state` 收尾逻辑（:2472-2480），但要确保「最后一个订阅者断开 ≠ 任务结束」——收尾只在 runtime task 真正完成时触发。

### FR-3 只读重连端点（`server.py` 新增 `GET /api/sessions/{session_id}/stream`）
- 不接收 prompt、不写历史、不触发新一轮 `run_turn`；仅 `hub.subscribe` + 可选 `Last-Event-ID`/`?since=<seq>` 回放。
- 若 session 不在 running 或 hub 不存在 → 返回一个立即 `done` 的短流（前端回落磁盘快照）。
- 复用 `_runtime_event_to_sse_lines`，额外输出 `id: <seq>`。

### FR-4 前端重挂订阅（`desktop/src/components/ChatPane.tsx`）
- 把上一轮 FR-7 的 `syncBackgroundRun`（2s 磁盘轮询）替换/补强为 `reattachStream(sid, sinceSeq)`：回到 `execution_state==="running"` 且本地无活跃流时，连 `/api/sessions/{id}/stream`，带本地已知的 `lastSeq`。
- 复用 `sendChat` 的 SSE reader/parser；区别仅在不 POST、不写「🔁 续跑」类历史条目；维护 `sessionStreamStateRef[sid].lastSeq`。
- 离开 pane / 卸载时 abort 重连 controller，避免泄漏多订阅。
- 保留磁盘轮询作为**降级兜底**（端点不可用或回放窗口溢出时）。

## 工作量评估（粗估，含不确定性）

| 阶段 | 内容 | 估时 | 风险 |
|---|---|---|---|
| Spike | 验证 `runtime.run_turn` 事件能否安全多订阅、hub 放 ManagedSession 的并发安全、收尾语义 | 0.5d | 中：收尾/中断语义耦合较深 |
| 后端 hub + 重构 stream | FR-1 + FR-2 | 1.5~2d | 高：改动 `_event_stream` 核心循环，易回归（断连、interrupt、taskspace flush、title job） |
| 重连端点 | FR-3 | 0.5~1d | 中：回放窗口边界、鉴权（沿用 `AGX_DESKTOP_TOKEN`） |
| 前端重挂 | FR-4 | 1~1.5d | 中：与现有 abort/stall 计时/多窗格独立流交互 |
| 生命周期/背压/测试 | 内存上限、慢消费者、清理、单测+冒烟、灰度开关 | 1~1.5d | 中：长跑内存与多订阅者背压 |
| **合计** | | **~5~7d** | |

> 结论：这是一次**中等规模、触及 streaming 协议核心**的改动，不能塞进当前 stall-fix 分支。建议独立分支 + 灰度开关（`runtime.live_reattach_enabled`，默认 off，回退到磁盘轮询）。

## 风险与缓解
- **R1 改坏主流式链路**：`_event_stream` 是所有对话的命脉。缓解：灰度开关默认 off；hub 失败时 publish 内部 try/except 不影响 runtime；保留旧路径直到验证充分。
- **R2 内存泄漏 / 无界增长**：长任务 + 多 session 的环形缓冲与订阅表。缓解：`deque(maxlen)` + 字节上限 + session 结束确定性清理 + 订阅者数上限。
- **R3 慢消费者背压**：弱网订阅者拖慢 publish。缓解：per-subscriber 有界 queue，满了丢订阅者（让其重连回放）而非阻塞 publish。
- **R4 收尾/中断语义回归**：interrupt、`execution_state` 落定、title job（:2434-2440）、taskspace flush（:2428,:2471）必须只在 runtime task 真正结束时跑一次，而非"最后一个连接断开"。缓解：把收尾绑定到 runtime task 的 `add_done_callback`，与订阅者数解耦。
- **R5 群聊/子智能体/automation 多套 stream**：`server.py` 有 `_group_chat_stream`(:1994)、`_subagent_message_stream`(:1919)、`_loop_stream`(:2677) 等多条 SSE。缓解：本期只覆盖主 `/api/chat`(`_event_stream`)；其余沿用旧路径，列入后续。

## 备选方案（评估对比）
- **A 现状磁盘轮询（已落地）**：零新基础设施，≤2s 追平，但非 token 级。保留为降级路径。
- **B 本 plan：内存 event hub + 回放**：真无缝、低延迟；代价是新基础设施 + 触及核心循环。**推荐**。
- **C 持久化事件日志（每 session 一个 append-only events.jsonl + tail 订阅）**：天然跨进程/跨重启可回放，但写放大、IO 开销、且 Desktop 单机内存方案已够用。过度设计，暂不采。

## 验收（实施期）
- AC-1：流式途中切走再切回仍 running 的 session，前端在 ≤2s 内通过 `/api/sessions/{id}/stream` 接回，**token 级增量平滑续看**（非整段跳出）。
- AC-2：重连带 `Last-Event-ID` 时无重复帧、无缺口（回放窗口内）。
- AC-3：客户端断开不再使 runtime 被 cancel（除非用户显式 interrupt）；任务照常跑完并落盘。
- AC-4：单任务 30min+ 长跑，hub 内存稳定在上限内，无泄漏；多订阅者（同一 session 两个窗格）各自正确收流。
- AC-5：灰度开关 off 时行为与当前磁盘轮询完全一致（可安全回退）。

## 范围与排除
- 只覆盖主对话 `/api/chat` 的 `_event_stream`；`_group_chat_stream` / `_subagent_message_stream` / `_loop_stream` 本期不改，列后续。
- 不引入持久化事件日志（方案 C）；hub 为进程内内存结构。
- 不改 `ChatView`（Lite）等价路径，先 Pro `ChatPane` 验证。
- Spike 结论若发现 `runtime.run_turn` 事件源无法安全多订阅或收尾耦合过深，需回到本 plan 重新评估，可能维持现状磁盘轮询为最终方案。
