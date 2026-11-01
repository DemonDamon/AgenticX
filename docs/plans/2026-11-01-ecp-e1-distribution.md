# E1 Executable Subplan — 跨租户分发（grant / revoke）

> Parent: `docs/plans/2026-10-31-enterprise-capability-platform-master-plan.md`  
> Status: Done (merged #228)  
> Branch: `feat/ecp-e1-distribution`

## Goal
平台目录条目可 grant 给指定租户；租户侧对平台下发物只读元数据、可二次分配；revoke 默认停止更新并保留已同步副本（可选立即剥离）。

## Non-goals
货架 draft/publish（E2）。审核流（E3）。expert_package / 安装副本（E4）。客户定制 UI。

## Files (expected)
- Create: `enterprise/packages/db-schema/src/schema/platform-catalog.ts`（或等价命名）
- Create: drizzle migration(s) under `enterprise/packages/db-schema/drizzle/` + mysql 对照
- Modify: `enterprise/packages/db-schema/src/schema/index.ts`（导出）
- Create: admin Internal API `enterprise/apps/admin-console/src/app/api/admin/platform-catalog/`（list/create + grant/revoke）
- Modify: skills / packs 读路径，标记 `origin: platform | tenant` 与只读元数据
- Modify: `enterprise/apps/web-portal/src/lib/capability-packs-reader.ts` + bootstrap 相关，使 revoke 后不再下发**更新**（默认保留本地已有）
- Modify: `desktop/electron/enterprise-capabilities-sync.ts` 若需识别 revoke/停更语义
- Test: store + API + reader/bootstrap 单测；合成两租户 E2E 脚本或 vitest

## Data model (minimal)
- `platform_catalog_items`: id, slug, display_name, description, resource_type (`skill` 起步), payload_ref (bundle_uri/digest 等), status (`active`/`disabled`), audit
- `tenant_distribution_grants`: id, catalog_item_id, tenant_id, status (`granted`/`revoked`), revoke_policy (`retain_stop_updates` | `strip_bootstrap`), granted_at, revoked_at, audit
- 租户库现有 `enterprise_skills`：增加 `origin`（`tenant`|`platform`）+ `platform_catalog_item_id`（可空）；平台下发写入/同步时填这些字段；API 更新元数据时若 origin=platform → 403

## Steps
- [ ] 加 schema + 双库 migration + schema-parity / migration-inventory 测试绿
- [ ] Internal API：创建 catalog item；grant(tenantId)；revoke(tenantId, policy?)
- [ ] grant 时：在目标租户 upsert 只读 skill（或引用），可供现有 Pack assignment 使用
- [ ] 租户 Admin：列表区分平台下发 / 自建；平台物 PATCH 元数据拒绝
- [ ] revoke 默认 `retain_stop_updates`：bootstrap/reader 不再推送该 item 的新版本；可选 `strip_bootstrap` 从下发列表移除
- [ ] 单测覆盖 grant/revoke/只读
- [ ] **E2E**：两租户 A/B；grant 仅 A；A 可见可分配、B 不可见；revoke A 后停更新且默认副本策略可断言
- [ ] PR：仅 E1；作者 Damon；说明准入闸门与非目标

## Done when
两租户 E2E 绿；平台物只读强制；revoke 默认语义与 master plan 一致；PR 可审。
