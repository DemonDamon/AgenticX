# Enterprise IAM Full Build-out（去 mock，真落库，企业级可用）

> **Plan-Id**: `2026-05-04-enterprise-iam-full-buildout`  
> **范围**: `enterprise/` 下「身份与权限」全部页面（用户 / 部门 / 角色 / 批量导入）+ 后端 API + db-schema + IAM features + 跨 admin/portal 鉴权一致性。  
> **绝对不允许 mock**：所有列表 / 创建 / 编辑 / 删除 / 启停 / 角色赋予 / 部门绑定，统一走 PostgreSQL（`@agenticx/db-schema`）。  
> **客户对齐**: 《大模型一体化应用服务采购技术规范书》§1.4「按部门-员工-模型厂商-时间段四维查询消耗」、§2「子账号管理 + 权限一键冻结回收」、§五账号开通容量 ≥200。

---

## 0. 现状基线（Why we need this）

| 模块 | 真实状况 | 问题 |
|---|---|---|
| `/iam/users` | 进程内 `Map`（`apps/admin-console/src/lib/users-store.ts`），dev seed 重启清空 | 不能 `Plan-Id`/分页/搜索；与 `web-portal` 各跑一个内存仓 |
| `/iam/departments` | 完全 mock（`mockDepartments` 写死），按钮无 onClick | 客户「按部门统计 token」直接落不下来 |
| `/iam/roles` | 4 个写死的 `SYSTEM_ROLE_TEMPLATES`，"新建角色"无 onClick；无角色赋予用户的入口 | 无法满足 §2 RBAC |
| `/iam/bulk-import` | UI Stepper OK，调用的是 `features/iam/src/services/bulk-import.ts` 的内存 `IamUserService`；CSV 表头硬编码 | 客户要求"按部门员工模型厂商时间段查询消耗" — 导入字段缺 `dept_path` / `role`，无法初始化部门归属与角色 |
| `db-schema` | `users / departments / organizations / roles / user_roles / usage_records` 表结构都已存在并迁移到 `0004_overrated_slyde` | 仅 `usage_records` 与 `chat_*` 真正使用 |
| AuthZ | `requireAdminSession` 仅校验 cookie，不查 scope | 任何登录后用户都能调任何 admin API |

---

## 1. 设计原则（Non-negotiables）

1. **唯一数据源**：所有 IAM 实体写入 PostgreSQL；**禁止**新增 in-memory store。`apps/admin-console/src/lib/users-store.ts` / `features/iam/src/services/*.ts` 的 `Map` 实现全部下线（保留接口签名，迁到 drizzle）。
2. **跨 app 一致**：`admin-console` 与 `web-portal` 写同一张 `users`；`web-portal/src/lib/auth-runtime.ts` 的内存 `SharedAuthUserRepository` 改为 **PG-backed**（保留接口）。
3. **RBAC 守卫**：所有 `/api/admin/*` 路由强制 `requireAdminScope("user:create" | ...)`；缺权返回 403 而非 401。
4. **多租户硬隔离**：所有查询条件强制 `tenant_id = session.tenantId`；不允许跨租户读写。
5. **审计可追溯**：用户/部门/角色 CRUD 必须写一条 `audit_events` 行（事件类型、actor、target、diff 摘要）。
6. **批量导入升级**：CSV 表头必须**支持自定义映射**（非硬编码 4 列）。最低支持：`email / display_name / dept_path / role_codes / phone / employee_no / status`。导入失败行**可下载**修订版 CSV。
7. **企业级容量验证**：导入 200 行 ≤ 30s，列表 SSR/分页加载 ≤ 800ms（200 用户 / 50 部门规模）。

---

## 2. 数据层调整（最小增量）

> 不动现有 5 张表的列定义，**只做补强 + 新增 1 张审计表**。

### 2.1 现有表沿用

