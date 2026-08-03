# 深度调研车道来源可视化（Kimi 式右侧网页列表）

Planned-with: opus-5
Suggested-Impl-Model: gpt-5.6-terra-medium（跨包类型 + 编排器 + 前端三段收口，属中高风险跨栈改动）

## 背景与根因

Enterprise web-portal 的深度调研工作台里，每条「车道」（lane）展开后只有一堆流水文本：

```
调研子问题：minimax H3 核心技术点…
已展开 6 条检索式
发现 49 个候选来源
筛选出 10/49 个高质量来源
已收集 10 个来源，正在读取正文…
已读取 9/10 篇正文（1 请求失败）
备忘：research/<runId>/lanes/<laneId>/memo.md
查看产物
```

这些文本来自 `lane_progress` 事件的 `message` 字段，被原样堆进 `ResearchStep.detailLines`
（`enterprise/features/chat/src/components/molecules/deep-research-segments.ts` 的 `laneToStep`，
以及 `DeepResearchWorkbench.tsx` 的 `ExpandableStepRow`）。

**根因**：现有事件协议里**没有任何来源级数据**。`DeepResearchEvent` 的三个 lane 事件
（`enterprise/packages/core-api/src/chat.ts` L61-63 与
`enterprise/packages/sdk-ts/src/deep-research.ts` L22-24）只有 `message` / `sourcesCollected`（数量），
没有标题、URL、落盘路径。所以前端根本无从展示「这条车道检索了哪些网页」。

**服务端其实全都有**（`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`）：
- L919-923：`questionCitations: Citation[]`，每条含 `title` / `url` / `snippet` / `index`
- L947-969：抓到正文的会调 `archivePage(...)` 落盘到 `research/<runId>/pages/<slug>_<hash>.md`
  （路径由 `page-archive.ts` 的 `pageArchivePath(runId, url, title)` 生成，可在前端复算）
- L953：`pagesFetched` 计数

因此本次只需把来源清单通过新事件送到前端，并重做展示。

## 目标

1. 车道展开区不再是流水文本，而是「统计指标条 + 来源卡片列表」。
2. 点车道的「查看来源」→ 右侧文件面板切到该车道的**网页来源列表**（Kimi 式）。
3. 点某条来源 → 右侧预览**落盘正文**（`pages/*.md`）；卡片上另给外链图标跳原网页。

## In scope

- `enterprise/packages/core-api/src/chat.ts`：新增 `lane_sources` 事件类型
- `enterprise/packages/sdk-ts/src/deep-research.ts`：同步同一事件类型
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`：发出 `lane_sources`
- `enterprise/apps/web-portal/src/lib/deep-research/run-store.ts`：`trimEvents` 丢弃优先级
- `enterprise/features/chat/src/components/molecules/deep-research-steps.ts`：`ResearchStep.sources`
- `enterprise/features/chat/src/components/molecules/deep-research-segments.ts`：聚合 `lane_sources`
- `enterprise/features/chat/src/components/molecules/DeepResearchWorkbench.tsx`：车道展开区重做
- `enterprise/features/chat/src/components/molecules/DeepResearchFilesPanel.tsx`：新增 `sources` 视图
- `enterprise/features/chat/src/components/molecules/MessageList.tsx`：透传 lane 来源打开回调
- `enterprise/apps/web-portal/src/components/MachiChatView.tsx`：面板状态承载
- 新建 `enterprise/features/chat/src/components/molecules/deep-research-lane-sources.ts`（纯函数 + 类型）

## Out of scope（禁止顺手改）

- 不改检索/抓取策略、`source-pool.ts`、`registry.ts` 的打分与选源逻辑
- 不改 `report-html.ts` / `completion-summary.ts` / delivery 卡片
- 不改附件预览（`AttachmentContentPanel`）与 web-search 引用链路（`WebSearchCitation`）
- 不动 `DeepResearchTimeline.tsx`（旧时间线组件，当前未被 workbench 使用）
- 不引入新依赖

---

## FR-1：新增 `lane_sources` 事件类型（两个包保持一致）

**落点 A**：`enterprise/packages/core-api/src/chat.ts`，在 L63 的 `lane_done` 之后插入。
**落点 B**：`enterprise/packages/sdk-ts/src/deep-research.ts`，在 L24 的 `lane_done` 之后插入**完全相同**的分支。

```ts
  | { type: "lane_done"; laneId: string; artifactPath?: string; status: "ok" | "failed" }
  /** Per-lane source list so the workbench can show which pages were searched. */
  | {
      type: "lane_sources";
      laneId: string;
      sources: Array<{
        title: string;
        url: string;
        /** 截断后的检索摘要（≤ 200 字符） */
        snippet?: string;
        /** 正文已落盘时的 artifact 路径，如 research/<runId>/pages/<slug>_<hash>.md */
        archivedPath?: string;
        /** 是否成功抓到正文 */
        fetched?: boolean;
      }>;
    }
