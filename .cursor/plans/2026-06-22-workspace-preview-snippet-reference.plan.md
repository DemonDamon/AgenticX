# 工作区文件预览「选区引用至对话」

Planned-with: claude-opus-4.8

## 背景与目标

用户在工作区文件预览面板里（txt / md / code / xlsx / docx）选中**局部内容**后，希望能像 Cursor 那样把「某文件第几行 / 某 sheet 某单元格」精确引用进当前对话，而不是只能引用整文件。

参考 Cursor 行为：
- 用户手动 `@path:start-end` 引用 = **精确片段**，只传选定行，**不自动 padding 上下行**（与现有 `agenticx/cli/studio.py::_resolve_at_references` 行号语义一致：`lines[start-1:end]`，1-based 闭区间）。
- chip 展示形如 `install-skill-to-all.md (12-17)`；复制成纯文本为 `@<相对/绝对路径>:12-17`。

本 plan **默认精确模式**（不加 ±N 行上下文），不引入「上下文模式」开关（避免 scope creep；后续如需再单开 plan）。

## 现状（已确认）

| 能力 | 位置 | 现状 |
|------|------|------|
| 文件树右键「引用到输入框」 | `desktop/src/components/WorkspacePanel.tsx` → `onPickFileForReference` | 仅整文件 |
| 注入对话链路 | `desktop/src/components/ChatPane.tsx::insertWorkspaceFileReference` → `addContextFile(taskspaceId, relPath, { referenceToken })` | 整文件，key=绝对路径，content=全文截断 |
| 预览面板 | `desktop/src/components/workspace/WorkspaceFilePreview.tsx` | 文本走 `TextualPreviewBody`（`<pre><code>` 高亮 / markdown 渲染）；xlsx 走 `SpreadsheetPreview`；docx 走 `DocxPreview` |
| 预览数据结构 | `workspace-preview-types.ts::WorkspacePreview` | text/markdown/code 持有完整 `content` |
| chip 序列化 | `desktop/src/utils/chat-file-mention.ts::buildFileMentionAppend` | `@文件名`，无 range |
| 后端 context_files | `agenticx/studio/server.py::_normalize_context_files` | key→content 直传，key 仅作展示，不解析行号 |

关键结论：**Desktop 主链路把片段文本直接塞进 `context_files[key]=snippet` 即可**，后端无需改造就能把片段喂给模型；行号只用于 **chip 展示 / key 标识**。

## 范围（严格）

只动 Desktop 渲染层 + 既有注入链路，**不改后端 Python**、**不改 `agx serve` 协议**：

- `desktop/src/components/workspace/workspace-preview-types.ts`
- `desktop/src/components/workspace/WorkspaceFilePreview.tsx`
- `desktop/src/components/workspace/SpreadsheetPreview.tsx`
- `desktop/src/components/WorkspacePanel.tsx`
- `desktop/src/components/ChatPane.tsx`
- `desktop/src/utils/chat-file-mention.ts`（新增 range token 构造）
- 必要的小工具/类型

不在本次范围：docx 段落级引用（Phase 3，单独再做）、后端 `@path:line` 解析对齐、context 模式开关。

## Token / chip 规范

| 类型 | context_files key | chip 显示 | snippet content |
|------|-------------------|-----------|-----------------|
| txt/md/code | `<absPath>:<start>-<end>` | `basename (12-17)` | 选中行原文（1-based 闭区间） |
| xlsx | `<absPath>#<sheet>!<A1:rangeOrCell>` | `basename · Sheet1 · E12` | TSV 小块（含表头行可选） |
| 整文件（保留） | `<absPath>` | `basename` | 全文截断 |

复制为纯文本统一：`@<path>:<start>-<end>`（xlsx 用 `@<path>#<sheet>!<range>`）。

## 实施步骤

### Step 1：扩展预览/附件数据结构
- `WorkspacePreview` 文本类不变（已含 `content`）。
- `AttachedFile`（`ChatPane.tsx` 内 type，行 ~1484）与 `store.ts` 的 attachment 类型新增可选字段：`range?: { start: number; end: number } | { sheet: string; a1: string }`、`snippetContent?: string`。复用既有 `composerRefLabel` 做 chip 文案。
- AC：类型通过 `tsc`，旧数据（无 range）渲染不报错。

### Step 2：文本预览选区 → 行号
- 在 `TextualPreviewBody`：把 `<pre>` 内容按行渲染（或选区结束后用 `window.getSelection()` + 锚点行号映射）。
- 计算选区 `startLine/endLine`（1-based，闭区间，clamp 到 content 行数）。
- markdown 预览：因为是渲染后的 DOM，行号不可靠 → 退化为「按渲染块/或整文件」。**本期 markdown 仅支持整文件引用**（与现状一致），行号引用仅对 `text`/`code` 生效；在 UI 注明。
- AC：在 `text/code` 预览选 12–17 行，能得出 `{start:12,end:17}` 且 snippet 文本 == 这 6 行原文。

### Step 3：预览面板右键 / 悬浮「引用至当前对话」
- 在 `WorkspaceFilePreview` 文本区出现选区时，显示一个就近的小按钮 / 右键菜单项「引用至当前对话」（对齐图中红字诉求）。
- 触发回调 `onQuoteSnippet({ absolutePath, path, range, snippet, label })`，由 `WorkspacePanel` 透传到 `ChatPane`。
- AC：选区存在时按钮可见，点空白处/Esc 关闭预览后状态清理。

### Step 4：ChatPane 注入片段引用
- 新增 `insertWorkspaceSnippetReference`，仿 `insertWorkspaceFileReference`：
  - `context_files[`${abs}:${start}-${end}`] = snippet`（直接放片段，不再读盘）。
  - attachment 记 `referenceToken:true` + `range` + `composerRefLabel='basename (12-17)'`。
  - 调 `buildFileMentionAppend` 注入 chip（新增支持带 range 的 label）。
- AC：发送后 `/api/chat` body.context_files 含该 key→snippet；UserBubble chip 显示 `basename (12-17)`；重试保留。

### Step 5：xlsx 单元格/区域引用
- `SpreadsheetPreview`：给 `<td>` 加选择态（点选 / shift 框选 → `(sheet,row,col)`，合成 A1 range）。
- 右键「引用至当前对话」→ 复用 Step 3/4 回调，content 用选中区域 TSV。
- AC：图 1 场景下右键某单元格 → chip `xlsx名 · Sheet1 · E12`，context_files content 为该格文本。

### Step 6：chip 序列化与复制对齐
- `buildFileMentionAppend` 增加可选 `label` 覆盖（带 range 文案）；`extractComposerText` 序列化 token 时用 `composerRefLabel`（已有 token 重建逻辑，行 ~3309）。
- 复制消息/输入框文本时，range chip 还原为 `@<path>:<start>-<end>`。
- AC：复制含引用的用户消息，纯文本里出现 `@.cursor/commands/install-skill-to-all.md:12-17`。

### Step 7：验证
- `tsc --noEmit`（desktop）通过。
- 手动：text/code 行号引用、xlsx 单元格引用、整文件引用三条路径均可发送且模型可见（context_files 命中）。
- markdown/docx 退化为整文件引用，UI 有说明，不报错。

## 非目标 / 风险
- markdown 渲染后行号不可靠 → 本期不做 md 行级引用。
- docx 块级引用留 Phase 3。
- 不默认加上下文行（精确模式），避免与 Cursor @ 用户预期不一致。
- 后端 `context_files` key 含 `:line` 仅作标识，模型据 key 文案即可理解范围；不依赖后端解析。