- `users(id, tenant_id, dept_id, email, display_name, password_hash, status, ...)` ✅
- `departments(id, tenant_id, org_id, parent_id, name, path, ...)` ✅
- `organizations(id, tenant_id, name, ...)` ✅（多 org 后续再说，本期单 org 够用）
- `roles(id, tenant_id, code, name, scopes jsonb, immutable, ...)` ✅
- `user_roles(tenant_id, user_id, role_id, scope_org_id, scope_dept_id, ...)` ✅
- `usage_records(... user_id, dept_id ...)` ✅（已支持四维查询底座）

### 2.2 新增 `audit_events` 表（migration `0005_*`）

```sql
CREATE TABLE audit_events (
  id           varchar(26) PRIMARY KEY,
  tenant_id    varchar(26) NOT NULL REFERENCES tenants(id),
  actor_user_id varchar(26),                -- 操作人；admin-console 登录态
  event_type   varchar(64) NOT NULL,        -- iam.user.create / iam.role.assign / iam.dept.delete / ...
  target_kind  varchar(32) NOT NULL,        -- user | dept | role | bulk_import
  target_id    varchar(64),
  detail       jsonb,                       -- {before, after, csv_row, ...}
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_time_idx ON audit_events (tenant_id, created_at DESC);
CREATE INDEX audit_events_target_idx ON audit_events (tenant_id, target_kind, target_id);
```

### 2.3 `users` 表小幅扩列（migration `0006_*`，不阻塞主线）

为满足"批量导入支持自定义表头"需求：

```sql
ALTER TABLE users
  ADD COLUMN phone        varchar(32),
  ADD COLUMN employee_no  varchar(64),
  ADD COLUMN job_title    varchar(128);
CREATE INDEX users_tenant_employee_no_idx ON users (tenant_id, employee_no);
```

> 说明：客户规范没强制"工号 / 手机号"，但这是任何企业 IAM 真实可用的最低字段，且批量开通时甲方一定会丢这些字段进来。

---

## 3. 分阶段交付（每阶段独立可发布）

### Phase 1 — 基础设施（共享 PG 仓 + 审计 + RBAC）

- **F1.1**: 新建 `enterprise/packages/iam-core/`（或复用 `features/iam/src/services/`，但**重写为 drizzle 实现**），导出：
  - `PgUserRepository` / `PgDepartmentRepository` / `PgRoleRepository` / `PgUserRoleRepository` / `PgAuditRepository`
  - 全部基于 `drizzle-orm` + `Pool`，复用 `web-portal/src/lib/chat-history.ts` 的 `getDb()` 模式（singleton + dev fallback DSN）。
- **F1.2**: 新增 migration `0005_*` (`audit_events`) 与 `0006_*` (`users.phone/employee_no/job_title`)，跑 `pnpm --filter @agenticx/db-schema db:migrate` 验证。
- **F1.3**: 新增 `apps/admin-console/src/lib/admin-rbac.ts`：`requireAdminScope(scopes: string[])`。读取 `admin_console_session` cookie → 关联 PG `users` → 拉 `user_roles` 聚合 scopes → 缺权 403。
- **F1.4**: `web-portal/src/lib/auth-runtime.ts` 的 `SharedAuthUserRepository` 改为 `PgUserRepository`，`syncAuthUserToPostgres` 退化为内部 upsert（保留以兼容老调用）。
- **AC**:
  - `pnpm --filter @agenticx/db-schema db:migrate` 干净跑过；`audit_events` / 三新增列在 PG 中存在。
  - 单元测试：`PgUserRepository.upsert/list/findByEmail/delete` round-trip。
  - 集成测试：admin 登录后调用 `/api/admin/users` 必须命中 RBAC，缺 `user:read` 返回 403。

---

### Phase 2 — 用户管理真落库（`/iam/users`）

