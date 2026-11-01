# E5 Executable Subplan — 硬化与完整 E2E

> Parent: `docs/plans/2026-10-31-enterprise-capability-platform-master-plan.md`  
> Status: Done (merged #232; PG closed-loop fix #233)  
> Depends: E1–E4  
> Branch: `feat/ecp-e5-harden-e2e`  
> Planned-with: composer-2.5  
> Suggested-Impl-Model: composer-2.5

## Goal

1. **Docs harden**：权限矩阵、审计事件、错误码、E1–E5 联合发版说明；`docs/roadmap.md` M19 交叉引用。  
2. **Full synthetic E2E**：master §8 `e2e-enterprise-capability-platform`（skill S + expert_package E）。  
3. **PG copper-pipe fixture**（E4 PR 遗留）：grant → 二次分配 → revoke / install_copy 矩阵；`ECP_PLATFORM_TENANT_ID` 文档化。

## Non-goals

- 客户种子/文案；Desktop Mac UI 点击铜管；重写 E1–E4 API 风格；Dependabot。

## Done when

- [x] 本 plan 定稿并随 PR 提交  
- [x] `enterprise/docs/features/ecp/*` 硬化文档齐全且 README 可导航  
- [x] `ecp-e5-closed-loop.synthetic.test.ts` 覆盖 master §8 各步断言  
- [x] `ecp-e5-closed-loop.pg.integration.test.ts` + fixture：有 `DATABASE_URL` 时跑通 grant/assign/revoke/install_copy  
- [x] `@agenticx/config` · `ecp-errors.ts` + 单测  
- [x] `CreateSkillInput` 接口声明修复（E4 遗留语法缺口）  
- [ ] PR 打开；本地/CI 相关 vitest 命令在 PR 描述列出  
- [x] 全部 commit author/committer = Damon Li；仅白名单 trailers

## Key paths

| 区域 | 路径 |
|---|---|
| 文档 | `enterprise/docs/features/ecp/` |
| 错误码 | `enterprise/packages/config/src/ecp-errors.ts` |
| 合成 E2E | `enterprise/apps/admin-console/src/lib/__tests__/ecp-e5-closed-loop.synthetic.test.ts` |
| PG fixture | `enterprise/apps/admin-console/src/lib/__tests__/fixtures/ecp-e5-pg-fixture.ts` |
| PG E2E | `enterprise/apps/admin-console/src/lib/__tests__/ecp-e5-closed-loop.pg.integration.test.ts` |
| 路线图 | `docs/roadmap.md` · M19 |
| 环境变量 | `enterprise/docs/features/ecp/platform-tenant-env.md` · `enterprise/docs/configuration/env-vars.md` |

## AC（可执行）

1. **FR-DOC-1**：权限矩阵含 platform_operator / enterprise_admin / 成员三列与 revoke 表。  
2. **FR-DOC-2**：错误码表与 `resolveEcpErrorCode` 一致。  
3. **FR-TEST-1**：`pnpm -C enterprise/packages/config test -- ecp-errors` 绿。  
4. **FR-TEST-2**：`pnpm -C enterprise/apps/admin-console test -- ecp-e5-closed-loop.synthetic` 绿（无 DB）。  
5. **FR-TEST-3**：`DATABASE_URL=... pnpm -C enterprise/apps/admin-console test -- ecp-e5-closed-loop.pg` 绿（本地 PG + migrate 后）。  
6. **NFR-1**：commit/PR 无客户名、无第三方对标措辞。

## 验证命令

```bash
pnpm -C enterprise/packages/config test -- ecp-errors
pnpm -C enterprise/packages/config test -- ecp-shelf ecp-approval ecp-expert
pnpm -C enterprise/apps/admin-console test -- ecp-e5
# 可选 PG：
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/agenticx'
pnpm -C enterprise/packages/db-schema db:migrate:pg
export ECP_PLATFORM_TENANT_ID='<seed-platform-ulid>'
pnpm -C enterprise/apps/admin-console test -- ecp-e5-closed-loop.pg
```

Made-with: Damon Li · Impl-Model: composer-2.5 · Plan-File: docs/plans/2026-11-01-ecp-e5-harden-e2e.md

