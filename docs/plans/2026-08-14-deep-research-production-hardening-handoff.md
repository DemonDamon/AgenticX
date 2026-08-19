# 深度研究生产加固修复交接报告（HC0808）

实施分支：`hc-0808`<br>
核对基线：`b3a261e9`<br>
实施模型：`gpt5.6sol`

## 1. 目标与边界

本报告供一个没有前序对话的实施 Agent 直接施工。只在 `hc-0808` 上修改、分功能提交；不要切换 `main`、不要开 PR。全部验证通过后再一次性推送 `origin/hc-0808`。

已经完成且不得重复改造：全局证据包上限、相关片段召回、统一运行 deadline、反思缺口跨轮去重、单次深度研究预算、外部正文不可信边界、5–9 节报告交付约束。

本轮只做以下六项：

1. 深度研究运行记录并发安全，澄清等待改为数据库协调。
2. 租户每日搜索 Provider 调用硬上限，并在管理后台提供最小控制面。
3. 引用与事实断言的语义复核。
4. 查询改写服务不可用时的安全降级。
5. Lane memo 上下文收敛与跨章节连续性记忆。
6. 查询感知的证据时效性和动态第一方权威度。

明确不做：任务执行实例宕机接管、完整作业队列、历史用量报表、用户级/会话级搜索配额、向 Admin 暴露 lane 数/反思轮次/抓取数/模型调用数/评分权重/复核阈值、embedding/NLI 新服务。

## 2. 提交顺序

| 顺序 | 提交主题 | 内容 |
|---|---|---|
| 1 | `fix(research): make run persistence multi-instance safe` | Run CAS、原子报告追加、DB 澄清协调、归属校验 |
| 2 | `fix(search): enforce tenant daily provider quota` | 每日 Provider 硬配额、Admin 最小控件 |
| 3 | `fix(research): verify citation grounding` | 全报告一次语义复核与定点替换 |
| 4 | `fix(search): safely degrade query rewriting` | 改写故障时的保守原文搜索 |
| 5 | `fix(research): bound lane context and preserve continuity` | Lane memo 上限、滚动章节记忆 |
| 6 | `fix(research): rank time-sensitive evidence` | 时效车道评分、动态第一方信号 |

每个提交只暂存本功能文件，提交信息尾部固定：

```text
Impl-Model: gpt5.6sol
Made-with: Damon Li
```

不要清理或提交工作区里既有的无关文件。

## 3. 提交 1：运行状态与澄清协调（P0）

### 根因

`enterprise/apps/web-portal/src/lib/deep-research/run-store.ts` 的 `appendEvents()` 是 SELECT → JS 合并 → UPDATE，跨实例会覆盖事件；MySQL `appendReport()` 同样会丢 chunk；`finish()` 可互相覆盖终态；`reapStaleRuns()` 可能把刚完成/刚刷新的 run 改成 failed。`flushChain` 只保护单个进程内的单个 writer。

`enterprise/apps/web-portal/src/lib/deep-research/run-wait.ts` 用 `.runtime/deep-research-clarify/*.json` 协调澄清，只适用于共享本地磁盘；resume API 目前也没有按 tenant/user 校验 run 归属。

### 数据模型与迁移

修改：

- `enterprise/packages/db-schema/src/schema/deep-research-runs.ts`
- `enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts`
- 新增 PG `enterprise/packages/db-schema/drizzle/0045_deep_research_run_coordination.sql`
- 新增 MySQL `enterprise/packages/db-schema/drizzle-mysql/0019_deep_research_run_coordination.sql`
- 更新两侧 `meta/_journal.json`

新增对等字段：

```ts
revision: integer/int NOT NULL DEFAULT 0
clarifyResume: jsonb/json NULL
clarifyExpiresAt: timestamptz/datetime(6) NULL
```

### RunStore 契约

修改 `RunRecord` 映射并扩展 `RunStore`：

```ts
beginClarification(runId, events, expiresAt): Promise<boolean>
resolveClarification({ tenantId, userId, runId, payload, now }):
  Promise<"resumed" | "already_continued" | "not_found">
getClarificationResume(runId): Promise<ClarifyResumePayload | null>
expireClarification(runId, now): Promise<ClarifyResumePayload>
```

实现要求：