- **F2.1**: 删除 `apps/admin-console/src/lib/users-store.ts`，改为薄封装调用 `PgUserRepository`。`scopes` 字段从 `user_roles → roles.scopes` **聚合派生**（**不再**在 `users` 行上存）。
- **F2.2**: `/api/admin/users` GET：分页（`limit/offset`）+ 关键字（email/display_name/employee_no/phone）+ `deptId`（含子部门 path 前缀匹配）+ `status` + `roleCode` 筛选。
- **F2.3**: `/api/admin/users` POST：required `email/displayName`；可选 `deptId/phone/employeeNo/jobTitle/roleCodes/initialPassword`。`initialPassword` 缺省时生成 12 位强密码，写一条 `audit_events` 并把明文密码**仅在响应中**返回一次（前端"复制并发给员工"提示）。
- **F2.4**: `/api/admin/users/[id]` PATCH：支持改 `deptId / status / phone / employeeNo / jobTitle / roleCodes`（增删用户角色）。
- **F2.5**: `/api/admin/users/[id]` DELETE：**软删**（`is_deleted=true, deleted_at=now()`）；级联清掉 `user_roles`。`web-portal` 登录端读取时过滤软删。
- **F2.6**: `/api/admin/users/[id]/reset-password` POST：客户规范 §2 必须有「权限一键冻结回收」并暗含密码重置。返回新明文一次。
- **F2.7**: 前端 `iam/users/page.tsx`：
  - 部门字段：旧的纯 `Input` 改为 `DepartmentSelect`（接 `/api/admin/departments/tree`）；
  - 表单新增 `角色多选`（拉 `/api/admin/roles`）、`手机号` / `工号` / `职位`；
  - 详情抽屉新增「角色」分区（可增删 user_roles）和「重置密码」按钮。
- **AC**:
  - 重启 admin-console / web-portal 后，用户列表保留（PG 持久化）。
  - 同 owner 在 `admin-console` 创建用户后，立即能用该 owner 在 `web-portal` 登录。
  - 列表 200 用户分页 ≤ 800ms（本地 PG）。

---

### Phase 3 — 部门树真落库（`/iam/departments`）

- **F3.1**: `PgDepartmentRepository`：`createDepartment / updateDepartment / deleteDepartment / listTree / movePath`。`path` 字段维护用 `/dept-root/dept-ops/dept-ops-sales/` 形式；移动节点时**事务**重写所有子孙 `path` 前缀。
- **F3.2**: `/api/admin/departments` API：
  - GET `/`：扁平列表 + 树形（`?shape=tree|flat`）
  - POST `/`：`{ name, parentId? }` → 自动算 `path`
  - PATCH `/[id]`：`{ name?, parentId? }`（改名 / 移动）；移动时必须校验不能挂到自身子树。
  - DELETE `/[id]`：有子部门或非空成员时返回 409 `dept has children/members`。
- **F3.3**: 前端 `iam/departments/page.tsx` 全量重写：
  - 删除 `mockDepartments`；初始 `useEffect` 拉 `/api/admin/departments?shape=tree`。
  - 「新建部门」按钮 → Dialog（name + parent 选择器）。
  - 右侧详情：「编辑名称」「新建子部门」「删除」「移动到…」（`Sheet` + 树选择）。
  - 「导出结构」→ 导出 CSV `id,name,parent_id,path,member_count`。
  - 部门成员数从 `users.dept_id` 实时聚合（不再写死）。
- **AC**:
  - 在 admin-console 新建部门后，`/iam/users` 的"部门"下拉立即可见。
  - 在 portal 发对话产生 `usage_records.dept_id` 后，admin "四维消耗"按部门维度查询能命中。

---

### Phase 4 — 角色与权限真落库（`/iam/roles`）

- **F4.1**: `PgRoleRepository`：
  - 系统角色（`immutable=true`）：保留 owner/admin/auditor/member 四个 code，**安装时自动 upsert**（开 admin-console 第一次启动 / migration 后），不允许编辑 / 删除，但允许"基于其复制为自定义角色"。
  - 自定义角色：CRUD。
