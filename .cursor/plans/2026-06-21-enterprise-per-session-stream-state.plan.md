# Enterprise 聊天：流式状态按会话隔离（修复多会话误判）

Planned-with: claude-opus-4.8

## 背景与现象

用户场景（截图见对话）：

1. 会话 A（标题 `verify`）正在流式输出。
2. 切换到会话 B（标题 `你好`），UI 仍显示 B 在「运行中」（思考动画 + 停止按钮）。
3. 在 B 输入「继续」点发送 → 被错误地放入排队（`1 条排队 / Enter 再按一次立即发送`），但 B 实际上没有任何正在跑的 query。

期望：每个会话的"是否在生成"应**独立**；切到 B 时 B 是 idle，输入框可正常发送。

## 根因（已核实代码锚点）

`enterprise/features/chat/src/store.ts` 当前用**全局单一**字段表达流式状态，结构上只能支持「同一时刻一个 stream」：

| 字段 | 行号 | 问题 |
|---|---|---|
| `status: ChatStatus` | L65 | 全局，A 在跑则 `"streaming"`，切到 B 后**仍是 streaming** |
| `activeRequestId: string \| null` | L67 | 单一 requestId，无法区分到底是哪个 session |
| `streamingSessionId: string \| null` | L83 | 仅供侧栏指示，**不参与发送/排队判定** |

被污染的下游：

- `InputArea` `canCancel = status === "sending" || status === "streaming"`（`InputArea.tsx` L63）→ B 上显示停止按钮、隐藏发送按钮。
- `sendMessage` 入队判定：`shouldEnqueueOnResend({ isStreamActive: isStreamActive(state.status) })`（`store.ts` L643）→ B 的发送被误入队。
- `editUserMessageAndResend` / `regenerateAssistantResponse` 守卫：`if (state.status === "sending" || state.status === "streaming") return;`（L888 / L1083）→ B 的编辑/重生成被全局阻塞。
- `cancel(client)` 只读单一 `activeRequestId`（L1436）→ 用户在 A 中点停止的语义被切到 B 后破坏。

切到 B 时 store 没有把"显示给 B 的 status"重新计算，从结构上根本做不到——只有一份 status。

## 目标

### P0（必做）
- 流式状态**按 sessionId 隔离**：A 在跑时切到 B，B 显示为 idle，可正常发送、不入排队。
- `cancel()` / 入队 / 守卫 / UI 显示**全部以"当前 active session"的状态为准**。
- 侧栏继续基于"哪些 session 正在跑"高亮（已有 3×3 dots，扩展为支持多 session 同时高亮）。
- 不破坏单 session 既有行为（中断保留 partial、queue、ChatErrorAlert 等）。

### P1（同 PR 顺手做）
- 支持**多 session 真并发**：两个 session 都在生成时各自显示自己的进度、互不阻塞。当前 SDK 已支持（`HttpChatClient.pending` 是 `Map<requestId, ...>`），主要是 store 层放开。

## 非目标
- 不改 SDK 协议、不改 gateway。
- 不改合规/鉴权/配额错误处理。
- 不实现"中途切回原会话查看实时流"以外的新交互（沿用既有 SSE 推到 store 后 UI 渲染）。
- 不动 Desktop。

## 设计

引入**按 session 的流状态映射**：

```ts
type SessionStreamState = {
  status: "sending" | "streaming";
  activeRequestId: string;
};

type ChatStoreState = {
  // ...保留:
  errorMessage: string | null;       // 仍是全局；后续可改成 byId，本期不动
  status: ChatStatus;                 // **保留作为派生字段**，由 selector 计算
  activeRequestId: string | null;     // **保留，用于兼容**，由 selector 计算
  streamingSessionId: string | null;  // **保留**，但语义转为「最近开始的 stream」，仅侧栏 fallback
  // 新增:
  streamStateBySessionId: Record<string, SessionStreamState>;
};
```

> 为最小化改动半径，**保留** `status` / `activeRequestId` 字段名，但其值由 active session 派生维护：每次 `set` 流状态时同时写 `streamStateBySessionId[sessionId]` 与 `status`/`activeRequestId`（仅当 sessionId === activeSessionId）。`switchSession` 切换时根据 `streamStateBySessionId[newId]` 重算 status/activeRequestId。

新增 selector：

```ts
export function selectIsStreamingForSession(state: ChatStoreState, sessionId: string | null): boolean;
export function selectActiveRequestIdForSession(state: ChatStoreState, sessionId: string | null): string | null;
```

UI 与 store 的 gate **改用 sessionId-aware 判断**，而不是全局 `status`。

## 实施步骤（给 Composer 2.5）