- `appendEvents()` 保留 `mergeRunEvents()`，读取 `revision` 后用 `run_id + revision + active status` 做 CAS；成功时 `revision + 1`。最多重试 8 次，耗尽必须抛错，不能静默丢事件。
- `appendReport()` 删除前置 SELECT。PG 用 SQL concat，MySQL 用 `concat(report_markdown, chunk)`；WHERE 必须限定 active status，同时 `revision + 1`。
- `finish()` 用单条条件 UPDATE；第一个终态胜出，completed/failed/cancelled 不得互相覆盖；同一终态仅允许带 `errorMessage` 的补写。
- `reapStaleRuns()` 改成一次条件 UPDATE，PG 按 `returning`、MySQL 按 `affectedRows` 返回真实更新数。
- `setCitations()` 仍允许终态写入，因为当前 `persistFinish()` 会在状态补丁之后保存最终 citations；只需 `revision + 1`，不要错误限制为 active。
- memory store 必须保持同样的状态规则，不能只修 SQL store。

### DB 澄清协调

重写 `run-wait.ts`：删除 fs/path、`AGX_CLARIFY_WAIT_DIR`、本地 JSON 文件及对应测试 helper。数据库是唯一事实源；内存 waiter 最多只做低延迟唤醒。

状态规则：

- `beginClarification` 原子写入 clarify events、`awaiting_clarify`、到期时间，并清空旧响应。
- resume 仅在 tenant/user/runId 匹配、状态为 awaiting、尚无响应且未过期时写入答案并切回 running。
- timeout 原子写入 `{ answers: {}, skip: true, timedOut: true }` 并切回 running。
- resume 与 timeout 竞争只能有一个获胜；重复 resume 返回 `already_continued`，不能覆盖首份答案。
- `waitForClarifyResume(runStore, runId, timeoutMs)` 每秒读取 DB；到期时调用 `expireClarification()`，再读取竞争胜出的 payload。

修改 `orchestrator.ts` clarify gate：先 flush 已有事件；构造 clarify events；通过 `beginClarification()` 落库成功后再直接发送对应 SSE，不能再次塞给 writer 造成重复。删除恢复后的额外 `appendEvents(... status: "running")`。

修改 `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`，直接调用 `defaultRunStore.resolveClarification()`：

- 首次有效提交：200，`resumed: true`。
- 本人重复提交或已超时：200，`alreadyContinued: true`。
- run 不存在、跨 tenant 或跨 user：统一 404，避免 runId 探测。
- DB 失败：500，不能伪装成 already continued。

### 验收

更新/新增 `run-store.test.ts`、`run-store.sql.test.ts`、`run-wait.test.ts`、resume `route.test.ts`、`orchestrator.test.ts`：

- 两个独立 writer 从同一 revision 并发追加，事件和 `eventSeq` 均不丢。
- PG/MySQL 并发追加两个报告 chunk 均保留。
- 并发 finish 只有首个终态生效，旧 append 不可把终态复活。
- reap 与 finish/touch 竞争不误杀活跃 run。
- 实例 A 等待、实例 B resume，A 能从 DB 取得答案；测试不共享文件或 waiter。
- resume/timeout 竞争只有一个 payload 胜出；跨租户/用户为 404。
- DB 确认 awaiting 之前，客户端收不到 clarify SSE。

## 4. 提交 2：租户每日搜索 Provider 配额（P0）

### 数据模型

新增：

- `enterprise/packages/db-schema/src/schema/web-search-quota.ts`
- `enterprise/packages/db-schema/src/mysql-schema/web-search-quota.ts`
- 从两侧 `schema/index.ts` 导出
- PG `drizzle/0046_web_search_daily_provider_quota.sql`
- MySQL `drizzle-mysql/0020_web_search_daily_provider_quota.sql`
- 更新两侧 journal、migration inventory、schema parity

表 `enterprise_web_search_daily_quota`：

| 字段 | 约束与语义 |
|---|---|
| `tenant_id varchar(26)` | PK，每租户一行 |
| `max_provider_calls int` | not null default 0；0 表示不限 |
| `usage_day varchar(10)` | UTC `YYYY-MM-DD` |
| `provider_calls_used int` | not null default 0 |
| `updated_at` | DB 当前时间 |

最终 inventory：PG journal 46 项、SQL 48 个（含两个既有 orphan）；MySQL journal/SQL 各 21 项；逻辑 schema 表数量 50。不要改 MySQL baseline 内既有 42 表断言。

### 原子 Store

新增 `enterprise/apps/web-portal/src/lib/web-search/daily-provider-quota.ts`：