- **F4.2**: 新增 scopes 字典：`SCOPE_REGISTRY`（在 `iam-core` 内集中维护），覆盖 `user|dept|role|audit|metering|workspace|policy|model|kb|automation` × `read|create|update|delete|manage` 等组合。前端"新建角色"用 checkbox 矩阵勾选，不允许手输非法 scope。
- **F4.3**: `/api/admin/roles` API：GET 列表 / POST 新建 / PATCH 改名/改 scopes / DELETE 自定义角色。
- **F4.4**: `/api/admin/roles/[id]/users` GET：返回该角色下的所有用户（管理员视角"角色 → 用户"）。
- **F4.5**: 前端 `iam/roles/page.tsx`：
  - 删除 `SYSTEM_ROLE_TEMPLATES` 写死，改读 `/api/admin/roles`。
  - 「新建角色」/「复制为新角色」按钮接通 Dialog，scopes 勾选矩阵。
  - 角色卡片增加"成员数"badge，点击 → 抽屉显示成员（含搜索 / 移除）。
  - 权限矩阵改为按真实数据生成。
- **AC**:
  - 新建一个 "DataAnalyst" 自定义角色，勾选 `metering:read + audit:read`，赋予某用户后，该用户用 portal 登录即可访问对应受限页面（与 portal 的 RBAC 协同在 P5 完成）。

---

### Phase 5 — 批量导入升级（`/iam/bulk-import`）

- **F5.1**: 重写 `features/iam/src/services/bulk-import.ts`：
  - **列映射**：用户上传 CSV 后，先解析表头，由前端"映射向导"把任意列名映射到内部字段（`email* / display_name* / dept_path / role_codes / phone / employee_no / job_title / status / initial_password`）。映射规则可保存为 `~/.agenticx/iam-import-template-*.json` 或 PG 表 `iam_import_templates`（本期先存 localStorage，无需新表）。
  - **后端真执行**：调 `PgUserRepository.upsertByEmail`（按 email 幂等）+ `PgDepartmentRepository.findOrCreateByPath`（自动按 `/A/B/C/` 创建缺失部门，整事务）+ `PgUserRoleRepository.assign`（按 `role_codes` 多选 `;` 分隔）。
  - **批事务**：以 100 行为一批，单批失败回滚同批；任务进度持久化到内存（本期）+ 失败行可下载 `failures.csv`。
- **F5.2**: 前端 `iam/bulk-import/page.tsx` 新 step：
  - Step 0 上传：支持 `.csv` 文件拖拽 + textarea 双通道。
  - Step 1 列映射：表头 ↔ 内部字段（必填字段未映射时禁用下一步）。
  - Step 2 预检：原有逻辑 + 显示「将自动创建部门：A/B/C」预览；
  - Step 3 执行 + 进度；
  - Step 4 完成：下载失败行 CSV、跳转用户列表。
- **F5.3**: 提供示例 CSV 模板下载（`/templates/iam-bulk-import-example.csv`），覆盖部门路径与角色双场景。
- **AC**:
  - 上传 200 行（含中文姓名 + 多级部门 + 多角色）：导入耗时 ≤ 30s，PG 数据正确。
  - 修改示例 CSV 表头为 `邮箱 / 姓名 / 部门 / 角色`，能在向导里映射后正常导入。
  - 失败行可下载并直接重新上传修正。

---

### Phase 6 — RBAC 联动到 web-portal（前台权限闭环）

- **F6.1**: `web-portal` 登录态聚合 `user_roles → roles.scopes`，写入 JWT `scopes`（替代当前 `OWNER_DEFAULT_SCOPES` 硬编码）。
- **F6.2**: `web-portal` 中"管理员后台入口"按钮按 `scopes` 包含 `admin:enter` 显示。
- **F6.3**: 在 admin-console「停用 / 锁定」用户后，portal 的 `verifyAccessToken` / `refreshTokens` 立即拒绝（按 `users.status`）。
- **AC**:
  - 在 admin 把某用户改为 `disabled` → 该用户 portal 内下一次请求被踢出登录。

---

### Phase 7 — 验收与文档

