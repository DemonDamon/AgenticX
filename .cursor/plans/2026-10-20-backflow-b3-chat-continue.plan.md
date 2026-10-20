# 能力回流 B3：普通聊天的中断标记、断点落盘与继续生成

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B2（SDK 能把未完成流报成 `error.origin = "transport"`）

## 目标

员工在门户普通对话里：

1. 正在生成时刷新页面、断网、点停止，或流被提前掐断，已经生成的内容保留在历史里，消息上有「已中断」标记。
2. 这类消息下方出现「继续生成」，点击后接着已有内容往下写，不从头重来。
3. 回答只有推理、没有正文就结束时，显示「模型没有给出回答」类提示，而不是空白；推理内容保留可展开。
4. 失败提示、推理内容不会被当成历史再发给模型。
5. 流式输出合批渲染，长回答时页面不卡。

## 现状（已核实）

- 消息类型：`enterprise/packages/core-api/src/chat.ts` L174–198 `ChatMessage`，没有 `status`、没有 `interruption`。
- 门户落库：`enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts` L87 `serializeMessageMetadata`（只写 attachments / web_search_sources / deep_research / trace_id）、L111 `mapMessage`。表 `chat_messages` 已有 `status`（`complete|streaming|failed`）与 `metadata` 列，**无需迁移**。
- 入站清洗：`enterprise/apps/web-portal/src/lib/chat-message-sanitize.ts` L267 `sanitizeInboundMessages`。
- 前端 store：`enterprise/features/chat/src/store.ts`（2745 行）。`filterMessagesForCompletion` L318（只滤掉空助手占位）；`sendMessage` L1660；深度研究专用 8 秒落盘 `DEEP_RESEARCH_CHECKPOINT_MS` L79 与 `checkpointDeepResearchTurn` L1842；落库普遍以 `get().hydrated` 为前提（L1838 等）。没有普通回答落盘、没有 `continueResponse`。
- 内容解析：`enterprise/features/chat/src/assistant-content.ts`（201 行）`parseAssistantContent(message)`，无第二参数，无空回复处理。
- 来源（`$DELIVERY_REPO`，用 `git -C $DELIVERY_REPO show <hash>` 读）：
  - `63a345c1` 停止可持久化、中断后继续（引入 `interruption`、`turn-continuation.ts`、`continueResponse`）
  - `d822cf89` 推理中断后只续可见答案
  - `faac3f77` 流式回答落盘（`features/chat/src/utils/response-checkpoint.ts`）
  - `975a09c4` 追加终止提示时保留落盘前缀
  - `1f918bc7` 首次落盘提前到 1 秒
  - `9c85a0aa` 空回答显示提示并保留推理（含 `finish_reason=length` 视为截断）
  - `39009adc` 中断推理收成可恢复的缺答
  - `b1d6ae80` 流显示状态显式化、恢复提示文案共享（`apps/web-portal/src/lib/chat-error-i18n.ts`）
  - `4eff8c00` 发给模型的历史剔除失败提示与推理
  - `0bcd2e42` 流式文本合批（`features/chat/src/utils/stream-text-buffer.ts`）

## 改动

按下面顺序做，每一步都可单测。

### 1. 中断标记（数据契约）

- `core-api/src/chat.ts` `ChatMessage` 加：

```ts
/** 助手回答未正常结束时的说明；contentLength 之前是模型真实输出，之后是系统追加的提示。 */
interruption?: {
  reason: "cancelled" | "failed" | "disconnected";
  contentLength: number;
};
```

  若交付仓同一提交还给 `ChatMessage` 加了 `status` 或 `reasoning` 落库字段，一并照搬（主仓 `reasoning?` 已存在，只需确认是否落库）。
