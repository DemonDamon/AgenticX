---
name: Token 消耗看板诊断能力增强（参考 token-dashboard）
overview: 在 Enterprise metering 模块引入 4 项 token-dashboard 式诊断视角：KPI 扩展（7 卡）、trace 下钻、0-24 时模型堆叠图、单次请求分布。后端基于 usage_records 聚合加 3 个新接口；前端 metering 页面扩展展示。不动网关计量、不动 DB schema。
todos:
  - id: p0-backend-overview
    content: 后端 feature-metering 新增 queryOverviewStats 方法 + API route
    status: pending
  - id: p0-frontend-kpi
    content: 前端 KPI 从 3 卡扩到 7 卡
    status: pending
  - id: p1-backend-trace-list
    content: 后端新增 trace 列表 API（按筛选条件返回 DISTINCT trace_id + 聚合指标）
    status: pending
  - id: p1-frontend-trace-link
    content: 前端表格行加 trace 下钻入口
    status: pending
  - id: p2-backend-ridge
    content: 后端新增 queryHourlyModelRidge 方法 + API route
    status: pending
  - id: p2-frontend-ridge
    content: 前端 0-24 时模型堆叠面积图
    status: pending
  - id: p3-backend-dist
    content: 后端新增 queryRequestSizeDistribution 方法 + API route
    status: pending
  - id: p3-frontend-dist
    content: 前端单次请求分布图表
    status: pending
  - id: smoke-test
    content: Docker 启动 + curl 端到端验证
    status: pending
  - id: cdp-test
    content: Chrome DevTools CDP 真机点击验证
    status: pending
isProject: false
---

# Token 消耗看板诊断能力增强

**Plan-Id**: 2026-10-10-enterprise-metering-diagnostics-enhancement
**Owner**: Damon Li
**参照仓库**: fuyi-git/token-dashboard（诊断视角）

## 背景

Enterprise metering 模块已具备：
- usage_records 表（含 input_tokens / output_tokens / cached_tokens / cost_usd / trace_id 等完整字段）
- 基础聚合 query API + heatmap + ROI + 导出
- agent_token_traces 表 + agent-traces 页面（单次 trace 下钻）

但缺失 token-dashboard 的**诊断视角**：运营一眼看不完关键 KPI、看到异常无法下钻到 trace、没有时段×模型对比视图、不知道请求分布形状。

## 改动清单

### P0 — KPI 扩展（0.5 + 0.5 day）

**后端**：`enterprise/features/metering/src/services/metering.ts` 新增 `queryOverviewStats` 方法

```sql
-- 单条 SQL 聚合全部 KPI
SELECT
  SUM(total_tokens)                                           AS total_tokens,
  SUM(total_tokens) / GREATEST(COUNT(DISTINCT DATE(time_bucket)), 1)  AS daily_avg_tokens,
  COUNT(DISTINCT trace_id)                                     AS session_count,
  SUM(input_tokens)                                            AS input_tokens,
  SUM(output_tokens)                                           AS output_tokens,
  SUM(input_tokens) / GREATEST(SUM(output_tokens), 1)          AS io_ratio,
  SUM(cached_tokens)                                           AS cached_tokens,
  SUM(cache_read_input_tokens) / GREATEST(SUM(input_tokens), 1) AS cache_hit_rate,
  SUM(cost_usd)                                                 AS total_cost,
  COUNT(*)                                                      AS record_count
FROM usage_records
WHERE tenant_id = $1 AND time_bucket BETWEEN $2 AND $3 ...filters
```

- API route: `/api/metering/overview` (POST，复用现有筛选条件)
- 新增 types: `OverviewStatsResult`

**前端**：`metering/page.tsx` KPI section 从 3 卡扩到 7 卡
- 合计 Token / 日均 Token
- 会话数 / IO 比（input:output）
- 缓存命中率 / 预估金额（已有，保留）
- 记录数（已有，保留）

### P1 — Trace 下钻入口（0.5 + 0.5 day）

**后端**：新增 trace 列表 API

