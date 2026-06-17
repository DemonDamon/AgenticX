# Enterprise IAM：软删除用户同邮箱重建

Plan-Id: 2026-06-17-enterprise-iam-soft-delete-user-recreate

## 背景

GitHub Issue #24：管理台删除用户后，用同一邮箱再次创建失败，界面暴露 `INSERT INTO users` 失败。

## 根因

- 用户删除为软删除（`is_deleted=true`），行仍占用 `(tenant_id, email)` 唯一索引 `users_tenant_email_uq`。
- `createAdminUser` 仅检查未删除用户，随后 INSERT 新行 → 唯一约束冲突。

## 方案

1. **应用层**：创建/导入时若存在同邮箱软删用户，UPDATE 恢复（复用原 `id`），写入新密码与角色。
2. **数据库**：将唯一索引改为 partial unique index，仅约束活跃用户（`is_deleted=false AND deleted_at IS NULL`）。

## 变更文件

- `enterprise/packages/iam-core/src/repos/users.ts`
- `enterprise/packages/iam-core/src/repos/__tests__/users-restore.test.ts`
- `enterprise/packages/db-schema/src/schema/users.ts`
- `enterprise/packages/db-schema/drizzle/0026_users_tenant_email_active_uq.sql`
- `enterprise/packages/db-schema/drizzle/meta/_journal.json`

## 验收

- AC-1：删除用户后，用同一邮箱创建成功，用户可登录。
- AC-2：未删除用户同邮箱创建仍报 `email already exists`。
- AC-3：`pnpm --filter @agenticx/iam-core test` 通过。
- AC-4：执行 `db:migrate` 后索引为 `users_tenant_email_active_uq`。

## 升级说明

```bash
pnpm --filter @agenticx/db-schema db:migrate
# 重启 admin-console / start-dev
```
