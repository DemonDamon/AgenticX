# Machi 桌面端消息排队

## 需求

- FR-1: 模型生成中用户发送新消息时默认**入队**，不中断当前回复
- FR-2: 当前轮次结束后自动按 FIFO 发送队首消息
- FR-3: 用户可通过排队项「立即发送」按钮或 **Enter 连按两次** 强制插队（中断当前生成并发送）
- FR-4: 排队区展示在输入框上方（可折叠），支持编辑/删除
- AC-1: `ChatPane` 生成中 Enter 一次 → 入队并清空输入
- AC-2: 生成中 Enter 两次（400ms 内）→ 立即发送输入内容
- AC-3: 队首在 `sendChat` finally 中自动 dequeue 续发
- FR-5: 强制插队中断时若上一轮无 assistant 落盘，自动追加「（已中断）」assistant 占位到 `messages.json`，避免下一请求出现 user → user 串问导致模型一并作答（context bleed）
- AC-4: 中断 query1 后再发 query2，模型只回答 query2，不再追溯回答 query1

## 改动范围

- `desktop/src/store.ts` — `takePendingMessage`
- `desktop/src/utils/streaming-stop-policy.ts` — 排队/双击 Enter 策略
- `desktop/src/components/messages/MessageQueuePanel.tsx` — 新建
- `desktop/src/components/messages/QueuedMessageBubble.tsx` — 立即发送
- `desktop/src/components/ChatPane.tsx` — 主逻辑
- `desktop/src/components/ChatView.tsx` — Lite 对齐