- `sql-store.ts`：`serializeMessageMetadata` 写入 `interruption`（及交付仓同时写入的 `reasoning`）；`mapMessage` 读回。追加 / 更新消息时：已是完成态且无 `interruption` 的行，禁止再被写成 `disconnected`（交付仓 `sql-store.ts` 对应判断，约 L581–L583）。
- `chat-message-sanitize.ts`：增加 `sanitizeInterruption`（只接受上述三种 reason 与非负整数 `contentLength`，`contentLength` 不超过 content 长度），在入站清洗里应用。

### 2. 流式落盘

- 新文件 `features/chat/src/utils/response-checkpoint.ts`（+ test）：照搬 `createResponseCheckpoint`（首次 1 秒；之后增长 ≥ 2000 字符用 5 秒间隔，否则 15 秒；保存中不重入；`stop()` 后不再写）。
- `store.ts`：普通对话发送时为助手消息创建 checkpoint，每次内容变长调用 `changed()`；保存的快照带 `interruption: { reason: "disconnected", contentLength: 当前长度 }`，正常结束时最终保存会清掉 `interruption`。深度研究原有 8 秒落盘逻辑不动。
- 落盘条件：本计划内仍以 `hydrated` 为准（放宽到「列表加载完即可」是 B4 的事）。

### 3. 停止、失败、掐断的收尾

- 用户点停止：保留已输出内容，写 `interruption.reason = "cancelled"`，`contentLength` = 当时内容长度。
- SDK 返回 `error`（含 B2 的 `origin: "transport"`）：保留内容，在 `contentLength` 之后追加一行提示，`reason = "failed"`（传输中断用 `"disconnected"`）。
- 追加提示时保留已落盘前缀（`975a09c4`）。

### 4. 空回答与中断推理

- `assistant-content.ts`：`parseAssistantContent(message, streaming = false)`：
  - 非流式、可见正文为空、且有 `interruption` 或推理未闭合时，`displayContent` 用「模型没有给出回答」提示（文案走第 6 步的 i18n key）。
  - 新增 `prepareAssistantContinuation(message)`：闭合未完成的推理标记，返回 `{ requestContent, displayPrefix }`，供继续生成和历史过滤使用。
- `store.ts`：流结束时可见正文为空 → 标 `interruption`（保留 `reasoning`）；`finish_reason` 为 `length` / `max_tokens` → 视为截断，追加「回答达到长度上限，已停止」提示并标 `interruption`。

### 5. 继续生成

- 新文件 `features/chat/src/utils/turn-continuation.ts`：`findContinuableResponse(messages)` —— 最后一条助手消息有 `interruption` 时返回它，否则 `null`。
- `store.ts` 新 action `continueResponse(client, messageId, options?)`：把该助手消息 `contentLength` 之前的内容（经 `prepareAssistantContinuation` 去掉推理）作为前缀，按交付仓 `63a345c1` / `d822cf89` 的请求构造方式续写，新输出拼接到前缀之后写回同一条消息；成功结束清掉 `interruption`；再次失败按第 3 步处理。
- 门户 `MachiChatView.tsx`：对 `findContinuableResponse` 命中的消息，在消息操作区（或输入区上方，以交付仓位置为准）显示「继续生成」按钮；生成中不显示。只接入普通对话消息，深度研究消息不显示（B6 有自己的「继续完成报告」）。

### 6. 恢复提示文案

- 新文件 `apps/web-portal/src/lib/chat-error-i18n.ts`（+ test）：`localizeChatMessageError` 只翻译 `contentLength` 之后的系统提示，不动模型正文与推理；文案 key 放 `messages/{zh,en}.json` 的 `errors.emptyResponse`、`errors.interrupted`、`errors.truncated`、`errors.transport`（定点插入）。

### 7. 发给模型的历史

- `store.ts` `filterMessagesForCompletion`：助手消息只取 `contentLength` 之前的内容，再经 `prepareAssistantContinuation().requestContent` 去掉推理；结果为空则整条不发。原有「去掉空占位」行为保留。

### 8. 流式合批

