# Portal 联网搜索时效性与事实落地（Bocha freshness + 发布时间透传）

Planned-with: Claude Opus 5 (thinking)
Suggested-Impl-Model: composer-2.5-fast（纯后端参数透传 + 纯函数分级 + 单测，改动面小、无跨栈风险；若实施方顺带触碰 SSE 或 orchestrator，请升到 codex 档）

## 背景

Enterprise 前台（web-portal）问「广州南沙天气如何」时，回答退化为"你去某网站看"或给出与当日不符的天气。此前已修过两轮（多轮上下文拼接 query、强化 SYSTEM_HINT 禁止甩链接），但单轮直问仍不理想。

## 证据链（2026-08-02 实测，非推测）

1. **Bocha 已生效，不是配置没落地。**
   - MySQL `agenticx.enterprise_runtime_web_search`：`tenant_id=01J00000000000000000000001, enabled=1, provider=bocha, api_key_cipher` 长度 96，`max_results=50`，`updated_at=2026-08-01 05:35`。
   - `enterprise/.env.local` 的 `DEFAULT_TENANT_ID` 与该行 `tenant_id` 一致；`route.ts:162/176` 用 `session.tenantId` 加载租户行，命中后 `resolveWebSearchConfig` 优先租户行而非 env（`config.ts:24-31`），故运行时 provider 确为 bocha。
   - 用库内密钥直连 `https://api.bochaai.com/v1/web-search` 返回 `200`，密钥有效（`sk-` 前缀，长度 35）。

2. **真正的根因是 query 缺时效词导致命中陈旧快照。** 同一 provider、同一时刻：

   | 请求 | 首条结果 |
   |---|---|
   | `广州南沙天气如何`（单轮原样） | 「广州南沙天气」，内容为 **2025-02-10** 快照（21℃ 晴、湿度 39%） |
   | `广州南沙 今天天气怎么样`（多轮拼接后） | 「2026年08月02日广州天气预报」，中雨 29/23°C |

   即单轮直问拿到的是一年半前的页面。模型要么照抄陈旧数据（更危险），要么察觉不可靠后改为甩链接——这正是截图里的表现。

3. **两个 Bocha 参数能直接修掉，已实测：**
   - `freshness: "oneDay"`：`广州南沙天气如何` 原样 query 也返回当日结果（`datePublished=2026-08-02T00:00:00+08:00`，中雨 29/23°C）。
   - `summary: true`：snippet 显著变长，含逐日预报（08/02 中雨 29/23、08/03 中雨转雷阵雨、08/04 大雨转雷阵雨 30/2x）——事实密度足够模型结构化作答。
   - 响应本就带 `datePublished`，当前 `searchBocha`（`providers.ts:212-220`）**全部丢弃**，模型无从判断结果新旧。

4. **Bocha 失败会静默回落 DuckDuckGo**（`providers.ts:282-287` catch 后 `return searchDuckDuckGo(...)`），无任何日志，排障时无法区分"用了 bocha"与"回落了"。本次排查耗时主要花在这里。

结论：**不新增天气专用数据源**（与 Kimi 自述一致：它也只靠网页搜索）。差距在时效性控制与结果元数据，而非数据源类型。

## In scope

仅 `enterprise/apps/web-portal/src/lib/web-search/` 下：`providers.ts`、新增 `freshness.ts`、`tool-loop.ts` 的 `compactHitsForModel` 与 `WEB_SEARCH_SYSTEM_HINT`，及对应 `__tests__`。

## Out of scope（no-scope-creep 边界）

- 不接入 Open-Meteo / 气象局等专用天气 API，不做 geocoding。
- 不改 DuckDuckGo 的 HTML/Lite 解析逻辑，不改 Tavily 请求体（其 `topic`/`days` 留待后续）。
- 不改 `search-necessity.ts`（跳过搜索的判定）与 `buildWebSearchQuery`（多轮拼接）——这两处上两轮已验收。
- 不改 `deep-research/orchestrator.ts`：它复用 `executeWebSearch`，自动继承本次收益，不额外接线。
- 不改前端 SSE / sources UI 渲染。

## 需求

### FR-1（P0）searchBocha 传 `freshness` + `summary`，并透传发布时间

落点：`enterprise/apps/web-portal/src/lib/web-search/providers.ts`，`searchBocha`（现 194-221 行）。

Before（现状要点）：

