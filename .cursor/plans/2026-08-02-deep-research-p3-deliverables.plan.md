# P3 · 深度调研交付物：可交互 HTML 报告 + 思维导图 + 导出 + 引用跳转

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: `claude-opus-5-thinking-medium`（可交互 HTML 报告与思维导图是前端视觉审美活，需要品味档）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`
Depends-On: P0、P1、P2 **必须先合入**

---

## 0. 一句话

P0–P2 之后我们有了万字、多源、可追溯、异步的报告内容。P3 解决「拿到手之后怎么用」：
正文引用点得动、有目录能跳、能导出成 PDF/Word 交出去、有一份能分享的可视化 HTML 报告。

## 1. 现状与差距

| 交付维度 | Kimi | 我们（P2 后） |
|---|---|---|
| 目录 | 有 | 有（P0 已加） |
| 引用可点击跳转原文 | 有，内嵌正文 | `[N]` 是**纯文本**，点不动 |
| 来源列表 | 有 | 有（sources SSE） |
| 可交互 HTML 报告 | 有，可生成公开分享链接 | 无 |
| 思维导图 | 有 | 无 |
| PDF / Word 下载 | 有 | 无 |

### 已有可复用能力
- `enterprise/apps/web-portal/src/lib/deep-research/artifact-store.ts`：
  已支持 `kind: "memo" | "report" | "other"` 与 `mimeType`，
  `MAX_ARTIFACT_BYTES = 512 * 1024`、`MAX_ARTIFACTS_PER_RUN = 40`。
  HTML 报告直接作为 `kind: "report"` + `mimeType: "text/html"` 落库，**无需新表**。
- P2 的 `run-store.ts` 已持有完整 `reportMarkdown` 与 `citations`，是生成所有交付物的唯一数据源。
- `enterprise/packages/ui` 已有 `Dialog` / `Sheet` / `Button` / `Tooltip` 等原语与
  `themes/base.css` 的 OKLCH 三态主题 token。

---

## 2. In scope / Out of scope

### In scope
- 改 `report-writer.ts`：`[N]` 渲染为 Markdown 链接
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/report-html.ts`（可交互 HTML 生成）
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/report-mindmap.ts`（Mermaid 脑图生成）
- 新建导出路由 `.../deep-research/runs/[runId]/export/route.ts`（`?format=html|md|docx`）
- 前端：报告下方「查看可视化报告 / 下载」操作区
- 相应单测

### Out of scope（**违反即回退**）
- **不做公开分享链接**（涉及匿名访问与租户数据外泄，需独立安全评审，另开 plan）。
- 不引入 headless 浏览器做 PDF 渲染；PDF 走**浏览器打印**（HTML + `@media print`），
  不加 puppeteer 依赖。
- 不改 `artifact-store.ts` 的表结构。
- 不改 P0/P1/P2 的执行流水线逻辑，P3 只消费其产出。
- 不做报告在线编辑。

---

## 3. FR-1：引用可点击跳转

### 3.1 正文侧
**改** `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`，新增导出：

```typescript
/**
 * 把正文中的 [N] 替换为 Markdown 链接 [N](#ref-N)。
 * 只替换 citations 中真实存在的编号；不存在的编号保持纯文本（模型幻觉编号不该变成死链）。
 * 已经是链接形式的 [N](...) 不重复处理。
 */
