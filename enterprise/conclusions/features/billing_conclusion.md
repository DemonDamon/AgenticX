# @agenticx/feature-billing 模块总结

> 结论生成时间：2026-07-21（基于源码重生成）

> 说明：本文档描述**多方实时分账 feature 包**（`@agenticx/feature-billing`），由 `apps/admin-console` 在 metering/split 页面消费。重生成目的：旧结论把方法名/SQL 方言/API 类名写错，且漏掉 `sql/` 双方言层与 `contract_stub` 自声明，本次按源码逐行校准，并显式区分「真分账引擎」与「薄壳/桩」。

## 模块概述

`@agenticx/feature-billing` 是 **billing 分账引擎**——以 `usage_records` 中每条 LLM 调用的 `cost_usd` 为基础，根据 `billing_split_rules` 表中配置的参与者与比例（`ratio_bps`，万分比精度），把成本拆分到各参与方的 `billing_split_ledger`。背后是 **裸 SQL + 双方言执行器**（PostgreSQL 走 `pg.Pool`、MySQL 走 `mysql2/promise` 池），统一封装在 `src/services/sql/` 下，由 `resolveDatabaseConfig` 按 `DATABASE_DIALECT` 决断。额外提供：**对账**（reconcile：在 time range 内按 participant 汇总，含 dialect 感知的 `::bigint` / `CAST(... AS SIGNED)` 类型转换）、**待分账补跑**（syncPendingUsage：LEFT JOIN 找未分账的 usage_records 逐条补）、**结算 webhook**（settlement contract：写入 `billing_settlement_webhook_config` + `billing_settlement_webhook_events`，真实 `fetch` POST 但 payload 自带 `contract_stub: true`）。跟 metering 包共享同一份 `usage_records` 数据源。

## 目录结构

```
features/billing/
├── package.json                              # @agenticx/feature-billing（deps: pg + mysql2 + ulid + iam-core）
├── vitest.config.ts
├── tests/
│   ├── split-utils.test.ts                   # 纯函数测试（micro 转换 + 70/30 拆分 + CSV 导出）
│   └── settlement-contract.test.ts          # 结算合约测试（未配置跳过 + mock fetch 派发）
└── src/
    ├── index.ts                              # barrel（re-export 全部）
    ├── types.ts                              # SplitMode / SplitParticipant / BillingSplitRule / LedgerEntry / ReconcileResult / SettlementWebhook* 等
    ├── services/
    │   ├── split-rules.ts                    # SplitRulesService（规则 CRUD + findActiveRule 生效时间窗判定）
    │   ├── split-ledger.ts                   # SplitLedgerService（分录生成 + 对账 + 待分账补跑 + by_billing_item 解析）
    │   ├── split-utils.ts                    # costUsdToMicro / microToUsd / microToUsdString / splitAmountMicro / reconcileRowsToCsv（纯函数）
    │   ├── settlement-contract.ts            # SettlementContractService（webhook 配置 upsert + 真实 fetch 派发 + 事件记录）
    │   └── sql/
    │       ├── index.ts                      # createBillingSqlExecutor + jsonParam / nowExpr / returningStar 方言片段
    │       ├── postgresql.ts                 # postgresqlBillingSql（jsonCast=$n::jsonb / returning * / now()）
    │       └── mysql.ts                      # mysqlBillingSql（jsonCast=CAST($n AS JSON) / returning="" / UTC_TIMESTAMP(6)）
    └── api/
        └── split.ts                          # BillingSplitApi（JSON 信封 {code,message,data} 包装）
```

## 核心类型

| 类型 | 用途 |
|---|---|
| `SplitMode` | `"fixed_ratio" \| "by_billing_item"` |
| `SplitParticipant` | `participant_id + label? + ratio_bps + billing_item?` |
| `BillingSplitRule` | 一条分账规则（含 effective_start/end 时间窗 + 参与者数组 + billing_items + enabled）|
| `BillingSplitRuleInput` | 创建/更新入参（split_mode / enabled 可选，默认 fixed_ratio / true）|
| `BillingSplitLedgerEntry` | 一条分账分录（`amount_micro_usd` string + `original_cost_micro_usd` + `usage_record_id` + `rule_version` + `time_bucket`）|
| `UsageRecordForSplit` | 与 `usage_records` 表对齐的轻量 DTO（id/tenant_id/cost_usd/time_bucket/provider/model）|
| `ReconcileQueryInput` | tenant + start + end + 可选 participant_id + `sync_pending` + `sync_limit` |
| `ReconcileResult` | `rows`（按 participant 汇总）+ `ledger_entries`（明细）+ `synced_usage_count` |
| `SettlementWebhookConfig` | 租户级 webhook 配置（webhook_url / enabled / updated_at）|
| `SettlementWebhookEvent` | 事件记录（payload / status / response_status）|
| `SettlementContractNotifyInput` | webhook 通知事件内容（tenant + usage_record_id + rule_id + entries）|

