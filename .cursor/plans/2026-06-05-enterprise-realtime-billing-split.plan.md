---
name: 多方实时分账（结算自动化）
overview: 基于 usage_records 与计价结果，实现「多方协作场景的分账规则 + 实时分账账本 + 对账导出」。智能合约/数据要素交易作为接口占位与设计说明，不在本期落地区块链实现。
todos:
  - id: t1-split-rule
    content: 定义分账规则（按参与方/比例/计费项）PG 表与配置 API
    status: completed
  - id: t2-ledger
    content: usage 结算时按规则拆分写入分账账本
    status: completed
  - id: t3-reconcile
    content: 分账对账与导出（按周期/参与方汇总）
    status: completed
  - id: t4-admin-ui
    content: admin 分账规则配置 + 账本/对账视图
    status: completed
  - id: t5-contract-stub
    content: 智能合约/数据要素交易接口占位与设计文档
    status: completed
  - id: t6-smoke
    content: 冒烟测试覆盖按比例拆分、对账汇总、占位接口
    status: completed
isProject: false
---

# 多方实时分账（结算自动化）

**Plan-Id**: 2026-06-05-enterprise-realtime-billing-split
**Plan-File**: `.cursor/plans/2026-06-05-enterprise-realtime-billing-split.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：网关有 token 计量与（动态计价 plan 落地后）成本，但**无分账（billing split / chargeback）、无智能合约**。客户要求「实时分账（多方协作）」「内置智能合约（数据要素市场交易）」。本 plan 落地**可演示的分账账本 + 对账**；智能合约/链上交易因依赖外部区块链基础设施且法律口径未定，仅做接口占位与设计文档，**不承诺链上实现**。

## 需求

- FR-1: 分账规则：为某租户/业务定义参与方（如平台/数据提供方/模型方）与拆分方式（固定比例 / 按计费项 / 阶梯），可配置生效周期。
- FR-2: 实时分账：每条 usage 结算（取计价成本）后按规则拆分，写入分账账本 `billing_split_ledger`（含 usage 关联、参与方、金额、规则版本）。
- FR-3: 对账：按周期/参与方汇总分账、导出 CSV，金额可追溯到明细。
- FR-4（占位）: 提供 `settlement_contract` 接口抽象（签名/回调 webhook）与设计文档，描述未来对接智能合约/数据要素交易平台的方式；本期实现为可配置 webhook 通知 + 留痕，不含链上逻辑。
- NFR-1: 分账为 usage 之后的派生写入，失败不影响主计量；金额计算用整数最小币种单位避免浮点误差。
- AC-1: 配置 70/30 两方比例，一条成本明细被正确拆为两条账本记录且合计等于原成本。
- AC-2: 对账按参与方汇总金额与账本明细一致，导出正确。
- AC-3: webhook 占位接口被调用并记录，未配置时不报错。

## 改动范围（严格）

1. `enterprise/packages/db-schema/`
   - 新增 `billing_split_rules`、`billing_split_ledger` 迁移。
2. `enterprise/apps/admin-console/src/features/`（新增 `billing/` 或并入 metering）
   - 分账规则 CRUD service/API；账本聚合与对账 service/API（沿用 metering 鉴权 scope，新增 `billing:manage` 若需要）。
   - usage 结算后触发拆分：在 admin 侧 metering 入库路径（`features/metering/src/services/metering.ts` 落库点）后做派生拆分，避免改 Go 网关。
3. `enterprise/apps/admin-console/src/app/`
   - 分账规则配置页 + 账本/对账视图 + 导出。
4. 文档 + 占位接口
   - `enterprise/docs/billing/settlement-contract.md` 设计说明；webhook 通知 service（可配置 URL）。

不动：Go 网关计量与计价、portal、审计链。

## 验证步骤

1. `pnpm -C enterprise --filter admin-console test`（拆分比例/对账/整数金额单测，AC-1/2）。
2. 本地灌 usage + 配规则，核对账本与对账导出；配 webhook 验证占位调用（AC-3）。

## 回滚

- 分账为派生层，删规则与账本表即回滚；不影响主计量与计价；智能合约仅文档与占位 webhook，无外部依赖。