```ts
async function searchBocha(query, maxResults, apiKey, fetchImpl) {
  const response = await fetchImpl("https://api.bochaai.com/v1/web-search", {
    ...
    body: JSON.stringify({ query, count: maxResults }),
  });
  ...
  const values = json.data?.webPages?.value ?? [];
  return values.slice(0, maxResults).map((item) => ({
    title: ..., url: ..., snippet: truncateSnippet(String(item.snippet ?? "")),
  })).filter((hit) => hit.url);
}
```

After（意图）：

```ts
async function searchBocha(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchLike,
  freshness?: BochaFreshness,      // 新增，undefined 时不写入 body
): Promise<WebSearchHit[]> {
  const payload: Record<string, unknown> = { query, count: maxResults, summary: true };
  if (freshness) payload.freshness = freshness;
  // ...fetch 同前，body: JSON.stringify(payload)
  const json = (await response.json()) as {
    data?: {
      webPages?: {
        value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string; datePublished?: string }>;
      };
    };
  };
  return values.slice(0, maxResults).map((item) => ({
    title: String(item.name ?? "").trim() || item.url || "Untitled",
    url: String(item.url ?? "").trim(),
    // summary 更完整，优先；缺失回落 snippet
    snippet: truncateSnippet(String(item.summary ?? item.snippet ?? "")),
    publishedAt: String(item.datePublished ?? "").trim() || undefined,
  })).filter((hit) => hit.url);
}
```

注意：`summary: true` 会让 snippet 变长，`truncateSnippet` 默认上限 `DEFAULT_SNIPPET_CHARS = 600` 保持不变，不要调大。

### FR-2（P0）`WebSearchHit` 增 `publishedAt`，`formatHits` 输出发布时间

落点：同文件 `WebSearchHit`（现 11-15 行）与 `formatHits`（现 252-257 行）。

```ts
export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** ISO8601，provider 提供时才有（当前仅 Bocha）。 */
  publishedAt?: string;
};

export function formatHits(hits: WebSearchHit[]): string {
  if (hits.length === 0) return "No search results found.";
  return hits
    .map((hit, index) => {
      const date = hit.publishedAt ? `\n发布时间: ${hit.publishedAt}` : "";
      return `[${index + 1}] ${hit.title}\nURL: ${hit.url}${date}\n${hit.snippet}`;
    })
    .join("\n\n");
}
```

`publishedAt` 必须是可选字段，DDG/Tavily 分支不构造它，避免改动这两个 provider。

### FR-3（P0）新增 `freshness.ts`：按 query 推导时效档位

新建 `enterprise/apps/web-portal/src/lib/web-search/freshness.ts`：

```ts
export type BochaFreshness = "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | "noLimit";

/** 强时效：当日数据才有意义。 */
const ONE_DAY = /天气|气温|温度|湿度|风力|降雨|降水|台风|空气质量|实时|今天|今日|现在|此刻|股价|汇率|金价|油价|比分|赛况|开盘|收盘/;
/** 中时效：一周内。 */
const ONE_WEEK = /新闻|头条|最新|近期|发布|上线|财报|季报|公告|版本|更新日志|release/i;

/**
 * 无匹配返回 undefined = 不加 freshness 约束（等价 noLimit），
 * 避免对「XX 是谁」这类稳定事实误加时间窗导致召回变差。
 */
export function resolveFreshness(query: string): BochaFreshness | undefined {
  const q = query.trim();
  if (!q) return undefined;
  if (ONE_DAY.test(q)) return "oneDay";
  if (ONE_WEEK.test(q)) return "oneWeek";
  return undefined;
}
```

### FR-4（P0）`executeWebSearch` 接线

落点：`providers.ts` `executeWebSearch`（现 259-288 行）。在函数内计算一次并传入 bocha 分支：

```ts
const freshness = resolveFreshness(q);
// ...
if (provider === "bocha") {
  if (!cfg.apiKey.trim()) throw new Error("bocha api key missing");
  const hits = await searchBocha(q, n, cfg.apiKey, fetchImpl, freshness);
  if (hits.length > 0) return hits;
}
```

Tavily / DuckDuckGo 分支签名与行为不变。`import { resolveFreshness } from "./freshness";` 放在文件顶部 import 区（遵守 no-inline-imports）。

### FR-5（P0）`compactHitsForModel` 保留 `publishedAt`

落点：`enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts:248-254`。该函数当前显式重建对象，会把 FR-2 的字段抹掉，必须补：

