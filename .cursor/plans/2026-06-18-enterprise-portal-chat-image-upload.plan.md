# Enterprise 前台聊天图片上传 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Enterprise web-portal 聊天输入区补齐与 Near Desktop 对齐的图片附件能力：点击上传、粘贴、拖拽，输入框上方预览，发送后多模态请求可达 Gateway/上游视觉模型，历史可回显。

**Architecture:** 前端在 `@agenticx/feature-chat` 增加附件状态与 `InputArea` 交互；`MachiChatView` 接线；`HttpChatClient` 将末条 user 消息转为 OpenAI `content: [{type:text},{type:image_url}]`；Gateway 将 `ChatMessage.Content` 从 `string` 升级为 `json.RawMessage` 透传上游；PG `chat_messages.metadata` 持久化 `dataUrl` 附件供重试/历史展示。非视觉模型沿用 Desktop `isKnownNonVisionChatModel` 规则 + Cherry 式居中黄底提示。

**Tech Stack:** React 19、Next.js App Router、Zustand、`@agenticx/feature-chat`、`@agenticx/sdk-ts`、`@agenticx/core-api`、Go Gateway relay/adaptor、Drizzle PG jsonb metadata。

**参考实现（只借鉴语义，不复制代码）：**
- Desktop `ChatPane.tsx`：`parseLocalFile` / `AttachmentChip` / paste·drop·file input
- Desktop `clipboard-images.ts`：剪贴板图片去重
- Desktop `model-vision.ts`：非视觉模型拦截
- Desktop 发送体：`image_inputs` + 持久化 attachment（Enterprise 改为 OpenAI multimodal + metadata）

**范围约束（no-scope-creep）：**
- ✅ web-portal + feature-chat + sdk-ts + core-api + gateway（多模态透传为硬依赖）
- ✅ 仅 **图片**（`image/*`），不做 PDF/Office 通用附件
- ❌ 不改 admin-console UI、不做对象存储/CDN 上传（MVP 用 data URL，与 Desktop 一致）
- ❌ 不实现 webSearch/deepResearch 按钮真实逻辑

---

## 现状差距

| 层级 | 现状 | 目标 |
|------|------|------|
| `MachiChatView` | Paperclip tooltip「上传文件（即将上线）」 | 可点选/粘贴/拖拽图片 |
| `InputArea` | 纯 textarea，无 paste/drop | 容器级 dragover/drop + onPaste 回调 |
| `useChatStore.sendMessage` | 仅 `content: string` | 支持 `attachments[]`，允许仅图片发送 |
| `HttpChatClient` | `messages[].content` 字符串 | 末条 user 转 multimodal array |
| Gateway `openai.ChatMessage` | `Content string` | `Content json.RawMessage` + 文本提取 helper |
| `ChatMessage` (core-api) | 无 attachments | 可选 `attachments` + PG metadata 往返 |
| `MessageList` | 用户气泡纯文本 | 渲染图片缩略图 |
| `/api/me/models` | 无 capabilities | 返回 `capabilities` 供前端 vision 判断 |

---

## 数据契约

### 前端附件（composer 态）

```ts
type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: "parsing" | "ready" | "error";
  dataUrl?: string;
  errorText?: string;
};
```

### core-api 扩展

```ts
export type ChatMessageAttachment = {
  name: string;
  mime_type: string;
  size?: number;
  data_url: string;
};

export type ChatMessage = {
  // ...existing
  attachments?: ChatMessageAttachment[];
};
```

### PG 持久化

写入 `chat_messages.metadata`:

```json
{ "attachments": [{ "name": "paste.png", "mime_type": "image/png", "data_url": "data:image/png;base64,..." }] }
```

`content` 仍存用户文本；纯图发送时 `content` 可为空字符串或 `[图片: paste.png]`（与 Desktop 占位一致，便于标题摘要）。

### Gateway 请求体（OpenAI 兼容）

