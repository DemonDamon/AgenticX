# 上下文压缩通知持久化（跳转会话后不再消失）

Planned-with: Claude Opus 4.8

Plan-Id: 2026-07-08-compaction-notice-persist
Plan-File: .cursor/plans/2026-07-08-compaction-notice-persist.plan.md

## 背景 / 问题（根因证据链）

用户现象：长任务执行完，消息列表**末尾**出现「已压缩 13 条较早历史，任务继续」「已压缩 23 条…」等提示；
但**跳转到别的 session 再切回来**，这些提示行就消失了（见随附截图：图 1 有、图 2 无）。

排查结论：**这是可见性（UI 临时状态）bug，不是压缩失效、也不是数据丢失。**

一个 session 目录下有两份持久化：

| 文件 | 角色 | 压缩后内容 |
|------|------|-----------|
| `messages.json`（`session.chat_history`） | 用户可见记录 | 保留全量原文 |
| `agent_messages.json`（`session.agent_messages`） | 喂给模型的上下文 | 压缩为 `[compacted]` 摘要 + 保留最近 N 条 |

- 压缩动作本身**已生效且持久**：`agent_runtime.py` 在压缩成功时把 `session.agent_messages = list(compacted_history)`
  写回，`session_manager._save_agent_messages_snapshot()` 落盘到 `agent_messages.json`
  （`session_manager.py:1823-1834`）。重启后模型侧上下文仍是压过的。
- 但那条**给人看的「已压缩 N 条」提示行只走 SSE + 前端内存**，**从不写入 `chat_history`**：
  - 后端：`agent_runtime.py` 仅 `yield RuntimeEvent(type=EventType.COMPACTION.value, ...)`（proactive 分支
    ~1922-1930；reactive 分支 ~2736-2744），无 `chat_history.append`。
  - 前端：`ChatPane.tsx:8571-8580` / `ChatView.tsx:1745-1753` 收到 `compaction` 事件后
    `addPaneMessageIfSessionActive(... noticeKind: compaction_*)`，只写内存。
- 跳走再回来时 `reloadSessionFromDisk`（`ChatPane.tsx:4456-4470`）用磁盘快照
  `setPaneMessages(pane.id, mapped)` **全量替换内存**，磁盘里没有这条提示 → 消失。

对比：`turn_interrupted` 通知走的是 `turn_interruption.py:append_turn_interruption_notice()`
（append 到 `chat_history` + `metadata.kind`），所以它重载后仍在。压缩提示缺这条路径。

### 为什么末尾会出现两条（13 / 23）

长任务多轮里发生了**两次**滚动压缩，各发一次 `compaction` 事件、各插一条提示；计数随历史增长而变大，语义正确，不是同一条重复。

### 为什么「两份不对称」值得修（额外风险）

1. **透明度断层（本 bug）**：压缩发生过的事实在重载后无痕，等到模型事后把失败甩锅给「会话被压缩了」时用户才后知后觉——这正是 `ChatPane.tsx:8572` 注释所述设计目标，现只在当次流式成立。
2. （非本 plan 范围，仅记录）`context_usage.py` 读 `chat_history` 全量原文估算 token，与模型实际吃的压缩后 `agent_messages` 不一致，用量 chip 会偏高。本 plan 不动用量口径。

## 目标行为

- 上下文压缩发生时，向 `chat_history` 追加一条**轻量通知行**（`role=tool` + `metadata.kind=compaction_proactive|compaction_reactive` + `compacted_count`），内容与前端 `buildCompactionNoticeText` 输出**逐字一致**，并落盘到 `messages.json`。
- 跳转 session 再切回、或重启应用后，该通知行仍在原位渲染为 `ContextNoticeLine`（与 `turn_interrupted` 行为一致）。
- 滚动压缩多次触发时，历史里**不累积一长串**「已压缩 N 条」——同一轮/相邻的压缩通知就地合并为最新一条。
- **不把 `[compacted]` 摘要正文塞进 `chat_history`**（那是 `agent_messages` 的产物，塞进去会污染 transcript、被用量重复计数、并干扰 retry 的 `_strip_compacted_blocks` 逻辑）。