### Step 1 — 新增 selector 工具
新建 `enterprise/features/chat/src/utils/session-stream-state.ts`：

```ts
import type { ChatStoreState } from "../store";

export function isSessionStreaming(
  state: Pick<ChatStoreState, "streamStateBySessionId">,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  const s = state.streamStateBySessionId[sessionId];
  return s?.status === "sending" || s?.status === "streaming";
}

export function getSessionRequestId(
  state: Pick<ChatStoreState, "streamStateBySessionId">,
  sessionId: string | null,
): string | null {
  if (!sessionId) return null;
  return state.streamStateBySessionId[sessionId]?.activeRequestId ?? null;
}
```

并写单测 `session-stream-state.test.ts`（覆盖：空 map、不同 session 的不同 status、null sessionId）。

### Step 2 — 扩展 store state
文件：`enterprise/features/chat/src/store.ts`

- L60-L84 `ChatStoreState` 新增字段：
  ```ts
  streamStateBySessionId: Record<string, SessionStreamState>;
  ```
  并 export `SessionStreamState` 类型。
- 初始 state（L308-L371 的 base / hydrate 默认值）增加 `streamStateBySessionId: {}`。
- 新增内部 helper（紧邻 `addChunkToSessionTokens` 之后）：
  ```ts
  function setSessionStream(
    set: any, get: any,
    sessionId: string,
    next: SessionStreamState | null,
  ) {
    set((prev: ChatStoreState) => {
      const map = { ...prev.streamStateBySessionId };
      if (next) map[sessionId] = next; else delete map[sessionId];
      const isActive = prev.activeSessionId === sessionId;
      return {
        streamStateBySessionId: map,
        // 兼容字段：仅当当前 active session 是它时同步顶层字段
        ...(isActive ? {
          status: next?.status ?? "idle" as const,
          activeRequestId: next?.activeRequestId ?? null,
        } : {}),
        streamingSessionId: next ? sessionId
          : (prev.streamingSessionId === sessionId ? null : prev.streamingSessionId),
      };
    });
  }
  ```

### Step 3 — 三条流式路径用 helper 改写状态写入
文件：`enterprise/features/chat/src/store.ts`

把以下行替换为 `setSessionStream(set, get, sessionId, ...)`：

**sendMessage**（L745-L746 设 `sending`、L775 设 `streaming`、L779 / L789 / L836 / L863 清空、cancelled 分支 L778-L781）：
- 起始：`setSessionStream(set, get, sessionId, { status: "sending", activeRequestId: "" })`（注：requestId 在 `client.sendMessage` 后才有，可在拿到 requestId 后再调用一次更新为 `streaming`）
- 拿到 `requestId` 后：`setSessionStream(set, get, sessionId, { status: "streaming", activeRequestId: requestId })`
- cancelled 分支：`setSessionStream(set, get, sessionId, null)` + `set({ errorMessage: null })`
- error / done / catch：同样 `setSessionStream(set, get, sessionId, null)`，**不要**再手写 `status: "idle", activeRequestId: null, streamingSessionId: null`。

**editUserMessageAndResend** L959-L960 / L989 / L1054 / L1074：同上。

**regenerateAssistantResponse** L1144-L1145 / L1169 / L1234 / L1254：同上。

> 注意：保留 `errorMessage` 的设置逻辑不变（错误分支仍 `set({ errorMessage: ... })`），因为 errorMessage 这一期不做 byId。

### Step 4 — 入队 / 守卫改为按 session 判定
文件：`enterprise/features/chat/src/store.ts`

- **L643** `sendMessage` 入队判定：
  ```ts
  if (shouldEnqueueOnResend({
    isStreamActive: isSessionStreaming(state, sessionId),
    forceSend: options?.forceSend,
  })) { ... }
  ```
- **L660** `forceSend` 中断：
  ```ts
  if (options?.forceSend && isSessionStreaming(get(), sessionId)) {
    await get().cancel(client); // cancel 也要按 session，详见 Step 5
  }
  ```
- **L888** `editUserMessageAndResend` 守卫：
  ```ts
  if (isSessionStreaming(state, state.activeSessionId)) return;
  ```
- **L1083** `regenerateAssistantResponse` 守卫：同上。
- **L868** `finally` 中的 dequeue 判定：
  ```ts
  if (isSessionStreaming(get(), sid)) return;
  ```

> 别忘了在文件顶部 `import { isSessionStreaming, getSessionRequestId } from "./utils/session-stream-state";`。

### Step 5 — `cancel()` 按 session 取消
文件：`enterprise/features/chat/src/store.ts` L1434-L1438