末条 user 消息示例：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "请描述这张图" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
  ]
}
```

---

## 交互与 UX（对齐 AGENTS.md / Desktop）

1. **预览位置**：附件 chip 显示在输入框**上方**（InputArea 容器内顶部），缩略图可点击放大（简单 `Dialog` + `<img>`）。
2. **三种入口**：Paperclip → hidden `<input type="file" accept="image/*" multiple>`；textarea `onPaste`；InputArea 外层 `onDragOver/onDrop`。
3. **发送条件**：`canSend = (text.trim() || readyAttachments.length) && !streaming`。
4. **非视觉模型**：命中 `isKnownNonVisionChatModel(provider, model)` 时阻止添加并展示黄底感叹号提示（文案：「模型不支持该文件类型」），位置在消息列表与输入区之间（复用现有 Alert 区或新增 inline toast）。
5. **限制**：单图 ≤ 5MB，最多 4 张/条消息（可配置常量）。
6. **重试/编辑重发**：从 message.attachments 恢复 composer 附件（与 Desktop retry 保留图片一致）。

---

## 实现任务

### Task 1: 契约与工具函数

**Files:**
- Modify: `enterprise/packages/core-api/src/chat.ts`
- Create: `enterprise/features/chat/src/utils/clipboard-images.ts`（自研，语义对齐 Desktop）
- Create: `enterprise/features/chat/src/utils/model-vision.ts`（自研，规则对齐 Desktop）
- Create: `enterprise/features/chat/src/utils/build-multimodal-content.ts`
- Create: `enterprise/features/chat/src/utils/build-multimodal-content.test.ts`

**Step 1:** 扩展 `ChatMessage` / export types  
**Step 2:** 实现 clipboard 提取 + multimodal content builder 单测  
**Step 3:** `pnpm --filter @agenticx/core-api typecheck` + feature-chat vitest

---

### Task 2: Gateway 多模态 Content 透传

**Files:**
- Modify: `enterprise/apps/gateway/internal/openai/types.go` — `Content json.RawMessage`
- Modify: `enterprise/apps/gateway/internal/openai/content.go`（新建）— `ContentText()`, `JoinMessagesText()`
- Modify: `enterprise/apps/gateway/internal/server/server.go` — `joinMessages` / `latestUserMessageContent` / `estimateTextTokens` 改走 helper
- Modify: 其它直接 `msg.Content` 当 string 比较的 call site（inbound 仍产出 string JSON）
- Test: `enterprise/apps/gateway/internal/openai/content_test.go`

**Step 1:** 写 failing test：unmarshal `[{type:text},{type:image_url}]` 不丢字段  
**Step 2:** 实现 RawMessage + Text 提取  
**Step 3:** `go test ./...` gateway 包

**注意：** adaptor 层 `json.Marshal(upstream)` 应原样保留 array content，不做 string 强转。

---

### Task 3: SDK 与 Store 发送链路

**Files:**
- Modify: `enterprise/packages/sdk-ts/src/types.ts` — message 增加 optional attachments
- Modify: `enterprise/packages/sdk-ts/src/chat/http.ts` — 构建 multimodal messages
- Modify: `enterprise/features/chat/src/store.ts` — `SendMessageInput.attachments`、`sendMessage`/`editUserMessageAndResend`/`regenerate` 携带 attachments
- Modify: `enterprise/features/chat/src/store.history.test.ts`（如有）补充 metadata 映射

**Step 1:** HttpChatClient 单测：有 attachment 时 body 含 image_url  
**Step 2:** store 允许空文本 + 有附件时发送  
**Step 3:** typecheck feature-chat + sdk-ts

---

### Task 4: 历史持久化往返

**Files:**
- Modify: `enterprise/apps/web-portal/src/lib/chat-history.ts` — `mapMessageRow` / insert 读写 `metadata.attachments`
- Modify: `enterprise/apps/web-portal/src/app/api/chat/sessions/[sessionId]/messages/route.ts`（若需校验 attachments 大小）

**Step 1:** append 时 metadata 落盘  
**Step 2:** list/get 还原为 `ChatMessage.attachments`  
**Step 3:** 手工：发带图消息 → 刷新页面 → 气泡仍显示缩略图

---

### Task 5: InputArea + 附件 UI 组件

**Files:**
- Create: `enterprise/features/chat/src/components/atoms/AttachmentChip.tsx`
- Modify: `enterprise/features/chat/src/components/molecules/InputArea.tsx`
- Modify: `enterprise/features/chat/src/index.ts` — export hooks/types

**InputArea 新增 props:**

```ts
attachments?: ComposerAttachment[];
onAddFiles?: (files: File[]) => void;
onRemoveAttachment?: (id: string) => void;
onPaste?: (event: React.ClipboardEvent) => void;
attachmentPreview?: React.ReactNode;
disableSendWithoutContent?: boolean; // default true → 改为 false when attachments
```

**行为：**
- 容器 `onDragOver` preventDefault + `dropEffect=copy`
- `onDrop` → `onAddFiles`
- 顶部渲染 `AttachmentChip` 列表
- `canSend` 考虑 attachments

---

### Task 6: MachiChatView 接线

**Files:**
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`
- Modify: `enterprise/apps/web-portal/messages/zh.json` + `en.json`
- Modify: `enterprise/apps/web-portal/src/app/api/me/models/route.ts` + `admin-providers-reader.ts` — `PortalModelOption.capabilities`