## 范围（In / Out of scope）

**In scope：**
- `agenticx/runtime/agent_runtime.py`：proactive（~1922）与 reactive（~2736）两处压缩分支，追加 `chat_history` 通知行（含落盘顺序处理）。
- 新增 `agenticx/studio/compaction_notice.py`（镜像 `turn_interruption.py` 的持久化/去重 helper），或在 `turn_interruption.py` 同风格内新增函数。**首选新建独立模块**，避免动 `turn_interruption.py` 既有逻辑。
- `desktop/src/utils/session-message-map.ts`：`mapLoadedSessionMessage` 的 tool 分支，从 `metadata.kind` 还原 `noticeKind`。
- 冒烟测试：新增 `tests/test_smoke_compaction_notice_persist.py`。

**Out of scope（严禁顺手改）：**
- 不改压缩算法 / 阈值 / `compactor.py` / `agent_messages` 回写逻辑。
- 不改 `context_usage.py` 用量口径。
- 不改前端 `ChatPane.tsx` / `ChatView.tsx` 的 SSE `compaction` 分支（当次流式仍走内存插入，保持现状；持久化仅负责「重载后仍在」）。
- 不改 `turn_interruption.py` 既有函数体。
- 不动 `_normalize_messages`（已保留 `metadata`，无需改）。

> no-scope-creep：每处改动都能追溯到下方某条 FR。

## 关键事实（供实施者独立判断，无需本对话上下文）

- `agent_runtime.py` proactive 分支顺序：`if did_compact:` 块（~1922，emit COMPACTION、回写 `agent_messages`）**在 user 消息 append 之前**；`chat_history` 的 user append 在 ~1965（`_chat_history_append_deduped(session.chat_history, hist_user)`），随后可能触发 `self._mid_turn_persist()` 落盘。
  - 含义：若在 `did_compact` 块内直接 append 通知行，顺序会变成 `[压缩通知] → [user] → [assistant]`，通知出现在用户消息**之前**，读起来别扭。**须把通知 append 延后到 user 的 `chat_history` append 之后**（见 FR-1 实施细节）。
- `agent_runtime.py` reactive 分支（~2736，`did_react`）发生在 turn 中途（工具轮之间），此时 user 早已入库，**可就地 append**，顺序自然正确。
- `_normalize_messages`（`session_manager.py:1868`）已把 `metadata` 原样写入序列化行；tool 行只要**不带** `tool_call_id` / `tool_name`，前端 `parseContextNotice`（`context-notice.ts:38-52`）即可命中并渲染 `ContextNoticeLine`。
- 前端 `detectKindFromText`（`context-notice.ts:22-26`）已识别文本：
  - 「上下文接近上限，已压缩」→ `compaction_reactive`
  - 「已压缩」+「任务继续」→ `compaction_proactive`
  - 因此**即使不改前端也能渲染**；FR-3 的前端改动是稳健性增强（显式 `noticeKind`），非渲染必需。
- 前端文案来源 `buildCompactionNoticeText`（`context-notice.ts:29-34`）：
  - `reactive=false` → `已压缩 {count} 条较早历史，任务继续。`
  - `reactive=true`  → `上下文接近上限，已压缩 {count} 条历史，任务继续。`
  - 后端持久化行的 `content` **必须与此逐字一致**，保证文本 fallback 与前端内存插入两条路径视觉统一。
- `ContextNoticeKind` 类型已含 `compaction_reactive` / `compaction_proactive`（`store.ts:164-165`），无需扩类型。

## 需求（FR）与验收标准（AC）

