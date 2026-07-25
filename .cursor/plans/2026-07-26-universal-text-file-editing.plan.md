# 工作台文件预览：从「Markdown 专属编辑」扩展为「通用文本文件编辑」

Planned-with: Opus 5

Suggested-Impl-Model: 见下方「子任务 → 推荐模型」表

---

## 1. 背景与现状证据链

用户在工作台（WorkPanel）预览 `requirements.txt` 时，只看到「复制 / 关闭」两个按钮，没有编辑、保存、撤销入口。期望：常规格式文件都能像普通编辑器一样改、保存、回退。

### 1.1 现状：编辑能力只对 Markdown 开放

`desktop/src/components/workspace/WorkspaceFilePreview.tsx:953`：

```ts
const isEditableMarkdown =
  preview.kind === "markdown" && !truncated && !initialLineRange;
```

该布尔值同时门控了 4 处能力：

| 位置 | 被门控的能力 |
|---|---|
| `WorkspaceFilePreview.tsx:1340` | 工具栏「预览 / 编辑（Pencil）/ 撤销 / 重做 / 查找替换」整组按钮 |
| `WorkspaceFilePreview.tsx:1047` | `handleSave()` 直接 early-return |
| `WorkspaceFilePreview.tsx:1185`–`1210` | ⌘S / ⌘Z / ⌘⇧Z / ⌘F 键盘快捷键监听 |
| `WorkspaceFilePreview.tsx:1565` | 传给 `TextualPreviewBody` 的 `viewMode` 被强制降级为 `"preview"` |

因此 `.txt` / `.py` / `.json` 等 `kind === "text" | "code"` 的文件在 UI 上完全没有编辑入口。

### 1.2 现状：编辑正文渲染分支也只认 Markdown

`WorkspaceFilePreview.tsx:847`：

```ts
if (preview.kind === "markdown" && viewMode === "edit") {
  return <textarea ... aria-label="编辑 Markdown 源码" />;
}
```

即使强行把 `viewMode` 置为 `"edit"`，非 markdown 文件仍会掉到 `:904` 的只读 `<pre><code>` Prism 高亮分支。HTML 文件（`isHtmlFile`，`:959`）的「查看源码」按钮（`:1324`）同样落到只读分支，只能看不能改。

### 1.3 已具备、可直接复用的基础设施

不需要从零造轮子，以下都已存在且工作正常：

- **撤销/重做**：`useTextEditHistory`（`WorkspaceFilePreview.tsx:535`–`573`），200 步上限，`resetKey` 为 `absolutePath:contentLength`。
- **查找替换**：`findTextMatch` / `countMatches` / `replaceAllOccurrences`（`:619`–`681`），含 smart-quote / em-dash 归一化。
- **落盘 IPC**：`window.agenticxDesktop.writeLocalTextFile`（preload `desktop/electron/preload.ts:773`，类型 `desktop/src/global.d.ts:1304`），主进程 handler 在 `desktop/electron/main.ts:10914` (`write-local-text-file`)。
- **脏态与提示**：`isDirty`（`:1019`）、`saveToast`、`saveError`、底部提示条（`:1575`–`1583`）。

所以本次工作**主要是解除门控 + 补齐安全性**，而不是新建编辑器。

### 1.4 现状写入链路的 4 个真实风险（必须一并解决）

读 `desktop/electron/main.ts:10912`–`10936` 可见：

```ts
const WRITE_LOCAL_TEXT_MAX_BYTES = 512 * 1024;
// ...
await fs.promises.writeFile(normalized, content, "utf8");
```

