# 主动压缩持久化与去重复通知

Plan-Id: 2026-06-01-proactive-compaction-persist-dedup
Plan-File: .cursor/plans/2026-06-01-proactive-compaction-persist-dedup.plan.md

## 背景 / 问题

长会话中用户观察到「上一条刚显示『已压缩 14 条历史，任务继续』，下一轮又立刻显示『已压缩 15 条…』」，
误以为压缩没生效或在重复压缩。根因不是 bug，而是当前主动压缩的实现语义：

1. **主动压缩不落盘。** 每轮请求开始时，`agent_runtime` 从 `session.agent_messages`（始终保存**全量原文**）
   读历史，调用 `compactor.maybe_compact()`，结果只放进**本轮发给模型的临时 `messages`**，
   **不写回 `session.agent_messages`**。
   - 见 `agenticx/runtime/agent_runtime.py:1106-1123`：`history = _sanitize_context_messages(session.agent_messages)`
     → `maybe_compact(history)` → `messages.extend(compacted_history)`，无回写。
   - 对比 reactive（token 预算触发）路径 `agent_runtime.py:1721-1729` 已经 `session.agent_messages = react_hist` 落盘。
2. **每轮达标就再压一次，并各发一条 SSE。** `compacted_count = len(copied) - retain_recent_messages`
   （见 `compactor.py:394`，`retain_recent_messages` 默认 8）。历史每多 1 条 assistant/user，
   下一轮 `compacted_count` 就 +1（14 → 15）。前端 `ChatPane.tsx:6493` / `ChatView.tsx:1414`
   每收到一次 `compaction` 事件就**插一条**通知，不合并。
3. 因此长会话几乎**每轮都重新对全量历史做一次 LLM 摘要**（额外延迟 + 额外 token 成本），
   且 UI 上不断追加「已压缩 N 条」。

> 关键事实：`session.chat_history`（用户可见记录 / 持久化）与 `session.agent_messages`（喂给模型的上下文）
> 是两套数据。回写 `agent_messages` 不会丢失用户可见的聊天记录，且 reactive 路径已是此语义。

## 目标行为（与用户预期对齐）

- 主动压缩成功后，把压缩形态（`[compacted]` 摘要块 + 保留的最近 N 条）**写回 `session.agent_messages`**，
  实现「滚动压缩」：后续仅在**新积累了足够多的消息**后才再压一次，而不是每轮重压全量。
- 同一段历史不再每轮重复整段 LLM 摘要；UI 不再每轮追加「已压缩 N 条」。

## 范围（严格限定）

- 仅改 `agenticx/runtime/agent_runtime.py` 主动压缩分支的回写逻辑。
- 不改 `compactor.py` 的压缩算法、阈值、reactive 路径、前端通知组件。
- 不改 `chat_history` / 持久化 / `messages.json` 结构。

## 需求

### FR-1 主动压缩落盘
主动压缩路径（`agent_runtime.py` ~1117-1156，`did_compact` 为真时）在发出 `COMPACTION` 事件后，
将 `session.agent_messages` 替换为 `list(compacted_history)`（即 `[compacted_block, *retained]`）。
- 须在用户消息 append（~1161）**之前**完成回写，保证随后 `synced_session_message_count = len(session.agent_messages)`（~1163）取到正确基线。
- 回写后本轮 `messages` 仍由 `[system_prompt] + compacted_history` 构成，二者一致，无重复。

### FR-2 不破坏既有 tool-call 配对
回写值来源于 `maybe_compact` 的返回（其输入已经过 `_sanitize_context_messages`），
保留段尾部的 assistant/tool 配对不被破坏；不得引入「assistant(tool_calls) 无对应 tool 响应」断链。

### FR-3 通知自然收敛
不新增前端改动。依赖 FR-1 后「未达阈值的轮次不再触发压缩」从而**不再发 `compaction` 事件**，
使「每轮一条」的重复通知自然消失。

## 验收标准

- AC-1：构造一段超过阈值的历史，连续两轮普通对话（每轮仅新增少量消息）。
  第 1 轮发生压缩并落盘；第 2 轮因 `agent_messages` 已是压缩形态且未再次达标，
  **不**触发 `maybe_compact` 压缩、**不**发 `COMPACTION` 事件、UI 不再出现新的「已压缩 N 条」。
- AC-2：持续对话直到再次积累 > `retain_recent_messages` 的新消息后，才发生**第二次**压缩
  （滚动压缩），其 `compacted_count` 反映自上次压缩以来的增量，而非线性逐轮 +1。
- AC-3：压缩落盘后，模型请求上下文 `messages` 与 `session.agent_messages` 形态一致；
  无 provider 400（tool-call 配对）回归。
- AC-4：reactive（token 预算）路径行为不变；`chat_history` / 持久化记录完整无损。

## 实施步骤

1. 在 `agent_runtime.py` 主动压缩分支，于 `if did_compact:` 块内（发 `COMPACTION` 事件、跑 `run_on_compaction` 之后、
   append 用户消息之前）加入 `session.agent_messages = list(compacted_history)`。
2. 自查：`compacted_history` 为 `maybe_compact` 返回的第一元素列表，确认其为 `[compacted_block, *retained]`，
   且 `retained` 尾部 tool-call 配对完好。
3. 冒烟测试：
   - 新增/复用测试覆盖 AC-1（落盘后下一轮不重压）与 AC-2（滚动压缩增量）。
   - 跑现有 `tests/test_context_compiler.py` 等相关用例确认无回归。

## 风险与决策

- 压缩为有损摘要：落盘后早期细节不可逆地从模型上下文移除。
  - 决策：这与「压完后续都用压缩结果」的用户预期一致，且 reactive 路径已是同语义；`chat_history` 仍保留完整原文用于 UI/持久化，可接受。
- 若存在依赖 `agent_messages` 全量原文的其它分支（如重试 / 分支续写），需在实施时确认不受影响（步骤 2 自查范围）。
