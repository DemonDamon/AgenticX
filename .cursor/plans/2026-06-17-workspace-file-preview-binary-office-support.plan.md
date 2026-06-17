# Workspace File Preview Binary & Office Support Implementation Plan

> **For Composer 2.5:** Execute this plan task-by-task. Do not refactor unrelated chat/workspace behavior. Keep every code change traceable to one requirement below. Use TDD where practical, and stop after each phase to verify before proceeding.

## What & Why

Near Desktop 的工作区文件预览当前把所有文件都当 UTF-8 文本读取并展示，导致 PDF、图片、Excel、Word 等二进制文件出现乱码。用户期望工作区文件预览至少不乱码，并逐步支持图片、PDF、DOCX、XLSX 等常见文档预览，体验参考 Kimi 的文件预览，但 Desktop 第一阶段不追求完整 Office 编辑器级还原。

## Current State

- `agenticx/studio/session_manager.py:1149-1182` 的 `read_taskspace_file()` 会读取 bytes 后执行 `data.decode("utf-8", errors="replace")`，这是 PDF/PNG/JPEG/XLSX/DOCX 乱码的根因。
- `agenticx/studio/server.py:4656-4674` 暴露 `GET /api/taskspace/file`，当前只返回文本字段 `content`。
- `desktop/electron/preload.ts:326-329` 通过 `window.agenticxDesktop.readTaskspaceFile()` 读取上述接口。
- `desktop/src/global.d.ts:640-649` 只声明了文本读取响应字段。
- `desktop/src/components/WorkspacePanel.tsx` 的 `FilePreview` 只有 `content/truncated/size`，渲染分支只有 Markdown 和 Prism code。
- Electron 主进程已有 `load-local-image-data-url`（`desktop/electron/main.ts`），聊天 Markdown 图片预览已通过该 IPC 读取本地图片，但工作区预览未复用。
- `agenticx.tools.adapters.liteparse.LiteParseAdapter` 已支持 PDF/DOC/DOCX/PPT/PPTX/XLS/XLSX/图片解析文本，但它适合“抽取内容给 agent”，不等同于视觉预览。

## Requirements

- FR-1: 工作区预览不得对二进制文件做 UTF-8 强制解码；二进制文件必须显示图片/PDF/文档预览或友好占位，不得显示乱码。
- FR-2: PNG/JPG/JPEG/GIF/WEBP 图片在工作区预览中直接展示图片，支持居中、自适应、滚动、复制路径/关闭。
- FR-3: PDF 第一阶段先显示友好占位（文件名、大小、类型、可在 Finder 中打开/复制路径/引用），第二阶段使用 `pdfjs-dist` 渲染前 N 页并支持翻页/缩放。
- FR-4: DOCX/XLSX 第一阶段先显示友好占位，可选调用 LiteParse 抽取文本摘要；第二阶段 DOCX 通过 `mammoth` 渲染 HTML，XLSX 通过 `xlsx` 渲染工作表表格。
- FR-5: 工作区树点击文件和聊天中绝对路径点击文件均走同一预览分类逻辑。
- FR-6: 预览卡片背景与头部必须使用不透明 surface token（如 `bg-surface-popover` / `bg-surface-base`），禁止使用 `bg-surface-card`、`bg-surface-hover` 等在 dark/dim 主题中定义为 rgba 的半透明变量作为弹窗主体背景。
- FR-7: 大文件必须有上限和提示：文本最多读取/展示 512KB；图片/PDF data URL 读取须限制大小（默认 25MB，可在代码常量中集中配置）；超过限制显示友好占位和“在 Finder 中打开”。
- FR-8: 不引入在线服务，不上传用户本地文件；所有预览在本地 Electron/Studio 内完成。

## Acceptance Criteria

- AC-1: 打开 `.png/.jpg/.jpeg/.gif/.webp` 时预览卡片显示图片，不出现乱码。
- AC-2: 打开 `.pdf/.docx/.xlsx` 时至少显示“暂不支持完整预览”的友好占位，且不显示乱码。
- AC-3: 打开 `.md/.py/.ts/.json/.txt/.sh` 仍保持现有 Markdown/代码高亮能力。
- AC-4: 聊天中点击 `/Users/.../file.pdf` 或 `/Users/.../image.png` 与工作区树点击同一文件的行为一致。
- AC-5: 暗色/暗灰主题下预览卡片顶部和正文不透出底层聊天内容。
- AC-6: Python 单元测试覆盖文本文件、图片二进制、PDF 伪文件的分类与返回结构。
- AC-7: Desktop lint 对改动文件无新增错误；若全量 typecheck 存在既有错误，最终说明中必须列明与本次改动无关。