- **R1 非原子写**：直接 `writeFile` 覆盖原文件，写入中途崩溃会留下截断文件。Markdown 场景侥幸没炸，扩到全格式后风险面变大。
- **R2 无外部变更检测**：预览加载后若文件被 agent / 终端 / 外部编辑器改动，保存会**静默覆盖**对方的修改。工作台里 agent 频繁写工作区文件，这个概率不低。
- **R3 截断文件可被写回**：预览侧对超限文件会 `truncated = true`（`agenticx/studio/session_manager.py:1755`–`1762` 按 `max_bytes` 截断）。当前靠 `isEditableMarkdown` 里的 `!truncated` 兜住；扩展时若漏掉这一条，就会用「截断内容」覆盖完整文件，属于数据损毁级事故。
- **R4 解码损坏与换行丢失**：预览读文件用 `errors="replace"` 解码，非 UTF-8 文件会带 `U+FFFD`；写回一律 `utf8` + textarea 会把 CRLF 归一成 LF。两者都会造成「只是打开看了一眼，文件却变了」。

---

## 2. 目标 / 非目标

### In scope

1. 把可编辑范围从 `kind === "markdown"` 扩展到全部文本类预览：`kind ∈ {"text", "markdown", "code"}`（含 `.txt` / `.py` / `.json` / `.html` / `.yaml` / `.log` 等）。
2. 编辑正文（textarea）分支覆盖上述所有文本类型，HTML 的「查看源码」升级为「编辑源码」。
3. 工具栏语义按文件类型区分：markdown / html 保留「渲染预览 ↔ 编辑」；纯文本 / 代码为「只读 ↔ 编辑」。
4. 主进程写入加固：原子写、mtime 前置校验、EOL 保持、大小上限与预览截断阈值语义对齐。
5. 脏态保护：关闭预览 tab / 关闭面板 / 切换文件时若有未保存修改，弹应用内主题化确认框（禁止 `window.confirm`）。
6. 明确的「不可编辑」原因提示：截断、超限、疑似非 UTF-8、只读文件、行号聚焦模式。

### Out of scope（本次明确不做）

- 不引入 Monaco / CodeMirror，继续用 `textarea` + Prism 只读高亮的现有方案。
- 不做 PDF / Office / 图片 / 二进制的编辑，保持只读。
- 不做多标签共享的全局 dirty 管理器、不做自动保存、不做版本历史 / diff。
- 不改 `agenticx/studio/session_manager.py` 的预览截断逻辑本身（只读取其 `truncated` 结果）。
- 不重构 `WorkPanel.tsx` 的 tab 管理架构，只在 `closePreviewTab` 处挂一个确认钩子。

> **no-scope-creep 边界**：本次只允许改动第 4 节列出的文件。看到相邻代码「顺手可以优化」一律不动。

---

## 3. 需求（FR）与验收（AC）

### FR-1 通用文本可编辑判定

将 `isEditableMarkdown` 更名为 `isEditableText`，判定条件改为：

```ts
// WorkspaceFilePreview.tsx:953 附近
const editBlockReason: string | null = useMemo(() => {
  if (!textualPreview) return null;              // 非文本类：不展示编辑入口
  if (initialLineRange) return "行号聚焦模式下不可编辑";
  if (truncated) return "文件过大已截断，为避免覆盖丢失内容，暂不可编辑";
  if (textualPreview.content.includes("\uFFFD")) return "文件疑似非 UTF-8 编码，暂不可编辑";
  if (textualPreview.size > WRITE_LOCAL_TEXT_MAX_BYTES) return "文件超过 512 KB 写入上限";
  return null;
}, [textualPreview, initialLineRange, truncated]);

const isEditableText = textualPreview != null && editBlockReason === null;
```

`WRITE_LOCAL_TEXT_MAX_BYTES = 512 * 1024` 需在渲染侧同步一份常量（新建 `desktop/src/components/workspace/workspace-edit-limits.ts` 导出），与 `main.ts:10912` 保持同值，并在该常量文件写注释指明两处必须同步。

原 4 处 `isEditableMarkdown` 引用（`:1047`、`:1185`、`:1340`、`:1565`）全部替换为 `isEditableText`。

**AC-1**
- 打开 `requirements.txt`：工具栏出现「编辑」按钮，点击后可键入，⌘S 保存后重开文件内容为新内容。
- 打开一个 > 512 KB 的 `.log`：无编辑按钮，头部或底部展示 `editBlockReason` 文案。
- 打开一个 GBK 编码的 `.txt`（内容含中文）：无编辑按钮，提示「疑似非 UTF-8 编码」。
- 从聊天里点 `@file[x.py]:12-20` 打开（`initialLineRange` 非空）：仍为只读聚焦视图，无编辑按钮。

