# Desktop 多选消息「保存为 PDF」导出

Planned-with: Claude Opus 4.8
Suggested-Impl-Model: Composer 2.5 Fast

> 复杂度：中等（M）。范围锁定 Desktop 渲染端 + Electron 主进程，不触碰 Python 后端、不改跨窗格状态。
> 子任务性质：Electron IPC 接线 + 一段自包含 HTML 生成 + 原生 printToPDF。属「后端接线 + 前端样板」，Composer/Fast 档足够，无需上顶配。

---

## 1. 需求（来自用户截图红框）

在聊天多选工具栏（`已多选 N 条 · 转发 · 复制 · 删除 · 取消`）中，`复制` 旁**新增一个「保存为 PDF」按钮**：
用户多选若干条消息后点击，把**选中的对话历史（文本）+ 图片**导出为**一份完整 PDF**，弹出系统保存对话框让用户选择落盘路径，成功后给出反馈并可在访达/资源管理器中定位。

### FR（功能性需求）
- FR-1：多选栏（`selectedMessageIds.size > 0` 时可见）在「复制」与「删除」之间新增「保存为 PDF」按钮，视觉与相邻按钮一致（`rounded px-1 hover:bg-surface-hover`）。
- FR-2：导出内容按**时间顺序**（即 `selectedMessages` 现有顺序）包含每条消息的：发送者标签（我 / 分身名 / AI）、时间、正文（Markdown 渲染为 HTML）、内嵌图片。
- FR-3：图片来源为 `message.attachments[].dataUrl`（base64，自包含），以及正文 Markdown 内的图片；PDF 必须真实显示这些图片，不能只剩文字或占位符。
- FR-4：点击后弹出系统「保存文件」对话框，默认文件名形如 `Machi对话_<会话简称或日期>_<HH-mm>.pdf`，默认目录为用户「下载」目录。
- FR-5：导出成功后：给出应用内 toast（复用 `setStallHintToast` 或新增 `pdfExportToast`）提示「已保存到 <路径>」；用户取消保存对话框时静默返回、无报错 toast。
- FR-6：导出失败（写盘/渲染异常）时给出可读错误 toast（含底层错误摘要前 200 字），不吞错。

### NFR（非功能性需求）
- NFR-1：**零外网依赖、单文件自包含**——HTML 内联所有 CSS 与图片 dataUrl，不引用远程资源。
- NFR-2：**中文正确渲染**——PDF 走 Electron 原生 `webContents.printToPDF`（Chromium 排版），中文字体、Emoji、表格、代码块均正常。
- NFR-3：**安全**——离屏 `BrowserWindow` 必须 `webPreferences.javascript = false`，杜绝消息正文里潜在脚本执行（内容来自 LLM/用户，视为不可信）。
- NFR-4：导出过程不阻塞主窗口交互；临时 HTML 文件用完即删。

### AC（验收条件）
- AC-1：多选 3 条（含 1 条带图片的 assistant 消息 + 1 条用户消息 + 1 条含 Markdown 表格/代码的消息），点击「保存为 PDF」，选择路径后生成的 PDF 打开可见：三条消息按序排列、图片正常显示、中文/表格/代码格式正确。
- AC-2：在保存对话框点「取消」，无任何报错、多选态保持不变。
- AC-3：`npm run typecheck`（或 `tsc --noEmit`）与 `npm run build` 绿。
- AC-4：主进程改动后完全重启 `npm run dev`，功能可复现（不是仅刷新渲染进程的假象）。

---

## 2. 现状锚点（实施时按这些行号 / 符号定位）

- `desktop/src/components/ChatPane.tsx`
  - L9753-9785：多选工具栏 JSX（`已多选 … 转发 / 复制 / 删除 / 取消`）。「保存为 PDF」按钮插在 L9780「复制」按钮 `</button>` 之后、L9781「删除」按钮之前。
  - L4168-4171：`selectedMessages = visibleMessages.filter(...)`（已按可见顺序=时间序）。
  - L196：`import { messagePlainTextForClipboard } from "../utils/markdown-copy-format";`（纯文本兜底用）。
  - L4020-4049：`copyMessage`，展示了 attachment 图片读取模式（`attachment.dataUrl && attachment.mimeType.startsWith("image/")`）。
  - L2471 / L5805-5808：`stallHintToast` 的定义与自动消失定时器，可作为 toast 反馈参照或直接复用。
  - L9762-9769：发送者标签与时间格式化的既有写法（`role === "user" ? "我" : avatarName || agentId || "AI"`；`toLocaleTimeString("zh-CN", {hour,minute})`），导出时**复用同一套标签逻辑**保持一致。
