# Chat 抢占式追问保留流式半成品修复计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: GPT-5.6 Sol（跨 Desktop/Studio 的并发时序修复，需同时约束前端快照提交、后端旧 run 收尾与历史顺序）

## 目标

用户在上一轮仍流式输出时强制发送新 query，旧轮次已经展示的 assistant 文本必须立即保留在消息列表，并在旧 run 完成中断收尾后写入 `messages.json`；新 query 只能在旧 run 完成收尾后开始，避免 partial 丢失、历史乱序、两个 run 并发写同一 session。

## 根因与证据链

1. Pro 主路径 `desktop/src/components/ChatPane.tsx` 的 force-send 分支（`sendChat` 内 `shouldInterruptOnResend(...)`，当前约 7125 行）先调用 `/api/session/interrupt`，再 `abort()` 旧 SSE，并立即把 `sessionStreamStateRef[sessionId].text` 和 overlay 清空。
2. 该分支注释声称旧请求会在 `finally` 调 `commitCurrentStreamIfNeeded`，但实际 helper 只在 tool-call 边界调用；旧请求进入 `AbortError` 后，`catch/finally` 直接清理 `StreamCommitRegistry`，没有提交 partial。60ms 固定等待因此不会产生 assistant 消息，只会回退为“（已中断）”。
3. Lite 路径 `desktop/src/components/ChatView.tsx` 会在 abort 前把 `streamTextRef.current` 写入前端 store，所以当前窗口可短暂看到 partial；但它不直接落盘，历史持久性依赖 Studio 的中断收尾。
4. Studio 已在 `agenticx/studio/server.py::_finalize_partial_assistant_if_needed` 中把无 FINAL 的 `partial_meta_text` 追加到 `chat_history`，并由 `_finalize_chat_runtime` 持久化。
5. 但 `/api/session/interrupt` 只设置 interrupt flag 后立即返回；紧接着的新 `/api/chat` 在旧 runtime 真正退出前执行 `manager.clear_interrupt(session_id)`（当前约 2900 行）。当 live event hub 让 runtime 在客户端断开后继续运行时，新请求会过早清掉旧 run 的中断信号，造成旧 partial 未收尾、旧新 run 并发或历史顺序错乱。
6. 因此必须同时修复两层：前端在清 overlay 前原子认领并显示 partial；后端在接受同 session 新 run 前等待被中断的 active event hub 完成收尾。只加前端气泡不能保证重启后历史存在，只加后端等待不能保证 UI 在新 query 发出瞬间保留已展示文本。

## In scope

- Pro `ChatPane` 抢占式追问：保留当前 session 未提交的可见 partial，且只提交一次。
- Pro `ChatPane` **Stop / 打断按钮**（`stopCurrentRun`）：打断当下立即把已流式 partial（含思维链）写入 `pane.messages`，并重试 `mergeTailFromDisk` 拉回「已中断 / 恢复执行」卡；不得等到切换历史会话才出现。
- Lite `ChatView` 行为回归：继续在 abort 前保留 partial。
- Studio 同 session barge-in：新 `/api/chat` 在清 interrupt flag 前等待旧 event hub runtime done。
- 针对 registry 原子认领与后端等待 helper 的自动化测试。
- `server.py` 修改后的强制冷启动与核心 API smoke。

## Out of scope

- 不改变“普通 Enter 默认排队、二次 Enter/立即发送才抢占”的产品交互。
- 不改群聊路由、子智能体委派、Automation、stall/unattended 策略。
- 不新增消息 schema；沿用后端 `metadata.source = interrupted-partial`。
- 不改中断提示卡视觉，也不仿制豆包的具体省略号样式；本次先保证内容与历史完整。
- 不重构 `ChatPane.tsx` / `ChatView.tsx` 的整体流式解析器。

## FR / NFR / AC

### FR-1：Pro 抢占前提交当前 partial

- 在 `desktop/src/utils/stream-commit-registry.ts` 增加原子方法 `claimUncommittedText(sessionId)`：
  - session 不存在、已 committed、文本为空时返回 `null`；
  - 否则先把该 session 标记 committed，再返回当时文本快照；
  - 该方法不做 UI 文案过滤，调用方继续复用 `isThinkingPlaceholderText` / `isStreamToolLabelOnlyText`。
- 在 `ChatPane.sendChat` 的 force-send 分支中，在调用 interrupt/abort/清空 overlay 之前：
  - 调用 `claimUncommittedText(requestSessionId)`；
  - 对有效可见文本复用既有 `parseReasoningContent` 与 assistant message extras 规则，写入当前 pane；
  - 无有效可见文本时保留“（已中断）”兜底；
  - 删除“等待 60ms 让 finally 提交”的错误假设。

