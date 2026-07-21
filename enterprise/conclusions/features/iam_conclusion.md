# @agenticx/feature-iam 模块总结

> 结论生成时间：2026-06-08（首次创建）；2026-07-21 重写（对齐真实代码、补诚实边界）

> 说明：本文档描述**身份 · 租户 · 部门 · 角色 · 权限 feature 包**（`@agenticx/feature-iam`，位于 `enterprise/features/iam`），并明确它与企业运行时后端 `@agenticx/iam-core` 的职责边界。

## 模块概述

`@agenticx/feature-iam` 是一个**自包含的 IAM 业务规则 + 类型 + RBAC 契约 + 内存参考实现 + API 信封包装 + 单个 UI 组件**包。它把"用户 / 部门 / 角色 / 权限"这一类管理后台经典工作流封装成三层：① 服务层（`services/`，纯内存实现，依赖 `@agenticx/auth` 的 `AuthContext` 做租户隔离 + scope 校验）② API 包装层（`api/`，把 service 结果统一包成 `{code,message,data}` 信封）③ 中间件（`middleware/rbac.ts`，提供 `assertTenantScope` 等可复用断言）。另含批量导入服务和一个 `DepartmentTree` UI 组件。整包用 `zod ^4` 做输入校验，类型化彻底。

**关键定位（诚实边界）**：本包的 service 全部是**内存实现**（`Map` / 数组），构造函数只接受可选的内存 repo，**没有定义可注入的持久化 repo 接口**，也不依赖任何数据库。生产环境的 IAM 落库逻辑不在本包，而在 `@agenticx/iam-core`（PG/MySQL 双方言 repo + scope-registry + PAT/session-grant/compliance 等）。admin-console 的 `/api/admin/*` 路由**直接 import iam-core** 的 repo 函数，**不经过本包的 service/API**。本包当前在 admin-console 中的实际消费**仅限 `DepartmentTreeNode` 这一个类型**（`apps/admin-console/src/app/iam/departments/page.tsx`）。因此本包更接近"IAM 业务规则与 RBAC 契约的参考实现 + 类型导出 + 部门树 UI"，**不是** admin-console 的运行时 IAM 后端。

## 目录结构

```
features/iam/
├── package.json                              # @agenticx/feature-iam（private, main=src/index.ts）
├── README.md                                 # 一句话说明（极简）
└── src/
    ├── index.ts                              # barrel：re-export 全部 types/middleware/services/api/components
    ├── types.ts                              # zod schemas + 全部 DTO（IamUser / AuditEvent / Department / IamRole / ImportJob 等）
    ├── middleware/
    │   └── rbac.ts                           # RbacError + assertTenantMatch / assertScopes / assertTenantScope
    ├── services/                             # 业务层（纯内存，不依赖 HTTP / DB）
    │   ├── user.ts                           # IamUserService（CRUD + 状态机 + 软删 + 重置密码 + 审计写入）
    │   ├── department.ts                     # DepartmentService（物化路径树管理）
    │   ├── role.ts                           # RoleService（系统角色模板 + 自定义角色 + bind/unbind）
    │   └── bulk-import.ts                     # BulkImportService（CSV 解析 + 行级校验 + 批次回滚 + 重试）
    ├── api/                                  # API 包装层（业务结果 → JSON 信封）
    │   ├── users.ts                          # IamUsersApi
    │   ├── departments.ts                    # IamDepartmentsApi
    │   ├── roles.ts                           # IamRolesApi
    │   └── bulk-import.ts                    # IamBulkImportApi
    └── components/
        └── DepartmentTree.tsx                # 部门树 UI（18px chevron + 受控选中 + memberCount）
```

## 核心组件

### 中间件 `middleware/rbac.ts`

```ts
class RbacError(message, status=403)
assertTenantMatch(auth, tenantId)              // 租户隔离断言（auth.tenantId !== tenantId → 403）
assertScopes(auth, requiredScopes[])           // scope 缺失断言（取 auth.scopes 差集）
assertTenantScope(auth, tenantId, scopes[])    // 二合一：先租户后 scope
```

**关键约束**：所有 service 方法第一参数都是 `AuthContext`（from `@agenticx/auth`），第一行就调 `assertTenantScope(auth, ..., [...])`——**租户隔离 + RBAC 强一致**。注意本中间件只做"操作者是否持有所需 scope"的硬断言，**不展开 `*` 通配、不做 scope 注册校验**；`*` 通配与注册 scope 清单的权威逻辑在 iam-core 的 `scope-registry.ts`。

### 服务层（全部内存实现）

| Service | 关键方法 | 行为 | 所需 scope |
|---|---|---|---|
| `IamUserService` | `createUser` / `listUsers` / `updateUser` / `deleteUser`(软删) / `enableUser` / `disableUser` / `resetPassword` / `listAuditEvents` | 每次变更产 `AuditEvent`（`iam.user.create/update/delete/enable/disable/reset_password`）；状态机 `active\|disabled\|locked`；邮箱按 `tenantId:email` 去重，已软删可重建 | `user:create/read/update/delete` |
| `DepartmentService` | `upsert` / `remove` / `assignMemberCount` / `listTree` | 物化路径树（`path = parentPath + name/`）；删除前校验子节点存在则拒绝；`listTree` 按 name 排序递归建树 | `dept:create/delete/update/read` |
| `RoleService` | `bootstrapSystemRoles` / `upsertRole` / `listRoles` / `bindRole` / `unbindRole` | 5 个系统角色模板（owner/admin/member/dept_admin/auditor，`immutable:true`）；`scopeSchema` 强制 `^[a-z_]+:[a-z_]+$`；**自定义角色 scope 不得超出操作者已有 scope**（除非持 `role:super`）；系统角色不可降级 immutable | `role:create/read/update` |
| `BulkImportService` | `getTemplateCsv` / `precheck` / `submit` / `getJob` / `retryFailures` | CSV 解析 + 行级 zod 校验 + CSV 内重复邮箱预检；100 行/批，**批内任一行失败则回滚同批已建账号**；`ImportJob` 状态机 `queued/running/completed/failed`；`retryFailures` 仅重跑 failures 行 | `user:create/read` |