- `desktop/src/store.ts`
  - L168-223：`Message` 类型；L268-276：`MessageAttachment`（`name/mimeType/size/dataUrl?/sourcePath?`）。
- `desktop/electron/main.ts`
  - L1-14：已 `import { app, BrowserWindow, dialog, nativeImage, ipcMain, ... } from "electron"`；`fs`/`path`/`os` 已导入。
  - L5377-5421：`confirm-dialog` handler——**新 IPC handler 的编写范式参照它**（try/catch、返回 `{ok, ...}`）。
  - L1707 / L3126：`mainWindow` 引用与主窗口创建，参考 `webPreferences`、图标路径写法。
- `desktop/electron/preload.ts`
  - L62：`contextBridge.exposeInMainWorld("agenticxDesktop", { ... })`；L423-435：`confirmDialog` 暴露范式——新方法照抄该模式。
- `desktop/src/global.d.ts`
  - L422：`agenticxDesktop: { ... }` 类型块；L837：`confirmDialog` 类型范式——新方法在此补类型。

---

## 3. 方案决策

### 方案 A（采用）：渲染端生成自包含 HTML → 主进程离屏 `printToPDF`
- 渲染端把 `selectedMessages` 拼成一份完整 HTML 字符串（内联 CSS + 内联图片 dataUrl），通过新 IPC `export-messages-pdf` 传给主进程。
- 主进程：`dialog.showSaveDialog` 取路径 → 把 HTML 写临时文件 → 新建离屏 `BrowserWindow({ show:false, webPreferences:{ javascript:false, offscreen:true }})` → `loadFile(tmpHtml)` → `did-finish-load` 后 `webContents.printToPDF({...})` → 写入用户选择路径 → 销毁窗口、删临时文件 → 返回 `{ok, path}`。
- **优点**：Chromium 原生排版，中文/表格/代码/图片零成本保真；无需 html2canvas/jsPDF；产物矢量清晰、体积小。

### 被否方案
- 方案 B（jsPDF + html2canvas，渲染端）：中文字体需手动嵌入、图片走 canvas 光栅化模糊、包体大 → 否。
- 方案 C（`window.print()`）：无法程序化指定落盘路径、UX 差 → 否。

### 依赖决策
- Markdown → HTML：`react-markdown` 是 React 组件，不便在纯工具函数里输出字符串。**引入轻量 `marked`**（体积小、稳定、无运行时副作用）用于导出场景。
  - 安装：`cd desktop && npm i marked`（如需类型：`marked` 自带 d.ts）。
  - 兜底位（Composer 可选）：若要严格「零新依赖」，可退化为 `messagePlainTextForClipboard(message)` + `<pre style="white-space:pre-wrap">` 输出纯文本（丢失表格/标题格式，但仍满足 FR-2 的文本+图片）。**默认走 `marked`**，兜底方案仅在评审要求零依赖时启用。
- 安全：由于离屏窗口 `javascript:false`，`marked` 输出无需额外 DOMPurify；但仍在 `marked` 配置里禁用潜在危险不是必须项（脚本不会执行）。

---

## 4. 实施步骤（按顺序）

### 步骤 1 — 新增导出 HTML 生成工具
新建 `desktop/src/utils/export-pdf-html.ts`：

职责：输入 `selectedMessages: Message[]` 与元信息（会话标题、导出时间），输出**完整 HTML 文档字符串**。