```ts
getTenantDailySearchProviderQuota(tenantId, now?)
setTenantDailySearchProviderLimit(tenantId, limit, now?)
reserveTenantDailySearchProviderCall(tenantId, now?)
isTenantDailySearchProviderQuotaExceeded(error)
```

API 字段名统一为 `maxDailySearchProviderCalls`，有效整数范围 `0..1_000_000`。默认 0 是为了滚动上线不意外中断现有租户；上线前由管理员设有限值。

禁止 SELECT → 判断 → UPDATE。先 no-op upsert 确保行存在，再用一条条件 UPDATE 原子跨日重置和递增：

```sql
UPDATE enterprise_web_search_daily_quota
SET provider_calls_used = CASE WHEN usage_day = :today
      THEN provider_calls_used + 1 ELSE 1 END,
    usage_day = :today,
    updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = :tenant
  AND (max_provider_calls = 0 OR
       CASE WHEN usage_day = :today THEN provider_calls_used ELSE 0 END
       < max_provider_calls);
```

PG 用 `RETURNING`，MySQL 读 `affectedRows`。`set...` 只更新 limit，绝不清空今日 used。DB 异常必须 fail-closed。

计数口径：adapter 与凭据校验完成后、真实出站调用前扣减；主服务、备用服务、失败和超时尝试都计数。未知 adapter、缺凭据、配额拒绝、query rewrite、页面直读/抓取、模型调用不计数。不限额时仍累计真实用量。

### 唯一扣减边界与错误语义

修改 `providers.ts`：`beforeProviderAttempt` 支持 `void | Promise<void>`，`executeWebSearch()` 必须在 `adapter.search()` 前 `await`，且 hook 位于 provider try/catch 外；配额拒绝不得被当作 Provider 故障后继续 failover。

修改：

- `tool-loop.ts` 的 `GatewayFetchDeps` / `executeOrdinarySearchPlan()`，主、备调用都传 admission hook。
- `deep-research/orchestrator.ts` 的 `DeepResearchDeps`，Recon/lane 均先扣单次 run ledger，再 await 同一 tenant admission hook。
- `deep-research/recon.ts` 及 lane catch，配额异常必须重新抛出。
- `app/api/chat/completions/route.ts`，普通搜索和深度研究都注入 `() => reserveTenantDailySearchProviderCall(session.tenantId)`。

普通搜索达限后返回 429（建议错误码 `42903`）和“今日联网搜索额度已用完，请联系管理员调整”，不得让模型脱离搜索裸答。深度研究流中输出同义终态、保存 failed run，并停止所有后续 Provider/fallback 请求。

### 管理后台最小控制面

只修改现有联网搜索页面/API：

- `enterprise/apps/admin-console/src/app/api/admin/web-search/route.ts`
- `enterprise/apps/admin-console/src/app/api/admin/web-search/__tests__/route.test.ts`
- `enterprise/apps/admin-console/src/app/admin/web-search/page.tsx`
- `enterprise/apps/admin-console/messages/zh.json`
- `enterprise/apps/admin-console/messages/en.json`

GET/PUT 权限维持 `provider:read` / `provider:update`。响应追加：

```ts
dailyProviderQuota: {
  usageDay: "2026-08-14",
  limit: 1000,
  used: 237,
  remaining: 763, // 不限时 null
  unlimited: false
}
```

PUT 只新增 `maxDailySearchProviderCalls`。页面只新增一张紧凑策略卡：

- 数字输入“每日搜索调用上限”与一个保存按钮。
- 只读“今日已用 237 / 1000 次”；0 时显示“今日已用 237 次 · 当前不限额”。
- 提示“主搜索、备用搜索及失败请求均计数，按 UTC 自然日重置”。
- 策略网格调整为 `xl:grid-cols-3`，避免五张卡过窄。

不得新增独立配额页、手动清零、用户级额度，也不得把页面抓取数、模型调用数、lane 数、反思轮次、评分权重或重试数暴露给 Admin。

### 验收

新增 `daily-provider-quota.test.ts`，并更新 `providers.test.ts`、`tool-loop.test.ts`、`orchestrator.test.ts`、Admin route test：

- 上限 7，同时发起至少 20 个 reservation，恰好 7 个成功，DB used=7。
- 主服务失败再走备用累计 2 次；达限后 adapter.search 调用数为 0。
- 0 不限但仍递增；跨 UTC 日后首个请求 used=1。
- 调低 limit 不清空 used，且低于已用量时立即拒绝。
- 管理后台刷新与 DB 一致；只出现一个新增可编辑参数和一个只读用量。

