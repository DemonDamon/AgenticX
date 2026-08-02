# Portal 联网搜索：指代追问的实体消解与历史上行清洗

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: gpt-5.6-terra-medium（跨栈收口）；子任务见下表

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1 `follow-up.ts`（指代识别 + 实体消解，纯函数 + 正则） | `kimi-k2.7-code` | 纯字符串/正则模块，边界由 AC 锁死，便宜档够用 |
| FR-2 `tool-loop` / `search-necessity` 接线 | `gpt-5.6-terra-medium` | 改动落在搜索主链路，跳过判定回归风险高 |
| FR-3 历史上行清洗（剥 `<think>` / `[N]`） | `gpt-5.6-terra-medium` | 影响所有联网轮次的上行 payload，序列敏感 |
| FR-4 系统提示分支调整 | `composer-2.5-fast` | 文案级改动 |
| FR-5 测试补齐 | `kimi-k2.7-code` | 按 AC 写断言，样板活 |

---

## 背景与根因（证据链，实施者不必回看对话即可自证）

复现对话（三轮，联网开关常开）：

1. 轮1「你认识宗主吗」→ 搜索「宗主」→ 百科式长答，句末带 `[6][9][23]` 等编号
2. 轮2「我说的是最近比较活人的宗主」→ 搜索该短句 → 命中一条新浪新闻，答「是指 **蔡徐坤**」并标 `[8]`
3. 轮3「他为什么被封为宗主呢」→ **搜索词就是「他为什么被封为宗主呢」** → SERP 全是修仙小说 / 唐宣宗 / 朱棣庙号 → 模型撤回轮2 结论，改答一串小说角色

### 缺陷 D1：追问的搜索词没有实体，代词未消解

`enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` 的 `buildWebSearchQuery`（约 L199-214）只在
「本轮是短补槽 **且** 上一轮用户消息命中 `FOLLOW_UP_INTENT`（天气/新闻/价格…）」时才拼接：

```ts
if (!prev || !isShortFollowUpQuery(last) || !FOLLOW_UP_INTENT.test(prev)) return last;
```

轮3 中 `last = "他为什么被封为宗主呢"`（10 字 ≤ 24 且不含 `FOLLOW_UP_INTENT` → `isShortFollowUpQuery` 为 true），
但 `prev = "我说的是最近比较活人的宗主"` 不含任何 `FOLLOW_UP_INTENT` 词 → 直接 `return last`。
于是把带代词、零实体的整句丢给 Bocha，SERP 必然跑题。**这是首要根因。**

### 缺陷 D2：`[N]` 编号跨轮碰撞，导致模型误判自己在造假并撤回正确答案

每轮 `withSearchContext`（约 L267-278）都把**本轮** hits 重新从 `[1]` 编号注入 system；
而历史 assistant 消息原文保留了**上一轮编号体系**下的 `[8]`。
轮3 的模型推理原文（用户已贴出）写得极清楚：

> 「搜索结果[8]是关于唐宣宗，而不是蔡徐坤 …… 我一定是在之前的回复中虚构了那个信息」

也就是说轮2 大概率**没有**幻觉（当轮 `[8]` 确实是那条新浪新闻），是我们的注入格式让模型拿
**两套不兼容的编号**互相校验，从而做出一次错误的自我否认。这解释了「很抱歉，我需要更正一下」的来源，
比「注意力被稀释」精确得多。

### 缺陷 D3：历史 assistant 的 `<think>` 推理链被原样回传上行

`enterprise/features/chat/src/assistant-content.ts` 把 `<think>…</think>` 存在 `message.content` 内，
仅在**展示时**才切分（`REDACTED_OPEN`/`REDACTED_CLOSE`）。
`enterprise/features/chat/src/store.ts` 的 `toSdkRequest`（约 L271-308）对 assistant 消息直接
`content = message.content`，未剥 `<think>`。
所以轮3 的上行 payload 里带着轮1+轮2 的完整思考链（轮2 那段就是模型反复自我怀疑的长文），
既是真正的上下文膨胀来源，也在语义上给模型示范「要反复推翻自己」。