## Architecture

新增“文件预览分类”层，避免 `readTaskspaceFile` 继续承担所有类型的读取职责：

1. **后端 Studio**
   - `read_taskspace_file()` 保持文本读取兼容，但新增 `kind/mime_type/is_binary/preview_supported` 等字段。
   - 对二进制文件不返回 `content`，只返回元数据和 `absolute_path`。
   - 可新增纯函数 `classify_taskspace_file(path, size)` 便于单测。

2. **Electron Main/Preload**
   - 复用/扩展 `load-local-image-data-url` 给图片预览使用。
   - P1 新增通用只读 IPC：`load-local-file-data-url`，仅允许预览 allowlist 扩展名，并做大小限制。

3. **Desktop Renderer**
   - 把 `WorkspacePanel.tsx` 中的预览渲染拆成 `WorkspaceFilePreview.tsx`。
   - 预览状态从单一 `FilePreview.content` 改为 discriminated union。
   - 所有背景使用不透明 token。

## Data Contract

### P0 Response Shape

`GET /api/taskspace/file` 在兼容旧字段基础上返回：

```ts
type TaskspaceFilePreviewResponse = {
  ok: boolean;
  name?: string;
  path?: string;
  absolute_path?: string;
  content?: string;          // only for text/code/markdown
  truncated?: boolean;
  size?: number;
  mime_type?: string;
  preview_kind?: "text" | "markdown" | "code" | "image" | "pdf" | "office" | "binary";
  is_binary?: boolean;
  preview_supported?: boolean;
  error?: string;
};
```

### Frontend Union

```ts
type WorkspacePreview =
  | {
      kind: "text" | "markdown" | "code";
      path: string;
      absolutePath: string;
      content: string;
      size: number;
      truncated: boolean;
      mimeType: string;
    }
  | {
      kind: "image";
      path: string;
      absolutePath: string;
      size: number;
      mimeType: string;
    }
  | {
      kind: "pdf" | "office" | "binary";
      path: string;
      absolutePath: string;
      size: number;
      mimeType: string;
      message: string;
    };
```

## Phase P0: Stop Garbled Preview + Image Support

### Task 1: Add backend file classification

**Files**

- Modify: `agenticx/studio/session_manager.py`
- Test: `tests/test_studio_taskspace_file_preview.py` (new)

**Step 1: Add failing tests**

Create `tests/test_studio_taskspace_file_preview.py` with focused tests for a pure classifier if possible. If direct `SessionManager` construction is awkward, extract a pure helper first in the implementation step and test that helper.

Test cases:

- `.py` returns `preview_kind="code"`, `is_binary=False`, and `content` present.
- `.md` returns `preview_kind="markdown"`, `is_binary=False`, and `content` present.
- `.png` with PNG header returns `preview_kind="image"`, `is_binary=True`, and no `content`.
- `.pdf` with `%PDF-` header returns `preview_kind="pdf"`, `is_binary=True`, and no `content`.
- `.xlsx` returns `preview_kind="office"`, `is_binary=True`, and no `content`.

Expected initial result: tests fail because classifier/fields do not exist.

**Step 2: Implement helper functions**

In `agenticx/studio/session_manager.py`, add small helpers near taskspace file methods:

- `_guess_preview_mime(path: Path) -> str`
- `_guess_preview_kind(path: Path, mime_type: str) -> str`
- `_is_textual_preview_kind(kind: str) -> bool`

Use `mimetypes.guess_type()` plus explicit extension fallback. Required mappings:

- Markdown: `.md`, `.markdown`, `.mdx`
- Code/text: `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.toml`, `.sh`, `.bash`, `.txt`, `.csv`, `.log`, `.xml`, `.html`, `.css`
- Image: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`
- PDF: `.pdf`
- Office: `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`
- Binary fallback: everything else

**Step 3: Modify `read_taskspace_file()`**

Replace unconditional UTF-8 decode with:

- Always compute `name`, `path`, `absolute_path`, `size`, `mime_type`, `preview_kind`, `is_binary`.
- If textual kind: read up to `max_bytes`, decode UTF-8 with replacement, return `content`.
- If non-textual kind: do **not** read full file, do **not** decode bytes, return metadata only.

Keep `truncated` for text files. For binary files, `truncated` should be `False` or omitted.

**Step 4: Run tests**

Run:

```bash
pytest tests/test_studio_taskspace_file_preview.py -q
```

Expected: PASS.

### Task 2: Update API and desktop type contracts

**Files**

- Modify: `agenticx/studio/server.py`
- Modify: `desktop/src/global.d.ts`
- Modify: `desktop/electron/preload.ts` if endpoint path changes; otherwise no change.

**Step 1: Keep API route stable**

Do not rename `/api/taskspace/file` in P0. The response gains fields only; this preserves existing renderer callers.

**Step 2: Update TypeScript declarations**

Update `desktop/src/global.d.ts` `readTaskspaceFile` return type to include:

```ts
mime_type?: string;
preview_kind?: "text" | "markdown" | "code" | "image" | "pdf" | "office" | "binary";
is_binary?: boolean;
preview_supported?: boolean;
```

**Step 3: Verify no compile-time errors in edited files**

Use `ReadLints` or run a focused `npx tsc --noEmit -p tsconfig.json` and note unrelated existing errors if any.

### Task 3: Split preview rendering out of `WorkspacePanel`

**Files**

- Create: `desktop/src/components/workspace/WorkspaceFilePreview.tsx`
- Modify: `desktop/src/components/WorkspacePanel.tsx`

**Step 1: Create `WorkspaceFilePreview.tsx`**

Move the portal card UI out of `WorkspacePanel.tsx`. The new component should accept:

```ts
type WorkspaceFilePreviewProps = {
  preview: WorkspacePreview;
  anchor: { top: number; bottom: number; left: number };
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
};
```

Important visual rule:

- Main card: `bg-surface-popover`
- Header: `bg-surface-popover`
- Body: `bg-surface-base`
- Do not use `/NN` Tailwind opacity suffix for preview surface classes.
- Do not use `bg-surface-card` or `bg-surface-hover` as main/header/body background because dark/dim themes define them as rgba.

**Step 2: Render textual preview**

Inside the component:

- `kind === "markdown"`: existing `ReactMarkdown` pipeline.
- `kind === "code" | "text"`: existing Prism highlighter.

**Step 3: Render image preview**

For `kind === "image"`:

- Use `window.agenticxDesktop.loadLocalImageDataUrl(preview.absolutePath)`.
- Show loading skeleton while loading.
- On success render:

```tsx
<div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-surface-base p-6">
  <img src={dataUrl} className="max-h-full max-w-full rounded-lg object-contain" />