### FR-2 编辑正文分支覆盖全部文本类型

改 `WorkspaceFilePreview.tsx:847`：

```ts
// before
if (preview.kind === "markdown" && viewMode === "edit") {

// after
if (viewMode === "edit") {   // 此时 preview 必为 TextualPreview
```

`aria-label` 从写死的「编辑 Markdown 源码」改为 `` `编辑 ${previewBaseName(preview.path)}` ``。

`TextualPreviewBody` 的 `viewMode` 传参（`:1565`）改为：

```ts
viewMode={isEditableText || isHtmlFile ? viewMode : "preview"}
```

**AC-2**
- `.py` / `.json` / `.yaml` / `.txt` 在编辑模式下渲染为可输入 textarea，字体、行高与只读态一致（`font-mono text-[13px] leading-[1.65]`），不出现布局跳动。
- `.html` 点「编辑源码」后可直接改源码并保存，保存后切回渲染视图能看到改动生效。

### FR-3 工具栏语义按类型区分

`WorkspaceFilePreview.tsx:1340`–`1411` 的按钮组：

- `preview.kind === "markdown"` 或 `isHtmlFile`：保留现状「Eye = 渲染预览 / Pencil = 编辑源码」。
- 其余文本类型：Eye 按钮 `title` 改为「只读」，Pencil 为「编辑」；语义是同一份源码的只读高亮态 ↔ 可输入态。
- 撤销 / 重做 / 查找替换按钮维持仅在 `viewMode === "edit"` 时出现。
- 底部提示条（`:1579`）的条件同步换成 `isEditableText`，文案保持「有未保存修改 · ⌘S 保存 · ⌘Z 撤销 · ⌘F 查找替换」。

**AC-3**：`.txt` 编辑态下工具栏依次出现「只读 / 编辑 / 撤销 / 重做 / 查找替换 / 复制 / 关闭」，撤销重做在无历史时为 disabled 态（`disabled:opacity-40`）。

### FR-4 主进程写入加固（原子写 + mtime 校验 + EOL 保持）

改 `desktop/electron/main.ts:10914` 的 `write-local-text-file` handler，入参扩展为：

```ts
{ path?: string; content?: string; expectedMtimeMs?: number; eol?: "lf" | "crlf" }
```

处理顺序（保持原有 path 校验与大小校验不变，只在其后追加）：

1. `const stat = await fs.promises.stat(normalized)`（已有）——若 `expectedMtimeMs` 传入且 `Math.abs(stat.mtimeMs - expectedMtimeMs) > 1`，返回 `{ ok: false, error: "file changed on disk", code: "STALE" }`，不写入。
2. 若 `eol === "crlf"`，写入前 `content = content.replace(/\r?\n/g, "\r\n")`。
3. 原子写：写入同目录临时文件 `<basename>.<pid>.<ts>.tmp`，再 `fs.promises.rename(tmp, normalized)`；`rename` 失败时清理 tmp 并返回错误。
4. 成功返回 `{ ok: true, size, mtimeMs: (await fs.promises.stat(normalized)).mtimeMs }`。

同步更新 `desktop/electron/preload.ts:773` 的入参透传与 `desktop/src/global.d.ts:1304` 的类型签名（新增 `expectedMtimeMs?`、`eol?`，返回值新增 `mtimeMs?`、`code?`）。

渲染侧 `persistEditContent`（`WorkspaceFilePreview.tsx:1021`）：
- 打开文件时记录 `baselineMtimeMs`（来自预览加载结果；若 `systemSearchPreview` 未返回 mtime，则新增返回字段，见 FR-4a）。
- 保存时带上 `expectedMtimeMs`；收到 `code === "STALE"` 时**不覆盖**，`setSaveError("文件已被外部修改，请关闭后重新打开")`，并把 toast 设为「保存失败」。
- 保存成功后用返回的 `mtimeMs` 刷新 `baselineMtimeMs`。
- EOL：加载内容时检测 `content.includes("\r\n")` 记为 `crlf`，保存时回传。