补充澄清一点 grok 方案里的 C 层：**搜索块不会跨轮叠加**。
客户端从不发送 system 消息（`toSdkRequest` 只发 user/assistant），system 是服务端每轮新建的，
所以不存在「旧搜索块堆叠」，C 层可以不做。

### 缺陷 D4：系统提示没有「结果跑题」的出口，反而强制模型硬编答案

`WEB_SEARCH_SYSTEM_HINT`（约 L46-58）要求「严格基于这些结果作答」「禁止声称无法联网」
「即使某些字段未显示，也要先给出片段中能找到的最接近事实」。
当 SERP 整体跑题时，这段提示把模型逼向「用修仙小说凑一个答案」，正是轮3 输出那份小说清单的直接动因。

### 与工作区已有改动的关系

工作区当前有一批**未提交**的联网上下文预算改动（`rerank.ts` / `context-budget.ts` /
`tool-loop.ts` / 来源面板 `usedByModel` 分区），本 plan 建立在其之上，不回退这些改动。
注意：预算变大后跑题 SERP 注入得更多，D1 的伤害被放大——所以 D1 必须修。

---

## 目标与非目标

### In scope

- 指代类追问的实体消解，与「消解不出实体时跳过搜索」
- 上行历史清洗：剥 `<think>`、剥历史 `[N]`
- 系统提示增加跑题出口 + `[N]` 仅限本轮的说明
- 上述四项的单测

### Out of scope（no-scope-creep 边界）

- 不改 `rerank.ts` / `context-budget.ts` 的排序与预算算法
- 不动 `desktop/`、`admin-console`、任何 Machi 侧代码
- 不改联网开关关闭时的直连路径（`route.ts` 未走 `runWebSearchTurn` 的分支）
- 不引入 LLM 改写 query（不加一次额外模型调用），只做规则消解
- 不改数据库落盘的消息内容（`<think>` / `[N]` 仍原样入库，仅上行副本清洗）

---

## FR-1 新增 `follow-up.ts`：指代追问识别 + 实体消解

**文件（新建）**：`enterprise/apps/web-portal/src/lib/web-search/follow-up.ts`

导出三个纯函数：

```ts
/** 代词 / 指代 / 回指标记。u flag 必需（用了 \p{L}）。 */
const REFERENTIAL_MARKER =
  /(^|[^\p{L}])(他|她|它|他们|她们|这个|那个|这位|那位|这人|那人|此人|该人|上面(说)?的|刚才(说)?的|你刚(才)?说|你说的|前面(说)?的|这事|那件事)/u;

/** 自带实体的迹象：书名号 / 引号 / 连续 ASCII 词（品牌名、型号）。 */
const SELF_CONTAINED_ENTITY = /《[^》]{1,30}》|「[^」]{1,30}」|“[^”]{1,30}”|[A-Za-z][A-Za-z0-9.\-]{2,}/u;

export function isReferentialFollowUp(query: string): boolean;
export function extractEntityFromHistory(messages: ChatMessage[]): string;
export function resolveFollowUpQuery(messages: ChatMessage[]): { query: string; entity: string } | null;
```

### `isReferentialFollowUp(query)`

- `query.trim()` 为空或长度 > 40 → `false`
- 命中 `SELF_CONTAINED_ENTITY` → `false`（本身自带实体，不算指代追问）
- 命中 `REFERENTIAL_MARKER` → `true`
- 否则 `false`

### `extractEntityFromHistory(messages)`

从后向前遍历，取最近一条 **assistant** 消息（`content` 非空），按顺序尝试：

1. 剥 `<think>…</think>`（含未闭合：出现 `<think>` 但无 `</think>` 时整段丢弃）
2. 第一个 `**粗体**` 片段，去掉首尾符号后长度在 `2..20` → 命中即返回
3. 第一个 `《…》` / `「…」` / `“…”` 片段，长度 `2..20` → 命中即返回
4. 都没有 → 返回 `""`

**顺序很重要**：宗主案例里 `“宗主”` 出现在 `**蔡徐坤**` 之前，先取粗体才能拿到人名而不是话题词。
参考轮2 答案原文首句：`根据搜索结果，最近网络上比较活跃、被称为"宗主"的应该是指**蔡徐坤**。`