### FR-1 proactive 压缩通知落盘（顺序正确）
`agent_runtime.py` proactive 分支：在 `did_compact` 为真时，**不在 `did_compact` 块内直接 append**，而是设一个 pending 标记（如局部变量 `pending_compaction_notice = {"kind": "compaction_proactive", "count": compacted_count}`）；在 user 消息完成 `chat_history` append 之后（~1965 之后、`self._mid_turn_persist()` 之前）调用新 helper 把通知行 append 到 `chat_history`。
- 通知行结构：
  ```python
  {
      "id": uuid.uuid4().hex,
      "role": "tool",
      "content": f"已压缩 {count} 条较早历史，任务继续。",  # 与 buildCompactionNoticeText(count, false) 逐字一致
      "agent_id": agent_id or "meta",
      "metadata": {"kind": "compaction_proactive", "compacted_count": count, "source": "runtime"},
  }
  ```
- **不得**带 `tool_call_id` / `tool_name`（否则前端不识别为通知）。
- 系统触发轮（`_is_system_trigger`，即 `[系统通知]` 开头）保持现有「不追加用户可见提示」的克制：可跳过通知落盘，与 ~1939 的既有判断对齐。

**AC-1**：构造超过阈值的历史，发一轮普通对话触发 proactive 压缩。turn 结束后 `session.chat_history` 中在 user 行之后、assistant 行之前存在一条 `metadata.kind == "compaction_proactive"`、`content == "已压缩 N 条较早历史，任务继续。"` 的 tool 行；`messages.json` 快照含该行。

### FR-2 reactive 压缩通知落盘
`agent_runtime.py` reactive 分支（~2736，`did_react` 且非「budget over-limit 单行合并」路径）：在 emit `COMPACTION`（reactive=True）之处，同步向 `chat_history` append 通知行：
- `content = f"上下文接近上限，已压缩 {react_count} 条历史，任务继续。"`（与 `buildCompactionNoticeText(count, true)` 逐字一致）
- `metadata = {"kind": "compaction_reactive", "compacted_count": react_count, "source": "runtime"}`
- 复用现有 `_budget_compress_notice_sent_this_turn` 之外，本通知按 FR-4 去重即可，无需新增 per-turn latch。
- **不影响** `token_budget_compress`（budget over-limit）那条 ERROR 提示路径——那条不属于压缩通知，保持现状。

**AC-2**：mock 一轮中途 reactive 压缩（`did_react=True`），`chat_history` 出现 `metadata.kind == "compaction_reactive"` 的 tool 行且落盘。

### FR-3 前端重载还原 noticeKind
`session-message-map.ts` 的 `mapLoadedSessionMessage` tool 分支：当 `metadata.kind` 为 `compaction_proactive` / `compaction_reactive` 时，设 `mapped.noticeKind = metadata.kind`。
- 位置：参照现有 `kind === "clarification"` 的重建块（`session-message-map.ts:283`）同层，加一个 compaction 分支。
- 目的：使 `parseContextNotice` 走 `message.noticeKind` 直通路径（不依赖文本匹配），文案未来若变更也不失效。

**AC-3**：给 `mapLoadedSessionMessage` 传入一条 `role:"tool", metadata:{kind:"compaction_proactive"}` 的行，返回的 `Message.noticeKind === "compaction_proactive"`；`parseContextNotice` 对该 Message 返回非 null，`MessageRenderer` 渲染 `ContextNoticeLine`。（前端单测或类型层面验证均可；至少人工在 UI 复现「跳走再切回提示仍在」。）

### FR-4 滚动压缩去重（不累积）
新 helper 在 append 前检查 `chat_history` 尾部：若**紧邻的**（跳过纯展示性尾行的规则从简：仅看最后一行）最后一行已是同 `metadata.kind` 的压缩通知，则**就地更新**该行的 `content` 与 `metadata.compacted_count`（改为最新计数），而非再 append 一条。
- 目的：多次滚动压缩后历史里最多保留一条「当前 kind」的最新压缩通知，避免一长串。
- proactive 与 reactive 视为不同 kind，可各留一条。

**AC-4**：连续两次触发 proactive 压缩（count 从 N 增到 M），`chat_history` 中 `compaction_proactive` 通知行**只有一条**且 `compacted_count == M`、`content` 反映 M。

