# 深度研究结果导向写作与迭代补证计划

Planned-with: GPT-5 (Codex)
Suggested-Impl-Model: gpt5.6sol
Status: pending-review
Plan-Id: 2026-08-14-deep-research-results-first-orchestration

## 目标

让深度研究把“证据是否足以回答用户问题”作为内部编排信号，而不是把检索过程、来源置信度或信息缺口清单直接交给读者。报告默认只呈现问题本身的结论、证据、机制和适用边界；若证据仍有会改变答案的缺口，则在预算内继续检索、重新复盘，再决定是否进入写作。

本计划是对现有 deep-research 流程的定向优化，不重写 Planner、搜索车道、报告协议或持久化架构。需要同时解决三件事：

1. 默认报告不再强制生成“信息缺口”“来源置信度”“检索方法”等内部元章节。
2. “推荐 / 不推荐 / 风险评估”只在用户明确询问决策、选型、风险，或明确选择“决策建议”交付形态时出现；跳过澄清不能自动进入该体例。
3. 一次反思改为有界的多轮“反思 → 补证 → 再反思”，每轮优先追一个最高价值缺口；缺口查询过于拥挤时，复用普通自动搜索的自包含 facet 契约拆成少量查询逐次执行，把节省下来的主车道检索预算用于纵向补证，而不是无条件增加首轮搜索次数或同时铺开更多车道。

Suggested-Impl-Model 选择 `gpt5.6sol`：本任务跨越报告意图约束、搜索预算、事件可见性和多轮停止条件，需同时保证内容判断与并发/预算边界，适合由强推理代码模型实施和收口。

## 根因与证据链

### 1. 最终报告被模板强制暴露内部缺口

- `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts` 的 `OUTLINE_SYSTEM` 明确要求末节必须是“信息缺口”类章节，并要求该节为 prose。
- 同文件 `defaultOutline()` 的兜底大纲也固定以信息缺口收尾；即使 outline 模型失败，用户仍会看到这类内容。
- 同文件 `SECTION_SYSTEM` 没有区分“影响结论的局部限定条件”和“内部检索置信度/缺口清单”，因此章节写作者容易把复盘材料重新讲给读者。
- `enterprise/apps/web-portal/src/lib/deep-research/delivery-prefs.ts` 的 `deliveryPrefsPromptBlock()` 又要求完整论证链不得省略信息缺口，形成第二层强制。
- 目标实现基线中的 `enterprise/apps/web-portal/src/lib/retrieval/evidence-discipline.ts` 当前要求证据不足时“标明不确定性”；该约束应改为收窄结论并在相关结论附近说明限定条件，不能诱导独立的内部置信度段落。

### 2. 决策体例没有被用户意图约束

- `report-writer.ts` 的 `FORMAT_DIRECTIVES.tradeoff` 固定要求写“推荐/不推荐/风险”。
- outline 模型始终可以选择 `tradeoff`，但 `buildReportOutline()` 当前只接收 topic 与 evidence，不知道原始用户问题是否真的要求决策，也不知道用户是否选择过 `DeliveryShapeId="decision"`。
- `DEFAULT_DELIVERY_PREFS` 只是 `structured`；用户跳过澄清时并没有请求决策建议。因此默认报告出现推荐/风险，根因不是澄清答案，而是大纲层缺少确定性的 intent guard。

### 3. 缺口补搜只有一轮，既不验证补搜效果，也不能追踪新暴露的依赖缺口

- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` 在主车道结束后执行一次 `reflectFn()`，随后只运行一次 gap lanes，然后立即进入 synthesize。
- 新证据不会再次送入 reflector。第一轮补证若暴露出新的关键事实缺口，或者只返回重复来源，系统都无法继续判断。
- 当前 `reflection` 事件会把 gap description 直接显示在工作台，gap lane 还会生成公开车道卡和 memo artifact。内部质量控制因此被误当成交付内容，编排痕迹过重。
- `reflector.ts` 主要限制条数，没有要求缺口必须“能改变用户问题的答案、尚未被现有证据覆盖、可由一个精确查询解决”，容易产生泛化的局限性或方法论问题。

## 设计原则

1. **结果优先**：正文围绕用户问题组织，不围绕系统怎样搜索、怎样评估来源组织。
2. **不掩盖事实**：真正影响结论的适用边界、样本限制或冲突证据仍应紧贴相关结论呈现；只是禁止把内部 gap inventory 和置信度报告独立交付。
3. **显式意图优先**：用户明确问“局限、风险、是否推荐、如何选择”时必须保留对应内容，不能被通用过滤器误删。
4. **先补证再写作**：能够靠检索解决的缺口先进入内部补搜；达到停止条件后才写报告。
5. **纵向优先、有界迭代**：每轮只追一个关键缺口；该缺口可按自包含事实面拆成少量查询并逐次执行。反思轮数、总查询数和写作预留时间均有硬上限，禁止无限自循环。
6. **协议兼容**：不删除已有 `reflection` 事件类型和旧记录渲染能力；新 run 只是不再产生公开 gap 事件。

## In scope

- Enterprise web-portal 深度研究报告大纲、章节提示词和确定性输出 guard。
- 交付偏好与报告体例之间的显式意图接线。
- 主车道结束后的多轮、预算受控的 gap reflection 与内部补搜。
- 内部补证车道的事件/备忘可见性收敛。
- 与上述行为直接相关的单元测试、编排回归和类型检查。

## 实施基线说明

本计划先在主干保存为中性设计记录，首个实现落在已包含“普通搜索多 facet 计划”和共享证据纪律提示的交付基线。该基线应能找到 `web-search/follow-up.ts` 中的 `buildQueryRewriteSystemPrompt()` / `parseSearchQueryRewriteValue()`、`web-search/search-call-budget.ts` 以及 `retrieval/evidence-discipline.ts`。若后续在尚未包含这些前置能力的分支实施，不得照抄缺失 import；应先同步对应的中性 query-plan helper，或在本计划范围内新增依赖更低的 `web-search/query-plan.ts`，再按 FR-3 接线。

## Out of scope

- Planner/Recon 的整体重写、搜索供应商切换、搜索结果排序算法或抓取后端改造。
- 修改单个主车道“首个有效查询即可提前停止”的既有策略。
- 深度研究协议、数据库 schema、run-store 迁移、历史持久化、鉴权或 Gateway API。
- 删除旧 `reflection` 事件、旧 run 回放或旧客户端渲染兼容。
- 知识库、文件解析、附件直读、导出格式、引用编号体系或 citation validity 规则。
- Desktop、admin-console 及非深度研究聊天链路。

## No-scope-creep 约束

1. 不得以“结果导向”为理由删除用户明确要求的风险、局限、争议或反方证据。
2. 不得把“隐藏 gap 文案”实现为不做 reflection；缺口仍要驱动搜索和停止判断。
3. 不得提高主车道固定搜索次数；新增消耗只能来自预算内的、由证据缺口触发的内部查询。
4. 不得削弱 `WRITE_RESERVE_MIN_MS`，多轮补搜每轮开始前都必须重新检查写作预留预算。
5. 不得让内部 gap lane 写公开 memo artifact、公开 source/lane 卡或 gap description。
6. 不得通过 prompt-only 约束替代输出 guard；模型仍可能返回违背体例的 outline，代码必须确定性清洗。
7. 不得记录完整 gap 文本到新的生产日志或埋点；可记录轮数、去重数量、查询数、新增来源数和停止原因。

## FR-1：建立“用户明确意图”驱动的报告内容策略

### 修改落点

1. `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`
   - 锚点：`OutlineDeps`、`OUTLINE_SYSTEM`、`FORMAT_DIRECTIVES`、`defaultOutline()`、`parseOutlineJson()`、`buildReportOutline()`。
   - 为 outline 调用增加原始用户问题和交付形态上下文，建议形状：

~~~ts
export type ReportContentPolicy = {
  allowDecisionSections: boolean;
  allowLimitationsSections: boolean;
};

export type OutlineDeps = {
  callJson: ...;
  topic: string;
  originalUserQuery: string;
  deliveryShapes: DeliveryShapeId[];
  evidence: string;
};
~~~

   - 若为避免 `report-writer.ts` 反向依赖 `delivery-prefs.ts`，`deliveryShapes` 可用只读字符串集合或由 orchestrator 直接传入两个布尔值；禁止形成循环 import。
   - 新增纯函数 `deriveReportContentPolicy()`。判定必须同时支持中文和英文的明确意图：
     - decision：推荐/不推荐、选型、选择、值不值得、优劣/利弊、trade-off、recommend/choose/should 等；或 delivery shape 含 `decision`。
     - limitations：局限、限制、风险、争议、不确定性、证据质量、可靠性、limitations/risks/uncertainty/caveats 等。
   - “表现怎么样”“介绍一下”“深度研究某主题”等宽泛问题不得被判为 decision 或 limitations。

2. `OUTLINE_SYSTEM`
   - 删除“末节必须为信息缺口”的硬约束。
   - 改成：章节必须直接回答用户问题；默认禁止独立的“信息缺口、来源置信度、检索过程、研究方法”元章节。
   - 只有 policy 允许时才能生成 decision 或 limitations 专章。
   - 证据限制若会改变结论，应写入对应结论/证据章节的一两句适用边界，不得扩写成检索自评。
   - 在 `buildReportOutline()` 的 user message 中追加确定性的 `【报告内容策略】`，明确本次两类章节是否允许。

3. `defaultOutline()`
   - 接收 `ReportContentPolicy`，删除固定的信息缺口末节。
   - 默认兜底改为结果导向三段：`核心结论`、`关键表现与证据`、`机制、条件与适用范围`。中间节仍可用 `comparison_table` 保持现有丰富格式兜底。
   - 若用户明确要求限制/风险，可把最后一节替换为对应主题；若明确要求决策，可使用 `tradeoff`，但不得在默认路径出现。

4. 确定性 outline guard
   - 在 `parseOutlineJson()` 返回前调用纯函数，例如 `applyReportContentPolicy(outline, policy)`。
   - 未允许 limitations 时，过滤标题/brief 明确属于以下内部元主题的章节：信息缺口、证据缺口、来源置信度、资料完整性、检索/调研过程、研究方法自评；真正的“产品/技术适用边界”不能仅因包含“限制”二字被误删。
   - 未允许 decision 时：
     - `format="tradeoff"` 归一为 `comparison_table` 或 `prose`；
     - 纯“推荐/不推荐/风险评估”章节删除；
     - 同时包含实质对比数据的章节保留，但 brief 改为中性比较，不要求下游给购买/采用建议。
   - 清洗后若没有有效 section，则使用 policy-aware fallback；不得返回空 outline。
   - 该 guard 必须作用于模型正常返回和 fallback 两条路径。

### Before / After 意图

~~~ts
// Before：outline 模型无论用户问什么都可选 tradeoff，且末节必须讲缺口
return parseOutlineJson(raw, deps.topic);

// After：用户意图决定允许的体例，模型输出还要经过确定性清洗
const policy = deriveReportContentPolicy({
  originalUserQuery: deps.originalUserQuery,
  deliveryShapes: deps.deliveryShapes,
});
return applyReportContentPolicy(parseOutlineJson(raw, deps.topic, policy), policy);
~~~

### 验收标准

- 普通“某项能力表现怎么样”报告的大纲不含信息缺口、置信度、检索方法、推荐/不推荐或风险评估专章。
- 跳过交付澄清后使用默认 `structured`，不能生成 `tradeoff`。
- 用户明确问“有哪些局限”时保留局限章节；明确问“是否值得采用、风险是什么”时保留 tradeoff/风险章节。
- 模型故意返回违背 policy 的 JSON 时，代码仍能过滤或归一，不依赖第二次 LLM 调用。

## FR-2：收敛章节写作与通用研究焦点

### 修改落点

1. `enterprise/apps/web-portal/src/lib/deep-research/report-writer.ts`
   - 锚点：`SECTION_SYSTEM`、`LEAD_SECTION_SYSTEM`、`FORMAT_DIRECTIVES.tradeoff`、`buildSectionMessages()`。
   - `SECTION_SYSTEM` 增加：禁止介绍内部搜索次数、来源置信度、gap inventory、检索过程或“第一条资料是否可信”；证据不足时缩小断言范围，并将必要限定条件放在它影响的具体结论旁。
   - `tradeoff` directive 仍保留，但只会在 FR-1 policy 允许时到达分节写作。
   - `buildSectionMessages()` 带上本次 policy 摘要，防止章节模型在普通 prose 内自行追加“推荐/不推荐/风险评估”。

2. `enterprise/apps/web-portal/src/lib/deep-research/delivery-prefs.ts`
   - 锚点：`DEFAULT_DELIVERY_PREFS`、`SHAPE_OPTIONS`、`deliveryPrefsPromptBlock()`。
   - 保留用户主动选择的“决策建议”形态。
   - 将默认结构化写作提示中的“不可省略信息缺口”改为“优先回答问题本身，证据限制仅在影响结论时就近说明”。
   - 不改变已有选项 ID、澄清答案解析或导出格式，避免协议和历史答案迁移。

3. `enterprise/apps/web-portal/src/lib/retrieval/evidence-discipline.ts`
   - 锚点：`EVIDENCE_DISCIPLINE_HINT`。
   - 将“证据不足则标明不确定性”改为“证据不足时降低断言强度或缩小结论范围；不得单列内部置信度/缺口清单”。
   - 保留逐项取证、跨来源独立性和不得把转载当独立来源的既有要求。

4. `enterprise/apps/web-portal/src/lib/deep-research/research-intent.ts`
   - 锚点：`defaultFocusOptions()`。
   - 通用 fallback 不再固定创建“局限、争议与信息缺口”焦点；改为与结果直接相关的“关键表现、证据与适用条件”。
   - 用户原问题明确要求局限/争议时，仍由现有意图模型/原问题产生相应 focus，不在 fallback 中禁止。

### 验收标准

- 默认交付偏好 prompt 不再要求信息缺口章节。
- section prompt 明确区分“局部限定条件”与“内部检索自评”。
- 通用意图 fallback 不会仅因问题宽泛就生成缺口车道。
- 引用完整性和证据独立性测试保持通过。

## FR-3：将一次性 gap search 改为纵向、有界的多轮补证

### 参数与停止条件

在 `enterprise/apps/web-portal/src/lib/deep-research/reflector.ts` 或 orchestrator 相邻常量区定义并导出用于测试的上限：

~~~ts
export const MAX_REFLECT_ROUNDS = 3;
export const MAX_GAPS_PER_ROUND = 1;
export const MAX_FOLLOWUP_QUERIES = 6;
export const MAX_QUERIES_PER_GAP = 3;
~~~

每一轮开始前必须满足 `searchBudgetLeft() > REFLECT_MIN_BUDGET_MS`，且保留现有 `WRITE_RESERVE_MIN_MS`。任一条件成立即停止：

- reflector 没有返回 gap；
- 所有 gap/query 均与之前轮次重复；
- 本轮没有新增唯一来源，说明补搜没有带来新证据；
- 达到总查询数或轮数上限；
- 搜索预算不足、run 被 abort 或遇到现有 policy error。

### 修改落点

1. 复用普通自动搜索的自包含 query-plan 契约，不复用整条会话 rewrite
   - 目标实现基线中的落点：
     - `enterprise/apps/web-portal/src/lib/web-search/follow-up.ts`：`buildQueryRewriteSystemPrompt()`、`parseSearchQueryRewriteValue()`。
     - `enterprise/apps/web-portal/src/lib/web-search/search-call-budget.ts`：`normalizeMaxSearchCalls()`。
   - 从 `buildQueryRewriteSystemPrompt()` 中抽出纯文本 helper，例如 `selfContainedSearchPlanInstruction(maxSearchCalls)`：
     - 默认只给一条查询；
     - 仅当一个问题包含多个需要分别取证的实体、实验条件、指标或时间范围，单条查询容易漏召回时才拆分；
     - 每条查询必须自包含，不得使用代词，不得用近义改写凑数量。
   - 从 `parseSearchQueryRewriteValue()` 中抽出纯归一化 helper，例如：

~~~ts
export function normalizeSelfContainedSearchQueries(args: {
  resolvedQuery: string;
  candidates: unknown;
  maxSearchCalls: number;
}): string[] | null;
~~~

   - 普通自动搜索继续调用这两个 helper，行为和配置上限不变；reflector 只复用 helper，不复制第二份 prompt/去重/截断规则。
   - **禁止**从 deep-research 直接调用 `resolveStandaloneSearchQuery()`：该函数面向会话指代补全，依赖历史消息，并会为每个 gap 增加一次独立模型 round trip；gap 已由 reflector 在同一次 JSON 调用中生成，无需再做一次语义 rewrite。
   - 若共享 helper 会形成 `tool-loop.ts ↔ follow-up.ts` 的新循环依赖，应把这两个无状态 helper 放入依赖更低的 `enterprise/apps/web-portal/src/lib/web-search/query-plan.ts`；该文件只能依赖 query sanitizer / search-call-budget，不能反向 import orchestrator 或 provider。

2. `enterprise/apps/web-portal/src/lib/deep-research/reflector.ts`
   - 锚点：`MAX_GAPS`、`MAX_FOLLOWUP_QUERIES`、`REFLECT_SYSTEM`、`parseGapsJson()`、`reflectOnGaps()`。
   - prompt 只允许报告满足全部条件的 gap：
     1. 会实质改变对原始用户问题的答案；
     2. 当前 lane memos 尚未回答；
     3. 能通过一个或少量具体、可执行的自包含搜索查询补齐；
     4. 查询优先定位第一方资料、原始评测、可复现实验或直接数据。
   - 禁止输出“资料可能不全”“仍需更多研究”“通用方法论”“来源置信度”这类不可操作的泛化缺口。
   - 每次 reflector 只返回一个最高优先级 gap；其 `queries` 默认一条，只有 gap 同时包含多个独立事实面且拥挤查询容易漏召回时，才按共享 query-plan 规则拆成最多三条自包含查询。
   - 例：不要搜索“模型 A 在基准 X、基准 Y、不同硬件和不同版本下表现与原因”；可在预算允许时拆为“模型 A 版本 V 基准 X 成绩与评测条件”“模型 A 版本 V 基准 Y 成绩与评测条件”“模型 A 版本 V 硬件 H 推理性能”。每条都必须重新带上实体、版本和所需条件。
   - `parseGapsJson()` 使用共享 `normalizeSelfContainedSearchQueries()` 做单轮 query 清洗、去重和截断；跨轮去重由 orchestrator 负责。

3. `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`
   - 锚点：`searchBudgetLeft()`、`runOneLane()`、注释 `Reflect + one-shot follow-up search` 及其后的 synthesize 边界。
   - 将一次性块替换为有界循环。实现意图：

~~~ts
const seenGapKeys = new Set<string>();
const seenQueryKeys = new Set<string>();
const seenEvidenceUrls = collectUrls(citationsByQuestion, reconCitations);
let followupQueriesUsed = 0;

for (let round = 1; round <= MAX_REFLECT_ROUNDS; round += 1) {
  if (searchBudgetLeft() <= REFLECT_MIN_BUDGET_MS) break;

  const gaps = await reflectFn({
    topic: exactResearchTopic,
    laneMemos: citationsByQuestion.map(toMemo), // 包含此前 gap lanes
    todayLine,
    callJson,
  });
  const novel = selectNovelGaps(gaps, {
    seenGapKeys,
    seenQueryKeys,
    remainingQueries: MAX_FOLLOWUP_QUERIES - followupQueriesUsed,
    maxGaps: MAX_GAPS_PER_ROUND,
  });
  if (novel.length === 0) break;

  // 每轮最多一个 gap；其 facet queries 串行执行，候选已够用即停。
  const rows = await runInternalGapLanes(novel, {
    variantExecution: "sequential_early_stop",
  });
  appendRowsAndStats(rows);
  followupQueriesUsed += sum(rows.queriesPlanned);

  const newUrls = collectNewUniqueUrls(rows, seenEvidenceUrls);
  if (newUrls.length === 0) break;
}
~~~

   - 每轮 `reflectFn` 都必须收到前面新增的 gap lane memo；这是“加长链路”的关键，不能对同一份首轮 memo 连调三次。
   - `runOneLane()` 为内部 gap 增加 `variantExecution="sequential_early_stop"`：一次只执行一个 facet query；每次合并 pool 后复用现有 `enoughCandidates` / lane adopt cap 判定，证据候选已够用则不运行剩余 facet；证据仍薄且总预算允许才执行下一条。主车道现有 wave/concurrency 行为不变。
   - query key 使用 `trim + Unicode lowercase + 连续空白折叠`，description 也做稳定规范化；不能只按 gap id 去重，因为模型每轮可生成新 id。
   - 新证据按规范化 URL 去重；重复命中旧 URL 仍可计入现有统计，但必须触发“无新增证据”停止，避免空转。
   - 总查询上限按实际 `queriesPlanned` 计数；不得仅按 gap 数推算。
   - 保持当前 gap query `skipExpand: true`，不在每个内部 gap 上再做 query expansion。

### 验收标准

- 第一轮补证引出一个新的、依赖前轮证据的问题时，第二轮能看到新增 memo 并继续补搜。
- 一个拥挤 gap 被拆成三条自包含 facet 时按顺序执行；第一条已得到足量候选则只调用一次，第一条证据不足时才执行第二/第三条。
- reflector 连续返回相同 query（即使 gap id 不同）时只搜索一次。
- 补搜只返回已见 URL 时，在该轮后停止，不继续消耗第三轮。
- 三轮、六个实际查询、写作预留预算和 abort 四个硬边界均有测试。
- 主车道现有 early-stop 行为不变。

## FR-4：内部补证不再暴露为读者可见编排

### 修改落点

1. `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`
   - 扩展 `runOneLane()` 参数，增加明确的可见性语义，优先使用枚举而非多个容易漏配的布尔值：

~~~ts
type LaneVisibility = "public" | "internal";

runOneLane({
  ...,
  visibility: "internal",
});
~~~

   - `visibility="internal"` 时禁止产生：`lane_started`、`lane_progress`、`lane_sources`、`lane_done`、memo artifact 及其 `artifact` 事件。
   - 内部车道仍可使用 citation registry、正文抓取、页面归档策略、memo 总结和 research stats；最终报告证据不能因隐藏 UI 而丢失。
   - 主车道默认 `public`，现有事件和 artifacts 行为不得改变。

2. 替换现有公开 reflection 流程
   - 新 run 不再 emit `type="reflection"` 和 gap descriptions。
   - 整个迭代过程只产生一条高层 phase，例如 `phase="reflect", message="正在复核并补充关键证据…"`；轮次、gap 数和具体 query 只进入内部计数，不为每轮追加读者可见叙事。
   - 删除“发现 N 处信息缺口”“针对 N 处缺口补充检索”“证据充分、未发现缺口”等会暴露内部判断或制造重复卡片的叙事。

3. 兼容性
   - `enterprise/apps/web-portal/src/lib/deep-research/run-store.ts` 中已有 event type 不删除。
   - `enterprise/features/chat/src/components/molecules/deep-research-segments.ts` 与 `DeepResearchWorkbench.tsx` 保留旧 `reflection` 事件渲染，以便历史 run 回放；本计划不改协议 schema。

### 验收标准

- 新 run 的事件序列不含 `reflection`，也不含 `gap-*` lane 卡、gap memo artifact 或具体缺口文本。
- 工作台只看到一次“复核并补充关键证据”高层状态，之后进入综合写作。
- 最终 report 的 citation registry 和 research_stats 包含内部补搜贡献的来源/查询计数。
- 旧 fixture 中的 `reflection` 事件仍可正常渲染。

## FR-5：编排与报告回归测试

### 单元测试

1. `enterprise/apps/web-portal/src/lib/deep-research/report-writer.test.ts`
   - fallback outline 不含信息缺口/来源置信度章节。
   - 普通结果型 query 下，模型返回的信息缺口、检索方法和纯推荐/风险章节被过滤，`tradeoff` 被归一。
   - 默认/跳过澄清的 `structured` 不允许 decision；显式 `decision` 或明确决策 query 允许。
   - 明确询问“局限是什么”时 limitations 章节不被过滤。
   - 全部 section 被过滤时回退到非空、结果导向大纲。
   - section messages 包含“不暴露内部检索自评、限定条件就近说明”的约束。

2. `enterprise/apps/web-portal/src/lib/deep-research/delivery-prefs.test.ts`
   - 默认 prompt 不再出现“必须包含信息缺口”。
   - 用户明确选择 `decision` 的 parse 与 label 不变。

3. `enterprise/apps/web-portal/src/lib/deep-research/reflector.test.ts`
   - 单轮只保留一个 gap、每 gap 最多三条 query、无 query gap 丢弃、description/query 去重。
   - prompt 明确要求“影响答案 + 当前未覆盖 + 可检索解决”，并禁止泛化缺口。
   - 拥挤问题只有在包含独立事实面时才拆分，且每条 query 均保留实体、版本/范围等必要锚点。

4. `enterprise/apps/web-portal/src/lib/web-search/__tests__/follow-up.test.ts`（若 helper 保留在 `follow-up.ts`）或新增 `enterprise/apps/web-portal/src/lib/web-search/__tests__/query-plan.test.ts`
   - 普通自动搜索与 reflector 对同一 candidates 得到相同的清洗、去重、顺序和上限结果。
   - `maxSearchCalls=1` 时仍合并为唯一 resolved query，保证普通自动搜索既有行为不回归。

5. `enterprise/apps/web-portal/src/lib/deep-research/research-intent.test.ts`
   - 通用 fallback 关注关键表现/证据/适用条件，不默认生成信息缺口焦点。

### 编排回归

在 `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.test.ts` 增加可控的 `reflectFn` 与 search mock：

1. 首轮发现 gap A → 搜到新证据 → 第二轮收到 gap A memo 并发现依赖 gap B → 搜到新证据 → 第三轮返回空；断言恰好两轮补搜。
2. 第二轮返回与第一轮同义或同 query 的 gap；断言不会重复搜索。
3. 补搜返回的 URL 全部已存在；断言本轮后停止。
4. 一个 gap 含三个 facet：第一条足量时后两条不执行；第一条不足时按序执行下一条，且不并发拥挤请求。
5. 达到 `MAX_REFLECT_ROUNDS`、`MAX_FOLLOWUP_QUERIES`、预算不足、abort 时分别停止。
6. 新事件序列不包含 `reflection`、公开 gap lane 或 memo artifact；只有一条高层 reflect phase。
7. 内部来源进入 evidence pack、citation indexes 和 research_stats。
8. 主车道“首个查询已得到足够来源时不运行延后变体”的既有测试继续通过。

使用中性回归样例，例如“研究某模型的 harness 实际表现”，并让 mock 第一轮补齐公开评测、第二轮补齐评测条件，断言最终大纲只回答表现、证据和条件，不输出“我们对第一份资料有多大把握”。

### 验证命令

~~~bash
cd enterprise
pnpm --filter web-portal exec vitest run \
  apps/web-portal/src/lib/deep-research/report-writer.test.ts \
  apps/web-portal/src/lib/deep-research/delivery-prefs.test.ts \
  apps/web-portal/src/lib/deep-research/reflector.test.ts \
  apps/web-portal/src/lib/deep-research/research-intent.test.ts \
  apps/web-portal/src/lib/deep-research/orchestrator.test.ts \
  apps/web-portal/src/lib/web-search/__tests__/follow-up.test.ts

pnpm --filter web-portal typecheck
pnpm --filter web-portal build
~~~

若仓库已有与本次无关的 typecheck/build baseline 失败，交付说明必须同时给出基线复现结果和本次定向测试结果，不能把既有失败描述为本次通过。

## 实施顺序与可回退提交

按以下功能边界分别提交；每个 commit 只暂存本功能直接修改的文件：

1. `fix(portal): keep research reports focused on requested results`
   - FR-1 + FR-2：报告 policy、兜底大纲、delivery prompt、证据纪律和通用 focus。
2. `feat(portal): iterate evidence gap searches within budget`
   - FR-3：reflector 约束、跨轮去重、有界迭代和停止条件。
3. `refactor(portal): keep research refinement steps internal`
   - FR-4：内部 lane visibility、公开事件收敛、旧事件兼容测试。

提交 subject/body 只描述产品内行为，不写外部产品、客户名称或对标表述。实施 commit trailer 使用：

~~~text
Plan-Id: 2026-08-14-deep-research-results-first-orchestration
Plan-File: .cursor/plans/2026-08-14-deep-research-results-first-orchestration.plan.md
Plan-Model: GPT-5 (Codex)
Impl-Model: gpt5.6sol
Made-with: Damon Li
~~~

## 风险与回滚

| 风险 | 保护措施 | 回滚信号 |
| --- | --- | --- |
| 过滤器误删用户明确要的风险/局限 | policy 同时看原始 query 与 delivery shape；显式意图测试 | 明确风险问题仍无风险章节 |
| 多轮补搜增加耗时/费用 | 3 轮、1 gap/轮、3 facet/gap、6 query 总上限；逐条 early-stop；每轮检查写作预算 | p95 明显上升或频繁触发写作超时 |
| 直接复用会话 rewrite 反而增加一次模型调用 | 只抽共享 query-plan 指令与纯解析 helper；不调用 `resolveStandaloneSearchQuery()` | 每个 gap 在 reflector 之外又出现 rewrite 模型请求 |
| 反思产生重复 query | 规范化 query/description 跨轮 Set 去重 | 同一查询在日志计数中重复执行 |
| 内部 lane 隐藏时误丢证据 | visibility 只控制事件/artifact，不控制 registry/memo/stats | 最终报告引用数低于补搜前或缺少新证据 |
| prompt 约束失效 | 确定性 outline guard 作为最后防线 | 模型返回元章节后仍进入最终 outline |

三笔实施 commit 可按相反顺序独立回退。若 FR-3 出现预算回归，可只回退多轮 loop，FR-1 的结果导向写作仍可保留；若 FR-4 出现工作台进度反馈不足，可恢复公开的单条高层进度，但不得恢复具体 gap description。
