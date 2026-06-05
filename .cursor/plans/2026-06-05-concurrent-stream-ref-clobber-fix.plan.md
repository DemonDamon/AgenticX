---
name: concurrent-stream-ref-clobber-fix
overview: 根治「同一 ChatPane 内两个会话并发流式时，流式收尾/提交读写的是单实例 ref（streamTextRef / streamCommittedRef / lastMidStreamAssistantCommitRef），被另一会话覆盖，导致 A 提交进 B 的文本（回复追尾串台）、共享 committed flag 误置导致提交丢失（指令/回答消失）」。上一版 ownerSessionId 归属戳在原理上挡不住此 bug——行的归属戳是对的，但它装的“内容”来自被另一会话污染的共享 ref。本 plan 将这三个单实例 ref 按 sessionId keyed 化，抽成可单测的纯注册表模块，先 TDD 复现两会话交错再接线。
todos:
  - id: p0-registry-pure
    content: 新增 desktop/src/utils/stream-commit-registry.ts 纯模块 + .test.ts，提供按 sid keyed 的 text/committed/midCommit 读写与清理；vitest 覆盖两会话交错不互相覆盖
    status: completed
  - id: p0-wire-chatpane
    content: ChatPane.tsx 流式收尾/提交全部改读写本闭包 requestSessionId 对应的注册表项，移除对 streamTextRef/streamCommittedRef/lastMidStreamAssistantCommitRef 的跨会话依赖
    status: completed
  - id: p0-cleanup-on-end
    content: turn 结束 finally 清理该 sid 的注册表项，避免无界增长；overlay 渲染仍只反映当前会话
    status: completed
  - id: tests-regression
    content: pnpm -C desktop test 全量绿（含新增交错用例）；改动文件无 lint/类型错误
    status: completed
isProject: false
---

# 并发会话流式提交「单实例 ref 覆盖」根因修复（P0 前端）

**Plan-Id**: 2026-06-05-concurrent-stream-ref-clobber-fix
**Plan-File**: `.cursor/plans/2026-06-05-concurrent-stream-ref-clobber-fix.plan.md`
**Owner**: Damon Li
**Made-with**: Damon Li

> 关联（同族 session 隔离/串台/丢失，历次只覆盖到一部分）：
> `2026-06-04-cross-session-message-contamination-and-loss`（加了 ownerSessionId 归属戳 + 渲染过滤；**本 bug 是它原理上挡不住的盲区**）、
> `2026-06-04-session-state-isolation-and-false-stall-on-switch`、
> `2026-06-03-restart-completed-session-false-stall-and-spurious-nudge`、
> `2026-06-04-backend-event-loop-blocking-root-fix`（放大器）。

---

## 现象（用户实测，2026-06-05）

1. 在会话 A 发指令，A 流式运行中（A 的 SSE 后台仍在跑）。
2. 切到会话 B（**同一个 pane**，点历史切换），在 B 发新指令。
3. B 里：刚发的 user 指令「不见了」，且看到「大模型的回复**追尾**到 B 之前的历史对话里」。
4. 切回 A：A 「整个回答都不见了」。
5. 来回切两个会话，消息互串 + 丢失，反复出现。

---

## 根因（已逐行 trace，证据确凿）

### 关键事实：切换会话不会中止上一个会话的主 SSE 流
- 一个 pane 只有**一个 `ChatPane` 实例**，切换历史只是改 `pane.sessionId`。
- `send()` 的主 SSE fetch 用 `sessionAbortControllersRef.current[requestSessionId]`，**仅在 barge-in / 卸载时 abort**，纯切换不 abort。
- ⇒ A 的 SSE 循环与 B 的 SSE 循环可在同一 ChatPane 实例内**并发存在**。

### 真凶：流式收尾/提交读写的是单实例 ref，被并发会话覆盖
`desktop/src/components/ChatPane.tsx`：

```
2169:  const streamTextRef = useRef("");                 // 单实例（非 keyed）
2170:  const streamCommittedRef = useRef(false);         // 单实例（非 keyed）
       // lastMidStreamAssistantCommitRef 亦为单实例（用于 6039 / 7076）
```