**Step 1:** `useComposerAttachments` hook（parseLocalFile 等价逻辑）  
**Step 2:** Paperclip 绑定 file input；去掉 coming soon tooltip  
**Step 3:** `handleSend` 传 attachments；vision 不支持时 setVisionWarning  
**Step 4:** 模型列表带 capabilities，解析当前 `activeModel` 的 provider/model

---

### Task 7: MessageList 用户气泡展示图片

**Files:**
- Modify: `enterprise/features/chat/src/components/molecules/MessageList.tsx`

**Step 1:** user 消息下方渲染 attachments 缩略图网格  
**Step 2:** 点击放大（Dialog）

---

### Task 8: 验收

**Manual checklist:**
- [ ] 点击 📎 选 png/jpg，预览出现在输入框上方
- [ ] 截图 Ctrl+V 粘贴到输入框
- [ ] 从桌面拖拽图片到输入框
- [ ] 纯图片无文字可发送
- [ ] gpt-4o（vision）模型能收到并描述图片
- [ ] 纯文本模型（如 deepseek-chat）提示「模型不支持该文件类型」
- [ ] 刷新后会话历史用户消息仍显示缩略图
- [ ] 重试用户消息保留图片

**Commands:**

```bash
cd enterprise
pnpm --filter @agenticx/feature-chat test
pnpm --filter @agenticx/sdk-ts typecheck
pnpm --filter web-portal typecheck
cd apps/gateway && go test ./...
```

---

## Requirements

- **FR-1:** 输入区支持点击选择 `image/*` 文件（可多选，≤4）。
- **FR-2:** 输入区支持剪贴板粘贴图片。
- **FR-3:** 输入区支持拖拽图片文件。
- **FR-4:** 附件预览位于输入框上方，可移除单项。
- **FR-5:** 发送时将图片随末条 user 消息送 Gateway（OpenAI multimodal）。
- **FR-6:** 非视觉模型阻止附加并给出明确中文提示。
- **FR-7:** 历史消息持久化 attachments，刷新后可回显。
- **FR-8:** 重试/编辑重发保留 attachments。

- **NFR-1:** 单图 ≤ 5MB；超限给出可读错误，不 silent fail。
- **NFR-2:** 不引入新的 npm 依赖（FileReader/data URL 即可）。
- **NFR-3:** Gateway 变更向后兼容：纯 string content 仍可用。

- **AC-1:** 上述 Manual checklist 全部通过。
- **AC-2:** gateway / feature-chat 单测绿。
- **AC-3:** web-portal typecheck 绿。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| data URL 过大导致 PG/请求体膨胀 | 5MB×4 上限；metadata 仅存当次消息；后续可换 OSS |
| Gateway 策略扫描只认 string | `ContentText()` 提取纯文本做 keyword/PII，图片不参与文本策略 |
| 部分 upstream 不支持 data URL | 与 Desktop 相同限制；文档注明需 vision 模型 + 支持 base64 的 provider |
| admin capabilities 未填 vision | 回退 `isKnownNonVisionChatModel` 启发式 + capabilities 双判 |

---

## 提交建议

1. `feat(gateway): pass through multimodal message content`
2. `feat(enterprise-chat): image attachment composer and send pipeline`
3. `feat(web-portal): wire MachiChatView image upload UX`

每 commit 带 `Plan-Id: 2026-06-18-enterprise-portal-chat-image-upload` 与 `Made-with: Damon Li`。