- **F7.1**: `enterprise/scripts/reset-dev-data.sh` 增加 `--with-iam-seed`：除现有种子外，再插入 5 个示例部门 + 4 个角色 + 10 个示例用户，便于演示。
- **F7.2**: `enterprise/apps/admin-console/README.md`（新建或追加）：写入 IAM 各 API 的 cURL 示例与 RBAC 矩阵。
- **F7.3**: `docs/release-notes/`（按现有约定）追加 IAM 全量交付条目。
- **F7.4**: e2e（Playwright，可放 `enterprise/scripts/e2e-iam.ts` 或现有 visual-tour）覆盖：登录 → 新建部门 → 新建角色 → 新建用户并赋角色 → 批量导入 5 行 → 在 portal 用其中一个账号登录成功并触发一条对话 → admin "四维消耗"能按部门维度查到。

---

## 4. 风险与回退策略

| 风险 | 缓解 |
|---|---|
| 删除 `users-store.ts` 后 dev 重启重 seed 行为变化 | `iam-core/seed.ts` 在 `getDb()` 第一次连接时检测 owner 缺失则 upsert。 |
| 部门移动重写 path 影响大 | 所有 path 操作走单事务；并加并发锁（PG advisory lock 或乐观版本号），在 `0005` migration 给 `departments` 加 `path_version`。 |
| RBAC 上线后旧 admin 用户 403 | 在 `0005` migration 之后跑 `seed-admin-roles.sql`：把 `owner@agenticx.local` 自动绑定 `super_admin`。 |
| 批量导入 CSV 含中文逗号/引号 | 引入 `papaparse` 或 `csv-parse`，不再手工 `split(",")`。 |
| Phase 4 角色变化破坏 web-portal session | F6.1 上线前，portal JWT 仍读 `OWNER_DEFAULT_SCOPES` fallback；按 feature flag 灰度。 |

---

## 5. 实施顺序与并行度

> 单 PR 太大不可读，按"功能点 → 提交"分组（与 `/commit` 风格一致）：

```
P1 → P2 (依赖 P1) → P3 (并行 P2 完成后) → P4 → P5 (依赖 P3 + P4) → P6 (依赖 P4 + P5) → P7
```

**阶段性 commit 模板（每个 commit 含 Plan-Id 和 Made-with: Damon Li）**：

- `feat(db-schema): add audit_events table and users hr columns` → P1
- `feat(iam-core): drizzle-backed user/dept/role repositories` → P1
- `feat(admin-console): scope-aware RBAC guards for /api/admin/*` → P1
- `refactor(admin-console): replace in-memory users store with PG repo` → P2
- `feat(admin-console): users page with role assignment and reset password` → P2
- `feat(admin-console): department tree CRUD with path move` → P3
- `feat(admin-console): roles management with scope matrix and user binding` → P4
- `feat(admin-console): bulk import with column mapping and dept auto-create` → P5
- `feat(web-portal): JWT scopes from user_roles and disabled-user lockout` → P6
- `chore(deploy): iam seed extension and e2e visual tour` → P7

---

## 6. 与现有架构的衔接点

- **客户规范条款映射**：
  - §1.4「按部门-员工-模型厂商-时间段四维查询消耗」→ Phase 3（部门真数据）+ 现有 `usage_records.dept_id`。
  - §1.4「企业级子账号批量开通、权限分配」→ Phase 5 + Phase 4。
  - §2「权限管控、子账号管理与权限一键冻结回收」→ Phase 2（停用/锁定 + 软删）+ Phase 6（实时踢出）。
  - §五「200 账号容量」→ Phase 5 性能 AC + Phase 2 列表分页。
- **与已落库的聊天历史协同**：`chat_sessions.user_id / tenant_id` 已经依赖真实的 `users` 表（参见 `2026-05-03-enterprise-chat-history-persistence`）。本 plan 的 P2 把 `users` 真落库后，整条数据线（用户 → 部门 → 对话 → 用量）首尾贯通。

---

## 7. 不在本 plan 范围

- 多 organization（企业内多法人）UI；当前单 org 已可满足客户规范。
- SSO / OIDC / SAML 接入；`features/iam/src/middleware/rbac.ts` 之外的认证模块。
- 审计页面 UI（`audit_events` 已落库，但页面留给后续 plan）。
- 角色范围权限（`scope_org_id / scope_dept_id`）的 UI 编辑器；本期 user_roles 默认全租户作用域。