</div>
```

- On failure show an error placeholder with buttons:
  - Copy path
  - Reveal in Finder / file manager

**Step 4: Render unsupported binary/PDF/Office placeholder**

For P0:

- `kind === "pdf"`: show “PDF 预览将在下一阶段支持；当前可在系统应用中打开。”
- `kind === "office"`: show “Office 文档预览将在下一阶段支持；当前可在系统应用中打开。”
- `kind === "binary"`: show “该文件类型暂不支持预览。”

Each placeholder includes:

- File icon
- File type and size
- Buttons: Copy path, Reveal in Finder/file manager, Reference to chat if existing callback is available later (optional in P0)

### Task 4: Adapt `WorkspacePanel` state and open flow

**Files**

- Modify: `desktop/src/components/WorkspacePanel.tsx`

**Step 1: Replace `FilePreview` type**

Remove the old text-only `FilePreview` shape:

```ts
type FilePreview = {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
};
```

Replace with the `WorkspacePreview` union either imported from `WorkspaceFilePreview.tsx` or colocated in `desktop/src/components/workspace/workspace-preview-types.ts`.

**Step 2: Adapt `openFile()`**

After `readTaskspaceFile()`:

- If `preview_kind` is `"image"`, set `kind: "image"` preview using `absolute_path`.
- If `"pdf" | "office" | "binary"`, set placeholder preview.
- If `"markdown"`, set markdown preview with content.
- If `"code" | "text"`, set code/text preview with content.
- Preserve `selectedFilePath`.
- Never call Prism on binary preview.

**Step 3: Preserve chat path behavior**

Ensure `openFileByAbsolutePath()` continues to call `openFile(match.taskspaceId, match.relPath)` and therefore inherits the new classification.

**Step 4: Manual sanity check**

Try the following from a bound workspace:

- `.py` file: syntax highlighted.
- `.md` file: rendered Markdown.
- `.png`/`.jpg`: rendered image.
- `.pdf`: friendly placeholder, no garbled bytes.
- `.docx`/`.xlsx`: friendly placeholder, no garbled bytes.

### Task 5: Verification and first commit

**Files**

- All P0 files above.

**Step 1: Run focused Python tests**

```bash
pytest tests/test_studio_taskspace_file_preview.py -q
```

Expected: PASS.

**Step 2: Read lints for desktop files**

Use `ReadLints` on:

- `desktop/src/components/WorkspacePanel.tsx`
- `desktop/src/components/workspace/WorkspaceFilePreview.tsx`
- `desktop/src/global.d.ts`

Expected: no new linter errors.

**Step 3: Optional focused build/typecheck**

```bash
cd desktop && npx tsc --noEmit -p tsconfig.json
```

If existing unrelated errors appear, do not fix unrelated files. Record them in final verification notes.

**Step 4: Commit P0**

Commit only files changed for P0. Commit message must include:

```text
Made-with: Damon Li
Plan-Id: 2026-06-17-workspace-file-preview-binary-office-support
Plan-File: .cursor/plans/2026-06-17-workspace-file-preview-binary-office-support.plan.md
```

## Phase P1: Rich PDF / DOCX / XLSX Preview

Proceed to P1 only after P0 is verified and committed.

### Task 6: Add preview dependencies

**Files**

- Modify: `desktop/package.json`
- Modify lockfile if present.

**Dependencies**

Install using package manager, do not hand-edit versions:

```bash
cd desktop
npm install pdfjs-dist mammoth xlsx
```

Notes:

- `pdfjs-dist` handles PDF rendering.
- `mammoth` handles DOCX to HTML.
- `xlsx` handles XLS/XLSX workbook parsing. If `.xls` parsing is unreliable, degrade gracefully to placeholder.

### Task 7: Add safe local binary data IPC

**Files**

- Modify: `desktop/electron/main.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/global.d.ts`

**Step 1: Add `load-local-file-data-url` IPC**

In `main.ts`, add:

```ts
const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
const PREVIEW_FILE_MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};
```

The handler must:

- Normalize `file://` paths.
- Check `fs.existsSync`.
- Reject directories.
- Reject files over `PREVIEW_MAX_BYTES`.
- Reject extensions not in allowlist for this IPC.
- Return `{ ok: true, dataUrl, mime, size }`.

Do not expose arbitrary file reads beyond allowlist.

**Step 2: Expose in preload/global types**

`preload.ts`:

```ts
loadLocalFileDataUrl: async (path: string) => ipcRenderer.invoke("load-local-file-data-url", path),
```

`global.d.ts`:

```ts
loadLocalFileDataUrl: (path: string) => Promise<{ ok: boolean; dataUrl?: string; mime?: string; size?: number; error?: string }>;
```

### Task 8: Implement PDF preview

**Files**

- Modify: `desktop/src/components/workspace/WorkspaceFilePreview.tsx`
- Optionally Create: `desktop/src/components/workspace/PdfPreview.tsx`

**Implementation**

- Load data URL via `loadLocalFileDataUrl(absolutePath)`.
- Use `pdfjs-dist` to render PDF.
- Configure worker correctly for Vite/Electron. Prefer local worker URL import pattern:

```ts
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
```

- Render pages to `<canvas>` for first 10 pages initially.
- Provide controls:
  - current page / total pages
  - previous / next
  - zoom in / zoom out
- For PDFs over 25MB or load failure, show placeholder with system-open/copy buttons.

**Acceptance**

- A normal PDF displays first page.
- Multi-page PDF can navigate pages.
- Large PDF fails gracefully, no crash, no乱码.

### Task 9: Implement DOCX preview

**Files**

- Modify/Create: `desktop/src/components/workspace/DocxPreview.tsx`
- Modify: `WorkspaceFilePreview.tsx`

**Implementation**

- Fetch bytes from data URL or use base64 conversion.
- Use `mammoth.convertToHtml({ arrayBuffer })`.
- Render resulting sanitized-ish HTML in a contained preview surface.
- Scope styles under `.agx-docx-preview`.
- Do not attempt editing toolbar or full Word fidelity.