```

注意：`core-api` 的该行上方已有 `/** ... */` 注释风格，保持一致；**只新增分支，不得改动相邻任何一行**。

**AC-1**：`pnpm -C enterprise exec tsc --noEmit`（或各包 typecheck）通过；两个文件的 `lane_sources`
分支字段逐字相同（可用 `rg -A 16 'type: "lane_sources"'` 比对）。

---

## FR-2：编排器在车道抓取结束时发出 `lane_sources`

**落点**：`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`，
在 L985 的 `}`（page fetch 的 `if (questionCitations.length > 0 && searchBudgetLeft() > 0) { ... }` 块结束）
之后、L987 `let memo = "";` 之前插入。

要求：
1. **无论是否抓到正文都要发**（只要 `questionCitations.length > 0`），`fetched` 反映每条实际结果。
2. `archivedPath` 只在 `pageFetchCfg.archivePages` 为真且该条确实落盘成功时给出。
   实现方式：在 L947-969 的 `for (const [i, page] of pages.entries())` 循环里，把成功落盘的
   `citation.url` 收进一个局部 `Set<string>`（如 `archivedUrls`），并把成功抓到正文的 url 收进
   `fetchedUrls`；发事件时据此判断。注意该循环在 `try` 内，两个 Set 需声明在 `try` 之外
   （与 `let pagesFetched = 0;` 同级，L932 附近），否则 catch 分支拿不到。
3. `archivedPath` 用 `pageArchivePath(runId, citation.url, citation.title)` 计算
   （已从 `./page-archive` 导入 `archivePage`，需一并导入 `pageArchivePath`）。
4. `snippet` 截断：`c.snippet?.slice(0, 200)`，空串则不带该字段。

伪代码：

```ts
// L932 附近，与 pagesFetched 同级
let pagesFetched = 0;
const fetchedUrls = new Set<string>();
const archivedUrls = new Set<string>();

// L953 之后
pagesFetched += 1;
fetchedUrls.add(citation.url);
// L967 之后
if (ok) { pagesArchived += 1; archivedUrls.add(citation.url); }

// L985 之后（page fetch 块结束）、memo 之前
if (questionCitations.length > 0) {
  enqueueEvent({
    type: "lane_sources",
    laneId,
    sources: questionCitations.map((c) => ({
      title: c.title,
      url: c.url,
      ...(c.snippet?.trim() ? { snippet: c.snippet.slice(0, 200) } : {}),
      ...(archivedUrls.has(c.url)
        ? { archivedPath: pageArchivePath(runId, c.url, c.title) }
        : {}),
      fetched: fetchedUrls.has(c.url),
    })),
  });
}
```

**AC-2**：新增 `orchestrator.test.ts` 用例，断言成功路径的事件流里存在
`e.type === "lane_sources"` 且 `e.sources.length > 0`、每条含非空 `url`；
现有 `orchestrator.test.ts` 全部保持绿。

---

## FR-3：`trimEvents` 丢弃优先级

**落点**：`enterprise/apps/web-portal/src/lib/deep-research/run-store.ts` L190-197 的 while 循环。

在 `dropOldestOfType("narrative")` 之后、"Last resort" 之前插入
`if (dropOldestOfType("lane_sources")) continue;`，即优先级为
`lane_progress` → `narrative` → `lane_sources` → 其它。同时更新 L178-180 的 JSDoc 描述。

**AC-3**：`run-store.test.ts` 新增用例：事件超限时 `lane_sources` 比 `run_started` / `clarify` 先被丢，
但比 `lane_progress` 后被丢。

---

## FR-4：前端类型与聚合

**新建**：`enterprise/features/chat/src/components/molecules/deep-research-lane-sources.ts`

```ts
export type LaneSource = {
  title: string;
  url: string;
  snippet?: string;
  archivedPath?: string;
  fetched?: boolean;
};

/** 从 url 取可读域名（去 www.），失败回落原串。 */
export function laneSourceHost(url: string): string;

