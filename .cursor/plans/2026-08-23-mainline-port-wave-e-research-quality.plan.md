# Wave E：检索 / 深度研究质量回灌

Planned-with: Cursor Grok 4.6

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把交付分支上已经验证过的检索/研究质量机制（页面主文本、直读 lane、引文落地审计、中断流用量结算，以及可选的时效排序）回灌主线 Enterprise 门户与网关，只移植算法与状态机。

**Architecture:** 不 merge 交付分支，不整文件覆盖 `tool-loop.ts` / `orchestrator.ts` / `server.go`。在 `feat/mainline-port-wave-c`（`74a94595`）上新开 `feat/mainline-port-wave-e`，按 T1→T4 分 commit。能力说明继续走主线产品身份，不引入交付产品名。

**Tech Stack:** TypeScript（web-portal deep-research / web-search）、Go（enterprise gateway）、vitest、`go test`。

---

## Suggested-Impl-Model

| 子规划 | 推荐模型 | 理由 |
|---|---|---|
| T1 页面主文本 | `composer-2.5` | 单文件算法替换 + 已有测试夹具，样板少 |
| T2 直读 lane | `gpt-5.6-sol-medium` | 跨 tool-loop / orchestrator / rerank 接线，回归面大 |
| T3 引文审计 | `gpt-5.6-sol-medium` | 状态机 + 预算门控，顺序敏感 |
| T4 中断流结算 | `gpt-5.6-sol-medium` | Go 计费双轨，错一次会双扣或漏扣 |
| T5 时效 RRF（可选） | `composer-2.5` | 仅 `rerank.ts` 算法 hunk |

Suggested-Impl-Model: `gpt-5.6-sol-medium`（整波次默认；T1/T5 可降到 Composer 2.5）

---

## 0. 实施者必须先读的基线

| 项 | 值 |
|---|---|
| 源分支（只读） | `origin/hc-0818`（工作区若在交付树则为该仓库 HEAD） |
| 实施 worktree | `/Users/damon/myWork/AgenticX-wave-a` |
| 基线 commit | `74a94595`（Wave C 末；**不要**以 `feat/mainline-port-g1` 为底，以免和 G1 揉进同一 PR） |
| 禁止 | `git merge origin/hc-0818`；整文件覆盖 `orchestrator.ts` / `tool-loop.ts` / `ChatPane.tsx` / `server.py` |
| 交付源 commit | `953c0438` 主文本；`b7315063` 直读 lane；`9b53bb43` 引文审计；`821a9f35` 中断流结算；可选 `c42b60af` 时效 RRF |

对照源（只读）：

```bash
git show 953c0438 --stat
git show b7315063 --stat
git show 9b53bb43 --stat
git show 821a9f35 --stat
```

工作区若当前是交付树，上述 hash 在该仓库；实施必须在 wave-a worktree。

---

## 1. 根因与证据（不依赖对话记忆）

主线门户已有 deep-research / web-search 骨架，但四段质量机制未落地或仍是旧实现：

1. **主文本：** `enterprise/apps/web-portal/src/lib/web-search/page-fetch-extract.ts` 现为 93 行。`pickMainHtml`（约 L54–69）用非贪婪 `<div>` / `<article>` regex + id/class 启发式。侧栏菜单、推荐轨、未闭合 script 会把导航噪声当正文。交付 `953c0438` 改为「去噪 → 栈扫描 container → 按非链接 prose 打分 → 向内收紧」三阶段。
2. **直读 lane：** 主线无 `direct-page.ts`。用户消息里的显式 URL 仍走普通搜索召回，同一文档会被重复抓、重复计分。交付 `b7315063` 在 provider 调用前解析 URL、读页、BM25 选 passage，orchestrator 全 run 共享一次 `directPageView`。
3. **引文审计：** 主线 `orchestrator.ts` `runDeepResearchTurn`（约 L649）在综合阶段直接 `linkifyCitations`（约 L2255），没有「先核 claim 再 linkify」。交付 `9b53bb43` 在 structure repair 之后、linkify 之前插入整报告一次审计。
4. **中断流结算：** 主线 `enterprise/apps/gateway/internal/server/server.go` `handleStream`（约 L1107）在 `streamErr != nil` 入口（约 L1186）对 channel relay **先** `RollbackContext`，再 `reportUsageDetailed` + `SettleContext`。中断流上的 reservation 被整单回滚后再 partial charge，存在双轨。交付 `821a9f35` 抽出 `settleInterruptedStreamUsage`，去掉 premature rollback。

