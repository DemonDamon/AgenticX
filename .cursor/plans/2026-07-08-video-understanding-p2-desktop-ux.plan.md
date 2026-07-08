# P2：Desktop 视频理解体验（mp4 附件/@引用 + 过程聚合 + 非视觉兜底）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.3-codex

> 依赖 P0 已合入（`video_understand` 工具存在）。本子规划让 Desktop 端顺滑地把 mp4 交给该工具：允许拖入/选择 mp4 作为「引用型附件」并透传绝对路径 `sourcePath`，让模型直接 `video_understand(path=sourcePath)`；给 `video_understand` 工具卡一个友好标签+图标（过程天然聚合为单卡）；非视觉模型附视频时给 Cherry 式提示。

---

## 根因/依据

- Near 前端无法在浏览器内解析视频，正确做法与 Office/PDF 一致：作为「引用型附件」透传绝对路径，由后端工具处理。现成范式：`isReferenceableDocumentFile`（`desktop/src/components/ChatPane.tsx:1670`）+ `parseLocalFile` 中的文档分支（`ChatPane.tsx:6681-6697`，用 `window.agenticxDesktop?.getPathForFile?.(file)` 取绝对路径并写 `sourcePath`）。
- 「过程聚合为单张可折叠卡」在 P0 落地后**基本自动满足**：WorkBuddy 是 3-4 次 shell 调用（多张卡），Near 变成 **1 次** `video_understand` 调用（1 张 `ToolCallCard`，默认折叠——见既有 ToolCallCard 语义）。P2 只需给它一个可读标签+图标。
- 非视觉兜底范式已存在：图片附件在 `parseLocalFile` 开头 `isImageFile && isKnownNonVisionChatModel` → `setAttachToastOpen(true)`（`ChatPane.tsx:6601`）。视频复用同一 toast。

---

## 变更点 1：新增视频文件判定

文件：`desktop/src/components/ChatPane.tsx`

**锚点**：`isReferenceableDocumentFile`（`ChatPane.tsx:1670-1674`）之后**新增**（精确增函数）：

```tsx
/** Local video files: frontend cannot parse; backend `video_understand` tool handles via absolute path. */
function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const lower = file.name.toLowerCase();
  return [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"].some((ext) => lower.endsWith(ext));
}
```

> 扩展名集合须与 P0 `VideoFrameExtractor.SUPPORTED_FORMATS` 一致。

---

## 变更点 2：`parseLocalFile` 接入视频引用分支

文件：`desktop/src/components/ChatPane.tsx`，函数 `parseLocalFile`（`ChatPane.tsx:6600`）。

### 2.1 非视觉模型兜底（在函数开头图片 guard 旁增一条）

**锚点**：
```tsx
    if (isImageFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
      setAttachToastOpen(true);
      return;
    }
```
（`ChatPane.tsx:6601-6604`）在其**后**新增：
```tsx
    if (isVideoFile(file) && isKnownNonVisionChatModel(chatProvider, chatModel)) {
      setAttachToastOpen(true);
      return;
    }
```

### 2.2 视频引用分支（在文档分支之后、unsupported fallback 之前）

**锚点**：`isReferenceableDocumentFile` 分支块（`ChatPane.tsx:6681-6697`）之后、最终 `不支持的文件格式` fallback（`ChatPane.tsx:6699-6709`）之前，**新增**（镜像文档分支）：

```tsx
    if (isVideoFile(file)) {
      const absolutePath = window.agenticxDesktop?.getPathForFile?.(file) || "";
      if (absolutePath) {
        setContextFiles((prev) => ({
          ...prev,
          [key]: {
            name: file.name,
            size: file.size,
            mimeType: file.type || "video/mp4",
            status: "ready",
            content: `[视频] ${file.name}（可用 video_understand 理解）`,
            sourcePath: absolutePath,
          },
        }));
        return;
      }
    }
```

> 与文档分支唯一差异：`content` 文案提示可用 `video_understand`，`mimeType` 回落 `video/mp4`。`sourcePath` 透传绝对路径后，`resolveReadyAttachment`（`ChatPane.tsx:1683`）与 `/api/chat` 的 `context_files` 构造会带上该路径，注入系统提示的 `_build_context_files_block` 会让模型看到视频路径，从而调用 `video_understand(path=<绝对路径>)`。

> `getPathForFile` 已在 `global.d.ts` 声明（文档分支已用），无需改类型。

---

## 变更点 3：拖拽/选择入口的视频兜底（可选，保持一致）

文件：`desktop/src/components/ChatPane.tsx`