export function linkifyCitations(markdown: string, validIndexes: Set<number>): string;
```

实现要点：
- 正则 `/\[(\d{1,3})\](?!\()/g`，`(?!\()` 保证不重复处理已有链接。
- 连续编号 `[1][4][7]` 各自独立替换。
- 代码块内不替换：先按 ``` 围栏切段，只处理非代码段。

### 3.2 来源列表侧
sources 段每条来源前加锚点：`<a id="ref-1"></a>[1] 标题 — URL`。
Markdown 渲染器需允许内联 HTML；若当前渲染器禁用了内联 HTML，
改用渲染器支持的锚点写法（**实施前先在 `enterprise/features/chat` 的 Markdown 渲染组件里确认，
不要盲改**）。

### AC-1
`report-writer.test.ts`：
- `linkifyCitations("结论 [1][2]", new Set([1,2]))` → `结论 [1](#ref-1)[2](#ref-2)`。
- 不存在的编号 `[99]` 保持原样。
- 已是链接的 `[1](#ref-1)` 不被二次处理。
- 代码块内的 `[1]` 不被替换。

---

## 4. FR-2：可交互 HTML 报告

**新建** `enterprise/apps/web-portal/src/lib/deep-research/report-html.ts`。

### 契约
```typescript
export type HtmlReportInput = {
  title: string;
  topic: string;
  markdown: string;
  citations: Citation[];
  mindmapMermaid: string;
  stats?: { queriesPlanned: number; urlsDiscovered: number; sourcesSelected: number; pagesFetched: number };
  generatedAt: string;
};

/** 返回单文件自包含 HTML（无外部构建依赖）。 */
export function renderHtmlReport(input: HtmlReportInput): string;
```

### 设计要求（这是本期的审美主战场）
- **单文件自包含**：一个 `.html` 就能双击打开。CSS 内联，不引用本地资源。
- **Markdown → HTML**：不引入 marked/markdown-it 依赖，在本文件内实现一个够用的转换器
  （标题、段落、列表、粗体、行内代码、代码块、链接、表格）。**如果实现成本过高，
  允许改为把 Markdown 原样放进 `<script type="text/markdown">` 并在页面内用
  已在 `enterprise/packages/ui` 依赖树中存在的渲染库处理——实施前先查 `package.json` 确认，
  不得为此新增依赖。**
- **Mermaid**：思维导图通过 CDN `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js">`
  渲染；**必须做降级**：脚本加载失败时显示 `<pre>` 原始 mermaid 源码，页面不白屏。
- **布局**：左侧固定目录（点击平滑滚动、滚动时高亮当前节），右侧正文，顶部标题与统计条，
  底部来源列表（带 `id="ref-N"` 锚点，点击 `[N]` 平滑滚到对应条目并短暂高亮）。
- **主题**：明暗双色，读取 `prefers-color-scheme`，并提供一个右上角切换按钮，
  配色对齐 `enterprise/packages/ui/src/themes/base.css` 的 indigo/violet primary 与 OKLCH token
  （**取其色值内联进 HTML，不要 import 该 css**）。
- **打印样式**：`@media print` 隐藏侧栏目录与切换按钮，正文单栏，链接后追加
  `content: " (" attr(href) ")"` 便于纸质版溯源。这就是 PDF 导出路径。
- **XSS**：`markdown` 与 `citations` 均来自 LLM 与外部网页，**所有插值必须 HTML 转义**
  （`& < > " '`），生成的链接 `href` 只允许 `http:` / `https:`，其余替换为 `#`。
  本文件必须导出 `escapeHtml` 与 `safeHref` 并单测。

### AC-2
`report-html.test.ts`：
- 输出以 `<!DOCTYPE html>` 开头，含 `<title>`、目录容器、来源区。
- `escapeHtml("<script>")` 不含裸 `<script`。
- `safeHref("javascript:alert(1)")` 返回 `"#"`；`safeHref("https://a.com")` 原样返回。
- 标题数与 `markdown` 中的 `## ` 数量一致，且每个标题都有对应目录条目与 `id`。
- 每条 citation 生成一个 `id="ref-N"` 锚点。
- `mindmapMermaid` 为空字符串时不生成脑图区块（不留空壳）。

---

## 5. FR-3：思维导图

**新建** `enterprise/apps/web-portal/src/lib/deep-research/report-mindmap.ts`。

```typescript
export const MAX_MINDMAP_NODES = 40;

/** 由报告大纲 + 各节要点生成 Mermaid mindmap 源码。 */
export function buildMindmap(input: {
  topic: string;
  outline: ReportOutline;
  /** 每节 2–4 个要点短语，由 LLM 在写完该节后顺带产出；缺失则只出标题层。 */
  sectionKeyPoints?: Record<string, string[]>;
}): string;
```

- 输出标准 Mermaid `mindmap` 语法，root 为 `topic`，一级子节点为章节标题，
  二级为要点短语。
- **节点文本清洗**：去掉 `[N]`、换行、`()` `[]` 等会破坏 Mermaid 语法的字符，单节点截断到 24 字。
- 总节点数超 `MAX_MINDMAP_NODES` 时，按章节顺序保留、超出部分丢弃二级节点（先丢后面章节的要点）。
- 大纲为空时返回空字符串（调用方据此跳过脑图区块）。

要点采集：在 `report-writer.ts` 逐节写作完成后，用一次**极短**的 LLM 调用抽 2–4 个要点，
失败则跳过（`sectionKeyPoints` 缺该节即可）。**不得因为抽要点失败而影响报告主流程。**

### AC-3
`report-mindmap.test.ts`：
- 输出首行为 `mindmap`，含 root 与各章节节点。
- 含 `[3]`、括号、换行的标题被清洗为合法节点文本。
- 超过 `MAX_MINDMAP_NODES` 时被裁剪且仍是合法 mermaid（章节层完整）。
- 空大纲返回 `""`。

---

## 6. FR-4：产出与导出

### 6.1 run 结束时写 artifact
在 P2 的 `store.finish(runId, "completed")` **之前**，orchestrator 追加：
1. `buildMindmap(...)` → mermaid 源码
2. `renderHtmlReport(...)` → HTML
3. `artifactStore.write({ path: \`research/${runId}/report.html\`, title: \`${topic} · 可视化报告\`,
   kind: "report", mimeType: "text/html", content: html })`
4. 同时写一份 `research/${runId}/report.md`（`kind: "report"`, `mimeType: "text/markdown"`）
5. 发 `artifact` 事件（现有事件类型已支持，无需扩展）

**大小守卫**：HTML 超过 `MAX_ARTIFACT_BYTES`（512KB）时，`artifact-store` 会自动截断——
这会产生**结构损坏的 HTML**。因此写入前必须自检：超限则降级为
「不内联脑图 + 正文截断并在末尾追加提示」的精简版，保证 HTML 结构完整可打开。

### 6.2 导出路由
**新建** `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/[runId]/export/route.ts`
- `GET ?format=html|md|docx`
- 鉴权与 404 策略**照抄** P2 的 `.../runs/[runId]/stream/route.ts`（同租户同用户，否则 404）
- `html` / `md`：从 artifact-store 取对应 artifact 直出，
  `content-disposition: attachment; filename="<安全化标题>.<ext>"`
- `docx`：**不引入 docx 生成库**。产出 Word 可直接打开的
  `application/vnd.ms-word` HTML（即带 `xmlns:w` 头的 HTML，`.doc` 扩展名）——
  这是零依赖且 Word/WPS 均可打开的既有做法。在 UI 上标注为「Word 文档」。
- PDF **不做服务端路由**，前端「下载 PDF」按钮打开可视化 HTML 新标签页并触发 `window.print()`，
  由 `@media print` 样式承担排版。
- `export const runtime = "nodejs";`

### 文件名安全化
标题可能含 `/`、引号、换行。必须导出并单测 `safeFilename(title, ext)`：
仅保留中英文、数字、`-_`，其余替换为 `_`，长度截断 80，空则回落 `research-report`。

### AC-4
- 跨用户导出返回 404。
- `?format=md` 返回 `text/markdown` 且 `content-disposition` 为 attachment。
- `?format=docx` 的响应体能被 Word 打开（人工验证一次即可）。
- 不支持的 `format` 返回 400。
- `safeFilename("A/B\"C\n", "html")` → `A_B_C_.html` 之类的安全串（断言不含 `/` `"` `\n`）。

---

## 7. FR-5：前端操作区

在深度研究报告气泡下方，紧邻现有消息操作按钮行，增加一组**常驻**（非 hover 显示，遵循既有偏好）按钮：
- `查看可视化报告`：新标签页打开 `?format=html`
- `下载 Markdown`：`?format=md`
- `下载 Word`：`?format=docx`
- `打印 / 存为 PDF`：打开 HTML 并 `window.print()`

要求：
- 仅在 run 为 `completed` 且对应 artifact 存在时显示；进行中不显示（避免下到半截报告）。
- 图标用 `lucide-react`（已在 `@agenticx/ui` 依赖内），风格与现有操作按钮一致。
- 按钮 tooltip 用既有 `Tooltip` 原语，不用原生 `title`。
- **不写任何暴露内部路径的文案**（如 `research/<runId>/report.html`），
  按既有规范，面向用户界面不得出现仓库内部路径与运维实现细节。

### AC-5
- 手工：完成一次深度调研 → 四个按钮出现 → 可视化 HTML 能打开，目录可点、`[N]` 能跳到来源、
  明暗切换生效、脑图渲染出来（断网时降级为代码块不白屏）。
- 手工：`Ctrl/⌘+P` 打印预览中侧栏隐藏、正文单栏、链接带 URL。

---

## 8. 验收命令

```bash
cd enterprise
pnpm --filter @agenticx/web-portal test -- src/lib/deep-research
pnpm --filter @agenticx/web-portal typecheck
pnpm --filter @agenticx/chat typecheck
```

### 全系列收口
P3 合入后按主规划第 6 节的 **AC-G1 – AC-G8** 做一次完整回归，
用同一 query「deepseek v4 核心技术点」与 P0 前的基线报告并排对比，
把「字数 / 来源数 / 采用率 / 关键词数 / 耗时」五个数字记进结论文档。
