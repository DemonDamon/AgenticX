---
name: ChatPane streaming message queue fix
overview: 修复生成/工具执行中 Enter 或排队发送无反应：sendChat 在持锁前优先入队，避免 concurrent send 被静默丢弃。
todos:
  - id: t1-stream-active-helper
    content: streaming-stop-policy 新增 isStreamRunActiveForQueue
    status: completed
  - id: t2-sendchat-enqueue-first
    content: ChatPane sendChat 持锁前 tryEnqueueFollowUp
    status: completed
  - id: t3-enter-handler
    content: Enter 键 streamActive 判定与 sendChat 对齐
    status: completed
isProject: false
---

# ChatPane：生成中 Enter 排队发送修复

**Plan-Id**: 2026-06-15-chatpane-streaming-message-queue
**Plan-File**: `.cursor/plans/2026-06-15-chatpane-streaming-message-queue.plan.md`
**Made-with**: Damon Li

## 背景

用户在助手运行中（任务进度 / bash_exec / 正在思考）输入追问并按 Enter，或点击「排队发送」，输入框无清空、消息未进入排队区。根因：`sendChat` 在 `sendChatInFlightRef` 持锁分支直接 `dropped concurrent sendChat` 返回，排队逻辑位于持锁之后，永远执行不到。

## 需求

- FR-1: 流式/工具执行进行中，Enter 或排队按钮应将消息写入 `pendingMessages` 并清空输入框。
- FR-2: `isStreamRunActive` 判定需覆盖 SSE active、同 session send lock、后端 `executionState=running`。
- FR-3: 连按两次 Enter / forceSend 仍走打断续发，不入队。
- AC-1: 生成中输入「执行完之后…」按 Enter，输入区清空且排队面板出现该条消息。

## 改动文件

- `desktop/src/utils/streaming-stop-policy.ts` — `isStreamRunActiveForQueue`
- `desktop/src/utils/streaming-stop-policy.test.ts`
- `desktop/src/components/ChatPane.tsx` — `tryEnqueueFollowUp` 提前至持锁前

## 非目标

- 不改 ChatView Lite 路径（已在持锁前 enqueue）。
- 不改 composerExpanded 下 Enter 换行语义。