## 服务层

### `SplitRulesService` (`services/split-rules.ts`)

**职责**：分账规则 CRUD（PG 表 `billing_split_rules`）+ 生效时间窗判定

**方法**：`listRules` / `getRule` / `createRule` / `updateRule` / `deleteRule` / `findActiveRule(tenantId, timeBucketIso)`

**关键逻辑**：
- `createRule` 用 `ulid()` 生成 id，`participants` / `billing_items` 经 `sql.jsonCast` 写入 jsonb/JSON（PG `$n::jsonb` / MySQL `CAST($n AS JSON)`）；PG 走 `returning *`，MySQL 无 returning 故 `createRule` 后再 `getRule` 回读
- `updateRule` 动态拼装 SET 字段，`effective_end` / `billing_items` 用 `!== undefined` 区分「置空」与「不动」
- `findActiveRule` 按 `enabled=true and effective_start <= $2 and (effective_end is null or effective_end >= $2)` 选生效规则，`order by effective_start desc, updated_at desc limit 1`
- `parseParticipants` 解析 raw jsonb → `SplitParticipant[]`，过滤空 id 与非有限 `ratio_bps`，`ratio_bps` 用 `Math.round` 归一
- 所有读方法 `try/catch` 兜底返回 `[]` / `null`，吞掉连接异常

### `SplitLedgerService` (`services/split-ledger.ts`)

**职责**：分账分录生成 + 对账 + 待分账补跑

**方法**：
- `listLedgerEntries(tenantId, {start,end,participant_id?,limit?})` —— 按 tenant + time_bucket 范围 + 可选 participant 筛选 `billing_split_ledger`，默认 limit 500
- `syncPendingUsage(tenantId, limit=100)` —— **LEFT JOIN** `usage_records ur left join billing_split_ledger bl on bl.usage_record_id = ur.id where bl.id is null` 找未分账的 usage，逐条调 `applySplitForUsage`，返回补跑条数
- `applySplitForUsage(usage)` —— **核心**：先查 `billing_split_ledger where usage_record_id=$1` 做**幂等**（已存在则 return false）→ `findActiveRule` 找生效规则 → `costUsdToMicro` 转 bigint → `resolveParticipants` 解析参与者 → `splitAmountMicro` 拆 cost → **逐条 insert** `billing_split_ledger`（每条新 ulid，记 `rule_version=rule.updated_at` + `original_cost_micro_usd`）→ 若注入了 `SettlementContractService` 则 `notifySplit` 触发 webhook
- `reconcile(input)` —— 若 `sync_pending !== false` 先 `syncPendingUsage` 补跑 → 按 dialect 选 `coalesce(sum(amount_micro_usd),0)::bigint`（PG）或 `CAST(coalesce(sum(amount_micro_usd),0) AS SIGNED)`（MySQL）+ `count(*)::int` / `CAST(count(*) AS SIGNED)` 聚合 → 按 participant 分组汇总 + 取明细（limit 1000）+ 返回 `synced_usage_count`
- `resolveParticipants(rule, usage)` —— `by_billing_item` 模式按 `usage.model ?? usage.provider ?? "default"` 匹配 participant 的 `billing_item`，无匹配则回落全量参与者；`fixed_ratio` 直接返回全量
- `setSettlementService(service)` —— 运行时注入 webhook 服务

### `split-utils.ts`（纯函数）

```ts
costUsdToMicro(costUsd: number) → bigint          // cost_usd × 1_000_000，NaN/Infinity/<=0 → 0n
microToUsd(micro: bigint) → number                // bigint / 1_000_000
microToUsdString(micro: bigint) → string           // 直接 toString（保持 bigint 字符串）
splitAmountMicro(totalMicro, participants) → SplitShare[]  // 过滤 ratio_bps>0，最后一人兜底余数
reconcileRowsToCsv(rows) → string                 // participant_id,label,amount_usd(8位小数),entry_count
```

**精度**：`MICRO_USD_FACTOR = 1_000_000`（micro USD），分账全程 `bigint` 避免浮点精度问题；`splitAmountMicro` 用 `totalMicro * BigInt(ratio_bps) / BigInt(totalBps)` 整除，最后一名拿 `totalMicro - allocated` 吸收余数，保证 `sum(shares) === totalMicro`

### `SettlementContractService` (`services/settlement-contract.ts`)

**职责**：webhook 配置管理 + 真实派发 + 事件记录

**方法**：`getConfig` / `setConfig` / `listEvents` / `notifySplit`

