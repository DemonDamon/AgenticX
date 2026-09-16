# Desktop 本轮产物交接（预览 + 带走）

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> 范围收成「最显性小闭环」：本轮主产物出现在回复旁、点一下能在应用内看、能复制表格/路径、能另存。不做 Canvas、不做 Office 全格式互转、不做 PPT 缩略图、不做预览页转 PDF。

**Goal:** Agent 写完交付文件后，用户在回复下方立刻看到产物卡；点预览打开右侧工作台；表格能复制进表格软件；文件能另存。

**Architecture:** 复用已有 `collectSessionArtifactPaths` / `revealFileInTaskspace` / WorkPanel 预览。新增纯函数选出「主产物」（只自动打开这一份）。聊天气泡下方挂产物卡。Markdown 本地链接改走应用内预览，不再系统默认打开。另存为走主进程 `copy-local-file-as`。

**Tech Stack:** Desktop React + Zustand + Electron IPC + Vitest

---

## In scope

- FR-1: 从本轮消息切出产物路径，并选出唯一主产物
- FR-2: 最后一条助手回复下方展示产物卡（预览 / 访达 / 复制路径 / 另存为）
- FR-3: 本轮从忙碌变为空闲时，仅自动打开主产物（历史会话切换不打开）
- FR-4: 聊天气泡里的本地文件链接走应用内预览
- FR-5: Markdown 表格默认复制为 TSV（可粘贴到表格软件）
- FR-6: 主进程另存为；产物卡、HTML 分享菜单、文件预览顶栏可调用

## Out of scope

- 模型生成 React / Canvas 运行时
- HTML/Markdown 预览页一键转 PDF
- PPTX 缩略图、Office 排版保真
- 每个中间文件都自动打开
- 改 `agenticx/studio/server.py` import 区

## no-scope-creep

只改本 plan 列出的 Desktop 路径。不重构 WorkPanel、不改聊天发送链路、不改企业门户。

---

## 根因与证据

现有能力已经半套：

- `desktop/src/utils/session-artifacts.ts` 能从 `file_write` / bash / 助手正文收集路径；`collectTurnPreviewImagePaths` 只服务图片注入，没有「本轮全部产物 + 主产物」。
- `desktop/src/components/work-panel/SessionArtifactList.tsx` 在右侧摘要里，用户经常看不到。
- `desktop/src/components/messages/ArtifactFileLink.tsx` 用 `shellOpenPath` 交给系统应用，和 `ChatPane.revealFileInTaskspace` 的应用内预览不一致。
- `desktop/src/components/messages/TableBlock.tsx` 复制的是 Markdown，不是可粘贴到表格软件的 TSV。
- 没有「另存为」IPC；`exportMessagesPdf` 只导出整段对话。

自动打开必须避免 tab 轰炸：只在 **忙碌→空闲边沿** 打开 **一份主产物**。源码/日志（`.py` `.ts` `.json` `.log` 等）不能当主产物。

---

## 子规划 → 推荐模型

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| 纯函数 + 单测 | Composer 2.5 | 路径排序/切轮次，样板清晰 |
| 产物卡 + 链接/表格 | Composer 2.5 | 现有卡片/Markdown 组件接线 |
| Electron 另存为 IPC | Composer 2.5 | 对照已有 `export-messages-pdf` / `shell-show-item-in-folder` |

Suggested-Impl-Model: Composer 2.5

---

## FR / AC

### FR-1 本轮产物与主产物

- AC-1: `desktop/src/utils/session-artifacts.test.ts` 覆盖：
  - 本轮 `file_write` 出 `report.html` + `notes.py` → `collectTurnArtifactPaths` 含两者；`pickPrimaryTurnArtifact` 只返回 html
  - 后面还有另一条 assistant → 前一条的 `collectTurnArtifactPaths` 为空（避免重复卡）
  - 只有 `.py` / `.json` → `pickPrimaryTurnArtifact` 为 `null`
