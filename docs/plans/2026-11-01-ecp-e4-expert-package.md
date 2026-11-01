# E4 Executable Subplan — expert_package

> Parent: `docs/plans/2026-10-31-enterprise-capability-platform-master-plan.md`  
> Status: Done (merged #231)  
> Depends: E1, E2, E3  
> Branch: `feat/ecp-e4-expert-package`

## Goal

`expert_package` 可上架/分发/分配（Bundle + Capability Pack 产品化）；前台区分平台目录与组织库；**安装副本**为企业策略开关且**默认关**。

## Non-goals

新建平行 Expert 实体；Gateway wasm 当专家包；默认开启安装副本。

## Done when

- 合成 E2E/单测：专家包 manifest = 2 skill + 1 MCP；grant → 分配 → 成员可用路径可断言
- `install_copy_enabled` 默认 false；开/关两组 revoke 行为可测
- Admin：平台目录 Tab + 组织库「平台下发/自建」标识 + 分发策略开关

## Key paths

- `@agenticx/config` → `ecp-expert-package.ts`
- Schema → `0074_ecp_e4_expert_package.sql` / `0048_ecp_e4_expert_package.sql`
- Store → `expert-package-sync.ts`, `ecp-tenant-settings-store.ts`, `platform-catalog-store.ts`
- API → `/api/admin/ecp/distribution-settings`, `/api/admin/platform-catalog`（`packManifest`）
- UI → `EcpExpertPackagePanel.tsx`, capabilities Tab `ecp`

Made-with: Damon Li · Impl-Model: composer-2.5 · Plan-File: docs/plans/2026-11-01-ecp-e4-expert-package.md