- token 累加到**局部** `full`，却写进**共享** `streamTextRef`：
  - `6550-6552`：`full += tokenText; cumulativeFull += tokenText; scheduleStreamTextUpdate(full)` → `streamTextRef.current = full`
- 但提交读的是**共享 `streamTextRef`**，不是局部 `full`：
  - `6031-6041` `commitCurrentStreamIfNeeded()`：`const raw = streamTextRef.current.trim(); ... if (... || streamCommittedRef.current) return false; ... streamCommittedRef.current = true`
  - `6587-6592` tool_call 边界：`commitCurrentStreamIfNeeded(); full=""; streamTextRef.current=""; scheduleStreamTextUpdate(""); streamCommittedRef.current=false`
  - `7075-7105` finally 收尾：`if (... && !streamCommittedRef.current) { mid = lastMidStreamAssistantCommitRef.current; ... }`（mid 比对也走单实例）

### 两个现象的因果
- **回复追尾串台**：A 在某边界 `commitCurrentStreamIfNeeded()` 时读到的 `streamTextRef` 已被 **B 的 token 覆盖**（`6552`），于是把 B 的文本提交进 A。该行经 `addPaneMessageIfSessionActive` **被正确打上 A 的 `ownerSessionId`** → 归属过滤放行 → 显示在 A。**这就是 ownerSessionId 挡不住的根因：戳对、内容错。**
- **指令/回答消失**：`streamCommittedRef` 共享。B 置 `true` 后，A 收尾见 `true` → 跳过提交（`7096` 分支）→ A 乐观提交丢失。叠加后端并发下最后一轮未 finalize 落盘（另案，见“范围与排除”），切回 disk 也补不回。

> 一句话根因：**`streamTextRef` / `streamCommittedRef` / `lastMidStreamAssistantCommitRef` 是单实例，并发会话在同一 ChatPane 内互相覆盖。** 真相源应按 `sessionId` keyed（`sessionStreamStateRef.current[sid].text` 已经是 keyed 的，可复用）。

---

## 修复方案（P0，前端，最小且结构性）

### 设计原则
- **真相源按 sid keyed**：每个会话的「流式累计文本 / 是否已提交 / 上次中途提交文本」各自独立。
- **复用已有 keyed 态**：`sessionStreamStateRef.current[sid].text`（`6044-6047` 维护）已是 per-session 文本，提交逻辑改读它。
- **新增两个 keyed 注册项**替代单实例 flag：`committed` 与 `midCommit`。
- **抽纯模块**便于 vitest 复现两会话交错（仓库既有「纯函数 util + .test」范式）。
- **overlay 渲染不变**：当前会话的流式覆盖层仍由 `syncStreamingUiForCurrentSession` 驱动，且 RAF 写 `setStreamedAssistantText` 已被 `isTargetSessionStillActive()`（`6053`）门控，不受影响。

### 步骤 1（todo: p0-registry-pure）新增纯注册表 + 单测
新建 `desktop/src/utils/stream-commit-registry.ts`：

```ts
/** Per-session streaming commit bookkeeping. Keyed by sessionId so two
 *  concurrent streams in the same ChatPane never clobber each other. */
export class StreamCommitRegistry {
  private text = new Map<string, string>();
  private committed = new Map<string, boolean>();
  private midCommit = new Map<string, string | null>();

  beginSession(sid: string): void {
    if (!sid) return;
    this.text.set(sid, "");
    this.committed.set(sid, false);
    this.midCommit.set(sid, null);
  }
  setText(sid: string, text: string): void { if (sid) this.text.set(sid, text); }
  getText(sid: string): string { return this.text.get(sid) ?? ""; }
  isCommitted(sid: string): boolean { return this.committed.get(sid) ?? false; }
  markCommitted(sid: string, value = true): void { if (sid) this.committed.set(sid, value); }
  setMidCommit(sid: string, text: string | null): void { if (sid) this.midCommit.set(sid, text); }
  getMidCommit(sid: string): string | null { return this.midCommit.get(sid) ?? null; }
  /** Reset text+committed at a tool boundary, keep session entry alive. */
  resetTurnSegment(sid: string): void {
    if (!sid) return;
    this.text.set(sid, "");
    this.committed.set(sid, false);
  }
  /** Drop all entries for a finished session. */
  clearSession(sid: string): void {
    if (!sid) return;
    this.text.delete(sid); this.committed.delete(sid); this.midCommit.delete(sid);
  }
}
```