### `resolveFollowUpQuery(messages)`

- `last = extractLastUserQuery(messages)`（复用 `tool-loop.ts` 的导出）
- 非 `isReferentialFollowUp(last)` → 返回 `null`（交给原有 `buildWebSearchQuery` 逻辑）
- `entity = extractEntityFromHistory(messages)`
- `entity` 为空 → 返回 `{ query: "", entity: "" }`（调用方据此跳过搜索）
- 否则返回 `{ query: sanitizeWebSearchQuery(\`${entity} ${last}\`), entity }`

宗主案例期望：`{ query: "蔡徐坤 他为什么被封为宗主呢", entity: "蔡徐坤" }`

**AC-1**（`__tests__/follow-up.test.ts`）：

- `isReferentialFollowUp("他为什么被封为宗主呢") === true`
- `isReferentialFollowUp("广州南沙天气如何") === false`
- `isReferentialFollowUp("《三体》讲了什么") === false`（自带实体）
- `isReferentialFollowUp("GPT-5 为什么这么强") === false`（ASCII 实体）
- `extractEntityFromHistory` 对 `[{role:"assistant",content:'<think>纠结…</think>…被称为"宗主"的应该是指**蔡徐坤**。'}]` 返回 `"蔡徐坤"`
- `resolveFollowUpQuery` 在无 assistant 历史时返回 `{ query: "", entity: "" }`
- `resolveFollowUpQuery("广州南沙天气如何" 场景) === null`

---

## FR-2 `tool-loop` 接线：先消解，消解不出就跳过搜索

**文件**：`enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts`（`runWebSearchTurn`，约 L572-600）
**文件**：`enterprise/apps/web-portal/src/lib/web-search/search-necessity.ts`

1. `search-necessity.ts` 的 `WebSearchSkipReason` 新增成员 `"referential_no_entity"`。
   `classifyWebSearchNeed` **本体不改**（保持 allowlist 语义），新 reason 由 `tool-loop` 构造。

2. `runWebSearchTurn` 内，在现有 `const query = buildWebSearchQuery(originalMessages);` 处改为：

```ts
const resolved = resolveFollowUpQuery(originalMessages);
const query = resolved ? resolved.query : buildWebSearchQuery(originalMessages);
```

3. 在现有 `if (skip && skip.need === "skip")` 分支**之前**插入：

```ts
// 指代追问但历史里消解不出实体 → 本轮不搜（搜代词只会得到跑题 SERP），
// 直接基于对话上下文作答。
if (!webSearchAlwaysOn() && resolved && !resolved.entity) {
  console.info("[web-search] skipped search-first (reason=referential_no_entity)");
  // 走与 skip 分支相同的上行逻辑
}
```

实施建议：把 skip 分支的上行代码抽成局部函数 `respondWithoutSearch()` 复用，避免复制粘贴两份
`callGatewayStream` + `withTrivialTurnContext`。

4. 消解成功时打日志：`console.info(\`[web-search] follow-up resolved entity=${resolved.entity}\`)`。

**AC-2**（`__tests__/tool-loop.test.ts`）：

- 三轮消息（轮2 assistant 含 `**蔡徐坤**`，轮3 user 为「他为什么被封为宗主呢」）时，
  `executeSearch` 收到的 query **包含** `"蔡徐坤"`
- 同样三轮但把轮2 assistant 换成不含任何粗体/引号的纯文本时，`executeSearch` **未被调用**，
  且上行 messages 不含 `--- 联网搜索结果 ---`
- 「广州南沙天气如何」单轮场景 query 仍为原句（不回归 FR 既有行为）
- `AGENTICX_WEB_SEARCH_ALWAYS=1` 时上述跳过不生效

---

## FR-3 上行历史清洗：剥 `<think>` 与历史 `[N]`

**文件（新建）**：`enterprise/apps/web-portal/src/lib/web-search/history-sanitize.ts`

```ts
/** 上行前清洗历史 assistant 消息：推理链与旧编号都不该进模型上下文。 */
export function sanitizeHistoryForUpstream(messages: ChatMessage[]): ChatMessage[];
```

规则（只作用于 `role === "assistant"` 的消息，user/system 原样保留）：

