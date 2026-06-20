# Enterprise 聊天：中断流式输出后保留已生成内容（对齐豆包）

Planned-with: claude-opus-4.8

## 背景与问题

Enterprise web-portal 聊天在流式输出过程中点「停止」后，UI 出现两个问题（见用户截图）：

1. 正在输出的助手气泡内容被整段替换成 `request cancelled`。
2. 顶部弹出黄色「聊天请求失败 / request cancelled」错误条。

豆包的预期行为是：**流式输出到哪就停在哪，已生成的内容原样保留**，并且这段已生成内容会作为上下文带入后续追问。

## 根因（已核实，含代码锚点）

「用户主动中断」当前被当成「请求错误」处理：

1. `enterprise/packages/sdk-ts/src/chat/http.ts` 的 `stream()` 在 `catch` 中（约 L213-L221），无论是用户 abort 还是真失败，都 yield 一个 `error` chunk（cancel 时 code `49900` / message `request cancelled`）。`ChatChunk` 类型（`enterprise/packages/sdk-ts/src/types.ts` L31-L40）没有「cancelled」语义，只有 `error`。
2. `enterprise/features/chat/src/store.ts` 三条流式路径的 `for await` 循环里，凡是收到 `chunk.error` 就：把助手气泡 content 覆盖为 `toComplianceMessage(...)`、设置 `errorMessage`、`status: idle`，并 `return`（**跳过**后续 persist）。三处分别在：
   - `sendMessage`：L777-L791
   - `editUserMessageAndResend`：L986-L1001
   - `regenerateAssistantResponse`：L1161-L1176
3. `cancel(client)`（L1420-L1425）只是 `client.cancel(requestId)` + 置 idle，**没有**把「这是用户主动中断」的意图传给正在跑的 stream 循环，循环仍按 error 路径处理。

结论：partial 文本其实已经在 `messages` 里（每个 `chunk.delta` 已追加），只是被 error 分支覆盖、且没落库。

## 目标

### P0（必做）
- 用户主动中断后：**保留已生成的 partial 文本**，不覆盖、不弹错误条。
- 中断的 partial **落库持久化**（刷新/切会话后仍在）。
- 三条流式路径（send / edit-resend / regenerate）行为一致。

### P1（体验对齐，多数随 P0 自动满足）
- 中断后的下一条追问，已生成的 partial 作为上下文带入（因 partial 已留在 `messages` 且落库，下一轮 `toSdkRequest` 自然包含，无需改 gateway）。
- P1 仅需在 P0 完成后用「中断 → 追问」手测确认上下文确实带入；**不**实现「续写同一条 assistant」语义（留二期）。

## 非目标（明确不做）
- 不改 Go gateway（`enterprise/apps/gateway/**`）。
- 不实现 Desktop 式 `continue` 续写 API。
- 不改合规拦截（`90001/90002`）、鉴权（`40100/40300`）、配额（`42901`）等**真错误**的现有处理；这些仍走 error 分支弹错误条。
- 不动多选、滚动 FAB、生成中动画等无关逻辑。

## 实施步骤（按文件，给 Composer 2.5）

### Step 1 — SDK 类型：给 chunk 增加 cancelled 语义
文件：`enterprise/packages/sdk-ts/src/types.ts`

在 `ChatChunk`（L31-L40）增加可选字段：
```ts
export type ChatChunk = {
  requestId: string;
  delta?: string;
  done: boolean;
  usage?: ChatUsage;
  /** 用户主动中断（非错误）：保留已生成内容，不视为失败。 */
  cancelled?: boolean;
  error?: {
    code: string;
    message: string;
  };
};
```

### Step 2 — HttpChatClient：中断 yield cancelled 而非 error
文件：`enterprise/packages/sdk-ts/src/chat/http.ts`

`stream()` 的 `catch (error)` 块（约 L213-L221）改为：当 `pending.cancelled === true` 时，yield 一个**非 error** 的结束 chunk：
```ts
} catch (error) {
  if (pending.cancelled) {
    yield { requestId, done: true, cancelled: true };
  } else {
    yield {
      requestId,
      done: true,
      error: {
        code: "50000",
        message: error instanceof Error ? error.message : "request failed",
      },
    };
  }
}
```
（保持 `finally` 中 `this.pending.delete` / `this.controllers.delete` 不变。）

同步更新 `enterprise/packages/sdk-ts/src/chat/mock.ts` 的 cancel 分支（约 L59-L70）：把当前 yield 的 `error: { code: "REQUEST_CANCELLED" ... }` 改为 `{ requestId, done: true, cancelled: true }`，保证 mock 与 http 行为一致（单测依赖 mock）。

### Step 3 — store：三条流式循环新增 cancelled 分支 + 落库 partial
文件：`enterprise/features/chat/src/store.ts`

为避免重复代码，**先在文件内新增一个模块级 helper**（放在 `toComplianceMessage` import 之后、store 工厂函数之前的合适位置）：

```ts
/** 用户主动中断：保留 partial、清错误、置 idle。返回 true 表示循环应 break/return。 */
function applyCancelledState(
  set: (partial: any) => void,
): void {
  set({
    status: "idle",
    errorMessage: null,
    activeRequestId: null,
    streamingSessionId: null,
  });
}
```
> 注：若 store 内 `set` 类型不便直接传，可不抽 helper，直接在三处内联同样的 4 个字段 set。优先保证类型干净。