新建 `desktop/src/utils/stream-commit-registry.test.ts`，**至少**覆盖：
- `beginSession` 初始化后 `getText=""`, `isCommitted=false`, `getMidCommit=null`。
- **交错不串台**：`begin(A); begin(B); setText(A,"a1"); setText(B,"b1"); setText(A,"a2")` → `getText(A)==="a2" && getText(B)==="b1"`（核心回归：A 的提交读到的永远是 A 自己的文本）。
- **committed 隔离**：`markCommitted(B)` 后 `isCommitted(A)===false`（A 不被 B 的提交抑制）。
- **midCommit 隔离**：`setMidCommit(A,"x"); setMidCommit(B,"y")` → 各自独立。
- `resetTurnSegment(A)` 只清 A 的 text+committed，不动 B，也不动 A 的 midCommit。
- `clearSession(A)` 后三项均回退默认且不影响 B。

### 步骤 2（todo: p0-wire-chatpane）接线 ChatPane（精确改造点）
> 行号以当前文件为准，可能随改动漂移；按「锚点代码」定位。**不改 SSE 协议、不改归属戳、不动 Channel A/B/C 语义、不动后端。**

1. **实例化注册表**（在组件顶部 ref 区，`2169-2170` 附近）。保留 `streamTextRef`（仅作当前会话 RAF 渲染镜像），**新增**：
   ```ts
   const streamCommitRegistryRef = useRef(new StreamCommitRegistry());
   ```
   `lastMidStreamAssistantCommitRef`、`streamCommittedRef` 在 send() 内的用途全部迁移到注册表；若别处无引用则可一并删除（删除前先全局搜索确认无其他读者）。

2. **send() 起始重置**（锚点 `6005-6007` `streamTextRef.current=""; streamCommittedRef.current=false; lastMidStreamAssistantCommitRef.current=null`）：
   - 改为：`streamCommitRegistryRef.current.beginSession(requestSessionId);`
   - `streamTextRef.current = ""` 可保留（当前会话镜像）。
   - **不要**用单实例 flag。

3. **`scheduleStreamTextUpdate`**（锚点 `6042-6057`）：
   - 现已写 `sessionStreamStateRef.current[requestSessionId].text`（保留）。
   - **新增**：`streamCommitRegistryRef.current.setText(requestSessionId, nextText);`
   - `streamTextRef.current = nextText` 保留（仅当前会话 RAF 用）。

4. **`commitCurrentStreamIfNeeded`**（锚点 `6031-6041`）：
   - 文本源改为：`const raw = streamCommitRegistryRef.current.getText(requestSessionId).trim();`
   - 已提交判断改为：`streamCommitRegistryRef.current.isCommitted(requestSessionId)`。
   - 提交后：`streamCommitRegistryRef.current.markCommitted(requestSessionId); streamCommitRegistryRef.current.setMidCommit(requestSessionId, partial);`
   - 仍用 `addPaneMessageIfSessionActive`（已 stamp ownerSessionId=requestSessionId）。

5. **tool_call 边界重置**（锚点 `6587-6592`）：
   - `commitCurrentStreamIfNeeded();`（同上，现在按 sid 取自己的文本）
   - `full = "";`（局部，保留）
   - 删除 `streamTextRef.current = "";` 对提交的依赖，改为：`streamCommitRegistryRef.current.resetTurnSegment(requestSessionId);`
   - `scheduleStreamTextUpdate("")` 保留（会把注册表 + sessionStreamState + 镜像都清空到 requestSessionId）。
   - 删除 `streamCommittedRef.current = false;`（已由 `resetTurnSegment` 覆盖）。

