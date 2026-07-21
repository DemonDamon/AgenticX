# @agenticx/feature-metering 模块总结

> 结论生成时间：2026-07-21（基于 `enterprise/features/metering` 当前源码重生成）

> 说明：本文档描述**计量 · 四维查询 feature 包**（`@agenticx/feature-metering`），由 `apps/admin-console` 在 `/metering` 页面消费。仅基于真实源码，区分**真查询/UI** 与 **stub**。

## 模块概述

`@agenticx/feature-metering` 是 admin-console **token 消耗计量与 ROI 分析的核心 feature 包**。口号"四维查询（部门-员工-厂商-时间）"，实际维度更广：dept / user / provider / model / day / pat（PAT）/ api_token_id 都可作分组键或过滤项。基于 `usage_records` 表（来自 `@agenticx/db-schema`），提供三类**真实 DB 查询**：分组聚合（`MeteringService.query`）、热力图矩阵（`MeteringService.queryHeatmap`）、ROI 报表（`RoiService.computeReport`），外加业务营收 CRUD 与 CSV 导出。

**真 vs stub 判定**：本包**无 mock/stub**——所有 service 方法都走真实 SQL（PG 或 MySQL）；admin-console 侧 `lib/metering-service.ts` 是真 wrapper（直接 `new MeteringService()` / `new RoiService()`），`/api/metering/*` 路由与 `/metering` 页面均真接线。唯一"硬编码"是 `tenant_id`：由 `DEFAULT_TENANT_ID` env 或兜底常量 `01J00000000000000000000001` 解析（单租户简化，非 stub）。

## 目录结构

```
features/metering/
├── package.json                              # @agenticx/feature-metering
├── vitest.config.ts
├── tests/
│   ├── heatmap.test.ts                       # buildHeatmapMatrix / formatTimeSlot（AC-1/AC-3）
│   └── roi.test.ts                           # computeRoiRows / roiRowsToCsv（AC-2/AC-3）
└── src/
    ├── index.ts                              # barrel
    ├── types.ts                              # 所有 Input / Result 类型
    ├── services/
    │   ├── metering.ts                       # MeteringService（query + heatmap + recordUsage + JSONL 兜底）
    │   ├── heatmap-utils.ts                  # buildHeatmapMatrix + formatTimeSlot（纯函数）
    │   ├── roi.ts                            # RoiService（computeReport + 营收 CRUD）
    │   ├── roi-utils.ts                      # computeRoiRows + roiRowsToCsv（纯函数）
    │   └── sql/
    │       ├── index.ts                      # barrel：导出 PG/MySQL executor + builder
    │       ├── postgresql.ts                 # SqlExecutor/MeteringSqlBuilder 类型 + PG 实现
    │       └── mysql.ts                      # MySQL 实现（mysql2/promise）
    └── api/
        ├── metering.ts                       # MeteringApi（query 的 JSON 信封包装）
        ├── heatmap.ts                        # HeatmapApi
        └── roi.ts                            # RoiApi（report + reportCsv + 营收 CRUD）
```

## 核心类型（`src/types.ts`）

| 类型 | 用途 |
|---|---|
| `MeteringGroupKey` | `"dept" \| "user" \| "provider" \| "model" \| "day" \| "pat"` |
| `MeteringQueryInput` | `tenant_id` + 多重 IN 过滤（dept/user/api_token/provider/model）+ `start/end` + `group_by[]` |
| `MeteringPivotRow` | `dims: Record<string, string\|null>` + 6 个 token 字段（input/output/total/cached/cache_read/cache_creation）+ `cost_usd` |
| `HeatmapDimension` | `"dept" \| "user" \| "model" \| "pat" \| "provider"` |
| `HeatmapTimeGranularity` | `"hour" \| "day"` |
| `HeatmapMetric` | `"total_tokens" \| "cost_usd"` |
| `HeatmapQueryResult` | `{dimensions[], time_slots[], cells: HeatmapCell[]}` —— 稀疏 cell 列表，前端易渲染 |
| `BusinessRevenueRecord / Input` | 业务营收记录（scenario_label + period + revenue_usd） |
| `RoiReportInput / Result / Row` | 把 token 成本与营收按维度对齐（`roi: number \| null`） |
| `UsageRecordInput / WriteResult` | 写 `usage_records`（ulid 主键，可带 `route`/`pricing_version`） |

## SQL 抽象层（`src/services/sql/`）—— 双方言真查询

`MeteringSqlBuilder` 接口统一了 PG/MySQL 方言差异，`MeteringService` / `RoiService` 据此拼裸 SQL（不走 Drizzle）：

