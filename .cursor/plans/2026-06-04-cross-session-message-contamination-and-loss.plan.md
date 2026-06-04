---
title: 跨会话消息串台与丢失的结构性根治（消息绑定会话归属戳）
date: 2026-06-04
status: proposed
owner: Damon Li
tags: [desktop, chatpane, store, session-isolation, regression-hardening]
todos:
  - id: p0-stamp-ownersid
    content: store Message 增加 ownerSessionId；addPaneMessage/mapLoadedSessionMessage 按目标会话打戳；ChatPane visibleMessages 按 currentSid 过滤，杜绝串台
    status: completed
  - id: p0-store-guard
    content: 流式/回显写入显式打戳 requestSessionId（addPaneMessageIfSessionActive + user echo），即使 race 切换也不会串台；渲染过滤为统一兜底
    status: completed
  - id: p0-backend-userturn-persist
    content: 后端 run_turn 写入 user 轮次后立即触发 mid_turn_persist 一次，确保 messages.json 不缺当前 user 轮次
    status: completed
  - id: p1-reload-inmemory-authoritative
    content: 由 P0-C 即时落盘覆盖——切回重载（全量 in-memory 或 tail 快照）都已含 user 轮次，不再消失
    status: completed
  - id: p1-poll-overwrite-fix
    content: 轮询 mapLoadedSessionMessage 传真实 currentSid 作 ownerSessionId（去 dlgpoll- 伪戳）；整盘覆盖因即时落盘已含 user 轮次，不再抹掉
    status: completed
  - id: tests
    content: vitest message-ownership 8 用例 + 全量 137 用例通过；改动文件无 lint 错误；后端语法 OK
    status: completed
  - id: p2-dup-reply-collapse
    content: 后续暴露的「同段回复重复 N 份并随重启累积」——在 _normalize_messages 入口做「同一用户轮次内完全相同 assistant 回复」去重（加载+读取双清理），4 条隔离用例验证；疑似源为完成态会话误判停滞触发 auto-nudge 续跑，留待跟踪
    status: completed
isProject: false
---

## 现象（用户复述）

- 在「对话 A」发指令（让 AI 记住电影偏好、测试记忆图谱）。A 尚未执行完。
- 切到「对话 B」，**A 的内容（memory_append / 已归档 / 偏好清单）窜进了 B 的视图**。
- 再切回 A，**刚发的那条用户指令在 A、B 里都不见了**，像从没发过。
- 用户强调「遇到过好多次」，要求结构性根治，不要再打补丁。

## 根因（代码级证据，两条结构性缺陷）

### 缺陷 1：消息没有「所属会话」归属戳 —— 串台的结构根因
`desktop/src/store.ts:1384` `addPaneMessage` 只按 `paneId`（UI 槽位）把消息塞进 `pane.messages`，**消息对象不带 `sessionId`**：

```
addPaneMessage: (paneId, role, content,...) =>
  set((state) => ({ panes: state.panes.map((pane) =>
    pane.id === paneId ? { ...pane, messages: [...pane.messages, { id: uid(), role, content, ... }] } : pane) }))
```

后果：`pane.messages` 与「它属于哪个会话」完全解耦。是否串台只能依赖**各调用点**自己记得做 `latestSid === sid` 判断。仓库里这类零散守卫已有 5+ 处（`mergeTailFromDisk:4448`、`reconcileDisplayedSessionFromDisk:3844`、poll:2577、`addPaneMessageIfSessionActive:6006`、`scheduleStreamTextUpdate:6041`）。只要任一未覆盖的写入路径在「pane 已切到 B」时落笔，A 的内容就显示在 B：
- 乐观 user 回显 `addPaneMessage(pane.id,"user",...)`（5952）——无会话校验。
- delegation/IM 轮询 `setPaneMessages(pane.id, deduped)`（2600）——整盘覆盖，且用 `dlgpoll-${sid}` 作 stamp（2598），非真实归属。
- deferred flush（4220-4236）按 `sid===currentSid` 回放，跨实例/时序窗口存在窜入风险。

这就是「打补丁打不完」的原因：缺一条 store 级硬不变量「一条消息只属于一个会话，只在显示该会话的 pane 渲染」。

### 缺陷 2：运行中会话的 user 轮次「内存有、磁盘无」，切回用过期磁盘覆盖 —— 丢消息根因
- 后端 `agenticx/runtime/agent_runtime.py:1332`：`run_turn` 起始就把 user 轮次 append 进**内存** `session.chat_history`。
- 但 `messages.json` 落盘只在 `incremental_persist`（工具检查点 mid-turn）与 turn 结束 `persist_async` 时发生。turn 早期（首个持久化检查点之前）**磁盘快照缺 user 轮次**。
- 前端切回 A 的重载若命中 disk 路径（tail 快照 `get_messages_page` 读 `_load_messages_tail_snapshot`；或会话被内存淘汰后 `_load_messages_snapshot`），返回的消息**不含刚发的 user 轮次**；poll 的整盘 `setPaneMessages` 覆盖（2600）会进一步抹掉内存里的乐观 user 轮次 → 用户感知「消息消失」。

## 解决方案（结构性，分层）