```ts
export function compactHitsForModel(hits: WebSearchHit[]): WebSearchHit[] {
  return hits.slice(0, WEB_SEARCH_CONTEXT_HIT_LIMIT).map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: truncateSnippet(hit.snippet, WEB_SEARCH_CONTEXT_SNIPPET_CHARS),
    publishedAt: hit.publishedAt,
  }));
}
```

`WEB_SEARCH_CONTEXT_SNIPPET_CHARS = 320` 保持不变（实测足够容纳逐日预报行）。

### FR-6（P1）SYSTEM_HINT 增补陈旧数据处置规则

落点：`tool-loop.ts:40-50` 的 `WEB_SEARCH_SYSTEM_HINT`，**在末尾追加一句**，不要重写既有句子（既有句子已被 `tool-loop.test.ts:89-96` 断言覆盖）：

```
"部分结果附带「发布时间」。若其与系统提示的当前时间相差较大（例如非同一天的天气、非近期的行情），须明确标注该数据的日期并说明可能已过时，禁止把历史数据当作今日事实陈述。"
```

### FR-7（P1）Bocha/Tavily 静默回落加可观测日志

落点：`providers.ts:282-285` 的 catch。当前空 catch 直接回落，改为：

```ts
} catch (error) {
  if (provider === "duckduckgo") throw error;
  console.warn(
    `[web-search] provider=${provider} failed, falling back to duckduckgo:`,
    error instanceof Error ? error.message : String(error),
  );
}
```

禁止打印 `cfg.apiKey` 或完整请求体。

## 验收标准

- **AC-1**（FR-1/FR-4）`enterprise/apps/web-portal/src/lib/web-search/__tests__/providers.test.ts` 新增用例：以 mock fetch 调 `executeWebSearch("广州南沙天气如何", 5, { provider: "bocha", apiKey: "k", maxResults: 5 }, mock)`，断言请求体 JSON 含 `summary: true` 且 `freshness === "oneDay"`；再用 `executeWebSearch("OpenAI 是谁创办的", ...)` 断言请求体**不含** `freshness` 键。
- **AC-2**（FR-1）同文件用例：mock 返回 `{ data: { webPages: { value: [{ name:"t", url:"https://a", snippet:"s", summary:"long-summary", datePublished:"2026-08-02T00:00:00+08:00" }] } } }`，断言 `hits[0].snippet === "long-summary"`、`hits[0].publishedAt === "2026-08-02T00:00:00+08:00"`。
- **AC-3**（FR-3）新建 `__tests__/freshness.test.ts`：`resolveFreshness("广州南沙天气如何") === "oneDay"`；`resolveFreshness("英伟达最新财报") === "oneWeek"`；`resolveFreshness("勾股定理证明") === undefined`；`resolveFreshness("") === undefined`。
- **AC-4**（FR-2）`providers.test.ts`：`formatHits([{title:"t",url:"https://a",snippet:"s",publishedAt:"2026-08-02T00:00:00+08:00"}])` 输出含 `发布时间: 2026-08-02T00:00:00+08:00`；无 `publishedAt` 时输出**不含**「发布时间」。
- **AC-5**（FR-5）`__tests__/tool-loop.test.ts`：`compactHitsForModel([{...publishedAt:"2026-08-02T00:00:00+08:00"}])[0].publishedAt` 仍存在。
- **AC-6**（FR-6）`tool-loop.test.ts`：`expect(WEB_SEARCH_SYSTEM_HINT).toContain("发布时间")` 且既有 89-96 行断言仍全绿。
- **AC-7** 全量绿：`pnpm -C enterprise/apps/web-portal test` 与 `pnpm -C enterprise/apps/web-portal typecheck` 均通过。
- **AC-8**（人工回归，需真实 Bocha key）本地起 `bash enterprise/scripts/start-dev-with-infra.sh`，前台新开会话直接问「广州南沙天气如何」，回答须包含当日（今日日期）的天气状况与温度区间，且不以「建议访问某网站」收尾。

## 风险与回滚

- `freshness=oneDay` 可能在冷门地区/冷门话题下把召回压到 0。缓解：`executeWebSearch` 现有逻辑在 `hits.length === 0` 时已回落 DuckDuckGo（`providers.ts:274/287`），无需额外分支。若后续观察到召回下降，可退化为"先不带 freshness 查一次、结果全部超过 N 天再带 freshness 重查"，但本次不做（避免翻倍请求）。
- `summary: true` 是否消耗更多 Bocha 额度需留意计费口径；如需关闭，单点回滚 FR-1 的 `payload.summary`。
- 全部改动集中在 4 个文件 + 1 个新文件，回滚 = revert 单个 commit。
