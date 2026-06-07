---
name: 词元消耗热力图与 ROI 分析报表
overview: 在 admin-console metering 模块基于现有 usage_records 聚合，新增「词元消耗热力图（业务/时段维度）」与「ROI 分析报表（词元成本 vs 业务收益输入）」两块价值可视化，纯前端 + 聚合 API，不改网关计量。
todos:
  - id: t1-heatmap-api
    content: 新增热力图聚合 API（维度×时段的 token/成本矩阵）
    status: completed
  - id: t2-heatmap-ui
    content: admin metering 页新增热力图组件
    status: completed
  - id: t3-roi-input
    content: ROI 报表的收益输入模型（业务场景标签 + 收益录入）PG 表 + API
    status: completed
  - id: t4-roi-report
    content: ROI 报表页（成本 vs 收益、ROI 排序、导出）
    status: completed
  - id: t5-smoke
    content: 冒烟/组件测试覆盖聚合正确性与空数据态
    status: completed
isProject: false
---

# 词元消耗热力图与 ROI 分析报表

**Plan-Id**: 2026-06-05-enterprise-token-heatmap-roi-analytics
**Plan-File**: `.cursor/plans/2026-06-05-enterprise-token-heatmap-roi-analytics.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：admin-console metering 已 PG 化（`enterprise/apps/admin-console/src/app/metering/page.tsx` + `features/metering/src/services/metering.ts`），但只有折线/柱状图，**无热力图、无 ROI 报表**。客户要求「词元消耗热力图（识别高价值场景）」「ROI 分析报告（成本 vs 收益）」。本 plan 为 admin 端分析能力扩展，**不改网关计量链路**，纯消费 `usage_records`。

## 需求

- FR-1（热力图）: 按「业务维度（部门/PAT/模型/业务标签）× 时段（小时/天）」聚合 token 与成本，输出矩阵供热力图渲染。
- FR-2（业务标签）: usage 维度允许按已有字段（部门/PAT/模型）分组；若需「业务场景」标签，复用请求 metadata 中已存在的标签字段，不强制改网关。
- FR-3（ROI）: 提供业务场景的收益录入（人工/导入），与对应词元成本对比，计算 ROI 并排序，支持导出 CSV。
- NFR-1: 全部基于现有 `usage_records` 与新增收益表的只读聚合；大区间查询走分页/限制避免拖垮 PG。
- NFR-2: 权限沿用 metering scope；无数据时展示空态而非报错。
- AC-1: 给定一段 usage，热力图矩阵单元值与手工 SQL 聚合一致。
- AC-2: 录入某场景收益后，ROI 报表显示 `(收益-成本)/成本` 且按 ROI 排序正确。
- AC-3: 空数据/无收益录入时页面正常展示空态。

## 改动范围（严格）

1. `enterprise/apps/admin-console/src/features/metering/`
   - `services/metering.ts` 增 `queryHeatmap()` 聚合（维度×时段）。
   - 新增 `services/roi.ts`：收益录入 CRUD + ROI 计算。
2. `enterprise/apps/admin-console/src/app/api/metering/`
   - `heatmap/route.ts`、`roi/route.ts`（沿用现有 metering API 鉴权）。
3. `enterprise/packages/db-schema/`
   - 新增 `enterprise_business_revenue`（场景标签、周期、收益额）迁移。
4. `enterprise/apps/admin-console/src/app/metering/`
   - 热力图组件（复用现有图表依赖，如 recharts；热力图用网格 + 色阶，注意 recharts v3 tick 类型约束）。
   - ROI 报表页/区块 + 导出。

不动：网关计量、usage_records schema、portal。

## 验证步骤

1. `pnpm -C enterprise --filter admin-console test`（聚合与 ROI 计算单测，AC-1/2）。
2. 本地起 admin（先 `start-dev-with-infra.sh` 起 PG），灌入 usage 样本，核对热力图与手工 SQL；录入收益核对 ROI（AC-1/2）。
3. 清空数据验证空态（AC-3）。

## 回滚

- 纯新增页面/API/表，移除路由与迁移即回滚；不影响既有 metering 页与网关。