然后在三条路径的 `for await` 循环中，**在 `if (chunk.error) {...}` 之前**新增：

```ts
if (chunk.cancelled) {
  set({ status: "idle", errorMessage: null, activeRequestId: null, streamingSessionId: null });
  break; // 跳出循环，落到循环后的 persist 逻辑
}
```

三处位置：
- `sendMessage`：紧邻 L778 `if (chunk.error)` 前。
- `editUserMessageAndResend`：紧邻 L987 `if (chunk.error)` 前。
- `regenerateAssistantResponse`：紧邻 L1162 `if (chunk.error)` 前。

> 关键：用 `break`（不是 `return`），让循环后的 persist 代码执行，把 partial 落库。

### Step 4 — 确认 persist 条件不被 cancelled 拦掉
文件：`enterprise/features/chat/src/store.ts`

三处循环后的 persist 守卫当前是 `if (after.status !== "error" && after.hydrated)`：
- `sendMessage`：L840-L853（`portalHistory.appendMessages`）
- `editUserMessageAndResend`：L1048-L1058（`portalHistory.replaceMessages`）
- `regenerateAssistantResponse`：L1223-L1233（`portalHistory.replaceMessages`）

cancelled 分支已把 status 置为 `idle`（非 `error`），所以这些 persist 会正常执行——**确认无需改动**，但要在实现时核对：cancelled 后 `after.status === "idle"` 成立。
- 特例：`sendMessage` 的 persist 取 `userMessage` / `assistantMessage` 两条 append。中断时 assistant content 为 partial（可能为空字符串）。**若 partial 为空串**，仍 append（豆包中断空内容也会留空助手轮次）；保持现状即可，不额外加空判断。

### Step 5 — cancel() 不再与循环抢状态
文件：`enterprise/features/chat/src/store.ts` `cancel(client)`（L1420-L1425）

保持调用 `client.cancel(requestId)`，但**移除**其中直接 `set({ status:"idle", ... })` 的副作用改为仅触发 abort，让状态收敛**统一交给 stream 循环的 cancelled 分支**处理，避免「cancel 先置 idle、循环又置一次」的竞态与状态闪烁：

```ts
async cancel(client) {
  const requestId = get().activeRequestId;
  if (!requestId) return;
  await client.cancel(requestId); // 触发 abort，循环会收到 cancelled chunk 并收敛状态
},
```
> 若担心某些 client 实现不 yield cancelled（如旧 mock），Step 2 已统一 mock；保险起见可保留一个兜底：abort 后若 200ms 内循环未收敛，再置 idle。**默认不加兜底**，保持简单；如手测发现卡在 streaming 再补。

### Step 6 — 单元测试
新增/更新（vitest，目录 `enterprise/features/chat/src/...` 或 `sdk-ts`）：

1. `enterprise/packages/sdk-ts/src/chat/http.test.ts`（若无则新建）：
   - mock fetch + abort，断言 cancel 后 `stream()` 末尾 yield `{ done:true, cancelled:true }`，**不**含 `error`。
2. store 中断测试（参考已有 `enterprise/features/chat/src/store.history.test.ts` 写法，用 `MockChatClient`）：
   - AC：流式途中调用 `cancel()` 后，目标 assistant 消息 content 等于已接收的 partial（非 `request cancelled`），`errorMessage === null`，`status === "idle"`。
   - AC：中断后调用 `appendMessages`/`replaceMessages` 的 mock 被调用（partial 已落库）。

## 验收标准（AC）
- AC-1：流式输出途中点停止，助手气泡保留已生成文本，不被 `request cancelled` 覆盖。
- AC-2：中断后**不**出现黄色「聊天请求失败」错误条。
- AC-3：中断后刷新页面 / 切走再切回，该 partial 仍在（已落库）。
- AC-4：中断后继续追问，新一轮请求的 messages 包含上一轮 partial（开发者工具 Network 看 `/api/chat/completions` 请求体确认）。
- AC-5：真实错误（断网 / 网关 500 / 合规 90001）仍走 error 分支，正常弹错误条——回归不破。
- AC-6：三条路径（首发送 / 编辑重发 / 重新生成）中断行为一致。
- AC-7：`pnpm -C enterprise/features/chat test` 与相关 typecheck/build 通过。

## 验证命令
```bash
pnpm -C enterprise/features/chat test
pnpm -C enterprise/packages/sdk-ts test   # 若该包配置了 test
# 受影响应用 typecheck/build（按仓库习惯）
```

## 影响文件清单
- `enterprise/packages/sdk-ts/src/types.ts`
- `enterprise/packages/sdk-ts/src/chat/http.ts`
- `enterprise/packages/sdk-ts/src/chat/mock.ts`
- `enterprise/features/chat/src/store.ts`
- `enterprise/packages/sdk-ts/src/chat/http.test.ts`（新增）
- `enterprise/features/chat/src/store.interrupt.test.ts`（新增，或并入既有 store 测试文件）

## 风险与回退
- 风险：cancel 与循环状态竞态导致卡在 streaming → 由 Step 5 兜底说明处理。
- 风险：partial 落库后若用户期望「丢弃」→ 本需求明确要保留，符合豆包，不做丢弃。
- 回退：单 commit，按 Plan-Id 可整体 revert。