| 能力 | PostgreSQL | MySQL |
|---|---|---|
| `placeholder(i)` | `$i` | `?`（executor 内 `dollarToQuestion` 把 `$N` 转 `?`） |
| `dateBucket(g, col)` | `date_trunc('g', col)` | `DATE_FORMAT(col, '%Y-%m-%d %H:00:00')` / `... '%Y-%m-%d 00:00:00'` |
| `text(col)` | `col::text` | `CAST(col AS CHAR)` |
| `bigint(expr)` / `decimal(expr)` | `::bigint` / `::numeric(18,8)` | `CAST(... AS SIGNED)` / `CAST(... AS DECIMAL(18,8))` |
| `now()` | `now()` | `UTC_TIMESTAMP(6)` |
| `insertIgnore(col)` | `on conflict (col) do nothing` | `on duplicate key update id = id` |

- `createPostgresqlExecutor`：`pg.Pool` 直连；`createMysqlExecutor`：`mysql2/promise.createPool`（`timezone: "Z"`、`charset: "utf8mb4"`）。
- **方言选择**：构造时调 `resolveDatabaseConfig({ ...process.env, DATABASE_URL?, DATABASE_DIALECT?, NODE_ENV? })`（来自 `@agenticx/iam-core`），按 `config.dialect === "mysql"` 二选一选 executor + builder。

## 服务层

### `MeteringService` (`services/metering.ts`)

- `query(input) → MeteringQueryResult`：按 `group_by` 动态拼 SQL（`groupColumn` 映射每个 key 的 SQL 列，`day` 走 `sql.dateBucket("day", "time_bucket")`）；多重 IN 过滤；`day` 分组结果在 JS 侧把 pg 的 `Date` 转 ISO 短日期（避免前端 X 轴出现本地化长串）。
- `queryHeatmap(input) → HeatmapQueryResult`：拼 SQL 取原始 `(dim, time, total_tokens, cost_usd)`，`limit = max(limitDimensions * maxTimeSlots, 1)` 行，再 `buildHeatmapMatrix` 塑形。
- `recordUsage(input) → UsageRecordWriteResult | null`：写一条 `usage_records`（ulid 主键，`insertIgnore` 幂等）；失败返回 `null`（吞异常，不抛）。
- **JSONL 兜底**（真查询的降级路径，非 mock）：DB 查询抛错时，若 `GATEWAY_USAGE_JSONL_FALLBACK === "1"`，`query` / `queryHeatmap` 回退到 `queryFromUsageLog` / `queryHeatmapFromUsageLog`，读取 `GATEWAY_USAGE_LOG`（默认 `../../apps/gateway/.runtime/usage.jsonl`）按行 JSON 解析、内存聚合。读不到文件返回空集。
- **约束**：`MAX_HEATMAP_TIME_SLOTS` hour=168（一周）、day=90（三月）；`HEATMAP_DIM_COLUMN` 映射 `pat → api_token_id`、`user → user_id` 等；`limit_dimensions` 默认 30。

### `RoiService` (`services/roi.ts`)

- `computeReport(input) → RoiReportResult`：`ROI_DIM_COLUMN` 把维度映成 SQL 列，聚合 `usage_records.cost_usd`（top 200 label）+ 关联 `enterprise_business_revenue` 营收（按 `period_start <= end && period_end >= start` 时间窗匹配），调 `computeRoiRows` 算 ROI。cost/revenue 两路查询各自 try/catch，失败返回空数组而非抛。
- **营收 CRUD**（真落库）：`listRevenues`、`createRevenue`（ulid 主键，写后回读）、`updateRevenue`（动态拼 `set` 字段，空 patch 直接回读）、`deleteRevenue`（按 `rowCount` 判定）、`getRevenue`。
- 注意：`updateRevenue`/`deleteRevenue`/`getRevenue` 内部 SQL 仍用 `$1/$2` 占位符（PG 风格），MySQL executor 会经 `dollarToQuestion` 转换。

### Utils（纯函数，可测）

| 函数 | 职责 |
|---|---|
| `formatTimeSlot(raw, granularity)` | Date → `"YYYY-MM-DDTHH:00:00.000Z"`（hour）或 `"YYYY-MM-DD"`（day）；非 Date 取文本前 10 字符 |
| `buildHeatmapMatrix(rows, opts)` | 按总量降序取 top N 维度（默认 30）+ 收集时间槽 + 输出 `{dimensions, time_slots, cells}`；合并重复 dim/time |
| `emptyHeatmapResult` | 空结果占位 |
| `computeRoiRows(costs, revenues)` | 按 label 对齐 cost/revenue，`roi = cost>0 ? (revenue-cost)/cost : null`，按 ROI 降序、revenue 降序排序 |
| `roiRowsToCsv(rows)` | 导出 `label,cost_usd,revenue_usd,net_usd,roi` CSV（cost/revenue 8 位小数，roi 6 位） |

## API 层（`src/api/`）

每个 API 类把 service 返回值包装为 `{code: "00000", message: "ok", data: T}` 信封：