#### FR-4a mtime 透传

`desktop/electron/system-search.ts:540` 的 `previewSystemSearchFile` 返回体新增 `mtimeMs`；`workspace-preview-types.ts` 的 `WorkspacePreview` 文本分支新增可选 `mtimeMs?: number`，在 `mapSystemSearchPreviewToWorkspacePreview` 与 `mapTaskspaceFileToWorkspacePreview` 中透传（后者若后端无该字段则留空，此时保存降级为不带 `expectedMtimeMs`，行为与今天一致）。

**AC-4**
- 编辑 `a.txt` 不保存 → 在终端 `echo x >> a.txt` → 回 Near 按 ⌘S：出现「文件已被外部修改，请关闭后重新打开」，磁盘内容中的 `x` 未被抹掉。
- 编辑一个 CRLF 的 `.txt` 并保存后，`file a.txt` / `xxd` 检查仍为 CRLF 行尾。
- 保存过程中目录内不残留 `.tmp` 文件。

### FR-5 脏态保护

新增一个轻量的主题化确认弹层（复用现有对话框风格，禁止 `window.confirm`）：

- `WorkspaceFilePreview` 通过新增可选 prop `onRequestClose?: () => void` 与内部 `isDirty` 协作：`onClose` 触发前若 `isDirty`，先弹「有未保存修改」确认框，提供「保存并关闭 / 放弃修改 / 取消」三个动作，按钮顺序遵循「取消紧靠主按钮左侧」。
- `desktop/src/components/work-panel/WorkPanel.tsx:934` 的 `closePreviewTab` 与 `:887` 的同路径复用逻辑不改结构，只在关闭前走上述确认（由 `WorkspaceFilePreview` 内部拦截 `onClose` 实现，`WorkPanel` 侧无需感知）。
- 同一 tab 切换到别的文件时，`useEffect`（`:1008`）重置 baseline 前同样需要确认；若用户选择取消则不切换。

**AC-5**
- 改动未保存时点 ✕：出现主题化确认框（非系统原生弹窗），选「保存并关闭」文件落盘、tab 关闭；选「放弃修改」不落盘、tab 关闭；选「取消」保持原状且内容不丢。

### FR-6 不可编辑原因可见

当 `textualPreview != null && editBlockReason != null` 时，在工具栏「复制」按钮左侧展示一个静默的灰色说明 chip（`text-[11px] text-text-muted`），内容为 `editBlockReason`；不使用红色告警样式，避免制造焦虑。

**AC-6**：打开超大 `.log`，头部可见「文件过大已截断…」灰色说明，且不与既有底部琥珀色截断提示条（`:1584`）语义冲突（两者可共存，一个说明为何不能编辑、一个说明显示被截断）。

---

## 4. 涉及文件清单（改动范围白名单）

| 文件 | 改动 |
|---|---|
| `desktop/src/components/workspace/WorkspaceFilePreview.tsx` | FR-1/2/3/5/6 主战场；`:847`、`:953`、`:1008`、`:1021`、`:1047`、`:1185`、`:1340`、`:1565`、`:1579` |
| `desktop/src/components/workspace/workspace-edit-limits.ts` | **新建**，导出 `WRITE_LOCAL_TEXT_MAX_BYTES` 与注释 |
| `desktop/src/components/workspace/workspace-preview-types.ts` | `WorkspacePreview` 文本分支新增 `mtimeMs?`；两个 mapper 透传 |
| `desktop/electron/main.ts` | 仅 `:10912`–`10936` 区块（原子写 / mtime / eol） |
| `desktop/electron/system-search.ts` | `previewSystemSearchFile`（`:540`）返回体新增 `mtimeMs` |
| `desktop/electron/preload.ts` | `:773` `writeLocalTextFile` 参数透传 |
| `desktop/src/global.d.ts` | `:1304` 类型签名扩展 |
| `desktop/src/components/work-panel/WorkPanel.tsx` | 仅在预览 tab 关闭路径接确认回调（若 FR-5 由预览组件内部完全消化，则本文件可零改动） |