```ts
async cancel(client) {
  const state = get();
  const sessionId = state.activeSessionId;
  if (!sessionId) return;
  const requestId = getSessionRequestId(state, sessionId);
  if (!requestId) return;
  await client.cancel(requestId);
  // 状态收敛由 stream 循环的 cancelled 分支处理（已在前一个 plan 落地）
},
```

### Step 6 — `switchSession` 重算顶层兼容字段
文件：`enterprise/features/chat/src/store.ts`（`switchSession` 实现处，搜索 `switchSession` 函数）

切换 session 完成后，根据新 session 的 `streamStateBySessionId[newId]` 重置顶层 `status` / `activeRequestId` / `errorMessage`：
- 如果新 session 在跑：`status = streamStateBySessionId[newId].status`，`activeRequestId = ...activeRequestId`。
- 否则：`status = "idle"`, `activeRequestId = null`。
- `errorMessage` 切 session 时清空（避免 A 的 error 残留到 B）。

### Step 7 — UI 消费改为按 active session（多数随 Step 3 自动满足）
文件：`enterprise/apps/web-portal/src/components/MachiChatView.tsx`、`enterprise/features/chat/src/components/molecules/InputArea.tsx`

- 由于 Step 3 已让顶层 `status` 与 active session 同步，`InputArea status={status}` **无需修改**。
- 但 `MessageQueuePanel` 当前按 `pendingMessages.filter(sessionId === activeSessionId)`，已正确（无需改）。
- **可选检查**：`MachiChatView` L414 `<MessageQueuePanel status={status} />` 这里 `status` 现在是 active session 的，逻辑就对了。

### Step 8 — 侧栏多 session 高亮
文件：`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`（L132 / L319）

```ts
const streamStateBySessionId = useChatStore((s) => s.streamStateBySessionId);
// ...
isGenerating={Boolean(streamStateBySessionId[item.id])}
```
让多个并发 session 同时高亮（之前只有一个 `streamingSessionId` 字段，最多一个高亮）。

### Step 9 — 单元测试
- `enterprise/features/chat/src/store.multi-session.test.ts`（新建）：
  - 启动 session A 流式（用 mock client 不让它结束），切到 session B，断言 `isSessionStreaming(state, B) === false`，顶层 `status === "idle"`。
  - 在 B 调用 `sendMessage(client, { content: "继续" })`，断言**不**进入 `pendingMessages`（队列长度 0）。
  - A 仍在跑：断言 `isSessionStreaming(state, A) === true`，`streamStateBySessionId[A].status` 存在。
- 既有 `store.history.test.ts` / `store.interrupt.test.ts` 应继续通过；如需补 fixture，加 `streamStateBySessionId: {}`。

## 验收标准（AC）

- AC-1：A 流式中切到 B，B 输入框显示发送按钮（不显示停止），输入文字点发送**不**进入排队、立即触发请求。
- AC-2：A 流式中切到 B，B 不显示思考动画/`Thinking` 标记。
- AC-3：B 发送进入 streaming 后，A 的状态不被覆盖；切回 A 仍显示 A 自己的流式。
- AC-4：A 中点停止，仅 A 的请求被 abort、保留 partial（沿用上一 plan 行为）；B 不受影响。
- AC-5：侧栏 A 与 B 同时跑时各自显示生成中 dots。
- AC-6：`pnpm -C enterprise/features/chat test` 与 typecheck 通过；不破坏既有 20 条测试。
- AC-7：手测：A 跑中，在 B 编辑历史用户消息重发不被阻塞。

## 验证命令
```bash
pnpm -C enterprise/features/chat test
pnpm -C enterprise/features/chat typecheck
pnpm -C enterprise/packages/sdk-ts test
# 受影响应用 typecheck/build
pnpm -C enterprise/apps/web-portal typecheck
```

## 影响文件清单
- `enterprise/features/chat/src/store.ts`（核心）
- `enterprise/features/chat/src/utils/session-stream-state.ts`（新增）
- `enterprise/features/chat/src/utils/session-stream-state.test.ts`（新增）
- `enterprise/features/chat/src/store.multi-session.test.ts`（新增）
- `enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`（侧栏高亮）

## 风险与回退
- 风险：`finally` 中的 dequeue 时机依赖 status 收敛——Step 3 用 helper 集中写后保持顺序不变，应无回归；用 `store.interrupt.test.ts` 守住。
- 风险：`switchSession` 同步 errorMessage 清空可能导致用户切走再切回看不到错误——可接受（错误条本来就和当下输入流绑定）；如需保留，按 sessionId 做 errorMessage 二期再说。
- 风险：单 session 用户的既有行为变化——`status` 仍由 active session 派生，对 UI 完全等价。
- 回退：单 commit，按 Plan-Id revert。