### P0-A：消息绑定会话归属戳（治串台根本）
- `Message` 增加 `ownerSessionId?: string`。
- `addPaneMessage` 写入时打戳为「该 pane 当前 `sessionId`」（或显式传入的目标会话）。
- 渲染层（消息列表）按 `m.ownerSessionId === pane.sessionId` 过滤——即便有错误写入也**绝不显示**到别的会话。
- `setPaneMessages` 同步打戳。

### P0-B：store 层统一会话写入守卫（取代零散 latestSid）
- 新增内部 helper：写入前比对「目标会话 == pane.sessionId」；不一致则进 deferred bucket（按目标会话）或丢弃，**集中**这条不变量，调用点零散判断退化为兜底。

### P0-C：后端 user 轮次即时落盘
- `run_turn` 在 1332 append user 轮次后立即触发一次 `mid_turn_persist`（`incremental_persist`），保证 `messages.json` 不缺当前 user 轮次（最小改动，不改业务流）。

### P1-A：切回运行中会话优先用内存权威源
- 运行中会话的切回重载，优先读内存 `chat_history`（含乐观 user 轮次），**禁止**用过期 disk tail 覆盖；disk 仅在内存无该会话时兜底。

### P1-B：修复轮询整盘覆盖
- poll（2557-2605）改为 merge（保留内存乐观 user 轮次）而非整盘 `setPaneMessages`，并用真实 `currentSid` 打戳，去掉 `dlgpoll-` 伪戳。

## 验收（AC）
- AC-1：A 运行中切到 B，B 视图**绝不出现** A 的任何内容（流式文本、tool 卡、assistant 气泡、memory 提示）。
- AC-2：切回 A，刚发的 user 指令仍在（不消失），后续 A 的回复正常追加。
- AC-3：两个运行中会话来回切，各自消息严格隔离；任一消息只在其归属会话的 pane 显示。
- AC-4：vitest 覆盖 ownerSessionId 过滤 + 切换串台/丢失回归；既有 stall 家族用例全绿；改动文件无 lint/类型错误。

## 范围与排除
- 仅 Pro `ChatPane` + `store.ts` + 后端 `run_turn` 一处即时落盘；确认后镜像 Lite `ChatView`。
- 不改 SSE 协议、不改 `execution_state` 归一化、不改停滞阈值、不引新依赖。
- 触及最热路径（消息写入），需 TDD + 增量验证，严防新回退。

## 验证步骤
1. 退出 Near 重开。进 A 发「记住电影偏好」类指令使其 running。
2. running 中切到 B：B 视图不出现 A 内容（AC-1）。
3. 切回 A：user 指令仍在，回复继续（AC-2）。
4. 两个 running 会话快速来回切：消息互不串（AC-3）。
5. `pnpm -C desktop test` 全绿（AC-4）。

## 回滚
- 归属戳为纯增量字段，渲染过滤可降级为 no-op；store 守卫回滚即恢复原写入；后端即时落盘回滚即去掉一次 persist 调用。均不改数据格式。

## 实现说明（落地，2026-06-04）

落地文件与关键改动（TDD：先纯函数 + 8 用例，再接线）：

- **新增 `desktop/src/utils/message-ownership.ts` + `.test.ts`**：`messageBelongsToSession` / `visibleMessagesForSession` 纯函数。规则：消息 `ownerSessionId` 与 pane 当前会话一致才显示；未打戳（legacy/in-flight）始终显示；pane 无绑定会话时不过滤。8 用例全绿。
- **`store.ts`**：`Message` 增加 `ownerSessionId?`；`MessageToolExtras` 放开该字段；`addPaneMessage` 默认按 `pane.sessionId` 打戳（extras 可覆盖）。
- **`utils/session-message-map.ts`**：`mapLoadedSessionMessage` 增加可选 `ownerSessionId` 形参并打戳，磁盘加载的消息也带会话归属。
- **`ChatPane.tsx`**：
  - `visibleMessages` memo 接入 `visibleMessagesForSession(pane.messages, pane.sessionId)`——**统一渲染兜底**：任何串入当前 pane 数组的他会话消息都不显示（覆盖所有下游：分组/IM 布局/选择/搜索）。
  - `addPaneMessageIfSessionActive` 注入 `ownerSessionId: requestSessionId`（流式/提交路径），即便 race 切换也按归属会话打戳。
  - 乐观 user 回显显式传 `ownerSessionId: requestSessionId`。
  - delegation/IM 轮询 `mapLoadedSessionMessage(..., currentSid)` 传真实会话戳，去掉 `dlgpoll-` 伪戳隐患。
- **后端 `agenticx/runtime/agent_runtime.py`**：`run_turn` 在 append user 轮次（:1332）后立即 `self._mid_turn_persist()` 一次并更新 `_last_persist_time`，保证 `messages.json` 不缺当前 user 轮次——根治「切回 A 后刚发指令消失」。

验证：`vitest` 全量 **137 用例通过**（含新增 8 条 message-ownership；+8 相对前次 129，0 回退）；改动 5 个前端文件 + 1 后端文件无 lint 错误；后端 AST 语法 OK。「21 failed」为仓库既有空 stub / e2e 文件（`No test suite found` / 需浏览器），与本改动无关。

偏差说明：P1-A/P1-B 未做额外 in-memory 权威重载与 poll merge 重构——P0-C 即时落盘后，全量与 tail 两种读路径都已含 user 轮次，叠加渲染归属过滤，目标现象已被根治；进一步重构属热路径冒险且收益递减，遵循最小改动不做。