主线已有、不要重复造：

- `enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts` 的 checkpoint / `web_search_sources` / `deep_research` 事件切片
- `enterprise/features/chat/src/components/molecules/DeepResearchWorkbench.tsx`（只消费 events，不改 UI）
- `desktop/electron/enterprise-capabilities.ts` 不存在也不属于本波次

---

## 2. In scope / Out of scope

### In scope

- 替换 `page-fetch-extract.ts` 算法 + 扩展 `page-fetch.test.ts`
- 新增 `direct-page.ts`、`direct-document-intent.ts`；`rerank.ts` 增加 `rankTextPassages`
- **最小 diff** 把直读接到 `tool-loop.ts` / `orchestrator.ts` / `page-fetch.ts` / `page-fetch-backends.ts`
- 新增 `citation-verifier.ts`；最小 `evidence-pack.ts`（至少 `selectRelevantEvidenceExcerpt`）；orchestrator 在 linkify 前插入 verify
- gateway `settleInterruptedStreamUsage` + 去掉 interrupt 路径 premature rollback + Go 单测
- 可选：`rerankHits` 增加 recency RRF（`c42b60af` 算法 hunk only）

### Out of scope

- 计算器整链（`lib/calculator/*`、tenant `calculator_enabled`、tool-loop 计算器测试）
- `portal-capabilities.ts` 及 `withPortalCapabilityContext` 原样移植（交付产品名）
- 整文件替换 `tool-loop.ts`（交付侧约 1642 行，含 portal inject / calculator / trace）
- 整文件替换 `orchestrator.ts`
- chat-history 新字段（如 `web_search_trace`）
- DeepResearchWorkbench / citation chip 视觉改版
- 交付品牌组件、客户 org、测试域名、客户模型 slug
- Wave D 群聊 TurnPlan；Wave F 能力包

**no-scope-creep：** 每个改动必须能追溯到本 plan 一条 Task。觉得「顺手把计算器也接上」必须先问用户。

---

## 3. 品牌与提交约束

- commit / PR **禁止**客户名、交付产品名、第三方对标措辞
- 移植源文件后对 **staged diff** 做泄漏检索（实施者自列排除词，**不要把客户字面量写进 plan/commit**）
- 注释里若源文件带交付产品名，改成中性「门户 / 本机后端」
- trailer：`Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`
- Plan-Id: `2026-08-23-mainline-port-wave-e-research-quality`
- 实施前把本文件从 `.cursor/plans/pending/` **移回** `.cursor/plans/`

测试约定（wave-a worktree）：

```bash
cd /Users/damon/myWork/AgenticX-wave-a
# TS
pnpm --filter @agenticx/web-portal exec vitest run \
  src/lib/web-search/__tests__/page-fetch.test.ts \
  src/lib/web-search/__tests__/direct-page.test.ts \
  src/lib/web-search/__tests__/rerank.test.ts \
  src/lib/deep-research/orchestrator.test.ts \
  src/lib/deep-research/citation-verifier.test.ts
# 若缺 node_modules：只建指向原仓库的符号链接，禁止 git add
# Go
cd enterprise/apps/gateway && go test ./internal/server/ -count=1 -run 'Settle|StreamUsage'
```

---

## Task 1: 页面主文本（`953c0438`）

Suggested-Impl-Model: `composer-2.5`

**Files:**

- Modify: `enterprise/apps/web-portal/src/lib/web-search/page-fetch-extract.ts`（整文件替换算法，保留导出名 `extractMainText` / `MAX_PAGE_CHARS` / `MIN_USABLE_PAGE_CHARS`）
- Modify: `enterprise/apps/web-portal/src/lib/web-search/__tests__/page-fetch.test.ts`

**Before（主线约 L54–92）：** `stripNoiseTags` 用非贪婪正则删标签；`pickMainHtml` 用 article/main/div[id|class=content] 启发式。

**After 意图：**

```ts
// stripNoise: 嵌套感知；script/style 按 raw text 读到真正闭合标签（防 a<b 误解析）
// scanTags + collectRanges: 单次栈 walk 得到真实 container range
// pickMainRange: 先取非链接 prose 最大块，再向内收到仍保留 >=75% prose 的最内层
// extractMainText: stripNoise → pickMainRange → blockTagsToNewlines → normalizeWhitespace
```

调参点只有一处：向内收紧阈值 **0.75**。不要加站点黑名单。

**步骤：**