### NFR-1 不破坏既有链路
- 不引入 `assistant(tool_calls)` 无 `tool` 响应的断链（通知行是独立 tool 行，无 `tool_call_id`，不参与配对）。
- `turn_interrupted` / `budget_exceeded` / continuation 等既有通知渲染与 resume 逻辑不受影响（通知行 `kind` 不同，`task-stall-policy.ts` 只认 `turn_interrupted`）。
- `agx serve` 冷启动正常（本 plan 不触碰 `server.py` 顶部 import；若最终需在 `server.py` 引用新 helper，遵守「只精确增删目标行 + 冷启动 smoke」铁律）。

**AC-5**：`agx serve --host 127.0.0.1 --port <临时端口>` 冷启动进程不崩溃，`/api/session`、`/api/avatars`、`/api/sessions` 返回 200（因涉及 runtime/session 持久化路径改动，作为强制门槛）。

## 实施步骤（建议顺序）

1. **新建 `agenticx/studio/compaction_notice.py`**（`Author: Damon Li`，英文注释）：
   - `COMPACTION_PROACTIVE_KIND = "compaction_proactive"` / `COMPACTION_REACTIVE_KIND = "compaction_reactive"`
   - `build_compaction_notice_content(count: int, *, reactive: bool) -> str`：返回与前端逐字一致的两种文案。
   - `append_or_update_compaction_notice(session, *, count, reactive, agent_id) -> None`：实现 FR-1/FR-2 的 append + FR-4 的尾部就地更新去重；对 `chat_history` 非 list 时安全返回。
2. **改 `agent_runtime.py`**：
   - proactive 分支：`did_compact` 块内记录 pending 计数；在 user `chat_history` append 之后、`_mid_turn_persist` 之前调用 helper（FR-1）。注意 `_is_system_trigger` 跳过。
   - reactive 分支：在 emit reactive `COMPACTION` 处调用 helper（FR-2）。
   - 只增行、不整段替换相邻无关逻辑（no-scope-creep + 敏感文件铁律的同款自律）。
3. **改 `desktop/src/utils/session-message-map.ts`**：tool 分支新增 compaction kind → `noticeKind` 还原（FR-3）。
4. **测试**：
   - 新增 `tests/test_smoke_compaction_notice_persist.py` 覆盖 AC-1/AC-2/AC-4（可 mock session + 直接调 helper 与 runtime 分支的最小复现，参照 `tests/test_smoke_proactive_compaction_persist.py` 的构造方式）。
   - 跑 `tests/test_smoke_proactive_compaction_persist.py`、`tests/test_studio_server.py`、`tests/test_smoke_compactor_rolling.py` 确认无回归。
   - 前端：`npm run -C desktop typecheck`（或等效）确认 `session-message-map.ts` 类型无误。
5. **冷启动验收**（AC-5）：`agx serve` 临时端口 smoke。

## 风险与决策

- **文案双写风险**：后端 `build_compaction_notice_content` 与前端 `buildCompactionNoticeText` 各维护一份文案，未来改文案需两处同步。
  - 决策：接受。FR-3 让前端渲染以 `noticeKind` 为准，文案不一致最多是「历史行文字与新流式行细微差异」，不影响识别与渲染；在两处代码注释里互相 `# keep in sync with ...` 标注。
- **落盘顺序**：proactive 通知延后到 user append 之后，确保 `[user] → [压缩通知] → [assistant]` 阅读顺序自然。
- **有损压缩不可逆**：本 plan 只加「通知」，不改压缩落盘语义；`chat_history` 仍保留全量原文，`agent_messages` 仍是压缩态，维持现状。

## Suggested-Impl-Model（建议，最终以实际 Impl-Model trailer 为准）

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| 后端 helper + agent_runtime 接线（顺序/去重敏感） | Codex 系列（如 gpt-5.x-codex） | 后端实施、序列/落盘顺序敏感，代码专精中档够用且省 |
| 前端 `session-message-map.ts` 单点还原 | Composer 2.5 / 便宜档 | 单点样板改动，基线模型即可 |

整体基线：Composer 2.5 可依本 plan 独立完成（落点、结构、文案、AC 均已写全）。
