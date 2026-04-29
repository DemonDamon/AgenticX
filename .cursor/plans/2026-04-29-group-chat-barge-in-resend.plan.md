# Plan: 群聊打断 + 追问 barge-in 语义

Plan-Id: 2026-04-29-group-chat-barge-in-resend
Plan-File: .cursor/plans/2026-04-29-group-chat-barge-in-resend.plan.md
Status: implemented

## 背景

用户在群聊里观察到两个明显的体验缺陷：

1. **群聊里没有「停止/打断」按钮** —— 模型在响应、`正在输入...` 一直转，
   但没有任何 UI 入口能中断当前生成。
2. **流式中再发送只会进入「排队中 #1/n」** —— 用户期望的语义是
   「打断当前生成 + 把已生成的部分作为历史 + Q2 作为新一轮」，
   即 Cursor / ChatGPT / Claude.ai 的 barge-in 体验，而不是串行队列。

## 根因（已通过代码定位）

- `desktop/src/components/ChatPane.tsx`
  - `isStreamingCurrentSession` 中包含 `!isGroupPane`：群聊永远为 false，
    导致 `ActionCircleButton` 在群聊里永远显示「发送」、不显示「停止」。
  - 发送路径里 `if (sessionStreamStateRef.current[requestSessionId]?.active)`
    的分支直接 `enqueuePaneMessage` 后 `return`，导致所有面板（含群聊）
    流式中的二次发送都会被串行排队。
- 后端 `interruptSession` 接口本来就支持，群聊只是缺 UI 入口。
- `groupTyping` 的清空、SSE finally 提交 partial assistant 消息的链路，
  在 abort 路径上是齐的，无需改后端 / SSE。

## FR / AC

### FR-1：群聊里也能停止当前生成
- AC-1.1 群聊 pane 在流式中，输入区右侧按钮显示「停止」（与单聊一致）。
- AC-1.2 点击「停止」后：
  - 调用 `interruptSession` HTTP 接口；
  - 中止当前 fetch；
  - typing 气泡消失；
  - 已生成的 partial 由现有 SSE finally 块提交为 assistant 历史。

### FR-2：流式中追问采用 barge-in 语义
- AC-2.1 流式中再次发送，**不再进入「排队中」气泡**。
- AC-2.2 自动执行：abort 当前 → 清流式 state → 继续走原发送路径。
- AC-2.3 历史保留为：`user(Q1) → assistant(部分回复) → user(Q2) → assistant(...)`。
  上下文由模型自然消费（不主动拼接 Q1+部分+Q2 为单条 prompt）。

### FR-3：策略与显示判断纯函数化
- AC-3.1 抽出 `streaming-stop-policy.ts`，提供 `canStopCurrentRun` 与
  `shouldInterruptOnResend` 两个纯函数，并配 unit tests 锁住「群聊也应可见」
  与「流活跃→打断」语义。

### NFR
- NFR-1 不破坏 `forwardAutoReply` / `dequeuePaneMessage` 兜底路径
  （保留 store 与 finally dequeue 不动）。
- NFR-2 不动 `isStreamingCurrentSession` 的语义，避免影响 stream overlay /
  stall 检测 / `__stream__` 气泡渲染。
- NFR-3 不引入新依赖；测试用 `node:test` + `tsx`（与 desktop 既有测试一致）。
- NFR-4 不超出本次范围（no-scope-creep）：Lite 模式 `ChatView.tsx` 的 enqueue
  路径如有同类问题，留作后续单独评估。

## 影响范围

- `desktop/src/utils/streaming-stop-policy.ts` (新增)
- `desktop/src/utils/streaming-stop-policy.test.ts` (新增, 8 cases)
- `desktop/src/components/ChatPane.tsx`
  - 新增 `canInterruptCurrentSession` 派生
  - `ActionCircleButton` 的 `streaming` 改用 `canInterruptCurrentSession`
  - enqueue 分支改为 abort + 继续

## 验证

- `npx tsx --test src/utils/streaming-stop-policy.test.ts ...` → 12/12 pass
  （含原有 mcp-toggle-state、session-history-logic 测试）
- `ReadLints` 修改文件均无 lint 报错

## Out of Scope

- Lite 模式 `ChatView.tsx` 的同等改造
- 群聊 typing 气泡旁内联停止按钮（Q2=A 已选输入区方案，更省视觉）
- 主动合并 Q1+partial+Q2 为单条 user message（Q3=A 已否决）