要点：
- 顶部 `<!doctype html><html><head><meta charset="utf-8">` + 内联 `<style>`。
- 样式基线（浅色，适合打印）：白底黑字、`font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`、正文 `font-size:14px; line-height:1.6`、`img{max-width:100%; height:auto}`、表格边框、代码块浅灰底 + 等宽字体、`@page{ margin:16mm }`、每条消息之间 `page-break-inside:avoid` 尽量不跨页断裂。
- 头部区块：标题（如「Machi 对话记录」）+ 会话名 + 导出时间 + 消息条数。
- 每条消息渲染为一个 `.msg` 块：
  - 发送者行：`<div class="meta"><span class="who">{who}</span><span class="time">{time}</span></div>`，`who`/`time` 复用 L9762-9769 同款逻辑（抽成小函数或内联）。
  - 角色区分颜色：user 与 assistant 用不同左边框色（如 user=蓝、assistant=灰），保持可读。
  - 正文：`marked.parse(message.content || "")` → HTML；空正文跳过正文段。
  - 附件图片：遍历 `message.attachments`，对 `att.dataUrl && att.mimeType.startsWith("image/")` 的输出 `<img src="${att.dataUrl}">`；对仅有 `sourcePath` 无 dataUrl 的图片，输出 `<img src="file://${sourcePath}">`（离屏 `loadFile` 下 `file://` 可加载本地图）。
- **转义**：发送者名、时间等纯文本字段做 HTML 转义（写一个 `escapeHtml`）；正文交给 `marked`（其自身处理）。
- 导出函数签名建议：
  ```ts
  export function buildMessagesPdfHtml(args: {
    messages: Message[];
    sessionTitle?: string;
    exportedAt: number;
    userBubbleLabel?: string; // 与聊天里「我」的展示一致
  }): string
  ```

### 步骤 2 — 主进程新增 IPC `export-messages-pdf`
在 `desktop/electron/main.ts` 中，仿照 `confirm-dialog`（L5377）新增：

```ts
ipcMain.handle("export-messages-pdf", async (_event, payload: unknown) => {
  const p = (payload && typeof payload === "object") ? payload as {
    html?: unknown; defaultFileName?: unknown;
  } : {};
  const html = typeof p.html === "string" ? p.html : "";
  const defaultFileName = String(p.defaultFileName ?? "Machi对话.pdf").trim() || "Machi对话.pdf";
  if (!html) return { ok: false, canceled: false, error: "empty html" };

  const focused = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
  // 1) 保存对话框（默认 Downloads 目录）
  const defaultPath = path.join(app.getPath("downloads"), defaultFileName);
  const saveRes = focused
    ? await dialog.showSaveDialog(focused, { defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] })
    : await dialog.showSaveDialog({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (saveRes.canceled || !saveRes.filePath) return { ok: true, canceled: true };

  const targetPath = saveRes.filePath;
  let tmpHtmlPath = "";
  let offscreen: BrowserWindow | null = null;
  try {
    // 2) 写临时 HTML（自包含）
    tmpHtmlPath = path.join(os.tmpdir(), `agx-export-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.html`);
    fs.writeFileSync(tmpHtmlPath, html, "utf-8");
    // 3) 离屏窗口渲染（禁用 JS）
    offscreen = new BrowserWindow({
      show: false,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
    });
    await offscreen.loadFile(tmpHtmlPath);
    // 等待渲染稳定（图片解码）：did-finish-load 已由 loadFile await 覆盖，可再补一小段延时确保大图解码
    await new Promise((r) => setTimeout(r, 150));
    // 4) 生成 PDF（A4、打印背景色以保留区块底色）
    const pdfBuffer = await offscreen.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { marginType: "default" },
    });
    fs.writeFileSync(targetPath, pdfBuffer);
    return { ok: true, canceled: false, path: targetPath };
  } catch (err) {
    return { ok: false, canceled: false, error: String(err).slice(0, 200) };
  } finally {
    if (offscreen && !offscreen.isDestroyed()) offscreen.destroy();
    if (tmpHtmlPath) { try { fs.unlinkSync(tmpHtmlPath); } catch { /* ignore */ } }
  }
});
```

注意：`crypto` 已在 main.ts 顶部导入（L33）；`os`（L31）、`fs`（L32）、`path`（L29）均已导入，无需新增 import。

（可选，FR-5 的「在访达中定位」）：已有 `system-search:reveal`（L3647）可复用；导出成功后前端可调用 `agenticxDesktop.systemSearchReveal(path)` 或让 toast 里带「打开所在文件夹」。若该方法未在 preload 暴露则本 plan 不强制，可用 `shell.showItemInFolder` 另开 IPC，属可选增强，非 AC 必需。

### 步骤 3 — preload 暴露方法
在 `desktop/electron/preload.ts` 的 `exposeInMainWorld` 块内（仿 L423 `confirmDialog`）新增：

