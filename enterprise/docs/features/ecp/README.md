# AGX 企业能力平台（ECP）

可复用的 **能力货架 + 跨租户分发 + 可插拔审核 + 专家包（expert_package）** 平台层，挂在 `admin-console` / `web-portal` / Desktop 运行时同步之上。

## 文档索引

| 文档 | 说明 |
|---|---|
| [permission-matrix.md](./permission-matrix.md) | 平台运营 vs 租户 admin 权限与只读元数据 |
| [audit-events.md](./audit-events.md) | 货架 / 分发 / 审批关键事件（逻辑审计点） |
| [error-codes.md](./error-codes.md) | 稳定错误码与 HTTP 映射建议 |
| [release-notes-e1-e5.md](./release-notes-e1-e5.md) | E1–E5 联合发版说明 |
| [platform-tenant-env.md](./platform-tenant-env.md) | `ECP_PLATFORM_TENANT_ID` 与平台侧模板租户 |

## 规划与验收

- Master plan：`docs/plans/2026-10-31-enterprise-capability-platform-master-plan.md`
- 闭环 E2E case 名称：`e2e-enterprise-capability-platform`（见 master §8）
- 路线图：[docs/roadmap.md](../../../../docs/roadmap.md) · **M19 Enterprise Capability Platform**

## 自动化测试

| 层级 | 路径 | 运行方式 |
|---|---|---|
| 合成闭环（无 DB） | `admin-console` · `ecp-e5-closed-loop.synthetic.test.ts` | `pnpm -C enterprise/apps/admin-console test` |
| PG 铜管 fixture | `admin-console` · `ecp-e5-closed-loop.pg.integration.test.ts` | 需 `DATABASE_URL` + 已 migrate；见 E5 plan |

Desktop UI 端到端不在云端 CI 覆盖；本地 Mac 验证 bootstrap 与 Marketplace 同步。