/** 车道统计条：从 detailLines 里解析出的数字指标（无则返回空数组）。 */
export type LaneMetric = { label: string; value: string };
export function parseLaneMetrics(detailLines: string[]): LaneMetric[];
```

`parseLaneMetrics` 用正则从既有中文流水里提取，**不新增事件字段**：
- `/已展开\s*(\d+)\s*条检索式/` → `{ label: "检索式", value: "6" }`
- `/发现\s*(\d+)\s*个候选来源/` → `{ label: "候选", value: "49" }`
- `/筛选出\s*(\d+)\s*\/\s*(\d+)\s*个高质量来源/` → `{ label: "选用", value: "10" }`
- `/已读取\s*(\d+)\s*\/\s*(\d+)\s*篇正文/` → `{ label: "正文", value: "9/10" }`

顺序固定为 检索式 → 候选 → 选用 → 正文；未命中的项直接跳过。

**改动 A**：`deep-research-steps.ts` L10-20 的 `ResearchStep` 增加可选字段
`sources?: LaneSource[];`（从新模块 import 类型），不改其它字段。

**改动 B**：`deep-research-segments.ts`
- L33-43 `LaneDraft` 增加 `sources?: LaneSource[]`
- L45-59 `laneToStep` 透传 `sources: lane.sources`
- 在 `buildDeepResearchSegments` 的 switch（L140 起）中，`case "lane_done"` 之后新增
  `case "lane_sources"`：查 `lanes.get(event.laneId)`，命中则 `lane.sources = event.sources.slice()`。
  **注意**：`lane_sources` 在编排器里是在 `lane_done` **之前**发的，所以 lane 一定还在 map 里；
  但仍需 `if (!lane) break;` 兜底。

**AC-4**：新增 `deep-research-lane-sources.test.ts`：
- `laneSourceHost("https://www.example.com/a")` → `"example.com"`
- `parseLaneMetrics` 对上面 4 行样例返回 4 项且顺序正确；对空数组返回 `[]`
- 现有 `deep-research-segments.test.ts` / `deep-research-steps.test.ts` 保持绿，
  并新增一条：注入 `lane_started` + `lane_sources` + `lane_done` 后，
  生成的 tools segment 里对应 step 的 `sources.length` 正确。

---

## FR-5：车道展开区重做（内联卡片）

**落点**：`DeepResearchWorkbench.tsx` L99-177 的 `ExpandableStepRow`。

展开区（L157-174 的 `{open && canExpand ? ... : null}` 块）改为：

1. **指标条**：`parseLaneMetrics(step.detailLines)` 有结果时，渲染一行小 chip
   （`rounded-full bg-muted/60 px-2 py-0.5 text-[11px]`，形如 `检索式 6`、`正文 9/10`），
   无结果则回落渲染原 `detailLines`（保证老会话不空白）。
2. **来源列表**：`step.sources` 非空时，最多内联展示前 4 条，每条一行：
   `WebSearchFavicon`（host，size 16）+ 标题（truncate）+ 域名（muted）+ 抓到正文的显示「已读取」小标。
   整行可点：`onOpenLaneSource(source)`。
3. **底部操作行**：`查看全部 N 个来源`（→ `onOpenLaneSources(step)`）与既有 `查看产物` 并排。
4. `canExpand` 判据（L109）扩展为
   `step.detailLines.length > 0 || Boolean(step.artifactId) || (step.sources?.length ?? 0) > 0`。

新增 props 沿 `DeepResearchWorkbench` → `ToolsCard` → `ExpandableStepRow` 透传：

```ts
onOpenLaneSources?: (lane: { title: string; sources: LaneSource[] }) => void;
onOpenLaneSource?: (source: LaneSource) => void;
```

其中 `lane.title` 用 `step.subtitle ?? step.title`（subtitle 里含子问题原文）。
`DeepResearchWorkbenchProps`（L13-19）同步加这两个可选 prop。

**AC-5**：老会话（无 `lane_sources` 事件）展开后仍显示原流水文本，不报错、不空白；
新会话展开后能看到 favicon + 标题列表与「查看全部 N 个来源」。

---

## FR-6：右侧面板新增「来源」视图

**落点**：`DeepResearchFilesPanel.tsx`。

1. `DeepResearchFilesPanelProps`（L28-40）新增：

```ts
/** 打开某条车道的网页来源列表（Kimi 式）。设置后面板进入 sources 视图。 */
focusLane?: { title: string; sources: LaneSource[] } | null;
```

2. 内部 `view` 状态（L391）从 `"browse" | "preview"` 扩展为 `"browse" | "preview" | "sources"`。
   `focusLane` 非空时进入 `sources`；`focusArtifactId` 优先级高于 `focusLane`（两者不会同时设）。
3. `sources` 视图渲染：
   - 头部标题用「网页搜索 N」+ 车道标题副行（复用现有 header 结构，返回按钮回 `browse`）
   - 列表每项：`WebSearchFavicon` + 标题（两行截断）+ 域名 + `snippet`（两行截断）
   - 点击项：若 `archivedPath` 存在，在已加载的 `artifacts` 里按 `path === archivedPath` 找到 id，
     `setSelectedId(id); setView("preview")`；找不到或没有 `archivedPath` 时，
     `window.open(url, "_blank", "noopener,noreferrer")`
   - 每项右侧固定一个小外链图标按钮（`stopPropagation` 后 `window.open`），
     即便默认行为是预览正文也能直达原网页
4. 从 `sources` 视图进入 `preview` 后，返回按钮应回到 `sources`（用一个
   `previewOrigin: "browse" | "sources"` 状态记录来路），而不是直接跳回 `browse`。
5. `sources` 视图沿用现有的宽度/拖拽/全屏逻辑，不改 `deep-research-files-panel-resize.ts`。

**AC-6**：面板在 `sources` 视图下，点带 `archivedPath` 的项进入正文预览，
点返回回到来源列表；点不带 `archivedPath` 的项调用 `window.open`。

---

## FR-7：回调接线

1. `MessageList.tsx`
   - `MessageListProps`（L154-162 附近）新增
     `onRequestDeepResearchLaneSources?: (sessionId: string, lane: { title: string; sources: LaneSource[] }) => void;`
   - 新增 `openDeepResearchLaneSources` useCallback（参考 L497-507 的 `openDeepResearchFiles`），
     父级未接管时落到内部 state `filesPanelLane`
   - L743-745 的 `<DeepResearchWorkbench ... />` 补 `onOpenLaneSources` / `onOpenLaneSource`
     （后者：有 `archivedPath` 则走 `openDeepResearchLaneSources` 后由面板自行 preview；
      简化实现——`onOpenLaneSource` 直接 `window.open(url)`，正文预览统一从面板进入）
   - L1308 的内部 `DeepResearchFilesPanel` 传 `focusLane={filesPanelLane}`
2. `MachiChatView.tsx`
   - 新增 `filesPanelLane` state 与 `requestDeepResearchLaneSources` useCallback
     （参考 L135-142 的 `requestDeepResearchFiles`，同样先 `setAttachmentPreview(null)`）
   - L939-950 的 `<DeepResearchFilesPanel ... />` 传 `focusLane={filesPanelLane}`
   - 打开来源时清空 `filesPanelFocusId`，打开 artifact 时清空 `filesPanelLane`，避免两种 focus 打架

**AC-7**：`pnpm -C enterprise exec vitest run features/chat apps/web-portal/src/lib/deep-research` 全绿；
本地 `bash enterprise/scripts/start-dev.sh` 起前台，跑一次深度调研，
车道展开可见来源列表、点「查看全部」右侧出现网页列表、点条目进入正文预览。

---

## 验收总表

| 编号 | 验收点 | 验证方式 |
|---|---|---|
| AC-1 | 两包事件类型一致 | typecheck + `rg` 比对 |
| AC-2 | 编排器发出 `lane_sources` | `orchestrator.test.ts` 新用例 |
| AC-3 | trim 优先级正确 | `run-store.test.ts` 新用例 |
| AC-4 | host/metrics 纯函数 + segments 聚合 | `deep-research-lane-sources.test.ts` + segments 用例 |
| AC-5 | 老会话不回退 | 手测：无 `lane_sources` 的历史消息展开仍有内容 |
| AC-6 | 面板来源视图与返回路径 | 手测 + 组件级断言 |
| AC-7 | 端到端 | 本地跑一次深度调研 |

## 风险与回退

- **事件体积**：每车道 10 条来源 × (title+url+200 字 snippet) ≈ 3-5KB，
  乘以 4-6 条车道后仍远小于 run-store 上限；若实测偏大，先砍 `snippet` 到 120 字。
- **老会话兼容**：所有新字段可选，`sources` 缺失时 UI 回落到原 `detailLines` 渲染路径。
- **回退**：前端改动独立于事件；若面板视图出问题，可只回退 FR-5/FR-6/FR-7 的前端 commit，
  事件与编排器改动无害（前端忽略未知字段）。
