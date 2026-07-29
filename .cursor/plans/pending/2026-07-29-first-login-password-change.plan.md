# 首次登录强制修改初始密码

Planned-with: gpt-5.6-terra
Suggested-Impl-Model: gpt-5.6-terra
Plan-Id: 2026-07-29-first-login-password-change

## 目标

让使用系统生成初始密码的 Enterprise 用户在第一次密码登录后只能进入修改密码流程；在新密码保存成功前，不能访问工作台、聊天、模型、额度、个人令牌或管理接口。管理员重置密码后也进入相同状态。已有账号、SSO 登录和用户自行设置的初始密码保持现有行为。

## 根因与证据

当前 `users` 表只有 `password_hash`、失败次数和锁定时间，没有持久化的“初始密码待修改”字段：

- `enterprise/packages/db-schema/src/schema/users.ts` 与 `enterprise/packages/db-schema/src/mysql-schema/users.ts` 均缺少该列。
- `enterprise/packages/auth/src/types.ts` 的 `AuthUser`、`AuthContext` 和 `RefreshSession` 不携带该状态；`enterprise/packages/auth/src/services/auth.ts` 因此总是签发普通会话。
- `enterprise/apps/web-portal/src/app/api/auth/login/route.ts` 成功登录后无条件写入工作台 cookie；`enterprise/apps/web-portal/src/app/workspace/page.tsx` 只判断是否存在 session。
- `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`、`api/me/**`、`api/workspace/quota/summary` 等接口只判断 `getSessionFromCookies()` 是否为空，因此只在前端跳转无法阻止直接调用。
- 系统生成密码的入口至少有 `createAdminUser()`、批量导入和 `resetUserPassword()`；它们当前只写入 hash，不记录初始密码状态。

## 范围

### In scope

- Enterprise 本地密码账号的首次登录改密状态、PG/MySQL schema 与迁移。
- 管理端新建用户时未提供初始密码、批量导入未提供初始密码、管理员重置密码后的强制改密。
- 门户登录响应、首次改密页面、改密 API、工作台页面和工作台 API 的服务端强制拦截。
- 密码变更成功后的 cookie 轮换与原 refresh session 失效。
- 覆盖上述路径的单元/路由测试和迁移清单验证。

### Out of scope

- SSO/OIDC/SAML 用户的身份提供方密码管理。
- 修改密码强度策略、忘记密码流程、管理员手工设置密码后的强制改密、账号注册入口可见性、Desktop UI 改造。
- 用户组、模型、额度、组织结构或权限语义改动。
- 网关直接 bearer-token 接入协议的重新设计；门户所有工作台请求必须在转发前被拦截。

## 兼容性与规则

1. 新增 `users.must_change_password`（布尔，非空，默认 `false`）。既有行迁移后为 `false`，避免把存量账号锁在改密页。
2. 只有系统生成的初始密码会将字段设为 `true`：
   - `createAdminUser()` 中 `initialPassword` 为空；
   - 批量导入每行 `initialPassword` 为空；
   - `resetUserPassword()`（始终生成随机密码）。
3. 管理员显式输入的初始密码、门户注册的自主密码、开发 bootstrap 和 SSO/JIT 用户应写入 `false`。
4. 成功改密将字段置为 `false`，清除登录失败/锁定状态，并为当前浏览器签发一组新 access/refresh cookie。
5. 待改密状态由数据库实时水合优先于旧 JWT。这样管理员重置密码后，已登录浏览器的下一次门户请求也会被阻断。

## 实施拆分与推荐模型

| 子工作 | 建议实施模型 | 理由 |
| --- | --- | --- |
| Schema、仓储和 JWT 状态传播 | gpt-5.6-terra | 涉及双数据库、会话轮换与安全边界。 |
| 门户改密页面和路由拦截 | gpt-5.6-terra | 需要保证页面跳转与 API 不存在绕过路径。 |
| 测试与迁移收口 | gpt-5.6-terra | 需要覆盖刷新 token、旧会话和兼容性场景。 |

## 实施步骤

### 1. 持久化字段与迁移

Suggested-Impl-Model: gpt-5.6-terra

1. 在 `enterprise/packages/db-schema/src/schema/users.ts` 的 `passwordHash` / `status` 字段之间新增：

   ```ts
   mustChangePassword: boolean("must_change_password").notNull().default(false),
   ```

   同时把 `boolean` 加入 PG Core import。

