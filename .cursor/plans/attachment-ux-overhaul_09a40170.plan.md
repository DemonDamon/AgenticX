---
name: attachment-ux-overhaul
overview: 重构文件附件体验：附件预览移到输入框上方（对标豆包/Cherry Studio），支持图片缩略图、文件类型图标、解析状态指示，并在聊天气泡中展示附件卡片。
todos:
  - id: data-structure
    content: 定义 AttachedFile 类型，重构 contextFiles 状态为 Record<string, AttachedFile>
    status: completed
  - id: file-parsing
    content: 按 MIME 类型分流解析：图片 readAsDataURL、文本 readAsText、其他报错；加 parsing/ready/error 状态
    status: completed
  - id: preview-above
    content: 附件预览条移到输入框内 textarea 上方，新建 AttachmentChip 内联组件
    status: completed
  - id: message-type
    content: store.ts Message 类型增加 attachments 字段，sendChat 写入附件元数据
    status: completed
  - id: attachment-card
    content: 新建 AttachmentCard 组件：图片缩略图 + 文件卡片，集成到 ImBubble 用户消息
    status: completed
  - id: image-modal
    content: 图片点击放大：复用 Modal 组件弹出原图查看
    status: completed
  - id: build-verify
    content: npm run build 通过，lint 无新增错误
    status: completed
isProject: false
---

# Attachment UX Overhaul

## 现状问题

- 附件列表渲染在输入框下方，应在上方（对标豆包/Cherry Studio）
- 所有文件一律 `readAsText`，图片会乱码
- 无解析状态指示（豆包有"解析中..."）
- `Message` 类型无附件字段，聊天气泡不展示附件
- 无图片缩略图/放大查看

## 改动范围

### 1. 扩展 contextFiles 数据结构

文件: [desktop/src/components/ChatPane.tsx](desktop/src/components/ChatPane.tsx)

将 `contextFiles` 从 `Record<string, string>` 改为 `Record<string, AttachedFile>`:

```typescript
type AttachedFile = {
  name: string;
  size: number;
  mimeType: string;
  status: "parsing" | "ready" | "error";
  content: string;        // 文本文件内容
  dataUrl?: string;       // 图片 base64 dataURL（用于缩略图）
  errorText?: string;
};
```

### 2. 文件类型感知解析

文件: [desktop/src/components/ChatPane.tsx](desktop/src/components/ChatPane.tsx) (fileInput onChange)

按 MIME / 扩展名分流:

- **图片** (image/*): `readAsDataURL` -> 存 `dataUrl`，`content` 设为 `[图片: filename.png]`
- **文本/代码** (text/*, .py/.ts/.js/.json/.md/.yaml/.sh 等): `readAsText` -> 存 `content`（截取前 32000 字）
- **其他二进制**: 标记 `status: "error"`，提示"不支持的文件格式"
- 解析开始时 `status: "parsing"`，完成后改 `ready`

### 3. 附件预览条移到输入框上方

文件: [desktop/src/components/ChatPane.tsx](desktop/src/components/ChatPane.tsx) (JSX)

将当前在输入框 `</div>` 后面的 `contextFiles` 渲染块，移到输入框 `<div>` 内部、`<textarea>` 上方:

```
┌────────────────────────────────────────────┐
│ [📄 data.csv ✕] [🖼 photo.png ✕]          │  <- 附件预览条（输入区内、textarea 上方）
│ 发消息...                                   │  <- textarea
│ 📎  新对话 ▾   ⊞ 更多              (🎤)   │  <- 底栏
└────────────────────────────────────────────┘
```

新建内联组件 `AttachmentChip`:

- 文本文件: 文件图标 + 文件名 + 大小 + ✕ 移除
- 图片: 缩略图（32x32 圆角）+ 文件名 + ✕
- 解析中: 文件名 + "解析中..." 脉冲动画
- 错误: 红色提示 + ✕

### 4. 扩展 Message 类型 + 聊天气泡附件卡片

文件: [desktop/src/store.ts](desktop/src/store.ts)

```typescript
export type MessageAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;  // 图片 base64
};

export type Message = {
  // ...existing fields...
  attachments?: MessageAttachment[];
};
```

文件: [desktop/src/components/ChatPane.tsx](desktop/src/components/ChatPane.tsx) (sendChat)

发送消息时，将 `contextFiles` 中的元数据写入 `addPaneMessage` 的 attachments。

### 5. 新建 AttachmentCard 组件

新文件: `desktop/src/components/messages/AttachmentCard.tsx`

在 ImBubble / TerminalLine / CleanBlock 的用户消息中渲染:

- **图片**: 圆角缩略图（max 200px），点击弹出全屏查看（简易 Modal）
- **文件**: 文件类型图标（根据扩展名：代码绿色、文档蓝色、通用灰色）+ 文件名 + 大小 + "File" 标签

### 6. 图片放大查看 Modal

复用已有的 [desktop/src/components/ds/Modal.tsx](desktop/src/components/ds/Modal.tsx)，点击缩略图弹出原图查看。

### 7. sendChat 中 context_files 格式适配

当前后端接收 `context_files: Record<string, string>`。改动后:

- 文本文件: 保持 `{ [name]: content }` 格式不变
- 图片文件: 不发送 base64 到后端（太大），改为发送 `{ [name]: "[图片文件]" }` 占位
- 后端侧无需改动（本次不改后端）

## 不改动的部分

- 后端 `/api/chat` 接口不变
- 工作区面板的 `@` 引用逻辑不变（只影响本地上传的附件）
- TerminalLine / CleanBlock 风格暂不加附件渲染（仅 IM 风格加）