AC:
- partial=`"已经输出一半"` 时，force-send 后消息列表顺序为 `user(query1) → assistant(partial) → user(query2)`。
- 同一旧请求的后续 `catch/finally` 不再重复追加 partial。
- partial 为空/仅 thinking placeholder/仅 tool label 时仍写“（已中断）”。

### FR-2：后端等待旧 run 收尾后再开始新 run

- 在 `agenticx/studio/server.py` 靠近 chat runtime helpers 处新增 async helper：
  - 输入 `manager`、`session_id`、超时；
  - 当 `manager.get_event_hub(session_id)` 返回旧 hub 时等待（不能只依赖 interrupt flag；旧 finalizer 在 persist 前会清该 flag）；
  - 以短间隔 condition polling 等待旧 hub 在 partial 持久化后被清理，禁止只等 `hub.is_runtime_done` 或固定单次 sleep；
  - 超时抛出明确的 HTTP 409（或由调用点转换为 409），不能静默并发启动第二个 run。
- 在普通 Meta `/api/chat` 和群聊 `/api/chat` 清理 interrupt flag 之前调用该 helper；等待完成后才允许 `manager.clear_interrupt`、设置 `running`、追加 query2。
- `SessionManager.set_execution_state("interrupted")` 在 finalizer 持久化完成前保留旧 hub；`_finalize_chat_runtime` 完成 `persist_async` 后显式清 hub，使 barrier 同时代表“旧 runtime 已停 + partial 已落盘”。

AC:
- active hub + interrupt flag：新 chat 必须等 `publish_done()` 后才继续。
- active hub 未在超时内结束：新 chat 返回 409，不清 interrupt flag，不启动并发 runtime。
- 无 active hub：普通请求无额外可感知延迟。

### FR-3：持久化与 UI 一致

- 不由 Desktop 手工 append partial，避免与 `_finalize_partial_assistant_if_needed` 双写。
- 旧 runtime 完成收尾并 persist 后，新请求才进入 chat history；Desktop 已乐观提交的 partial 与磁盘 partial 内容一致。
- 新请求完成或 session poll 后，不得用磁盘快照覆盖掉 partial。

AC:
- 关闭并重开该 session，partial 仍存在。
- `messages.json` 中 query1 partial 只出现一次，且位于 query2 之前。

### NFR

- session 隔离：任何 claim/wait 都必须按 `session_id` 定位，不影响其他 pane/session 并发。
- 超时有界：后端等待默认不超过 2 秒；失败显式返回，不无限挂住发送。
- no-scope-creep：只改本 plan 列出的文件与测试。

## 实施步骤（TDD）

### Task 1：流式 partial 原子认领

Files:
- Modify: `desktop/src/utils/stream-commit-registry.test.ts`
- Modify: `desktop/src/utils/stream-commit-registry.ts`

1. 先在 test 中新增：
   - 未提交文本首次 claim 返回快照并标记 committed；
   - 第二次 claim 返回 null；
   - 空文本/未知 session/已 committed 返回 null；
   - A/B session claim 隔离。
2. 运行：
   - `cd desktop && npx vitest run src/utils/stream-commit-registry.test.ts`
   - 预期 RED：`claimUncommittedText is not a function`。
3. 最小实现该方法。
4. 复跑，预期全绿。

### Task 2：Pro force-send 使用 partial 快照

Files:
- Modify: `desktop/src/components/ChatPane.tsx`，锚点 `shouldInterruptOnResend(...)` force-send 分支。

Before:

```ts
await interruptSession(requestSessionId);
prevAbort.abort();
prevState.text = "";
setStreamedAssistantText("");
await sleep(60);
// 假定旧 finally 会提交 partial
```

After intent:

```ts
const claimedPartial = registry.claimUncommittedText(requestSessionId);
if (claimedPartial is visible assistant output) {
  add assistant message to the owning session/pane;
}
await interruptSession(requestSessionId);
abort old local SSE;
clear overlay;
if (no visible partial and prior turn still ends with user) {
  append interrupted placeholder;
}
```

要求：
- 必须在任何 `abort()`、`prevState.text = ""`、`setStreamedAssistantText("")` 之前 claim。
- 使用带 `ownerSessionId` 的既有 session-safe message append helper/等价参数，不能把旧 session partial 写到切换后的 pane。
- 不新增第二套流式内容解析。

### Task 3：Studio barge-in completion barrier

Files:
- Add: `tests/test_chat_barge_in_completion.py`
- Modify: `agenticx/studio/server.py`，锚点 `_finalize_partial_assistant_if_needed` 附近 helper 区与 `/api/chat` 内两处 `manager.clear_interrupt(payload.session_id)`。