6. **finally 收尾最终提交**（锚点 `7061-7105`）：
   - `full`（局部，正确）继续作为提交**内容**，不变。
   - `!streamCommittedRef.current` → `!streamCommitRegistryRef.current.isCommitted(requestSessionId)`。
   - `const mid = lastMidStreamAssistantCommitRef.current;` → `const mid = streamCommitRegistryRef.current.getMidCommit(requestSessionId);`
   - 两处 `streamCommittedRef.current = true;` → `streamCommitRegistryRef.current.markCommitted(requestSessionId);`
   - `else if (... && streamCommittedRef.current)` 分支同理改 `isCommitted(requestSessionId)`。

7. **send() finally 末尾清理**（todo: p0-cleanup-on-end，锚点 `7113-7129` 区域）：
   - 在 `delete sessionAbortControllersRef.current[requestSessionId];` 邻近，**新增**：`streamCommitRegistryRef.current.clearSession(requestSessionId);`
   - 检查原 `7099-7100` 的 `streamTextRef.current=""; streamCommittedRef.current=false;`：`streamTextRef` 重置仅在 `(pane.sessionId||"").trim()===requestSessionId`（当前会话）时做；`streamCommittedRef` 删除（已迁移）。

### 步骤 3（todo: tests-regression）验证
- `pnpm -C desktop test`：全量绿，含新增 `stream-commit-registry.test.ts` 交错用例。
- `pnpm -C desktop typecheck`（或 `tsc -p desktop --noEmit`，按仓库现有脚本）：无类型错误。
- ReadLints 改动文件无 lint 错误。

---

## 验收（AC）
- **AC-1（不串台）**：A 流式中切到 B 发指令，B 的回复**只**出现在 B；A 的回复**只**出现在 A；任一会话绝不出现对方的流式文本。
- **AC-2（不丢失）**：A 流式中切到 B 再切回 A，A 已发 user 指令与已生成 assistant 文本仍在；B 的 user 指令与回复也都在。
- **AC-3（committed 隔离）**：B 提交不抑制 A 的提交（反之亦然），无「回答整段消失」。
- **AC-4（回归绿）**：`pnpm -C desktop test` 全量通过（含新增交错用例）；改动文件无 lint/类型错误；既有 stall / ownership 用例不回退。

---

## 范围与排除
- **仅前端 Pro `ChatPane.tsx` + 新增 `stream-commit-registry.ts/.test.ts`**；确认 OK 后再镜像 Lite `ChatView.tsx`（本 plan 不含）。
- **不改**：SSE 协议、`ownerSessionId` 归属戳与渲染过滤、Channel A/B/C 停滞语义、`addPaneMessageIfSessionActive` 的 deferred bucket、后端任何代码。
- **后端根因 B（并发下最后一轮 assistant 未 finalize 落盘 + 前后端「完成」口径不一致，导致切回丢答案/误报停滞）属另一独立 plan**，本 plan 不处理；本 plan 仅消除前端 ref 覆盖这条主因。
- 触及最热路径（消息写入），严格 TDD + 增量：先纯模块 + 单测复现交错，再接线；每改一处保持可编译。
- 删除单实例 `streamCommittedRef` / `lastMidStreamAssistantCommitRef` 前，必须全局搜索确认 send() 之外无其他读者；若有则一并迁移或保留为当前会话镜像。

---

## 验证步骤（人工复现）
1. 完全退出 Near（⌘Q）重开，确保新前端加载。
2. 会话 A 发一条会跑较久的指令（流式中）。
3. 不等 A 结束，切到会话 B（同一 pane），发另一条指令。
4. 观察：B 只显示 B 的内容；切回 A 只显示 A 的内容；两边消息都不丢（AC-1/2/3）。
5. `pnpm -C desktop test` 全绿（AC-4）。

## 回滚
- 注册表为新增模块；接线点均为「读写源替换」。回滚即把 6 处改回读写单实例 ref 并删除注册表实例化与 clearSession 调用，行为恢复原状，不涉及数据格式/协议变更。

---

## 实现说明（落地后由实施者补写）
- 落地文件与关键改动：
- 验证结果（vitest 用例数、typecheck、lint）：
- 偏差说明（如有）：