**内存实现细节**：`IamUserService` 构造函数接受可选 `UserRepo = { users: Map<string,IamUser>; audits: AuditEvent[] }`；`DepartmentService` / `RoleService` 内部直接 `new Map()`（`RoleService` 另有 `bindings: Map<tenant:user, Set<roleId>>`）；`BulkImportService` 内部 `jobs Map` + `sourceRows Map`。**没有任何持久化接口暴露**——这是与 iam-core 的根本边界。

### 系统角色模板（`RoleService.SYSTEM_ROLE_TEMPLATES`）

| code | name | scopes |
|---|---|---|
| `owner` | Owner | user/dept/role 全 CRUD + `audit:read:all` + `audit:export` + `metering:read` |
| `admin` | Admin | user create/read/update + dept read/update + role read + audit all/export + metering read |
| `member` | Member | `user:read` |
| `dept_admin` | Dept auditor | `admin:enter` + `audit:read:dept` + `audit:export` + `metering:read` + `user:read` + `dept:read` |
| `auditor` | Auditor | `audit:read:all` + `audit:export` + `metering:read` + `user:read` + `dept:read` + `role:read` |

> 注意：这套模板是本包**硬编码**的参考清单，与 iam-core 的 `SCOPE_REGISTRY`（admin/user/dept/role/audit/metering/workspace/policy/model/kb/automation/gateway/provider/sso）**未完全对齐**——本包缺少 workspace/policy/model/kb/automation/gateway/provider/sso 等资源维度。生产侧角色与 scope 以 iam-core 的 `SCOPE_REGISTRY` + `expandRoleScopes`/`mergeUserScopes` 为准。

### API 层

每个 API 类把 service 返回值包装为 `{code:"00000", message:"ok", data: T}` 统一信封（`IamBulkImportApi.progress` 在 job 不存在时返回 `{code:"40404", message:"job not found"}`）：

```ts
class IamUsersApi { create/list/update/remove/enable/disable/resetPassword }
class IamDepartmentsApi { createOrUpdate/remove/tree }
class IamRolesApi { bootstrapSystemRoles/upsert/list/bind/unbind }
class IamBulkImportApi { template/precheck/submit/progress/retry }
```

### UI 组件 `DepartmentTree.tsx`

受控树组件：接受 `DepartmentTreeNode[]` + 可选 `selectedDepartmentId` + `onSelect(deptId)`；自定义 18px chevron SVG（注释强调"浅色主题下对比度必须足够"）；有子节点用可点 button（`aria-expanded` + 中文 `aria-label` 收起/展开），叶子节点用虚线占位 span；每行右侧 `tabular-nums` 显示 `memberCount`；按 level 缩进 `paddingLeft: 4 + level*16`。

## 公共导出

`src/index.ts` re-export 全部：types / RBAC 中间件 / 4 个 service 类 / 4 个 API 类 / `DepartmentTree` 组件。

## 依赖

| 依赖 | 用途 |
|---|---|
| `@agenticx/auth` | `AuthContext` / `AuthUser` 类型（rbac 中间件 + service 依赖） |
| `@agenticx/core-api` | 共享类型契约 |
| `@agenticx/ui` | UI 组件（DepartmentTree 用 button / icon 等） |
| `zod ^4.3.6` | 输入校验（schemas + safeParse） |
| `react ^19` | UI |

## 与 Enterprise 其他模块的关系（诚实边界）

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | **极弱消费者** | 仅 `iam/departments/page.tsx` import `DepartmentTreeNode` 类型；用户/角色/部门/审计/批量导入的 `/api/admin/*` 路由**直接走 iam-core**，不经过本包 service/API |
| `packages/auth` | 类型依赖 | `AuthContext` / `AuthUser` 来源 |
| `packages/iam-core` | **运行时后端（生产真相）** | PG/MySQL 双方言 repo（`UsersRepository`/`DepartmentsRepository`/`RolesRepository`/`AuditRepository`/`SsoProvidersRepository`）+ `scope-registry`（权威 scope 清单 + `*` 通配 + `expandRoleScopes`/`mergeUserScopes`/`hasEveryScope`）+ PAT/session-grant/compliance/quota-remaining/provider-api-key-crypto/runtime-legacy-migrate；admin-console `/api/admin/users/route.ts` 直接 `import { createAdminUser, listAdminUsers } from "@agenticx/iam-core"` |
| `packages/db-schema` | **间接（经 iam-core）** | 生产 IAM 数据落 `users`/`roles`/`departments`/`audit_events` 等表，由 iam-core repo 维护，本包不触碰 |

### 边界小结（重要）

- 本包 service 是**内存参考实现**，**无持久化 repo 注入接口**；原"admin-console 把 iam-core 的 PG repo 注入本包 service"的描述与代码不符，已更正。
- 运行时 IAM 后端 = `@agenticx/iam-core`；本包 = 业务规则/RBAC 契约参考 + 类型 + 部门树 UI。
- scope 体系两套并存：本包 `SYSTEM_ROLE_TEMPLATES` + `scopeSchema`（正则）vs iam-core `SCOPE_REGISTRY`（权威 + `*` 通配），**未对齐**，生产以 iam-core 为准。
- 若要让本包 service 真正接入生产，需先为其定义可注入的 repo 接口（对齐 iam-core `contracts.ts`），再由 admin-console 装配——目前未做。