## 5. 提交 3：引用—断言语义复核（P0）

新增 `deep-research/citation-verifier.ts` 与测试；在 `orchestrator.ts` 写完全部 section、执行完结构修复后、`linkifyCitations()` 前调用。

算法必须是“一次全报告审计 + 程序定点替换”，不能逐节新增 5–9 次模型调用：

1. 从未 linkify 的 Markdown 中提取带 `[N]` 的事实单元，跳过代码围栏，记录稳定 claimId、offset 和原引用编号。
2. 为避免复核本身膨胀，最多选 32 条；优先数字/日期/比较/因果断言，并按章节轮转。单条最多 280 字，claim 区总计不超过 9,000 字。
3. 按实际引用编号去重，用 `selectRelevantEvidenceExcerpt()` 召回片段；每源不超过 800 字、证据总计不超过 10,000 字，继续包裹 `<untrusted_evidence>`。
4. 全报告最多调用一次 `callGatewayJson()`，temperature=0、max_tokens=4096；仅在存在断言、剩余时间 >45 秒且 `modelCalls` 有余额时执行。该函数已扣 model budget，调用前不要重复 consume。
5. 只让模型返回问题项：

```json
{"findings":[{"claim_id":"c3","verdict":"partial|unsupported|contradicted","replacement":"可由原证据支持的降级表述 [1]"}]}
```

6. 只接受已知 claimId；replacement 的引用必须是该 claim 原引用的子集，不得新增标题、代码块或其它事实。空 replacement 表示删除该事实单元。
7. 按 offset 倒序替换，禁止重写整篇。非法 JSON/非法 finding/调用失败时保留原文并记服务端 warning，不把“置信度/信息缺口/复核失败”写给客户。
8. 真正调用时只发一条可见 phase：“正在复核引用与关键断言…”。

验收：普通段落/列表/表格可提取、代码块跳过；后部相关证据能召回；未知 claim/引用被拒；空 replacement 不破坏相邻 Markdown；最终 artifact 只含修复后正文；全报告最多一次复核且计入 `research_budget.modelCalls`；预算不足仍能正常完成。

## 6. 提交 4：查询改写故障的安全降级（P1）

修改：

- `web-search/follow-up.ts`：新增 `canSafelyFallbackToCurrentQuery(query)`。
- `web-search/tool-loop.ts`：调整 `rewriteSearchQueryWithAi()`、source union 与 trace。
- `web-search/__tests__/follow-up.test.ts`、`web-search/__tests__/tool-loop.test.ts`。

严格区分两种失败：

- 模型明确返回空 resolved query：`agent_unresolved`，绝不搜索。
- 两次改写因超时/HTTP/解析失败而不可用：仅当当前问题通过保守自包含检查时，搜索消毒后的当前原文一次，source=`current-fallback`；否则仍为 `rewrite_unavailable`。

自包含检查先拒绝中文/英文代词和承接词（如“他/她/它/他们/这篇/那个/上述/前者/后者/继续/再查一下/刚才”，`it/they/this/that/former/latter/same one`），然后只接受 URL、DOI/arXiv ID、书名号/引号标题，或明确的大小写/字母数字产品标识。不能用“句子够长”作为依据。

fallback 必须走 `sanitizeWebSearchQuery()`，只生成一条 query，不拆分、不拼历史；signal 已 abort 时禁止 fallback；trace reason=`rewrite_fallback_search`。不新增模型调用或 Admin 控件。

验收：含“她/这篇”的追问在 rewriter 503 时零 Provider 调用；含明确产品标识和日期的完整问题调用一次；模型明确返回空 query 时即使含实体也不 fallback；aborted 时不 fallback。

## 7. 提交 5：Lane 上下文与章节连续性（P1）

### Lane memo

在 `deep-research/evidence-pack.ts` 新增 `formatLaneEvidencePack()`，替换 `orchestrator.ts` 当前逐源 `fullText.slice(0, 2_000)` 的 `evidenceBits`。

内部固定上限：

```ts
MAX_LANE_MEMO_EVIDENCE_CHARS = 10_000
MAX_LANE_MEMO_EVIDENCE_TOKENS = 6_000
MAX_LANE_MEMO_SOURCE_CHARS = 1_000
```