```ts
exportMessagesPdf: async (payload: { html: string; defaultFileName?: string }) =>
  ipcRenderer.invoke("export-messages-pdf", payload) as Promise<{
    ok: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>,
```

### 步骤 4 — global.d.ts 补类型
在 `desktop/src/global.d.ts` 的 `agenticxDesktop` 块内（仿 L837 `confirmDialog`）新增同签名类型声明。

### 步骤 5 — ChatPane 接线按钮 + 导出处理函数
在 `ChatPane.tsx`：
1. 顶部 import：`import { buildMessagesPdfHtml } from "../utils/export-pdf-html";`
2. 新增 `useCallback` `exportSelectedMessagesToPdf`（放在 `deleteSelectedMessages` 附近，L4364 一带）：
   ```ts
   const exportSelectedMessagesToPdf = useCallback(async () => {
     if (selectedMessages.length === 0) return;
     try {
       const now = Date.now();
       const html = buildMessagesPdfHtml({
         messages: selectedMessages,
         sessionTitle: /* 复用 pane 标题/会话名，如 pane.title || selectedSubAgent || "对话记录" */,
         exportedAt: now,
         userBubbleLabel, // 已在组件内存在（见 L4361 依赖）
       });
       const stamp = new Date(now).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }).replace(":", "-");
       const res = await window.agenticxDesktop.exportMessagesPdf({
         html,
         defaultFileName: `Machi对话_${stamp}.pdf`,
       });
       if (res.canceled) return;               // 用户取消：静默
       if (res.ok && res.path) {
         setStallHintToast(`已保存到 ${res.path}`);   // 或专用 toast
       } else {
         setStallHintToast(`导出失败：${res.error || "未知错误"}`);
       }
     } catch (e) {
       setStallHintToast(`导出失败：${String(e).slice(0, 120)}`);
     }
   }, [selectedMessages, userBubbleLabel /*, sessionTitle 源 */]);
   ```
3. JSX：在 L9780「复制」按钮之后插入：
   ```tsx
   <button className="rounded px-1 hover:bg-surface-hover" onClick={() => void exportSelectedMessagesToPdf()}>
     保存为 PDF
   </button>
   ```

### 步骤 6 — 验证
- `cd desktop && npm i marked`（如采用 marked 方案）。
- `npm run typecheck` / `tsc --noEmit` 绿。
- `npm run build` 绿。
- **完全退出并重启** `npm run dev`（主进程新增 IPC 必须重启，不能只刷新渲染进程——见 AGENTS.md）。
- 手动走 AC-1 / AC-2。

---

## 5. 边界与已知限制（写入 PR 说明，避免过度扩张范围）
- v1 只导出**文本 + 图片**。SVG widget、工具调用卡片（`ToolCallCard`）、推理块折叠内容按其在 `message.content` 里的原始文本/Markdown 处理，不做像素级还原（超范围）。
- 仅 `dataUrl` 或本地 `sourcePath` 的图片可内联；纯远程 URL 图片依赖离屏窗口联网加载，NFR-1 要求自包含，故 v1 对远程 URL 图片**尽力加载但不保证**，可在 HTML 里保留 `<img src>` 由 Chromium 尝试。
- 不改任何后端 / Python 代码；不改多选之外的复制/转发/删除逻辑。

---

## 6. 涉及文件清单
| 文件 | 改动 |
|------|------|
| `desktop/src/utils/export-pdf-html.ts` | 新增：HTML 生成器 |
| `desktop/electron/main.ts` | 新增 `export-messages-pdf` IPC handler |
| `desktop/electron/preload.ts` | 暴露 `exportMessagesPdf` |
| `desktop/src/global.d.ts` | 补 `exportMessagesPdf` 类型 |
| `desktop/src/components/ChatPane.tsx` | import + `exportSelectedMessagesToPdf` + 多选栏按钮 |
| `desktop/package.json` | （若采用）新增 `marked` 依赖 |

---

## 7. 提交建议
- `feat(desktop): 多选消息导出为 PDF`
- 若拆两 commit：①`feat(desktop): add export-messages-pdf IPC (main+preload)` ②`feat(desktop): 多选栏新增保存为 PDF 按钮与 HTML 生成`
- trailer 记得 `Impl-Model` + `Made-with: Damon Li`。