**Security**

- Mammoth output should be treated as local trusted document content but still avoid script execution. React `dangerouslySetInnerHTML` is acceptable only after confirming Mammoth does not emit scripts; otherwise strip `<script>` tags with a tiny local sanitizer.

**Acceptance**

- DOCX headings/paragraphs/tables are readable.
- Unsupported/failed DOCX displays friendly placeholder.

### Task 10: Implement XLSX preview

**Files**

- Modify/Create: `desktop/src/components/workspace/SpreadsheetPreview.tsx`
- Modify: `WorkspaceFilePreview.tsx`

**Implementation**

- Load file via `loadLocalFileDataUrl`.
- Parse with `xlsx`.
- Render:
  - Sheet tab selector for first 8 sheets.
  - Table preview for first 200 rows and 50 columns.
  - Sticky header row if easy; otherwise simple table.
- Avoid rendering huge workbooks fully.

**Acceptance**

- XLSX first sheet renders readable table.
- Multiple sheets can be selected.
- Large sheet shows “仅展示前 200 行 / 50 列” hint.
- Unsupported `.xls` failure degrades to placeholder.

### Task 11: Verification and second commit

**Step 1: Manual preview matrix**

Test locally:

- `.png`
- `.jpg`
- `.pdf`
- `.docx`
- `.xlsx`
- `.py`
- `.md`
- unknown binary

**Step 2: Build**

```bash
cd desktop && npm run build
```

Expected: build succeeds. If unrelated existing issues fail, document exact errors and avoid unrelated changes unless required by new dependencies.

**Step 3: Commit P1**

Commit only P1 files and lockfile.

Commit trailers:

```text
Made-with: Damon Li
Plan-Id: 2026-06-17-workspace-file-preview-binary-office-support
Plan-File: .cursor/plans/2026-06-17-workspace-file-preview-binary-office-support.plan.md
```

## Out of Scope

- Full Kimi/Word-like editor toolbar.
- Office collaborative editing.
- Uploading local files to cloud preview services.
- PPTX visual slide fidelity.
- Refactoring unrelated chat message rendering, workspace terminal, or taskspace persistence logic.

## Risks & Mitigations

- **Risk:** PDF.js worker bundling fails in Electron/Vite.
  - Mitigation: isolate PDF preview in `PdfPreview.tsx`; if worker import fails, fall back to placeholder and keep P0 stable.
  - **Follow-up (2026-06-17):** Electron 34 lacks `Uint8Array.toHex()` required by pdfjs-dist 6.x modern build; use `pdfjs-dist/legacy/build/pdf.mjs` + matching worker instead.
- **Risk:** Theme token backgrounds are rgba and cause transparency.
  - Mitigation: use only `bg-surface-popover` and `bg-surface-base` for modal/card surfaces; verify dark/dim visually.
- **Risk:** Very large files freeze renderer.
  - Mitigation: enforce byte limits in Electron IPC and row/page limits in renderer.
- **Risk:** DOCX/XLSX parsing libraries add bundle size.
  - Mitigation: dynamic import `mammoth`, `xlsx`, and `pdfjs-dist` only inside their preview components.
- **Risk:** Existing full `tsc` has unrelated errors.
  - Mitigation: do not fix unrelated files; use `ReadLints` and focused build evidence where possible, report residual risk.

## Post-implementation Fixes (2026-06-17)

- **FR-1 follow-up:** Extend classifier with `.jsonl`, `.ndjson`, `.rs`; add `text/*` MIME fallback so plain-text files are not mislabeled `binary`.
- **FR-3 follow-up:** Switch `PdfPreview.tsx` to `pdfjs-dist/legacy/build/*` for Electron 34 compatibility (`hashOriginal.toHex is not a function`).
- **Tests:** Add coverage for `.jsonl`, `.rs`, `.log` classification in `tests/test_studio_taskspace_file_preview.py`.

## Final Handoff Notes for Composer 2.5

- Start with P0 only. Do not install dependencies until P0 is committed.
- Keep `WorkspacePanel.tsx` small by moving preview UI into `desktop/src/components/workspace/WorkspaceFilePreview.tsx`.
- Preserve existing text/Markdown behavior exactly.
- Never render binary bytes inside `<pre><code>`.
- After P0, ask for confirmation before implementing P1 if the user wants a smaller first PR.
