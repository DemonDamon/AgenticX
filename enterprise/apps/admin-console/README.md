# @agenticx/app-admin-console

管理员后台应用。

## 启动

```bash
pnpm dev
# http://localhost:3001
```

## 组装来源

- `@agenticx/feature-iam` — 账号 · 部门 · 角色 · 权限（前端组件）；数据层见 `@agenticx/iam-core` + PostgreSQL

## IAM API（需已登录 admin session cookie）

以下为典型 `curl`（将 `COOKIE` 换为浏览器里 `admin_console_session` 的值；`localhost:3001` 为 admin-console）。

### 用户

```bash
curl -sS -H "Cookie: admin_console_session=$COOKIE" "http://localhost:3001/api/admin/users?limit=10"
curl -sS -H "Cookie: admin_console_session=$COOKIE" -H "Content-Type: application/json" \
  -d '{"email":"u@example.com","displayName":"测试","roleCodes":["member"]}' \
  http://localhost:3001/api/admin/users
```

### 部门

```bash
curl -sS -H "Cookie: admin_console_session=$COOKIE" "http://localhost:3001/api/admin/departments?shape=tree"
```

### 角色

```bash
curl -sS -H "Cookie: admin_console_session=$COOKIE" http://localhost:3001/api/admin/roles
```

### 批量导入

```bash
curl -sS -H "Cookie: admin_console_session=$COOKIE" -H "Content-Type: application/json" \
  -d '{"rows":[{"email":"bulk1@example.com","displayName":"Bulk One","deptPath":"演示/子部门","roleCodes":["member"]}]}' \
  http://localhost:3001/api/admin/iam/bulk-import
```

## RBAC 说明

- 管理端接口使用 `requireAdminScope([...])`：无 cookie → 401；无权 → **403**。
- 常见 scope：`user:read`、`user:create`、`dept:read`、`role:read` 等；超级管理员角色可为 `*`。
- 种子用户 `owner@agenticx.local` 绑定 `super_admin`（见 `packages/db-schema/scripts/db-seed.mjs`）。
- `@agenticx/feature-metering` — 四维消耗查询
- `@agenticx/feature-audit` — 审计日志
- `@agenticx/feature-policy` — 敏感规则配置
- `@agenticx/feature-model-service` — Provider / Model / Key 池
- `@agenticx/feature-tools-mcp` — 工具 · MCP 管理