1. 剥 `<think>…</think>`（大小写不敏感）；出现 `<think>` 但无闭合标签时，丢弃 `<think>` 起至末尾
2. 剥引用编号：`content.replace(/\[(\d{1,3})\]/g, "")`，随后把产生的多余空格折叠为单空格
3. 若清洗后 `content.trim()` 为空 → 该消息**整条剔除**（避免上游拒收空 assistant，
   与既有 `stripEmptyAssistantMessages` 语义一致）

**接线**：`runWebSearchTurn` 内 `originalMessages` 赋值处（约 L551）改为在
`stripEmptyAssistantMessages(...)` 外再包一层 `sanitizeHistoryForUpstream(...)`，
使搜索路径、跳过路径、降级路径都受益。

**取舍说明（写进代码注释）**：剥掉历史 `[N]` 后，用户若追问「你刚才第 3 条引用的是什么」模型无法回答；
这是有意取舍——跨轮编号本身已不可靠（每轮重新编号），保留它造成的误判（D2）远大于这点损失。
数据库与前端展示不受影响，来源面板仍按每条消息自己的 `web_search_sources` 渲染。

**AC-3**（`__tests__/history-sanitize.test.ts`）：

- `<think>abc</think>正文[1]` → `正文`
- 未闭合 `正文<think>abc` → `正文`
- 只有 `<think>…</think>` 的 assistant 消息被整条剔除
- user 消息中的 `[1]` 与 `<think>` **不**被改动
- `[12]` / `[123]` 也被剥除；`[abc]`、`[]` 不受影响

---

## FR-4 系统提示：给跑题出口 + 声明 `[N]` 仅限本轮

**文件**：`enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts`，`WEB_SEARCH_SYSTEM_HINT`（约 L46-58）

在现有文案**末尾**追加两句（不删除既有约束，避免回退此前天气类回答的修复）：

```
"下方 [N] 编号仅对应本轮搜索结果；对话历史中出现过的编号属于往轮、已失效，" +
"禁止拿历史编号与本轮结果互相比对，也不要因编号对不上而推翻自己此前的结论。" +
"若本轮结果整体与用户问题无关（例如检索词被泛化、命中的都是同名的其他事物），" +
"须直接说明「本次检索结果与问题无关」，随后基于对话上下文已确认的事实作答，" +
"禁止用无关结果拼凑答案或改写此前结论。"
```

**AC-4**：`__tests__/tool-loop.test.ts` 断言 `WEB_SEARCH_SYSTEM_HINT` 同时包含
`"仅对应本轮搜索结果"` 与 `"与问题无关"`，且注入后的 system 文本包含这两段。

---

## FR-5 回归与人工验收

**AC-5**：以下命令全绿（在 `enterprise/` 下）

```bash
pnpm --filter @agenticx/web-portal test -- src/lib/web-search
pnpm --filter @agenticx/web-portal exec tsc --noEmit
```

（既有 portal `next build` 会因仓库已有的 eslint `react-hooks/exhaustive-deps` 规则缺失而报错，
与本次改动无关，不作为验收门槛。）

**AC-6**（人工，需重启 portal）：复现宗主三轮对话

1. 轮3 服务端日志出现 `[web-search] follow-up resolved entity=蔡徐坤`
2. 轮3 回答不再出现「很抱歉，我需要更正一下」式自我撤回
3. 若 SERP 仍不相关，回答须明说「本次检索结果与问题无关」而非罗列小说角色
4. 轮1「你好」等寒暄仍跳过搜索（不回归 `greeting` 分支）
5. 单轮「广州南沙天气如何」仍给出温度/湿度等具体事实（不回归天气修复）

---

## 提交约定

- 与本 plan 一起提交；实施前把本文件从 `.cursor/plans/pending/` 移回 `.cursor/plans/` 根目录
- Trailer：`Plan-Id: 2026-08-02-portal-followup-search-grounding` /
  `Plan-File: .cursor/plans/2026-08-02-portal-followup-search-grounding.plan.md` /
  `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`
- 工作区已有的联网上下文预算改动应先独立成一次 commit，再叠本 plan 的实现，便于回溯