只传当前 lane，query=当前 question，`includeLaneMemos=false`；按 citation index 去重并复用 `selectRelevantEvidenceExcerpt()`，保留不可信证据边界。12 个长来源也不能越界，相同引用只出现一次，正文后部的相关段落可以被选中。不增加模型调用。

### 跨章节连续性

在 `report-writer.ts` 新增 `buildSectionContinuitySummary(title, body)`，替换：

```ts
previousSummaries.push(sectionBody.trim().slice(0, 200));
```

内部固定上限：每节 420 字，全报告 4,000 字。确定性删除代码围栏、标题和表格分隔线；优先带引用事实句，从前/中/后分散选择最多 3 条；无引用时取首尾有效陈述；保留引用编号。输出形态：

```text
【章节标题】
关键结论：
- ... [1]
已用来源：[1][4]
```

验收：2,000 字章节末尾的关键结论能进入下一节 prompt；九节总记忆不超过 4,000 字；不重复注入完整章节；无新增模型调用。

## 8. 提交 6：查询感知的时效与权威评分（P1）

修改：

- `deep-research/source-pool.ts`：扩展 `scorePool()` / `authorityBoost()`，新增 `freshnessScore()`。
- `deep-research/query-expander.ts`：收紧 `kind="recency"` 生成条件。
- `deep-research/orchestrator.ts`：在 `scorePool(question, pool.list())` 传入本 lane 是否含 recency variant 和 `now`。
- `retrieval/evidence-discipline.ts`：增加当前态结论的时间约束。
- 更新 `source-pool.test.ts`、`query-expander.test.ts`。

仅 recency lane 使用时间权重；历史、基础理论、经典论文完全保留现有公式：

```text
普通：0.55 relevance + 0.25 authority + 0.20 repeat
时效：0.48 relevance + 0.22 authority + 0.15 repeat + 0.15 freshness
```

时效分只降权、不硬过滤：近 30 天=1；31–180 天=0.8；181–730 天=0.55；更旧=0.25；缺失/非法/异常未来日期=0.5。

动态第一方信号只补充静态先验：从 topic 提取长度 ≥3 的非通用拉丁实体 token；计算主域 label（兼容常见 `co/com/org/net/gov/edu/ac` 二级后缀）；只有主域 label 与实体 token 完全匹配，且子域或路径含 `docs/developer/api/research/documentation` 时，authority 至少提升到 0.8。禁止因 `.ai` 后缀或标题自称 official 加分，现有 `.gov/.edu/arxiv` 规则保留。

`EVIDENCE_DISCIPLINE_HINT` 增加：需要当前/最新结论时，发布日期缺失或明显早于目标时段的单一来源不能独立支撑断言，必须有近期证据或在正文就近标注时间边界。

验收：非时效车道旧基础论文不被新博客机械压过；时效车道同等相关/权威下近期来源优先；缺失/非法/未来日期不拿最高分也不被删除；普通 `.ai` 不自动提权；新厂商官方 docs 在实体精确匹配时可获得中高权威。

## 9. 全量验收与完成定义

至少运行：

```bash
pnpm -C enterprise --filter @agenticx/db-schema test
pnpm -C enterprise --filter @agenticx/db-schema typecheck
pnpm -C enterprise --filter @agenticx/app-web-portal test
pnpm -C enterprise --filter @agenticx/app-web-portal typecheck
pnpm -C enterprise --filter @agenticx/app-web-portal build
pnpm -C enterprise --filter @agenticx/app-admin-console test
pnpm -C enterprise --filter @agenticx/app-admin-console typecheck
pnpm -C enterprise --filter @agenticx/app-admin-console build
```

SQL 并发 AC 必须分别覆盖 PostgreSQL 与 MySQL；若本机没有双数据库，单测可以先用可注入 DB adapter 验证 CAS/affectedRows 分支，但合并前 CI 必须用真实两种数据库执行“20 并发抢 7 个名额”和并发 run append。

完成标准：

- 六个提交边界清晰，可逐个 revert。
- PG/MySQL schema 与迁移链严格对等，旧数据无需回填即可启动。
- 普通搜索与深度研究共享同一租户每日 Provider 闸门。
- Admin 只有“每日搜索调用上限”一个新增可编辑项和“今日已用”只读值。
- 报告正文不展示内部置信度、信息缺口或复核编排痕迹。
- 无本地澄清文件；跨实例 resume 有归属校验且幂等。
- `git diff --check`、上述测试/typecheck/build 全绿；只暂存本报告指定文件，最后一次性 push。
