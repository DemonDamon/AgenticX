# Enterprise IAM 全量落库（2026-05-04）

关联 Plan-Id: `2026-05-04-enterprise-iam-full-buildout`

## Highlights

- **PostgreSQL 唯一数据源**：用户 / 部门 / 角色 / 用户角色绑定 / 审计事件写入 `@agenticx/db-schema`；管理端移除内存 `users-store` 等 mock。
- **`@agenticx/iam-core`**：Drizzle 仓储（用户 CRUD 与软删、部门树与 path、角色与 scope 校验、批量导入、`PgAuthUserRepository`）。
- **管理端 RBAC**：`/api/admin/*` 使用 `requireAdminScope`，越权返回 **403**。
- **Web Portal 联动**：登录态从 DB 聚合 `user_roles → roles.scopes` 写入 JWT；停用/锁定用户刷新令牌失败；具备 `admin:enter` 时显示管理后台入口。
- **IAM UI**：`/iam/users`（部门/角色/HR 字段/重置密码）、`/iam/departments`、`/iam/roles`（矩阵/成员/复制/自定义角色）、`/iam/bulk-import`（papaparse + 列映射 + 失败行 CSV）。
- **运维**：`pnpm --filter @agenticx/db-schema run db:seed:iam`；`bash enterprise/scripts/reset-dev-data.sh --with-seed --with-iam-seed`；`pnpm -C enterprise e2e:iam`（Playwright 冒烟）。

## Fixes & Improvements

- **Core / DB**：`audit_events` 表；`users.phone` / `employee_no` / `job_title` 等列（以仓库当前 migration 为准）。
- **Docs**：`enterprise/apps/admin-console/README.md` 增补 IAM `curl` 与 RBAC 说明。