- 新文件 `features/chat/src/utils/stream-text-buffer.ts`（+ test）：首个片段立即刷新；之后 80ms 合并（正文超过 20000 字符时 160ms）；计时器回调异常经 `pendingError` 抛回流处理，不吞掉。
- `store.ts` 普通对话的内容追加改走该缓冲；`MessageList.tsx`、`ReasoningBlock.tsx` 只做交付仓 `0bcd2e42` 里与合批直接相关的渲染优化，不顺带改样式。

## 剥离

交付仓这些提交周边混有水印助手、文档生成、附件公网路由、规划器分支：一律不搬。只按函数摘取，`store.ts` 禁止整文件覆盖。

## In scope / Out of scope

- In：上面 8 步。
- Out：会话列表分页、未加载完成也落库（B4）；深度研究恢复与报告续写（B5 / B6）；桌面端。

## 验收

- AC-1：`features/chat` 新增 / 扩充测试：`utils/response-checkpoint.test.ts`、`utils/stream-text-buffer.test.ts`、`utils/turn-continuation.test.ts`、`assistant-content.test.ts`（空正文 + 中断 → 提示；推理未闭合 → `prepareAssistantContinuation` 闭合）、`store.interrupt.test.ts`（停止后保留内容且标 `cancelled`；中断推理后仍可继续）、`store.finish-reason.test.ts`（`length` 截断；空回答保留推理）、`store.completion-messages.test.ts`（历史剔除提示与推理；空则整条剔除）。用例从交付仓同名测试摘取并去掉水印 / 文档生成相关用例。
- AC-2：`apps/web-portal` 新增 / 扩充：`lib/chat-history/serialize-metadata.test.ts`（`interruption` 往返）、`append-idempotent.test.ts`（完成态不会被改回中断）、`lib/chat-error-i18n.test.tsx`、`chat-message-sanitize` 对 `interruption` 的校验用例。
- AC-3：`pnpm -C enterprise/features/chat test && pnpm -C enterprise/features/chat typecheck`（若无 typecheck 脚本则以 web-portal typecheck 覆盖）；`pnpm -C enterprise/packages/core-api` 无测试脚本则跳过；`pnpm -C enterprise/apps/web-portal typecheck && test`（除基线 10 条外无新增失败）。
- AC-4（验收方手工）：门户问一个长问题，输出到一半刷新 → 回答保留且显示「继续生成」，点击后从断点续写；生成中点停止 → 同上；把网关临时设成 `GATEWAY_REQUEST_TIMEOUT=5s` → 出现超时提示并可继续；正常结束的回答不出现「继续生成」。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：`features/chat` 264 项中仅基线的 `store.multi-session` 一条失败，原基线失败「取消后保留内容并落盘」已转绿；门户 949 项中仅基线的 orchestrator 续期一条失败；门户类型错误仍为 26 条（`store.ts` 那条原有错误因上方插入代码从 L1029 移到 L1324）。
- 手工（浏览器，本地网关 `GATEWAY_REQUEST_TIMEOUT=5s` → 恢复默认）：超时后回答显示超时提示，输入区出现「继续生成」；点击后续写正常输出；首次提问中途刷新，已落盘部分保留并可继续。
- 验收发现并修复：续写 / 重新生成路径（`regenerateAssistantResponse`）创建了 checkpoint 却从不调用 `changed()`，续写中途刷新会丢失全部续写内容；已补调用，并新增 `store.continue-checkpoint.test.ts`（空失败回答续写时中途落盘、完成后清除中断标记）。复验：续写中途刷新后保留了续写部分（受「已有前缀时 15 秒一存」设计约束）。
- 验收方补充：`packages/sdk-ts` 增加 `ChatChunk.finishReason`，读到上游 `finish_reason` 时单独产出一帧，使长度截断提示在真实流里可触发（新增 SDK 用例）。
- 计划外记录（主计划 §8）：「编辑后重新发送」路径（`editUserMessageAndResend`）没有接普通回答落盘。