- `MeteringApi.query(input)` → 信封
- `HeatmapApi.query(input)` → 信封
- `RoiApi`：
  - `report(input)` → 信封
  - `reportCsv(input)` → CSV 字符串（经 `roiRowsToCsv`）
  - `listRevenues(tenantId)` → `{items}`
  - `createRevenue(input)` → `{item}`
  - `updateRevenue(tenantId, id, patch)` → `{item}` 或 `{code: "40401", message: "revenue record not found"}`
  - `deleteRevenue(tenantId, id)` → `{deleted: true}` 或 `40401`

## 公共导出（`src/index.ts`）

re-export：types / 4 个 service（`MeteringService`、`RoiService`、heatmap-utils、roi-utils）/ 3 个 API 类 / sql 层（经 service 间接导出）。

## 依赖

| 依赖 | 用途 |
|---|---|
| `pg ^8` | PostgreSQL 客户端（`Pool`） |
| `mysql2 ^3.14.1` | MySQL 客户端（`createPool`） |
| `@agenticx/iam-core` `workspace:*` | `resolveDatabaseConfig` 方言选择 |
| `ulid ^3` | `usage_records` / `enterprise_business_revenue` 主键 |
| `vitest ^4` | 测试 |

**注**：本包**不依赖 Drizzle**，直接用 `pg.Pool` / `mysql2.Pool` 写裸 SQL，因分组维度组合 + heatmap 矩阵都需动态拼 SQL，比 query builder 更直接。

## 测试（`tests/`）

| 文件 | 覆盖 |
|---|---|
| `heatmap.test.ts` | `buildHeatmapMatrix` 空集（AC-3）/ 聚合 + top N 截断（AC-1）/ 合并重复 dim/time；`formatTimeSlot` hour/day |
| `roi.test.ts` | `computeRoiRows` ROI 计算与排序（AC-2）/ revenue-only 与 cost-only label / 空输入（AC-3）；`roiRowsToCsv` 表头与行格式 |

服务层（含 PG/MySQL 实际调用）的集成测试在 admin-console 侧覆盖，本包仅测纯函数。

## admin-console 消费侧（真 UI / 真路由，非 stub）

| 关联 | 形态 | 说明 |
|---|---|---|
| `lib/metering-service.ts` | **真 wrapper** | 直接 `new MeteringService()` / `new RoiService()`，`tenant_id` 由 `DEFAULT_TENANT_ID` env 或兜底 `01J00000000000000000000001` 解析；导出 `queryMetering` / `queryHeatmap` / `queryRoiReport` / `exportRoiReportCsv` / 营收 CRUD |
| `/api/metering/query` (POST) | **真路由** | `requireAdminScope(["metering:read"])` 鉴权 → `queryMetering`；默认时间窗近 7 天 |
| `/api/metering/heatmap` (POST) | **真路由** | 校验 dimension/granularity/metric 白名单 → `queryHeatmap` |
| `/api/metering/roi` (GET/POST/PUT/DELETE) | **真路由** | GET：`mode=revenues` 列营收 或 ROI 报表（`format=csv` 导出）；POST/PUT/DELETE：`metering:manage` 鉴权 + 字段校验后营收 CRUD |
| `/api/metering/export` (POST) | **真路由** | `queryMetering` 后在路由侧拼 CSV（含 dims + 6 token 字段 + cost） |
| `/metering` 页面 | **真 UI** | 筛选 chip（dept/user/pat/provider/model + 日期）→ summary 卡片 → Tabs（charts/heatmap/roi/table）：`LineCard` 趋势 + `BarCard` 日量 + `TokenHeatmap`（OKLCH color-mix 热力图）+ ROI 表 + 营收 CRUD 表单 + CSV 导出；全部 `adminFetch` 真请求，i18n via `useTranslations("pages.ops.metering")` |
| `apps/gateway`（Go） | **数据生产者** | 每次 LLM 调用后写 `usage_records`；本包 query 这张表；JSONL 兜底读 gateway 的 `usage.jsonl` |
| `packages/db-schema` | **schema 依赖** | 读 `usage_records` + 读写 `enterprise_business_revenue` |
| `packages/feature-billing` | **协同** | billing 消费同一份 `usage_records` 做分账；metering 做查询/可视化 |

## 与 Enterprise 其他模块的关系

- **IAM 鉴权**：所有路由经 `requireAdminScope`，读类用 `metering:read`、写类（营收 CRUD）用 `metering:manage`。
- **双方言迁移**：本包是 `@agenticx/iam-core` `resolveDatabaseConfig` 双方言（PG/MySQL）体系的下游消费者之一，与 IAM `getRepositoryRegistry()` 的 dialect dispatch 同源。
- **Gateway 数据链**：`usage_records` 由 Go gateway 写入；DB 不可达时本包可经 `GATEWAY_USAGE_JSONL_FALLBACK` 读 gateway 的 JSONL 兜底，保证计量页不白屏。