```sql
SELECT
  trace_id,
  SUM(total_tokens)   AS total_tokens,
  SUM(cost_usd)       AS cost_usd,
  SUM(input_tokens)   AS input_tokens,
  SUM(output_tokens)  AS output_tokens,
  MIN(time_bucket)    AS first_seen,
  COUNT(*)            AS step_count
FROM usage_records
WHERE tenant_id = $1 AND trace_id IS NOT NULL
  AND time_bucket BETWEEN $2 AND $3 ...filters
GROUP BY trace_id
ORDER BY total_tokens DESC
LIMIT 200
```

- API route: `/api/metering/traces` (POST)
- 支持按 token 成本降序的 trace 列表

**前端**：metering 的 table Tab 新增"查看关联 Traces"按钮，点击弹出 modal 显示 trace 列表，每个 trace 带链接跳转到 `/metering/agent-traces?trace_id=xxx`（agent-traces 页面已支持 traceId 查找）

### P2 — 0-24 时模型堆叠面积图（1 + 0.5 day）

**后端**：`queryHourlyModelRidge` 方法

```sql
SELECT
  EXTRACT(HOUR FROM time_bucket)::int AS hour,
  model,
  SUM(total_tokens) AS total_tokens
FROM usage_records
WHERE tenant_id = $1 AND time_bucket BETWEEN $2 AND $3 ...filters
GROUP BY 1, 2
ORDER BY 1, 2
```

- API route: `/api/metering/hourly-ridge` (POST)
- 返回 `{ hours: number[], models: string[], data: Record<string, number[]> }` 格式，方便前端直接堆叠

**前端**：charts Tab 新增一列堆叠面积图（recharts Area + Stack）
- X 轴 0-23 时，每一层一个模型
- 悬停显示具体数值
- 点击图例高亮某模型

### P3 — 单次请求分布（50/90 分位）（1.5 + 0.5 day）

**后端**：`queryRequestSizeDistribution` 方法

```sql
-- PostgreSQL 用 PERCENTILE_CONT
SELECT
  model,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_tokens) AS p50,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY total_tokens) AS p90,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY total_tokens) AS p99,
  AVG(total_tokens) AS avg_tokens,
  COUNT(*) AS request_count,
  histogram_bins(usage_records.total_tokens, 10) AS bins  -- 自实现
FROM usage_records
WHERE tenant_id = $1 AND time_bucket BETWEEN $2 AND $3 ...filters
GROUP BY model
```

- API route: `/api/metering/request-distribution` (POST)
- MySQL 用自定义分位数近似（NTILE 或 APPROX_PERCENTILE）

**前端**：新增一个 distribution Tab
- 每个模型一行，显示 p50/p90/p99 数字 + 直方图
- 支持点选高亮

## 不动

- gateway 计量链路、usage_records schema、agent_token_traces schema
- ROI 报表、配额管理、plan 管理等既有模块
- portal 侧

## 验证

1. `pnpm -C enterprise --filter @agenticx/feature-metering test`
2. `bash scripts/start-dev-with-infra.sh` 起中间件 + admin-console
3. curl 验证每个新 API 有数据返回
4. Chrome DevTools CDP 连接 admin-console，点 metering 页面看渲染

## 文件变更清单

| 层 | 文件 | 操作 |
|---|---|---|
| feature-metering types | `types.ts` | 新增 OverviewStatsResult / TraceListRow / RidgeRow / DistributionRow 类型 |
| feature-metering service | `services/metering.ts` | 新增 queryOverviewStats / queryTraceList / queryHourlyModelRidge / queryRequestSizeDistribution |
| feature-metering api | `api/metering.ts` | 新增 4 个 API 类方法 |
| admin-console API route | `api/metering/overview/route.ts` | 新增 |
| admin-console API route | `api/metering/traces/route.ts` | 新增 |
| admin-console API route | `api/metering/hourly-ridge/route.ts` | 新增 |
| admin-console API route | `api/metering/request-distribution/route.ts` | 新增 |
| admin-console lib | `lib/metering-service.ts` | 导出新方法 |
| admin-console page | `metering/page.tsx` | KPI 扩 7 卡 + 新增 Tab 内容 + trace 下钻 |
| admin-console component | `components/metering/TokenHeatmap.tsx` | 不动 |
| admin-console component | `components/metering/*.tsx` | 新增 RidgeChart / DistributionChart / TraceListModal |
| i18n | `messages/**/*.json` | 新增翻译 key |