**关键逻辑**：
- `setConfig` upsert：PG `on conflict (tenant_id) do update` / MySQL `on duplicate key update`，`nowExpr` 按 dialect 取 `now()` / `UTC_TIMESTAMP(6)`
- `notifySplit`：先 `getConfig`，未启用或无 URL → `recordEvent(status="skipped")` 返回 `{dispatched:false}`；启用则 `fetch(webhook_url, {method:POST, headers:content-type:application/json, body:JSON.stringify(payload), signal:AbortSignal.timeout(5000)})`，按 `response.ok` 记 `delivered` / `failed`，异常记 `failed`，最后 `recordEvent` 落库
- **payload 自带 `contract_stub: true`**——明确自声明为桩合约，非完整结算系统
- `recordEvent` 写 `billing_settlement_webhook_events`（payload 经 `jsonParam` 按 dialect 转类型），best-effort，吞异常

### API 层 `BillingSplitApi` (`api/split.ts`)

包装 `SplitRulesService` + `SplitLedgerService` + `SettlementContractService`（构造可注入），返回 `{code:"00000", message:"ok", data:T}`，未找到回 `{code:"40401", message:"rule not found", data:null}`

**方法**：`listRules` / `createRule` / `updateRule` / `deleteRule` / `reconcile` / `reconcileCsv`（调 `reconcileRowsToCsv`） / `syncPending` / `getWebhookConfig` / `setWebhookConfig` / `listWebhookEvents` / `notifySplit`

## 测试

| 文件 | 覆盖 |
|---|---|
| `tests/split-utils.test.ts` | `splitAmountMicro` 70/30 求和=原值（AC-1）+ 零总额返空（AC-3）；`reconcileRowsToCsv` 表头+内容（AC-2）；`costUsdToMicro` 四舍五入 |
| `tests/settlement-contract.test.ts` | 未配置 webhook 时 `dispatched=false` 不抛（AC-3）；mock fetch + mock getConfig 返回 `dispatched=true` 且 fetch 调用一次 |

**测试薄点**：仅 2 个测试文件、约 40 行/文件，纯 happy-path + 一个 skip case；无真实 DB 集成测试（`settlement-contract.test.ts` 用 `postgresql://invalid:5432/nodb` 占位 + mock）；`lint` 脚本为 `echo 'lint placeholder'` 占位。

## 真分账 vs 薄壳/桩（核心判定）

| 维度 | 真实现（real） | 薄壳/桩（stub） |
|---|---|---|
| 规则 CRUD | ✅ 真写 PG/MySQL，双方言 upsert/returning | — |
| 分账拆分 | ✅ bigint micro-USD，整除+余数兜底，`sum=total` | — |
| 幂等 | ✅ `applySplitForUsage` 先查 `usage_record_id` 去重 | — |
| 时间窗匹配 | ✅ `findActiveRule` 真按 effective_start/end 过滤 | — |
| by_billing_item | ✅ 按 model/provider 匹配 participant.billing_item | — |
| 待分账补跑 | ✅ `syncPendingUsage` LEFT JOIN 找漏单 | — |
| 对账聚合 | ✅ dialect 感知的 `::bigint` / `CAST AS SIGNED` | — |
| CSV 导出 | ✅ `reconcileRowsToCsv` 真生成 | — |
| Webhook 派发 | ✅ 真 `fetch` POST + 5s 超时 + 状态机 | — |
| Webhook 协议 | — | ⚠️ payload 自带 `contract_stub: true`，无 HMAC 签名、无幂等键、无重试队列、无死信 |
| 结算 payout | — | ⚠️ 无真实资金划拨/外部支付集成，仅事件日志 |
| 失败重投 | — | ⚠️ `failed` 事件仅落库，无 re-dispatch 调度 |
| 批量分账 | — | ⚠️ `syncPendingUsage` 逐条循环 insert，无事务包裹多行写入、无 bulk insert |
| 测试覆盖 | — | ⚠️ 2 文件 happy-path，无 DB 集成、无负向覆盖 |
| lint | — | ⚠️ `echo 'lint placeholder'` 占位 |

**结论**：分账引擎本体（规则/分录/对账/补跑/CSV）是**真实现**且双方言可用；结算 webhook 是**真 HTTP 派发但合约层为桩**（`contract_stub: true` 自声明，缺签名/重试/幂等键/资金划拨），批量写入与测试覆盖偏薄。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | **主消费者** | `/metering/split` 页面 + `/api/billing/{split/*,settlement/webhook}` 路由 |
| `packages/db-schema` | **schema 依赖** | `billing_split_rules` / `billing_split_ledger` / `billing_settlement_webhook_config` / `billing_settlement_webhook_events` |
| `features/metering` | **数据共享** | 同读 `usage_records` 表；metering 做查询/可视化，billing 做成本拆分 |
| `packages/iam-core` | **间接** | `resolveDatabaseConfig` 提供 dialect/url 解析；`insertAuditEvent`（通过 `gatewayAuditEvents`）用于分账操作审计 |