2. 在 `enterprise/packages/db-schema/src/mysql-schema/users.ts` 的相同位置新增：

   ```ts
   mustChangePassword: boolean("must_change_password").notNull().default(false),
   ```

3. 从 `enterprise/packages/db-schema/` 运行 PG 和 MySQL 的 Drizzle generate。当前基线最后文件分别是 `drizzle/0036_chat_sessions_pinned_at.sql` 和 `drizzle-mysql/0008_chat_sessions_pinned_at.sql`；预期新增下一编号的 `*_user_password_change_required.sql` 与对应 `meta/_journal.json` 条目。不要手工复用已占用编号。

4. 更新 `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts` 与 `schema-parity.test.ts` 中的迁移数量/清单断言，使两种方言都要求该迁移存在。

**验收：** 新 schema 编译后，PG 与 MySQL 都能把未指定值读取为 `false`；迁移库存测试不允许只提交单方言迁移。

### 2. 把状态接入认证类型、JWT 和 refresh 会话

Suggested-Impl-Model: gpt-5.6-terra

1. 在 `enterprise/packages/auth/src/types.ts`：
   - `AuthUser`、`AuthContext`、`RefreshSession` 新增 `mustChangePassword: boolean`；
   - `AuthTokens` 新增 `mustChangePassword: boolean`，供登录 API 和页面决定初始跳转；
   - `AuthUserRepository` 新增精确方法：

     ```ts
     updatePasswordAndClearRequirement(
       email: string,
       passwordHash: string,
     ): Promise<AuthUser | null>;
     ```

2. 在 `enterprise/packages/auth/src/services/jwt.ts` 的 `JwtService.verify()`：从 payload 读取布尔 `mustChangePassword`；老 token 缺字段时按 `false` 处理。`signAccessToken`/`signRefreshToken` 已序列化完整 `AuthContext`，无需另建 claim 名。

3. 在 `enterprise/packages/auth/src/services/auth.ts`：
   - 将当前 `loginWithPassword()` 内重复的签名/refresh-store 写入抽成私有 `issueTokens(context)`；其返回值同时含 `mustChangePassword: context.mustChangePassword`。
   - `toContext(user)` 复制 `user.mustChangePassword`。
   - 新增 `completeRequiredPasswordChange(input)`，输入为已验证 `AuthContext` 与新明文密码；仅允许 `context.mustChangePassword === true`。流程必须为：hash 新密码 → repository 原子清 flag → `refreshStore.delete(context.sessionId)` → 从更新后的用户构建 `mustChangePassword: false` 新 context → `issueTokens()`。
   - `refresh()` 继续使用 refresh JWT 的状态，因此待改密 refresh 不能把限制降级为普通 token。

4. 扩展 `InMemoryAuthUserRepository` 同步实现新 repository 方法，供测试使用。

**验收：** 待改密用户登录和 refresh 后的两个 token 都含 `mustChangePassword: true`；完成改密后旧 refresh session 不可再用，新 token 为 `false`。

### 3. 在 PG/MySQL 用户仓储保留和更新状态

Suggested-Impl-Model: gpt-5.6-terra

1. 在 `enterprise/packages/iam-core/src/repos/users.ts` 和 `enterprise/packages/iam-core/src/repos/mysql/users.ts` 的 `loadAuthUserByEmail()` / `findByEmail()` 映射中读取 `row.mustChangePassword`。

2. 为两个方言实现 `updatePasswordAndClearRequirement` 所需的底层更新：按租户和 email 更新 `passwordHash`、`mustChangePassword: false`、`failedLoginCount: 0`、`lockedUntil: null`、`status: "active"` 和 `updatedAt`；返回刷新后的 `AuthUser`。在 `PgAuthUserRepository` 与 `MysqlAuthUserRepository` 上实现 `AuthUserRepository` 方法，并保留现有租户隔离。

