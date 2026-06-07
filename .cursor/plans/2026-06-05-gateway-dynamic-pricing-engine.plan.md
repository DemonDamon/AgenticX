---
name: Gateway 动态计价引擎（基础词元 + 复杂度附加费）
overview: 在 Go 网关把现有静态 pricing.yaml 单价表扩展为「基础词元单价 + 复杂度附加费 + 模型分层」的动态计价引擎，admin-console 可配置并下发快照，usage_records 落计算后的真实成本。
todos:
  - id: t1-pricing-model
    content: 扩展 PricingTable 数据结构，支持 tier/surcharge/effective_date 字段与查询
    status: completed
  - id: t2-cost-compute
    content: ComputeCostUSD 改为按复杂度规则叠加附加费（长上下文/推理/工具调用）
    status: completed
  - id: t3-admin-pricing-store
    content: admin-console 新增计价配置 PG 表 + CRUD API + 发布快照
    status: completed
  - id: t4-snapshot-pull
    content: 网关启动/定时从 admin 拉取计价快照，回落本地 pricing.yaml
    status: completed
  - id: t5-smoke
    content: 冒烟测试覆盖基础单价、附加费叠加、快照回落三场景
    status: completed
isProject: false
---

# Gateway 动态计价引擎

**Plan-Id**: 2026-06-05-gateway-dynamic-pricing-engine
**Plan-File**: `.cursor/plans/2026-06-05-gateway-dynamic-pricing-engine.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

当前 Go 网关只有静态单价表 `enterprise/apps/gateway/internal/metering/pricing.go`（`PricingTable.ForModel()` 读 `pricing.yaml`），`ComputeCostUSD()` 仅做 `tokens × 单价`，无「复杂度附加费」「分层定价」「生效时间」。客户要求「动态计价模型（基础词元 + 复杂度附加费）」。

## 需求

- FR-1: 计价支持「基础词元单价（输入/输出/推理分列）+ 复杂度附加费」。复杂度因子来源：上下文长度档位、是否含 reasoning tokens、单请求工具调用次数（已在 usage 中可得的字段优先，不新增模型探测）。
- FR-2: 计价支持按模型分层（tier）与 `effective_date` 多版本，按请求时间命中生效版本。
- FR-3: admin-console「额度控制/计价」区可配置计价规则并发布快照；网关拉取快照，失败回落本地 `pricing.yaml`。
- FR-4: `usage_records` 写入按动态规则计算后的 `cost_usd`，并记录命中的计价版本标识。
- NFR-1: 不改 usage 归一化逻辑（`usage_normalizer.go`）、不改 token 计量字段；仅在「成本计算」环节扩展。
- NFR-2: 无快照、无配置时行为与现状等价（纯基础单价），保证向后兼容。
- AC-1: 给定一条含 reasoning + 长上下文的 usage，计算成本 = 基础 + 命中附加费，单测可断言数值。
- AC-2: admin 修改单价并发布后，网关在下次拉取窗口内使用新价。
- AC-3: 删除/无法拉取快照时回落本地表，计费不中断。

## 改动范围（严格）

1. `enterprise/apps/gateway/internal/metering/pricing.go`
   - 扩展结构：`ModelPricing` 增加 `Tier`、`InputPerM/OutputPerM/ReasoningPerM`、`Surcharges []SurchargeRule`（含 `When` 条件：`context_tokens_gte` / `has_reasoning` / `tool_calls_gte`，`AddPerM` 或 `MultiplierPct`）、`EffectiveDate`。
   - `ComputeCostUSD(usage, model, at time.Time)`：选生效版本 → 基础成本 → 叠加命中的 surcharge → 返回 `cost`、`pricingVersion`。
2. `enterprise/apps/gateway/internal/metering/reporter.go`
   - 调用新签名，写入 `cost_usd` 与 `pricing_version`（如表无该列则走 metadata JSON，避免 schema 破坏性变更）。
3. `enterprise/apps/admin-console/`（计价配置）
   - 新增 PG 表 `enterprise_runtime_pricing`（迁移随 `packages/db-schema`）。
   - `src/app/api/internal/pricing-snapshot/route.ts` 输出 active 计价快照（对齐既有 `policy-snapshot` / `token-quota` 模式）。
   - 计价编辑 UI 复用 metering/quota 页风格（最小新增页或区块）。
4. `enterprise/apps/gateway/internal/metering/`（快照拉取）
   - 新增 `pricing_loader.go`：`GATEWAY_REMOTE_PRICING_CONFIG_URL` 定时拉取，回落本地 `pricing.yaml`。

不动：限流/配额、策略引擎、审计链、JWT、`usage_records` 既有列定义（新增列须走迁移且可选）。

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/metering/...`（覆盖 AC-1 数值断言、快照回落）。
2. 起 admin-console，改单价并发布；本地起网关指向快照 URL，发一次 `/v1/chat/completions`，查 `usage_records.cost_usd` 与 `pricing_version`（AC-2）。
3. 停 admin / 配错 URL，确认回落本地表且计费继续（AC-3）。

## 回滚

- 计价为「读取 → 计算」纯函数扩展；移除 surcharge 配置即退回基础单价；快照 URL 留空即纯本地表。无数据破坏性变更（新增列可选）。