1. 从 `git show 953c0438:enterprise/apps/web-portal/src/lib/web-search/page-fetch-extract.ts` 取完整实现写入主线同路径。删掉交付注释里的产品名（若有）。
2. 把该 commit 加进 `page-fetch.test.ts` 的 nested-menu / rail / truncation / raw-text fixture **合并**进主线已有 4 条基础用例，不要删旧用例。
3. 跑 `page-fetch.test.ts`，期望 PASS。
4. 单独 commit。

**AC-E1:** 带密集 `<nav>`/`<aside>` 链接轨的 HTML，提取结果以文章 prose 为主，不把菜单当正文。  
**AC-E2:** 旧的 4 条基础 extract 用例仍绿。  
**AC-E3:** `extractMainText` 导出签名不变，`page-fetch.ts` 调用方不用改（除非类型变了）。

---

## Task 2: 直读 lane（`b7315063`）

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/web-search/direct-page.ts`
- Create: `enterprise/apps/web-portal/src/lib/web-search/__tests__/direct-page.test.ts`
- Create: `enterprise/apps/web-portal/src/lib/deep-research/direct-document-intent.ts`（仅 `resolveDirectDocumentResearchQuery` 及测试依赖）
- Modify: `enterprise/apps/web-portal/src/lib/web-search/rerank.ts` — 增加 `rankTextPassages`（交付约 L135）
- Modify: `enterprise/apps/web-portal/src/lib/web-search/__tests__/rerank.test.ts` — 只加 `rankTextPassages` describe
- Modify: `enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` — `runWebSearchTurn`（主线约 L560）**最小 hunk**
- Modify: `enterprise/apps/web-portal/src/lib/web-search/page-fetch.ts`、`page-fetch-backends.ts` — 只取该 commit 的小改
- Modify: `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` — 全 run 共享一次 `directPageView`，同文档 URL 从 search hits 过滤
- Modify: `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts` — 只加 `reads an explicit page once…` 一类用例
- Modify: `enterprise/apps/web-portal/src/lib/web-search/__tests__/tool-loop.test.ts` — 只加 direct-page cases

**Before：** 主线 `tool-loop.ts` 无 URL 直读；`rerank.ts` 无 `rankTextPassages`；`orchestrator.ts` 无 `directPageView`。主线 `direct-fetch.ts` 是 HTTP 出站传输，**保留**，不要改名或合并进 `direct-page.ts`。

**After 意图（伪代码，落在 tool-loop `runWebSearchTurn` 前段）：**

```ts
const directRef = resolveDirectPageReference(userMessage);
if (directRef) {
  const view = await readDirectPage(directRef, fetchOpts);
  // 显式 URL 可 bypass fast-skip
  const evidence = selectDirectPageEvidence(view, query);
  // 把 directPageSource(view) 并入 hits，后续 provider 搜索结果去掉同一规范化 URL
}
```

orchestrator：

```ts
// run 开始处读一次
const directPageView = explicitRef ? await readDirectPage(...) : null;
// 各 lane 只 rerank passages，不重复 fetch
// search hits filter: hit.url 规范化后 === directPageView.url 则丢弃
```

**禁止：** 把交付 `tool-loop.ts` 1642 行整文件拷进来。对照 `git show b7315063 -- enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` 只移植 direct-page 相关 hunk。

**AC-E4:** `direct-page.test.ts` PASS。  
**AC-E5:** 用户消息含一个公网文档 URL 时，该 URL 只被 fetch 一次（orchestrator 测试断言）。  
**AC-E6:** 主线已有 `tool-loop` / `orchestrator` / `rerank` 旧测试仍绿。

---

## Task 3: 引文落地审计（`9b53bb43`）

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/deep-research/citation-verifier.ts`
- Create: `enterprise/apps/web-portal/src/lib/deep-research/citation-verifier.test.ts`
- Create: `enterprise/apps/web-portal/src/lib/deep-research/evidence-pack.ts`（最小子集：`selectRelevantEvidenceExcerpt` + 它的直接依赖；若抽离导致 orchestrator 的 `formatEvidencePack`（主线约 L400）重复，改为 orchestrator 改 import，不要两套 excerpt 逻辑）
- Modify: `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` — 在 structure repair 之后、`linkifyCitations`（约 L2255）之前插入 verify
- Modify: `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts` — 加 `audits the whole report once…`

**Before：**

```ts
const finalReport = linkifyCitations(
  stripThinkBlocks(reportContentParts.join("")),
  validIndexes,
);
```

**After 意图：**