> `agenticx/studio/server.py` **不在**本次改动范围内，不得触碰。

---

## 5. 实施阶段

### Phase 1 — 主进程写入加固（先做，独立可验收）
FR-4 / FR-4a。改 `main.ts` / `system-search.ts` / `preload.ts` / `global.d.ts`。
验收：手工用现有 Markdown 编辑路径回归一次保存，确认原子写与 mtime 校验生效。

> ⚠️ 改完 `desktop/electron/*` 必须**完全退出并重启 `npm run dev`**（⌘Q），仅刷新渲染进程不会加载新 IPC handler。

### Phase 2 — 渲染层解除门控
FR-1 / FR-2 / FR-3 / FR-6。改 `WorkspaceFilePreview.tsx` + 新建常量文件 + 类型透传。

### Phase 3 — 脏态保护
FR-5。

### Phase 4 — 测试与回归
见第 6 节。

---

## 6. 测试计划

### 6.1 单元测试（新增）

新建 `desktop/src/components/workspace/__tests__/workspace-edit-guard.test.ts`（若仓库该目录测试约定不同，按既有 desktop 测试目录结构就近放置）：

- `editBlockReason` 纯函数抽出后覆盖 5 种情形：正常 / 截断 / 超限 / 含 `U+FFFD` / 带 `initialLineRange`。
- EOL 检测与还原：`\r\n` 文本 → 检测为 `crlf` → 还原后与原文逐字节相等。

### 6.2 主进程测试

新建 `desktop/electron/__tests__/write-local-text-file.test.ts`（或按既有 electron 测试约定）：

- mtime 不匹配返回 `code: "STALE"` 且文件内容未变。
- 超过 512 KB 返回错误且未写入。
- 原子写：成功后目录内无 `.tmp` 残留。

### 6.3 手工回归清单

| 场景 | 期望 |
|---|---|
| `requirements.txt` 编辑保存 | 内容落盘，重开一致 |
| `.py` 编辑 + ⌘Z 撤销 + ⌘F 替换 | 三项均生效 |
| `.md` 原有编辑流程 | **无回退**，预览/编辑切换、自动保存后切预览行为不变 |
| `.html` 编辑源码保存后切渲染 | 渲染反映新内容 |
| PDF / 图片 / `.xlsx` | 仍为只读，无编辑按钮 |
| 未保存关闭 tab | 主题化三选一确认框 |
| 外部并发修改后保存 | 拒绝覆盖并提示 |

---

## 7. 子任务 → 推荐模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| Phase 1 主进程写入加固（原子写 / mtime / EOL） | `gpt-5.6-terra-medium` | 涉及文件系统一致性与竞态语义，需要较强推理，但范围收敛 |
| Phase 2 渲染层解除门控 + 工具栏语义 | `kimi-k2.7-code` | 以精确改点为主的样板式改造，性价比高 |
| Phase 3 脏态确认弹层 | `claude-sonnet-5-thinking-medium` | 涉及交互取舍与视觉一致性，需要一点品味 |
| Phase 4 测试补齐 | `composer-2.5-fast` | 按 AC 写断言，机械度高 |

以上为建议；最终 `Impl-Model` trailer 以实际使用为准，由用户确认。

---

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 误覆盖 agent 正在写的工作区文件 | FR-4 mtime 前置校验；STALE 时拒绝写入 |
| 截断文件写回导致内容丢失 | FR-1 `truncated` 硬门控 + FR-6 原因可见 |
| 非 UTF-8 文件被 `U+FFFD` 污染 | FR-1 检测到替换字符即禁编辑 |
| Markdown 既有编辑流程回退 | 手工回归清单单列一行；`isEditableMarkdown → isEditableText` 为超集替换，不改 markdown 分支既有行为 |
| Electron 主进程改动未生效导致误判 | 实施说明中已写明必须 ⌘Q 重启 dev |

回滚：三个 Phase 各自独立成 commit，任一阶段出问题可单独 revert；Phase 2 revert 后即回到「仅 Markdown 可编辑」的今日行为。