3. 扩展 `buildNewUserFields()`（PG 与 MySQL）、`createAdminUser()` 输入和 `upsertUserByEmailInTx()` 输入，增加 `mustChangePassword?: boolean`。生成密码时按下列伪代码写入：

   ```ts
   const suppliedInitialPassword = input.initialPassword?.trim();
   const initialPassword = suppliedInitialPassword || generateInitialPassword();
   const mustChangePassword = input.mustChangePassword ?? !suppliedInitialPassword;
   ```

   `buildNewUserFields()` 必须把该值写入新建和软删除恢复两条路径。

4. 在两个方言的 `resetUserPassword()` 更新中显式设置 `mustChangePassword: true`。审计事件沿用现有 `iam.user.reset_password`，不要写入明文密码。

5. 在 `enterprise/apps/admin-console/src/app/api/admin/iam/bulk-import/route.ts` 调用 `upsertUserByEmailInTx()` 时传入：

   ```ts
   mustChangePassword: !row.initialPassword?.trim(),
   ```

6. 在 `enterprise/packages/iam-core/src/repos/users.ts` 与 MySQL 对应 `upsertUserRowFromAuthUser()` 中，连同 `passwordHash` 一起持久化 `user.mustChangePassword`，并确保冲突更新不会把该字段丢失。

7. 在 `enterprise/apps/web-portal/src/lib/auth-runtime.ts`：
   - `ProvisionInput` 增加可选 `mustChangePassword`；
   - `provisionUserFromAdmin()` 将该字段写入 `AuthUser`，默认 `false`；
   - dev bootstrap、SSO/JIT 构造 `AuthUser` 时显式写 `mustChangePassword: false`，消除类型遗漏；
   - `loginWithPassword()` 直接返回带标记的 `AuthTokens`。

**验收：** 创建/导入未提供密码与管理员重置均为 `true`；显式初始密码、注册、SSO/JIT、既有行均为 `false`；PG/MySQL 的 `AuthUser` 读取结果一致。

### 4. 门户首次改密页面与安全拦截

Suggested-Impl-Model: gpt-5.6-terra

1. 在 `enterprise/apps/web-portal/src/lib/session.ts`：
   - 扩展 `hydrateFromDatabase()` 的泛型约束和返回对象以覆盖 `mustChangePassword`；数据库可用时必须以 live user 的 flag 覆盖 JWT 同名字段。
   - 新增 `getWorkspaceSessionFromCookies()`：内部调用 `getSessionFromCookies()`，并返回一个可区分的状态（`ready` / `unauthenticated` / `password_change_required`）。不要把待改密用户伪装成普通未登录，否则改密 API 无法认证。
   - 新增生成统一 403 JSON 的小帮助函数，错误码固定为 `40302`，消息为 `password_change_required`；不要在不同 API 复制不同文案。

2. 调整 `enterprise/apps/web-portal/src/app/page.tsx` 与 `src/app/workspace/page.tsx`：
   - 无 session → `/auth`；
   - `mustChangePassword === true` → `/auth/change-password`；
   - 仅 ready session 渲染 `WorkspaceShell`。

3. 新增 `enterprise/apps/web-portal/src/app/auth/change-password/page.tsx`：
   - server page 先用 `getSessionFromCookies()` 验证；未登录跳 `/auth`，非待改密用户跳 `/workspace`；
   - client form 包含新密码和确认密码，最小长度沿用现有本地密码入口的 8 字符规则；提交中禁用按钮，确认不一致/接口错误贴近表单显示；
   - 成功后 `window.location.assign("/workspace")`，不显示或回传旧密码。

4. 新增 `enterprise/apps/web-portal/src/app/api/auth/change-password/route.ts`：
   - 仅接受 JSON `{ newPassword: string }`；拒绝空值和长度小于 8 的密码；
   - 通过 `getSessionFromCookies()` 获取待改密 session，其他 session 返回 40302；
   - 调用 `auth-runtime` 暴露的 `completeRequiredPasswordChange()`，并用其新 tokens 覆盖 `ACCESS_COOKIE` 和 `REFRESH_COOKIE`。cookie 参数必须与现有 `api/auth/login/route.ts` 完全一致；
   - 返回 `{ code: "00000", data: { expiresInSeconds } }`，不返回任何密码或 token。

5. 修改 `enterprise/apps/web-portal/src/app/api/auth/login/route.ts`：成功 payload 新增 `data.mustChangePassword`。修改 `enterprise/apps/web-portal/src/app/auth/page.tsx` 的 `handleSignIn()`：当该值为真时忽略 `returnTo` 并跳 `/auth/change-password`，否则保持当前目标解析。

