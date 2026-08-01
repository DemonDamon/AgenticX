# Enterprise 前台：多轮检索补全 query + grounded 直接作答

Planned-with: cursor-grok-4.5-high-fast

Suggested-Impl-Model: composer-2.5-fast

> 本计划为自包含实施说明：实施者无需阅读规划对话，仅凭本文件即可落地。

## 目标

1. 多轮对话里用户用短句补槽（如先问天气、再答「广州南沙」）时，搜索词要带上上一轮意图，搜到「广州南沙天气」而非南沙百科/政府网。
2. 有搜索结果时，模型须直接提炼温度/天气等事实作答（对齐 Kimi），禁止只甩「去某某网站查看」的渠道清单。

## 根因与证据链

### 问题 A：多轮丢意图（图 2 / 图 3）

`enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` 的 `extractLastUserQuery`（约 `:155`）**只取最后一条 user 消息**：

```ts
export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text) return sanitizeWebSearchQuery(text);
  }
  return "";
}
```

`runWebSearchTurn`（约 `:488`）把该字符串原样交给 `executeWebSearch`。因此：

- 轮 1 user：`今天天气怎么样`（或类似）→ 助手追问城市
- 轮 2 user：`广州南沙`
- 实际搜索词：`广州南沙` → SERP 变成百度百科/南沙区政府（图 3），无天气预报

Kimi 单轮「广州南沙天气如何」之所以顺，是因为 query 本身已含「天气」意图。

### 问题 B：有结果却推渠道（图 4）

`WEB_SEARCH_SYSTEM_HINT`（`tool-loop.ts:40`）只要求「严格基于这些结果作答 / 禁止声称无法联网」，**没有禁止「推荐查询渠道」式甩链**，也没有要求提炼可核验事实。模型面对天气站落地页 SERP 时，会退化成「请打开 weather.com.cn」。

## In scope

- 新增 `buildWebSearchQuery(messages)`：短句补槽时拼接上一轮 user 意图。
- `runWebSearchTurn` 用该函数替换裸 `extractLastUserQuery` 作为 **搜索词**（skip 判定仍用原 last-user + raw，避免寒暄误伤）。
- 收紧 `WEB_SEARCH_SYSTEM_HINT`：强制提炼事实、禁止只推外链清单。
- 单测覆盖多轮 query 与 hint 文案。

## Out of scope

- 不引入 LLM 改写搜索词（额外往返）。
- 不改搜索 provider、不抓取落地页全文、不做 Desktop。
- 不改前端 sources 面板 UI。
- 不改深度调研 orchestrator。

## FR / NFR

### FR-1：上下文搜索词

新建（或同文件导出）纯函数：

```ts
/** True when last user turn looks like a slot-fill, not a full question. */
export function isShortFollowUpQuery(query: string): boolean;

/**
 * Search keywords for the current turn.
 * - Default: last user text (sanitized), same as extractLastUserQuery today.
 * - When last user is a short follow-up and a previous user turn exists,
 *   return sanitize(`${last} ${prev}`) so SERP keeps prior intent
 *   (e.g. 「广州南沙」+「今天天气怎么样」→「广州南沙 今天天气怎么样」).
 */
export function buildWebSearchQuery(messages: ChatMessage[]): string;
```

`isShortFollowUpQuery` 规则（须实现）：

1. `trim` 后为空 → false。
2. 长度 > 24 → false（与寒暄 skip 护栏对齐）。
3. 若已含明确意图词则 **不算** 补槽（避免重复拼接）：  
   `/天气|气温|温度|湿度|预报|新闻|头条|价格|股价|汇率|怎么样|如何|多少|最新|查询|搜索|财报|官网|是谁|哪里|哪个/`
4. 其余短句 → true（地名、人名、型号、简单确认词等）。

`buildWebSearchQuery`：

1. 从 messages 自后向前收集 user 文本（经 `sanitizeWebSearchQuery`），最多取最近 2 条。
2. `last` 为空 → `""`。
3. 若 `!isShortFollowUpQuery(last)` 或没有 `prev` → 返回 `last`。
4. 否则返回 `sanitizeWebSearchQuery(\`${last} ${prev}\`)`（补槽在前，利于 SERP）。

落点：`tool-loop.ts` 在 `extractLastUserQuery` 之后新增上述两个导出；`runWebSearchTurn` 内：