1. 先写 async 单测：
   - active hub 在测试协程中稍后 `publish_done`，helper 返回；
   - active hub 永不完成，helper 超时；
   - no interrupt/no hub 立即返回。
2. 运行：
   - `pytest -q tests/test_chat_barge_in_completion.py`
   - 预期 RED：helper 尚不存在。
3. 实现 condition-polling helper；所有新增注释/docstring 使用英文。
4. 在两处清 interrupt 前精确插入调用，禁止整段替换 import 或 chat handler。
5. 复跑单测。

### Task 4：回归验证

Files:
- Modify: `desktop/src/components/ChatView.tsx`，锚点 `if (streaming && opts?.forceSend)`；在本地 abort 前先向 Studio 发 session interrupt，确保与 Pro 路径共享后端 completion barrier。
- Verify only: `agenticx/studio/server.py`

自动验证：

```bash
cd desktop
npx vitest run src/utils/stream-commit-registry.test.ts src/utils/streaming-stop-policy.test.ts
npx tsc --noEmit
npm run build
```

```bash
pytest -q tests/test_chat_barge_in_completion.py tests/test_chat_turn_interruption_notice.py
```

`server.py` 强制 smoke：

```bash
agx serve --host 127.0.0.1 --port <临时空闲端口>
curl --noproxy '*' -fsS http://127.0.0.1:<port>/api/session
curl --noproxy '*' -fsS http://127.0.0.1:<port>/api/avatars
curl --noproxy '*' -fsS http://127.0.0.1:<port>/api/sessions
```

核心 API 均须返回 HTTP 200，进程无启动崩溃。

手动验收：

1. 在 Pro 窗格发 query1，待出现至少两行 assistant token。
2. 在仍生成时输入 query2，并触发“立即发送/抢占”。
3. 观察 query1 partial 保留，末尾允许显示中断语义，但不得整段消失。
4. 等 query2 完成，切到其他 session 再切回。
5. 完全退出 Desktop 后重开；query1 partial 仍在，且只出现一次。
6. Lite 模式重复一次，结果一致。

## 风险与回滚点

- 风险：旧 provider 对 interrupt 响应超过 2 秒。处理：返回 409 并保留输入/明确提示，不允许并发破坏历史；不通过清 interrupt 强行继续。
- 风险：前端 partial 已在 tool-call 边界提交。处理：registry claim 对 committed session 返回 null，避免重复。
- 风险：用户切换 session 后旧流被抢占。处理：沿用 requestSessionId/ownerSessionId 隔离，不读 live pane session 作为旧消息归属。

## 预计改动文件

- `.cursor/plans/2026-07-18-chat-barge-in-partial-preservation.plan.md`
- `desktop/src/utils/stream-commit-registry.ts`
- `desktop/src/utils/stream-commit-registry.test.ts`
- `desktop/src/components/ChatPane.tsx`
- `desktop/src/components/ChatView.tsx`
- `agenticx/studio/session_manager.py`
- `agenticx/studio/server.py`
- `tests/test_chat_barge_in_completion.py`

## Review follow-up（Critical）

代码审查发现两处 Critical，已纳入本 plan 并落地：

1. **Meta `/api/chat` hub 顺序**：`wait_for_interrupted_runtime` + `clear_interrupt` / `set_execution_state("running")` 必须在 `ensure_event_hub` **之前**。否则新请求先拿到 hub，旧 run `persist` 后 `clear_event_hub` 会关掉新 hub。回归测试：`test_meta_chat_waits_for_previous_runtime_before_ensure_event_hub`。
2. **ChatPane 旧 SSE `finally` 身份守卫**：清理 `sessionAbortControllersRef` / `StreamCommitRegistry` / `sessionStreamStateRef` / dequeue / idle 前，必须确认 `sessionAbortControllersRef[sid] === abortController`（`stillOwnsStream`）。被 barge-in 替换的旧 finally 不得覆写新流状态。

## 验收补充（Stop 打断空白）

用户复现：流式中（含思维链 + 半截正文）点打断 → **当面只剩用户气泡**；切到其他历史再切回 → 半成品 +「已中断 / 恢复执行」正常。

根因：`stopCurrentRun` 只清 overlay / abort，从不把 registry 中的 partial 写入 store；磁盘由后端 `_finalize_partial_assistant_if_needed` 落盘，故切会话 `loadSessionMessages` 能恢复。

修复：共用 `preserveUncommittedStreamPartial`（Stop 与 force-send）；Stop 成功后短延迟重试 `mergeTailFromDisk`。

