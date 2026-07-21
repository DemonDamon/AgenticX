# @agenticx/sdk-ts 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`@agenticx/sdk-ts` 是**真实可用**的轻量 TypeScript 客户端 SDK（`package.json` description："TypeScript 客户端 SDK（给 Machi 接）"），非 stub。暴露 `ChatClient` 接口与 `MockChatClient` / `HttpChatClient` 两种实现，支持 SSE 流式输出、附件多模态、用户主动中断。web-portal 已在 `WorkspaceClient.tsx` 中真实消费。

## 目录结构

```
packages/sdk-ts/
├── package.json             # @agenticx/sdk-ts，private，main/types → ./src/index.ts
├── README.md                 # 一行说明
├── tsconfig.json
└── src/
    ├── index.ts              # 透传 types + chat/{client,mock,http}
    ├── types.ts              # ChatRole/ChatMessage/ChatRequest/ChatUsage/ChatChunk/SendMessageResult/ChatMessageAttachment
    └── chat/
        ├── client.ts         # ChatClient 接口
        ├── mock.ts           # MockChatClient（逐字符 50ms 模拟流）
        ├── http.ts           # HttpChatClient（fetch + SSE 解析 + AbortController）
        ├── multimodal.ts     # buildOpenAIMessageContent / toGatewayMessage（图片→image_url）
        └── http.test.ts      # vitest：中断时 yield cancelled chunk 不带 error
```

## 关键导出

**类型**（`types.ts`）：`ChatRole`（system/user/assistant）、`ChatMessageAttachment`、`ChatMessage`（含 `attachments?`）、`ChatRequest`、`ChatUsage`、`ChatChunk`（含 `cancelled?` / `usage?` / `error?`）、`SendMessageResult`

**接口**（`client.ts`）：
```ts
ChatClient {
  sendMessage(req: ChatRequest): Promise<SendMessageResult>
  stream(requestId: string): AsyncIterable<ChatChunk>
  cancel(requestId: string): Promise<void>
}
```

**实现**：`MockChatClient`、`HttpChatClient`、`buildOpenAIMessageContent`、`toGatewayMessage`

## 显著模式

- **requestId 生成**：`crypto.randomUUID()` 优先，缺失时 fallback `http_${Date.now()}_${rand}`（mock 用 `mock_` 前缀）
- **两阶段调用**：`sendMessage` 仅登记 pending 并立即返回 `requestId`，真正请求在 `stream(requestId)` 内发起（fetch POST），与 cancel 解耦
- **SSE 手工解析**：按 `\n\n` 分帧、`data:` 行聚合、识别 `[DONE]`；同时兼容 gateway 自定义 `agenticx_usage` 事件与上游标准 `usage` 字段，二者都转成 `ChatChunk.usage`（非终止帧）
- **delta 合并**：`pickStreamDelta` 把 `content` 与 `reasoning_content` 拼成单 `delta`（推理内容也走 delta 通道）；`finish_reason === "stop"` 才发终止帧
- **错误信封**：`parseErrorPayload` 解 gateway `{ error: { code, message } }`，未知 code 默认 `"50000"`
- **中断语义**：`cancel` 置 `cancelled=true` 并 `AbortController.abort()`；fetch 抛错时若已 cancelled 则 yield `{ done: true, cancelled: true }`（**不带 error**），否则 yield error 帧——`http.test.ts` 专门锁定此行为
- **多模态**：`toGatewayMessage` 把带 `image/*` 附件的消息转成 OpenAI `content` 数组（`text` + `image_url`），纯文本仍返回 string
- **窄契约**：`ChatMessage` 不含 tenant/tool_calls，比 `@agenticx/core-api` 的 chat 类型更窄——SDK 故意收窄
- **默认 endpoint**：`/api/chat/completions`，可通过 `{ endpoint }` 覆盖；请求带 `x-chat-session-id` header

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | 直接消费 | `WorkspaceClient.tsx` import `HttpChatClient`/`MockChatClient`，endpoint `/api/chat/completions` |
| `apps/gateway` | 被调用方 | HttpChatClient POST 到 gateway 的 `/v1/chat/completions`（web-portal 经 next 代理） |
| `packages/core-api` | 类型契约源 | 错误码 / chat 类型源头；本 SDK 是其窄化客户端视图 |
| Machi 桌面（主仓） | 目标消费者 | description 标注"给 Machi 接"，预留桌面端接 enterprise gateway |