```ts
const queryForSkip = extractLastUserQuery(originalMessages);
const query = buildWebSearchQuery(originalMessages); // 用于 executeWebSearch
// skip 判定继续用 queryForSkip + rawQuery（保持寒暄 skip 行为）
const skip = webSearchAlwaysOn()
  ? null
  : classifyWebSearchNeed({ query: queryForSkip, rawQuery: extractLastUserRawText(originalMessages) });
// ...
hits = await searchFn(query, undefined, cfg); // 注意：这里用 buildWebSearchQuery 的结果
```

### FR-2：grounded 提示强制直接作答

改 `WEB_SEARCH_SYSTEM_HINT`（同文件顶部常量）为（完整替换字符串，勿只追加一半）：

```ts
export const WEB_SEARCH_SYSTEM_HINT =
  "系统已完成联网搜索，并将结果附在下方。请严格基于这些结果作答；事实句末用 [N] 标注来源编号。" +
  "必须直接提炼并给出可核验事实（如天气状况、气温、湿度、风力、时间、价格、版本号等），用简洁结构化表述回复用户。" +
  "禁止只罗列网站名称、禁止让用户自行打开链接查看；禁止输出「推荐查询渠道」式清单来代替答案。" +
  "若片段不足以完全回答，先基于已有信息尽力汇总，并明确哪些字段不确定；仍禁止声称无法联网。" +
  "例外：当前公历日期、星期、时刻必须以系统提示「当前时间」章节为准，禁止用搜索结果覆盖本机日期。" +
  "禁止输出任何工具调用 XML/标签（包括 minimax:tool_call、<invoke>、tool_call 等）。";
```

### NFR

- 不增加 LLM 往返；纯字符串规则。
- 信息类完整问句（「广州南沙天气如何」）行为不变：仍只搜该句。
- 寒暄 skip / datetime skip / ALWAYS 开关零回归。

## 验收标准（AC）

新增/扩展 `enterprise/apps/web-portal/src/lib/web-search/__tests__/tool-loop.test.ts`（或并列 `search-query.test.ts`）：

- **AC-1**：`buildWebSearchQuery` 对  
  `[{role:user, content:"今天天气怎么样"}, {role:assistant, content:"请问哪个城市？"}, {role:user, content:"广州南沙"}]`  
  返回包含「广州南沙」且包含「天气」的字符串（推荐精确：`广州南沙 今天天气怎么样`）。
- **AC-2**：单轮 `[{role:user, content:"广州南沙天气如何"}]` → 等于 `广州南沙天气如何`（不重复拼接）。
- **AC-3**：`isShortFollowUpQuery("广州南沙") === true`；`isShortFollowUpQuery("广州南沙天气如何") === false`。
- **AC-4**：`WEB_SEARCH_SYSTEM_HINT` 含「禁止只罗列网站」或「推荐查询渠道」，且仍含「禁止声称无法联网」语义（「禁止声称无法联网」或等价「仍禁止声称无法联网」）。
- **AC-5**：既有 tool-loop / search-necessity / current-time 测例全绿；`runWebSearchTurn` 在多轮消息上调用 `executeSearch` 时传入的 query 为上下文拼接结果（可在现有桩上加一条集成用例）。

验收命令：

```bash
cd enterprise/apps/web-portal
pnpm exec vitest run src/lib/web-search/__tests__ src/lib/__tests__/current-time.test.ts
```

## 实施步骤

1. 实现 `isShortFollowUpQuery` + `buildWebSearchQuery` + 测例 AC-1~3。
2. 接线 `runWebSearchTurn`（搜索词 vs skip 判定分流）+ AC-5。
3. 替换 `WEB_SEARCH_SYSTEM_HINT` + AC-4。
4. 跑 vitest；手工：多轮「查天气」→「广州南沙」看 sources 是否含天气站；单轮「广州南沙天气如何」看是否直接给气温而非渠道清单。

## 风险与回退

| 风险 | 缓解 |
|---|---|
| 短句误拼导致 query 变噪 | 长度≤24 + 意图词否决；完整问句不拼接 |
| SERP 本身无气温片段时仍答不好 | 提示只能约束模型；provider/落地页抓取另立 plan |
| 提示过严影响其它题型 | 文案保留「基于结果 / 不足则说明不确定」 |
