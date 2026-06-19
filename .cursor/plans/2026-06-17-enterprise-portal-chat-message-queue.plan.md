# Enterprise Portal 流式输出消息排队

## What & Why

Enterprise web-portal 聊天在模型流式生成时，输入区仅显示 Stop，用户无法继续发送后续消息排队等待。对齐 Near Desktop「1 条排队 / Enter 再按一次立即发送」体验。

## Requirements

- FR-1: 流式/发送中时，用户 Enter 或点发送应将消息入队，而非丢弃或阻塞
- FR-2: 输入区上方展示排队列表（可折叠、编辑、移除、立即发送）
- FR-3: 当前轮次结束后自动发送队列首条
- FR-4: 400ms 内连按两次 Enter 或队列「立即发送」应中断当前流并优先发送
- FR-5: Stop 与 Send 按钮并存（生成中仍可入队）
- AC-1: 流式中发送第二条消息，队列显示 1 条，当前轮结束后自动发出
- AC-2: 双击 Enter 中断当前生成并立即发送输入内容
- AC-3: `pnpm -C enterprise/features/chat test` 与 web-portal typecheck 通过

## Implementation

- `enterprise/features/chat/src/store.ts` — `pendingMessages`、enqueue/dequeue、`sendMessage` options
- `enterprise/features/chat/src/components/molecules/MessageQueuePanel.tsx`
- `enterprise/features/chat/src/components/molecules/QueuedMessageBubble.tsx`
- `enterprise/features/chat/src/components/molecules/InputArea.tsx` — 流式中 Send + Stop
- `enterprise/apps/web-portal/src/components/MachiChatView.tsx` — 接线队列 UI