- AC-2: 主产物优先级：`html/htm` > `pdf` > `docx/doc` > `xlsx/xls/csv` > `pptx/ppt` > `md` > `txt` > 图片

### FR-2 回复下方产物卡

- AC-3: 非流式助手消息、本轮有产物时，在 `MessageRenderer` 气泡下方出现产物卡；流式 `__stream__` 不出现
- AC-4: 主产物行提供：预览（走 `onRevealPath`）、访达、复制路径、另存为
- AC-5: 附件超过 1 个时主产物置顶，其余可展开

### FR-3 主产物自动打开

- AC-6: `ChatPane` 仅在 `sessionBusy || isStreaming` 从 true 变 false 时调用已有 `openWorkspaceFilePreview(primary)`
- AC-7: 切换历史会话、首次挂载不自动打开
- AC-8: 无主产物时不打开、不切侧栏

### FR-4 本地链接进应用内预览

- AC-9: `ArtifactFileLink` 有 `MarkdownContext.onRevealPath` 时调用它；无回调才回退 `shellOpenPath`
- AC-10: 伪链接仍显示「文件不存在」

### FR-5 表格复制 TSV

- AC-11: `rowsToTsv` 用 tab 分隔、单元格内 tab/换行替换为空格；`markdown-table-export.test.ts` 断言
- AC-12: `TableBlock` 默认复制按钮复制 TSV，tooltip「复制表格」；保留「复制 Markdown」

### FR-6 另存为

- AC-13: IPC `copy-local-file-as`：源必须是已存在的普通文件；用户取消返回 `{ ok: true, canceled: true }`
- AC-14: 产物卡 / HTML 分享菜单 / `WorkspaceFilePreview` 顶栏可另存

---

## 落点

### 1) `desktop/src/utils/session-artifacts.ts`

在 `collectTurnPreviewImagePaths` 旁新增：

```ts
const PRIMARY_ARTIFACT_RANK: Record<string, number> = {
  html: 0, htm: 0, pdf: 1, docx: 2, doc: 2,
  xlsx: 3, xls: 3, csv: 3, pptx: 4, ppt: 4,
  md: 5, markdown: 5, txt: 6,
  png: 8, jpg: 8, jpeg: 8, gif: 8, webp: 8, svg: 8, bmp: 8,
};

const PRIMARY_ARTIFACT_EXCLUDE = new Set([
  "py", "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "yaml", "yml", "toml", "lock",
  "log", "sh", "bash", "zsh", "fish",
]);

export function artifactExt(path: string): string { /* basename 最后一段扩展名小写 */ }

export function collectTurnArtifactPaths(messages, assistantMessageId): string[] {
  // 窗口与 collectTurnPreviewImagePaths 相同：上一 user 之后 → 本 assistant（含中间 tool）
  // 若后面还有 assistant，返回 []
  return collectSessionArtifactPaths(list.slice(start, idx + 1));
}

export function pickPrimaryTurnArtifact(paths: string[]): string | null {
  // 排除 PRIMARY_ARTIFACT_EXCLUDE；其余按 PRIMARY_ARTIFACT_RANK，未入表的排 50
  // 无人选 → null
}

export function orderTurnArtifactsForCard(paths: string[]): string[] {
  // 主产物置顶，其余保持收集顺序去重
}
```

### 2) `desktop/src/components/messages/TurnArtifactCard.tsx`（新建）

视觉对齐 `SessionArtifactList`：`border-border bg-surface-card`，标题「本轮产物」。

Props: `paths: string[]`, `onOpenPath: (path: string) => void`

内部调用：

- `window.agenticxDesktop.shellShowItemInFolder`
- `navigator.clipboard.writeText(path)`
- `window.agenticxDesktop.copyLocalFileAs({ sourcePath })`

### 3) `desktop/src/components/messages/MessageRenderer.tsx`

助手分支（Im / terminal / clean）在气泡组件后追加：

```tsx
{message.role === "assistant" &&
message.id !== "__stream__" &&
!isGroupStreamMessageId(message.id) ? (
  <TurnArtifactCard
    paths={collectTurnArtifactPaths(allMessages, message.id)}
    onOpenPath={(path) => onRevealPath?.(path)}
  />
) : null}
```

