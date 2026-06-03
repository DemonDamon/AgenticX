---
name: kb-citation-doc-level-grouping
overview: 知识库检索来源卡与正文角标从「chunk 级」改为「文档级」展示——来源卡按文档去重计数，正文角标显示文档号（同一文档的多个分块命中显示同一个号、相邻同文档号合并为单个 pill），但 hover 仍展示每个位置各自命中的分块内容。chunk 级 reference id 与后端编号契约保持不变。
todos:
  - id: doc-grouping-util
    content: 新增 citation-doc-grouping 工具——deriveDocKey / buildDocNumberMap（id→docNumber）/ dedupeReferencesByDoc，附纯函数单测
    status: completed
  - id: merge-adjacent
    content: citation-normalize 新增 mergeAdjacentCitations——把连续且同 docNumber 的角标合并为一个渲染项（携带有序 chunk ref 列表），附单测
    status: completed
  - id: badge-docnumber
    content: CitationBadge 改为按 docNumber 渲染、支持多 reference（合并态），unresolved 回退原 id
    status: completed
  - id: popover-multi
    content: CitationPopover 支持多分块——堆叠展示各 chunk 摘录，文档名/打开入口只出现一次
    status: completed
  - id: body-wire
    content: CitationMarkdownBody / InlineCitationGroup 接入 docNumberMap 与 mergeAdjacentCitations
    status: completed
  - id: refs-card-dedup
    content: ReferencesCard 列表按 docKey 去重、行号用 docNumber、摘要「找到了 N 篇」用唯一文档数（可附片段数）
    status: completed
  - id: verify
    content: 纯函数单测 + 手工验收（a/b 单分块、c 多分块；相邻 [4][5] 合并；非相邻同文档分两处；纯 web；流式与历史回放）
    status: completed
isProject: false
---

# 知识库角标文档级分组（chunk → 文档映射）

> Plan-Id: 2026-06-03-kb-citation-doc-level-grouping
> Plan-File: `.cursor/plans/2026-06-03-kb-citation-doc-level-grouping.plan.md`
> Owner: Damon
> 前置：`2026-06-02-kb-citation-ima-style`（基础链路：references SSE、ReferencesCard、CitationMarkdownBody、CitationBadge/Popover 已落地）

## 背景与现象

用户反馈（截图）：`knowledge_search` 返回 5 条结果，来源卡显示「找到了 5 篇知识库资料」，但其中 `南网技术实现需求.md` 重复出现 3 行。

根因：当前来源卡与角标都是 **chunk 级**——`knowledge_search` 按相似度返回 5 个 **分块（chunk）**，`build_kb_references` 为每个 chunk 生成一条 reference，`ReferencesCard` 用 chunk 数计「篇」。当同一文档有多个分块命中 top_k 时，就会出现重复文件名 + 计数虚高。

## 目标行为

文档 a/b/c：a、b 各命中 1 个分块，c 命中 3 个分块。

| 位置 | 现状 | 目标 |
|------|------|------|
| 来源卡 | 5 行（c 重复 3 次）、「5 篇」 | 按文档去重 → a/b/c 共 3 行、「找到了 3 篇资料」 |
| 正文角标 | `[1][2][3][4][5]`（chunk 号） | 显示**文档号**：c 的 3 个分块位置都显示 `3` |
| 角标 hover | 各自分块摘录 | 不变：每个位置 hover 仍显示它各自命中的那个分块 |
| 相邻同文档角标（如 `[4][5]`） | 渲染为 `3 3` | **合并为单个 `3` pill**，hover 堆叠展示该文档被命中的多个分块 |

## 关键设计：保留 chunk id，仅在前端加「文档号」派生层

- **不改后端编号契约**：`knowledge_search` 仍返回 chunk hits，`references[].id` 仍是 1..N 的 chunk 级顺序号；模型仍按位置输出 `[1]..[N]`。hover 依赖 `refMap.get(id)` 取具体 chunk，**保持不动**。
- 前端引入两个派生量：
  - `docKey(ref)`：文档标识。KB：`url`（形如 `agx://kb/<doc_id>#<chunk>`）去掉 `#<chunk>` 后缀；缺失时回退 `kbSourcePath`/`title`。Web：`url`（每个 web 结果各自成「文档」）。
  - `docNumber`：按 `id` 升序遍历全部 references，为每个唯一 `docKey` 分配递增号（c 的 3 个 chunk 共用同一个 docNumber）。