6. 用 `getWorkspaceSessionFromCookies()` 替换所有工作台受保护接口中的直接 `getSessionFromCookies()`，至少覆盖当前命中点：
   - `src/app/api/chat/completions/route.ts`；
   - `src/app/api/chat/artifacts/[id]/route.ts`、`attachments/parse/route.ts`、`deep-research/resume/route.ts`、`sessions/**`；
   - `src/app/api/me/api-tokens/route.ts`、`models/route.ts`、`web-search/route.ts`；
   - `src/app/api/workspace/quota/summary/route.ts`；
   - `src/app/api/admin/users/route.ts`。

   每个路由在 `password_change_required` 状态下使用统一 40302 响应；`api/auth/session/route.ts` 可保留返回 session（含 flag），供前端恢复状态。不要修改 SSO callback/start 的 cookie 成功流程，因为 SSO 用户不进入该状态。

7. `enterprise/apps/web-portal/src/lib/auth-runtime.ts` 中的 Desktop 密码身份入口（当前 `loginAndGetIdentity()`，若在实施分支仍存在）必须在 password login 后检查 `mustChangePassword` 并返回明确的 `password_change_required` 错误，避免用随机初始密码绕过门户改密。

**验收：** 直接访问 `/workspace` 或调用聊天、模型、额度、令牌 API 的待改密用户均被拒绝；改密 endpoint 是唯一可用的受认证写操作；成功改密后立即恢复工作台访问。

## 测试计划

1. 新增 `enterprise/packages/auth/src/services/__tests__/auth-password-change.test.ts`，使用 `InMemoryAuthUserRepository` 和开发 JWT key：
   - 待改密用户登录后，access/refresh claims 和返回 `AuthTokens` 都为 `true`；
   - refresh 不会丢失 flag；
   - `completeRequiredPasswordChange()` 更新 hash、清 flag、使旧 refresh session 无效，并签发 `false` token；
   - 非待改密 context 调用该方法被拒绝。

2. 新增或扩展 `enterprise/packages/iam-core/src/repos/__tests__/users-password-requirement.test.ts`（同时 mock/覆盖方言 adapter）：
   - 未提供初始密码的创建和批量 upsert 写 `true`；
   - 显式初始密码写 `false`；
   - reset 写 `true`；
   - AuthUser loader 对两方言都返回同一 flag。

3. 新增 `enterprise/apps/web-portal/src/app/api/auth/change-password/__tests__/route.test.ts`：
   - 无 session → 401；普通 session → 40302；短密码 → 400；
   - 待改密 session 成功后写两枚 cookie，响应不含明文密码。

4. 新增 `enterprise/apps/web-portal/src/lib/__tests__/workspace-session.test.ts` 或在现有 session 测试中覆盖：数据库 live flag 为真时，即使旧 JWT 不带字段也返回 `password_change_required`。

5. 为 `src/app/workspace/page.tsx` 和 `src/app/api/chat/completions/route.ts` 增加路由级 mock 测试：前者重定向 `/auth/change-password`，后者返回统一 40302 而不触发 gateway fetch。

6. 执行：

   ```bash
   cd enterprise
   pnpm --filter @agenticx/auth test -- auth-password-change
   pnpm --filter @agenticx/iam-core test -- users-password-requirement
   pnpm --filter @agenticx/app-web-portal test -- change-password workspace-session
   pnpm --filter @agenticx/db-schema test -- migration-inventory schema-parity
   pnpm --filter @agenticx/app-web-portal typecheck
   pnpm --filter @agenticx/app-web-portal lint
   pnpm --filter @agenticx/app-web-portal build
   ```

## 完成标准

- 所有随机初始密码用户第一次密码登录都会进入改密页，且不能绕过到工作台或 API。
- 改密成功后同一浏览器立即可进入工作台，旧 refresh session 不再有效。
- 已有账号、SSO、手工初始密码和开发 bootstrap 不被误拦截。
- PG/MySQL schema、repository 与迁移清单一致；测试、typecheck、lint、build 全绿。
- 提交按“schema/auth core”“门户强制改密”“测试收口”拆分，并带对应 plan trailer 与 `Impl-Model: gpt-5.6-terra`。
