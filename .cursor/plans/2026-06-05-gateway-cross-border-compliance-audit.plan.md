---
name: 跨境数据流动合规审计与数据驻留
overview: 为网关增加「数据驻留标记 + 跨境流动判定与审计 + 合规日志留存策略」，在请求识别数据域/目标上游地域，命中跨境时打标、审计、按策略放行/拦截/审批占位，并实现 HIPAA 式审计日志留存配置。
todos:
  - id: t1-region-tagging
    content: 上游 channel 与租户增加 region/residency 元数据
    status: completed
  - id: t2-crossborder-judge
    content: 请求链判定是否跨境（数据域 vs 上游地域）并打标
    status: completed
  - id: t3-audit-fields
    content: 审计事件扩展跨境字段（src/dst region、判定结果、规则）
    status: completed
  - id: t4-retention
    content: 审计日志留存策略（保留周期/不可篡改/导出）配置化
    status: completed
  - id: t5-admin-view
    content: admin 跨境审计查询视图 + 合规留存设置
    status: completed
  - id: t6-smoke
    content: 冒烟测试覆盖跨境打标、审计落链、留存策略
    status: completed
isProject: false
---

# 跨境数据流动合规审计与数据驻留

**Plan-Id**: 2026-06-05-gateway-cross-border-compliance-audit
**Plan-File**: `.cursor/plans/2026-06-05-gateway-cross-border-compliance-audit.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：Blake2b 哈希链审计已落地（`enterprise/apps/gateway/internal/audit/writer.go` + PG `gateway_audit_events`），但**无 region/数据驻留概念、无跨境流动判定与审计、无显式留存策略**。客户要求「跨境流动合规审计（满足各国数据主权）」并涉及 HIPAA 审计日志留存。本 plan 落地**判定 + 审计 + 留存**的可演示闭环；真实的跨境审批工作流与法律认定属客户分阶段提供，仅预留接入位。

## 需求

- FR-1: 上游 channel 配置增加 `region`（如 `cn`/`us`/`eu`），租户/数据域配置 `data_residency`；请求携带或按租户推断数据域。
- FR-2: 请求链判定「数据域 → 上游地域」是否构成跨境；命中跨境时打标，按策略动作 `allow`/`block`/`require_approval`（审批为占位状态，记录待审，不内置完整审批流）。
- FR-3: 审计事件扩展字段：`src_region`、`dst_region`、`cross_border`(bool)、`residency_rule`，随哈希链落库。
- FR-4: 审计日志留存策略可配置：保留周期、是否只追加（已有链式不可篡改）、导出归档；提供 HIPAA 式最小留存（如 ≥6 年可配）。
- NFR-1: 未配置 region 时视为同域，零行为变化；判定失败 fail-open 记录但不拦截（除非显式 block 规则）。
- AC-1: 配置 cn 数据域 + us 上游，请求被标记 `cross_border=true` 并落审计。
- AC-2: 配置 `require_approval`，请求被标记待审并记录，不静默放行也不误删数据。
- AC-3: 留存策略设置后，审计查询/导出按周期生效，链校验仍通过。

## 改动范围（严格）

1. `enterprise/apps/gateway/internal/` (channel/identity)
   - channel 配置结构增 `region`；identity/tenant 解析增 `dataResidency`（JWT claim 或租户配置）。
2. `enterprise/apps/gateway/internal/server/server.go`
   - 请求前增加跨境判定函数，结果注入审计上下文与策略动作。
3. `enterprise/apps/gateway/internal/audit/writer.go` + `enterprise/packages/db-schema/`
   - 审计记录扩展跨境字段（迁移新增可选列），不破坏既有链 checksum 计算（字段纳入摘要时同步更新 hash 输入定义并加测试）。
4. `enterprise/apps/admin-console/`
   - 审计页增跨境筛选/视图；新增「合规留存」设置（保留周期/导出），写 PG 配置表。

不动：现有审计链算法（仅扩展摘要输入并补测）、策略草稿/发布、JWT 基础解析。

## 验证步骤

1. `go test ./internal/audit/... ./internal/server/...`（含链校验在新字段下仍通过、AC-1/2）。
2. 本地配 region 发跨境请求，admin 审计页确认打标与筛选；导出验证留存（AC-3）。
3. `GET /api/audit/chain-verify` 返回链完整。

## 回滚

- region/驻留字段可选，留空即同域无行为变化；审计新增列为可选迁移；判定与留存为旁路扩展，可关闭。
