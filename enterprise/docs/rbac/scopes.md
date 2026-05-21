# RBAC Scopes

Scope 是 Enterprise 权限的最小单元，格式为 `resource:verb`。

**单一来源**：`packages/iam-core/src/scope-registry.ts`

---

## 注册表

| Resource | Verbs | 示例 scope |
|---|---|---|
| admin | enter | `admin:enter` — 进入管理台 |
| user | read, create, update, delete, manage | `user:read` |
| dept | read, create, update, delete, manage | `dept:manage` |
| role | read, create, update, delete, manage | `role:create` |
| audit | read, read:all, read:dept, export, manage | `audit:read:dept` |
| metering | read, export, manage | `metering:export` |
| workspace | read, chat, manage | `workspace:chat` — 前台聊天 |
| policy | read, create, update, delete, publish, disable, manage | `policy:publish` |
| model | read, create, update, delete, manage | `model:manage` |
| kb | read, create, update, delete, manage | 知识库（预留） |
| automation | read, create, update, delete, manage | 自动化（预留） |
| gateway | read, manage | Gateway 配置 |
| provider | read, create, update, delete, manage | 模型服务商 |
| sso | read, create, update, delete, manage | SSO Provider |

---

## 特殊值

| 值 | 含义 |
|---|---|
| `*` | 拥有全部注册 scope（超级管理员） |

函数：

- `expandRoleScopes()` — 展开 `*`
- `mergeUserScopes()` — 多角色合并去重
- `hasEveryScope()` / `hasSomeScope()` — API 路由校验

---

## 默认种子角色（参考）

`db:seed` + 可选 `iam-demo-seed` 注入演示数据。典型配置：

| 角色 code | 用途 | 典型 scopes |
|---|---|---|
| owner | 租户拥有者 | `*` 或全量 manage |
| admin | 平台管理员 | `admin:enter`, IAM, policy, audit:read:all, model:* |
| security | 安全审计 | `audit:read:all`, `policy:read`, `metering:read` |
| member | 普通员工 | `workspace:chat`, `workspace:read` |

**Portal 聊天最低要求**：`workspace:chat`  
默认 owner 已自带；旧环境 HMR 可能自动补齐。

---

## 审计可见域

| Scope | 可见范围 |
|---|---|
| `audit:read:all` | 全租户 gateway 审计 |
| `audit:read:dept` | 本部门相关记录 |
| `audit:export` | 导出权限 |

**注意**：仅用旧 scope `audit:read` 在部门隔离场景可能 **403**，需升级为 `audit:read:dept` 或 `audit:read:all`。

IAM 管理审计（`audit_events` 表）与 gateway 审计分开授权，路由层分别校验。

---

## API 路由映射示例

| 路由 | 所需 scope |
|---|---|
| `GET /api/admin/users` | `user:read` |
| `POST /api/policy/publish` | `policy:publish` |
| `PUT /api/admin/users/:id/models` | `model:manage` |
| `POST /api/audit/query` | `audit:read:all` 或 `audit:read:dept` |
| Portal `/api/chat/completions` | `workspace:chat` |

具体校验见各 feature 的 `middleware/rbac.ts` 与 admin route handler。

---

## 角色编辑 UI

Admin `/iam/roles`：

- scopes 多选来自 `ALL_REGISTERED_SCOPES`
- 系统 immutable 角色不可删
- 保存后立即生效（JWT 内 scopes 在下次登录/refresh 更新）

---

## 扩展新 scope

1. 在 `SCOPE_REGISTRY` 添加 resource/verb
2. 在对应 API route 调用 `hasEveryScope`
3. 更新本文档与 admin 角色模板 seed
4. **不要** 在客户仓硬编码 scope 字符串而不回流 registry

---

## 相关文档

- [features/README.md](../features/README.md) — iam feature
- [api/admin-console.md](../api/admin-console.md)