```ts
const repaired = /* 现有 structure repair，若主线没有则不要新造，直接对 raw markdown 审计 */;
const verified = await verifyReportCitations({
  markdown: repaired,
  citations,
  remainingBudgetSeconds,
  remainingModelCalls,
  callGatewayJson, // 现有 orchestrator 网关 JSON 调用
});
const finalReport = linkifyCitations(verified, validIndexes);
```

状态机（必须按这个顺序，失败静默保留原文）：

1. `extractCitedClaims` — 跳过 fenced code / heading；表格行整行保留；稳定 id+offset
2. `selectClaimsForVerification` — 优先数字/日期/比较/因果，跨 section 轮转，最多 32 条、总字符 9000
3. `buildVerificationEvidenceBundle` — 每源 excerpt ≤800、总 ≤10000，包在 untrusted-evidence 边界
4. 仅当剩余 >45s 且 modelCalls 有余量时 `callGatewayJson`（temperature=0），模型只返回 problems
5. `applyVerificationFindings` — reverse offset splice；表格行只 downgrade 不 drop；orphan list bullet 整行删除

**AC-E7:** `citation-verifier.test.ts` PASS。  
**AC-E8:** orchestrator 测试证明 verify 在 linkify 之前只跑一次；网关/预算不足时报告原文仍可用。  
**AC-E9:** 不要改 DeepResearchWorkbench UI；新 phase 文案用中性「正在复核引用与关键断言…」，禁止交付产品名。

---

## Task 4: 中断流用量结算（`821a9f35`）

Suggested-Impl-Model: `gpt-5.6-sol-medium`

**Files:**

- Modify: `enterprise/apps/gateway/internal/server/server.go` — `handleStream` 约 L1186–1255
- Create: `enterprise/apps/gateway/internal/server/stream_usage_settlement_test.go`

**Before（约 L1186–1189 + L1235–1255）：** `streamErr != nil` 时 channel relay **先** `RollbackContext`，再 `reportUsageDetailed`，再 `SettleContext` / `reconcileQuotaUsage`。

**After 意图：**

```go
if streamErr != nil {
    // 不要在这里 RollbackContext
    // 政策拦截分支与普通中断分支都走：
    s.settleInterruptedStreamUsage(identity, decision, estimatedInputTokens, partialOutputTokens, qctx, reservedTokens, ...)
    // settleInterruptedStreamUsage 内部：
    //   reportUsageDetailed(...)
    //   if useChannelRelay { SettleContext } else { reconcileQuotaUsage }
    //   只 settle 一次
}
```

以 `821a9f35` **diff 语义**为准（去掉 premature rollback + 单次 partial settle），函数签名对齐 wave-a 当前的 `useChannelRelay` / `qctx` / `budgetCheck` 字段，不要按交付 HEAD 后续重构整段覆盖 `handleStream`。

成功路径（无 `streamErr`）一行不改。

**AC-E10:** `go test ./internal/server/ -run Settle` PASS。  
**AC-E11:** 中断流测试断言：channel relay **没有**先 Rollback 再 Settle；legacy quota 只 reconcile 一次。  
**AC-E12:** 成功流路径的 usage 测试（若已有）仍绿。

---

## Task 5（可选，同一 PR 末段或独立 commit）: 时效 RRF

Suggested-Impl-Model: `composer-2.5`

**Files:** `rerank.ts`、`__tests__/rerank.test.ts`  
**源:** `c42b60af` 只取 `recencyRanks` / `rerankHits` 算法 hunk。  
**Out:** 不要顺手改 freshness 查询改写或门户文案。

**AC-E13:** `describe("rerankHits recency")` PASS；无 recency 元数据时退回现有 BM25+provider RRF。

---

## 4. 总验收

| ID | 断言 |
|---|---|
| AC-E-G1 | 本分支 `git log 74a94595..HEAD --format=%s` 无交付产品名、无对标措辞 |
| AC-E-G2 | staged/committed diff 品牌泄漏检索零命中 |
| AC-E-G3 | Task 列出的 vitest + `go test` 全绿 |
| AC-E-G4 | 主线 chat-history checkpoint 与 DeepResearchWorkbench 渲染不被本波次改文件破坏（现有相关测试仍绿） |
| AC-E-G5 | 未改 `agenticx/studio/server.py`；若误碰则必须隔离 HOME 冷启动 `/api/session` `/api/avatars` `/api/sessions` = 200 |

每个 Task 单独 commit。禁止把 Wave E 和 G1/Wave F 捆进同一个 PR。
