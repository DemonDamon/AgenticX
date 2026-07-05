---
name: agenticx-query-data-source
description: Use when the user asks about verifiable quantitative facts (stock prices, financial indicators, macro data, company registry, academic metrics, legal statutes) that must come from a live data source rather than training memory.
metadata:
  author: AgenticX
  version: "1.0.0"
---

# Query Data Source

## When to use

- Any question about **stock price**, **financial indicators**, **macro economic data**, **company registry**, **academic citation counts**, or **legal statute text** that has a real, checkable current value.
- **Do NOT** answer from training memory for these categories — training data is stale and the user can verify against a real source.
- Call `list_data_sources` first when unsure which plugin or API fits (optional `domain`: `finance` / `macro` / `academic` / `enterprise` / `legal`).

## How to call

1. `list_data_sources(domain="finance")` — discover enabled plugins and `api_name` values.
2. `query_data_source(data_source_name=..., api_name=..., params={...})` — fetch structured JSON.
   - **Default chart window: `days: 60` (≈3 个月交易日).** A candlestick chart with only 5–10 bars
     looks sparse/empty in the chat widget, so this is the default for any "走势/行情/表现如何"
     style question — including casual phrasing like "最近一周走势" (interpret as "show me how it's
     been doing lately", not literally 5 trading days).
   - Only request a shorter window when the user gives an **unambiguous analytical** ask for an
     exact short range (e.g. "对比昨天和前天的收盘价" or "最近3个交易日的具体数字"). Map common asks:
     `1个月→days:20`, `3个月→days:60`（默认）, `6个月→days:120`, `1年→days:250`.
3. For **time-series** results (price history, macro trend), **must** follow with `show_widget`:
   - Prefer structured JSON (Desktop renders via ECharts):
   - **The top-level `"type": "stock_chart"` field is MANDATORY.** Omitting it makes the
     Desktop client treat the payload as a generic HTML widget and render the raw JSON
     text instead of a chart — always double-check this field is present before calling
     `show_widget`.

**Single stock:**

```json
{
  "type": "stock_chart",
  "title": "火炬电子 603678",
  "chart_type": "candlestick",
  "data_source_label": "获取数据 | AkShare（免费行情）",
  "points": [
    {"date": "2026-07-01", "open": 80, "high": 90, "low": 78, "close": 85, "volume": 120000}
  ],
  "attribution": "数据来源：AkShare"
}
```

**Multiple focused stocks (Kimi-style tabs — user can switch 火炬电子 / 祥鑫科技 / 天齐锂业):**

```json
{
  "type": "stock_chart",
  "data_source_label": "获取数据 | AkShare（免费行情）",
  "attribution": "数据来源：AkShare",
  "watchlist": [
    {
      "symbol": "603678.SH",
      "name": "火炬电子",
      "chart_type": "candlestick",
      "points": [{"date": "2026-07-03", "open": 81.26, "high": 89.4, "low": 77.93, "close": 85.48, "volume": 42942215}]
    },
    {
      "symbol": "002965.SZ",
      "name": "祥鑫科技",
      "chart_type": "candlestick",
      "points": [...]
    },
    {
      "symbol": "002466.SZ",
      "name": "天齐锂业",
      "chart_type": "candlestick",
      "points": [...]
    }
  ]
}
```

When the user mentions several tickers they are tracking, fetch each via `query_data_source` and pass **one** `show_widget` with a `watchlist` array — do not render three separate widgets.

   - Macro trends: same shape with `"chart_type": "line"` and points like `{"date": "2021", "value": 8.1}`.
4. **Workflow** (same as show_widget discipline): 1–3 sentences visible intro → `query_data_source` → `show_widget` → interpret numbers from tool output only.

## Example calls

| User intent | data_source_name | api_name | params notes |
|---|---|---|---|
| A-share K-line / recent trend | `akshare` | `stock_price_history` | `symbol`: **6-digit code without exchange suffix** (e.g. `603678`, not `603678.SH`); `market`: `a`; `days`: **60 default** (3 个月), 20/120/250 for 1mo/6mo/1yr |
| A-share snapshot | `akshare` | `stock_realtime_quote` | `symbol`: `603678` |
| China / global macro | `world_bank` | see `list_data_sources` | country/indicator codes from API schema |
| IMF indicators | `imf` | see `list_data_sources` | per plugin schema |
| Tushare (needs MCP) | `tushare` | per MCP tools | requires connected `tushareMcp` in settings |
| iFinD (enterprise) | `ifind` | per plugin | credential-gated; often unavailable on desktop |

Map `query_data_source` OHLCV rows to `stock_chart.points` (normalize date/open/high/low/close/volume field names from the JSON).

## Fallback discipline

- **MissingCredentialError** or connection failure on `ifind` / `tushare` → try free sources (`akshare`, `world_bank`, `imf`) before giving up.
- **Tushare without MCP** → tell user to connect `tushareMcp` in Desktop settings; do not invent prices.
- If **all** applicable sources fail: say explicitly **「当前数据源暂不可用，无法核实最新数据」**. Never substitute a remembered or guessed number.

## Known plugins (authoritative list: `list_data_sources`)

| domain | plugin | notes |
|---|---|---|
| finance | akshare | free, no credential, A/HK/US history & A-share quote |
| finance | tushare | requires connected `tushareMcp` |
| finance | ifind | enterprise-only, credential-gated |
| macro | world_bank | free, global development indicators |
| macro | imf | free macro indicators |