- 角标渲染 `docNumber` 而非 `id`；模型即使输出 `[4]`，前端查 id=4 → c 的某 chunk → 显示 `3`，hover 显示该 chunk。健壮、不依赖模型严格顺序。

## 需求（FR / AC）

### FR-1 文档分组工具（新文件 `desktop/src/utils/citation-doc-grouping.ts`）
- `deriveDocKey(ref: SearchReference): string`
- `buildDocNumberMap(refs: SearchReference[]): Map<number, number>`（id → docNumber，按 id 升序分配）
- `dedupeReferencesByDoc(refs): Array<{ docNumber; primary: SearchReference; chunks: SearchReference[] }>`（供来源卡用，按 docNumber 排序）
- **AC-1**：a/b/c（c 三 chunk）→ docNumberMap 把 c 的三个 id 都映射到同一号；dedupeReferencesByDoc 返回 3 项。
- **AC-2**：纯 web 多结果 → 每个 url 独立 docNumber，与原 id 一致（无回退）。

### FR-2 相邻合并（`citation-normalize.ts` 新增）
- `mergeAdjacentCitations(segments, docNumberById)`：把**连续**且 docNumber 相同的 citation 段合并成一个渲染项 `{ kind:"citation", docNumber, ids:number[] }`；text 段原样保留；**非相邻**的同文档角标不合并（各自成项）。
- **AC-3**：`[4][5]`（均属 c）相邻 → 合并为 1 项 `ids=[4,5]`；`[3] ... 文本 ... [4]`（c 两处）→ 2 项。

### FR-3 CitationBadge 文档号 + 多 reference
- props 改为 `{ docNumber: number; references: SearchReference[] }`（兼容单条）；pill 文本显示 `docNumber`；`references` 为空时 unresolved，回退展示传入的原始号、muted。
- **AC-4**：合并态 pill 仍是单个数字；hover 打开多分块 popover。

### FR-4 CitationPopover 多分块
- 支持 `references: SearchReference[]`：>1 时堆叠展示各 chunk 摘录（可加分隔），底部文档名 + 打开入口只出现一次（多 chunk 同属一文档）；=1 时与现状一致。
- **AC-5**：c 合并 pill hover 同时看到该文档命中的多个分块摘录。

### FR-5 CitationMarkdownBody 接入
- 计算 `docNumberById = buildDocNumberMap(references)`；渲染时用 `mergeAdjacentCitations` 产出渲染项；每个 citation 渲染项构造 `references = ids.map(refMap.get).filter(Boolean)` 传给 Badge。
- **AC-6**：正文角标显示文档号，与来源卡行号一致。

### FR-6 ReferencesCard 去重
- KB 列表用 `dedupeReferencesByDoc` 去重，行号 = `docNumber`，`key` 用 docKey；摘要 `找到了 N 篇知识库资料` 的 N = 唯一文档数（可在文档名后附「· M 个片段」当 M>1）。
- web 行为不变（每结果一行）。
- **AC-7**：截图场景显示 3 行、「找到了 3 篇资料」，c 行可见 3 个片段提示。

## 不做（范围外）
- 不改后端 `build_kb_references` / `search_docs_brains` 编号与排序；不引入「每文档 chunk 上限」的检索限流（如需另开 plan）。
- 不处理「同一文件被重复 ingest 成多个 doc_id」的入库级去重（不同 doc_id 仍算多篇，属另一类问题）。

## 验证
- 纯函数单测（新增/扩展）：
  - `citation-doc-grouping.test.ts`：buildDocNumberMap / deriveDocKey / dedupeReferencesByDoc（AC-1/2）。
  - `citation-normalize.test.ts`：mergeAdjacentCitations 相邻合并与非相邻不合并（AC-3）。
- 手工验收：a/b 单分块 + c 三分块；相邻 `[4][5]` 合并；非相邻同文档两处独立；纯 web；流式中途与历史回放；三主题（light/dim/dark）pill 与列表对比度。