外层 drop 处理器已有针对图片的非视觉预检（`ChatPane.tsx:10121` 与 `10283`）。由于变更点 2.1 已把兜底放进 `parseLocalFile`（所有入口的单一真源），这两处**无需强制修改**。若为即时反馈希望在 drop 阶段就提示，可在这两处的 `isImageFile(...)` 预检条件旁并列 `|| (isVideoFile(file) && isKnownNonVisionChatModel(...))`（精确增条件，不改循环结构）。此为可选优化，不做也不影响正确性。

---

## 变更点 4：ToolCallCard 友好标签 + 图标

文件：`desktop/src/components/messages/ToolCallCard.tsx`

### 4.1 标签

**锚点**：`buildToolLabel` 中 `if (name === "knowledge_search") return "knowledge_search";`（`ToolCallCard.tsx:80`）之后**新增**：
```tsx
  if (name === "video_understand") {
    const p = String(args.path ?? "").trim();
    const base = p ? p.split(/[\\/]/).pop() : "";
    return base ? `理解视频 ${base}` : "理解视频";
  }
```

### 4.2 图标

**锚点**：`pickToolIcon` 中 `if (name === "knowledge_search") return Search;`（`ToolCallCard.tsx:97`）之后**新增**：
```tsx
  if (name === "video_understand") return Film;
```
并在该文件顶部 lucide-react import 中**增加** `Film`（精确增标识符，不整段替换 import；`Film` 是 lucide-react 既有图标）。

> 效果：视频理解的整个过程收敛为一张标题为「理解视频 xxx.mp4」、带 🎞 图标、默认折叠的工具卡，符合"过程聚合、避免刷屏"的偏好；下一轮抽出的帧通过既有 `ViewImageInjectCard`（`desktop/src/components/messages/ViewImageInjectCard.tsx`）渲染的注入消息呈现，无需额外改动。

---

## 冒烟测试

**新建**：`desktop/src/utils/video-file.test.ts`（若 `isVideoFile` 需被复用可提取到 util；否则在 ChatPane 内联函数上做轻量导出测试）。为可测试，建议把 `isVideoFile` 提取到 `desktop/src/utils/`（与 `model-vision.ts` 同级）并从 ChatPane 引入：

- `isVideoFile` 对 `foo.mp4`/`bar.MOV`/`baz.webm` 返回 true；对 `a.png`/`b.txt`/`c.pdf` 返回 false；对 `file.type==="video/mp4"` 返回 true。

> 若不提取工具函数、保持 ChatPane 内联，则此项改为「手动验收」并在 PR 描述记录，不强制单测（避免为测试过度重构，符合 no-scope-creep）。推荐提取，成本低。

`ToolCallCard` 标签为纯函数分支，可在 `desktop/src/components/messages/react-blocks.test.ts` 同目录新增用例断言 `buildToolLabel({tool_name:"video_understand", args:{path:"/x/y/a.mp4"}})` 含 `理解视频 a.mp4`（若 `buildToolLabel` 未导出则跳过或按需导出）。

运行：`cd desktop && npx vitest run src/utils/video-file.test.ts`

---

## AC

- AC-P2-1：把一个 mp4 拖入/选入 Near 输入区，出现「[视频] xxx.mp4」引用附件；发送后模型能自动调用 `video_understand`（对话区出现「理解视频 xxx.mp4」工具卡）。
- AC-P2-2：整个视频理解过程只呈现**一张**可折叠工具卡（对比 WorkBuddy 的 ls/ffprobe/ffmpeg 多段 shell），下一轮出现帧图注入卡。
- AC-P2-3：当前为非视觉模型时，附 mp4 触发 Cherry 式「模型不支持该文件类型」提示（复用 `attachToast`），不静默附上。
- AC-P2-4：`cd desktop && npx tsc --noEmit` 通过；`npx vitest run`（新增用例）通过；`npm run build` 绿。

---

## In scope / Out of scope

**In scope**：`isVideoFile` 判定（建议提取到 `desktop/src/utils/`）、`parseLocalFile` 视频引用分支 + 非视觉兜底、ToolCallCard 视频标签/图标、轻量单测。

**Out of scope**：不改后端工具（P0/P1）；不改 `_inject_pending_visual_attachments`/`ViewImageInjectCard` 渲染；不做视频内联播放器/缩略图（超范围，如需另立 plan）；不改其它工具卡标签；不改 `global.d.ts` 已有 `getPathForFile` 声明。

---

## Traceability
- Plan-Id: `2026-07-08-video-understanding-p2-desktop-ux`
- Plan-File: `.cursor/plans/2026-07-08-video-understanding-p2-desktop-ux.plan.md`