`paths.length === 0` 时卡片自渲染 `null`。需要 `onRevealPath` 才显示预览按钮。

### 4) `desktop/src/components/ChatPane.tsx`

在 `openWorkspaceFilePreview` 定义之后加：

```ts
const artifactAutoOpenKeyRef = useRef("");
const artifactTurnBusyRef = useRef(false);

useEffect(() => {
  const busy = sessionBusy || isStreamingCurrentSession;
  const settled = artifactTurnBusyRef.current && !busy;
  artifactTurnBusyRef.current = busy;
  if (!settled) return;
  const lastId = lastAssistantMessageId;
  if (!lastId || lastId === "__stream__") return;
  const primary = pickPrimaryTurnArtifact(
    collectTurnArtifactPaths(pane.messages ?? [], lastId),
  );
  if (!primary) return;
  const key = `${pane.sessionId}:${lastId}:${primary}`;
  if (artifactAutoOpenKeyRef.current === key) return;
  artifactAutoOpenKeyRef.current = key;
  openWorkspaceFilePreview(primary);
}, [sessionBusy, isStreamingCurrentSession, lastAssistantMessageId, pane.sessionId, pane.messages, openWorkspaceFilePreview]);
```

会话切换时把 `artifactTurnBusyRef` 置 false（另写一个只依赖 `pane.sessionId` 的 effect），避免切到正在忙碌的窗格误触发。

### 5) `desktop/src/components/messages/ArtifactFileLink.tsx`

`useContext(MarkdownContext)`；有 `onRevealPath` 则调用并 `idle`，失败仍走原来的 `shellOpenPath` + 伪链接提示。

### 6) `desktop/src/utils/markdown-table-export.ts` + `TableBlock.tsx`

```ts
export function rowsToTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => cell.replace(/[\t\r\n]+/g, " ").trim()).join("\t"))
    .join("\n");
}
```

`TableBlock.handleCopy` 改为 `rowsToTsv`；tooltip「复制表格」。保留第二个按钮复制 Markdown。

### 7) Electron 另存为

`desktop/electron/main.ts` 在 `shell-show-item-in-folder` 旁：

```ts
ipcMain.handle("copy-local-file-as", async (_event, payload) => {
  const source = expandDesktopLocalPath(payload?.sourcePath);
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return { ok: false, error: "source is not a file" };
  }
  const saveRes = await dialog.showSaveDialog(focused, {
    defaultPath: path.join(app.getPath("downloads"), path.basename(source)),
  });
  if (saveRes.canceled || !saveRes.filePath) return { ok: true, canceled: true };
  await fs.promises.copyFile(source, saveRes.filePath);
  return { ok: true, canceled: false, path: saveRes.filePath };
});
```

同步：`preload.ts`、`desktop/src/global.d.ts`。

`HtmlPreviewChrome` 分享菜单加「另存为…」。
`WorkspaceFilePreview` 顶栏 Copy 左侧加另存按钮（`Download` 图标）。

---

## 验证

```bash
cd desktop && npx vitest run src/utils/session-artifacts.test.ts src/utils/markdown-table-export.test.ts
```

手工（`npm run dev`，须完全重启主进程才能加载新 IPC）：

1. 让助手 `file_write` 一份 `.html` 报告 → 回复下出现产物卡；侧栏自动打开该 HTML
2. 同轮再写 `.py` → 不自动打开 py；卡上 py 为附件
3. 点聊天气泡里的 `sandbox:` / `file:` 链接 → 工作台预览，不是系统浏览器
4. 复制气泡表格 → 粘贴到电子表格为多列
5. 产物卡「另存为」→ 下载目录出现副本；取消不报错

---

## 实施顺序

1. 纯函数 + 单测
2. TSV
3. ArtifactFileLink
4. TurnArtifactCard + MessageRenderer
5. ChatPane 自动打开
6. IPC 另存为 + 三处入口
