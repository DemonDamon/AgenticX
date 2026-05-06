---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise OIDC SSO 单点登录落地

> **Plan-Id**: `2026-05-06-enterprise-oidc-sso`
> **Plan-File**: `.cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md`
> **范围**: `enterprise/packages/auth/`、`enterprise/apps/web-portal/`、`enterprise/apps/admin-console/`、`enterprise/packages/db-schema/`、`enterprise/packages/iam-core/`、`enterprise/docs/`。
> **客户对齐**: 《大模型一体化应用服务采购技术规范书》§(二) 2「权限管控：完善的访问控制 + 子账号管理 + 权限一键冻结回收」、§(三) 1「200 个终端账号并发登录正常无卡顿报错」。
> **范围红线**：本 plan 严格只做「OIDC 客户端 / SSO 登录」；**不实现** OAuth2 授权服务器、不实现 SAML（占位 stub 保留）、不动 Gateway JWT 校验逻辑（保持上游签发的 AgenticX 内部 JWT 透传不变）。

---

## 0. Goal / Architecture / Tech Stack

**Goal**：让 `enterprise` 的前台（web-portal）与后台（admin-console）能用任意 OpenID Connect 兼容 IdP（Keycloak / Azure Entra ID / Okta / 阿里 IDaaS / 飞书企业自建 / 企业微信等）完成统一身份登录，登录成功后映射到本地 `users` + RBAC scopes，并继续签发 AgenticX 内部 JWT，下游 Gateway / 策略 / 审计 / 聊天链路保持原状。

**Architecture（单租户单 IdP → 多租户多 IdP 渐进式）**：

```
[Browser]
  ├─ POST /api/auth/login                            （旧账密链路，保留）
  └─ GET  /api/auth/sso/oidc/start?provider=default  （新增）
        → 302 Redirect to IdP authorize URL
              ↓
        [IdP] 用户认证 / 同意
              ↓
        302 → /api/auth/sso/oidc/callback?code=...&state=...
              ↓
   ┌──────────────────────────────────┐
   │  OidcCallbackHandler             │
   │   1. 校验 state / nonce / PKCE   │
   │   2. code → token endpoint        │
   │   3. 校验 id_token (jose)         │
   │   4. claims → AuthUser (JIT)      │
   │   5. 签发 AgenticX 内部 JWT       │
   │   6. 写 audit_events              │
   └──────────────────────────────────┘
              ↓
        Set-Cookie: access / refresh
              ↓
        302 → /workspace 或 /dashboard
```

**Tech Stack**：

- `openid-client@^6.x`（panva 出品，与已用的 `jose` 同作者；ESM-first，Node 20+，Next.js 兼容）。
- 现有 `@agenticx/auth` 的 `JwtService` / `AuthService` / `RefreshTokenStore`：保持不变，OIDC 走完后调用 `signAccessToken / signRefreshToken` 复用现有签发链路。
- `@agenticx/iam-core` 的 `loadAuthUserByEmail` / `upsertUserRowFromAuthUser` / `replaceUserRoleAssignments` / `aggregateScopesForUser`：复用做 JIT provisioning 与 scope 聚合。
- 配置来源：**P0 阶段**用环境变量；**P1 阶段**升级为 PG 表 `sso_providers` + admin-console 设置面板（多租户多 IdP）。

**Non-Goals（明确不做）**：

- 不做 OAuth2 Authorization Server（不发 access_token 给第三方应用、不实现 token introspection / revocation 给外部使用）。
- 不做 IdP 端的发布/管理（IdP 由客户自己运维 Keycloak/Entra/Okta/飞书等）。
- 不动 Gateway 现有 `parseIdentityFromJWT`（`enterprise/apps/gateway/internal/server/server.go:1013`）逻辑——只要本期签发的 JWT claims 仍然对齐 `tenantId / deptId / roleCodes / clientType`。
- 不实现 SAML（保留 `SamlProvider` stub，customer 若要再起新 plan）。
- 不实现 SLO（Single Logout） SP-initiated 链路（仅清本地 cookie + 调 IdP 的 `end_session_endpoint`，不做反向通道注销）。

---

## 1. 现状基线（避免重复造轮子）

| 模块 | 现状 | 本期是否动它 |
|---|---|---|
| `packages/auth/src/services/auth.ts` | 账密 `AuthService` + `InMemoryRefreshTokenStore` | 不动；OIDC 复用 |
| `packages/auth/src/services/jwt.ts` | RS256 JwtService（`AUTH_JWT_PRIVATE_KEY/PUBLIC_KEY`） | 不动；OIDC 复用 |
| `packages/auth/src/providers/oidc-provider.ts` | 空 stub `throw new Error("not implemented")` | **替换为真实实现** |
| `packages/auth/src/providers/saml-provider.ts` | 空 stub | 不动（保留） |
| `packages/auth/src/providers/factory.ts` | `createAuthProvider("password" | "oidc" | "saml")` | 扩展 OIDC 分支 |
| `apps/web-portal/src/app/auth/page.tsx` | SSO 按钮 `disabled` | **启用为可点击** |
| `apps/admin-console/src/app/login/page.tsx` | SSO 按钮 `disabled`（"敬请期待"） | **启用为可点击** |
| `apps/web-portal/src/lib/auth-runtime.ts` | `loginWithPassword` + `verifyAccessToken` + `refreshTokens` | 新增 `loginWithOidc(claims)` 复用同一签发链 |
| `apps/admin-console/src/lib/admin-pg-auth.ts` | `authenticateAdminConsoleUser`（账密） | 新增 `authenticateAdminConsoleViaOidc(claims)` |
| `packages/iam-core/src/repos/users.ts` | `loadAuthUserByEmail` / `upsertUserRowFromAuthUser` / `replaceUserRoleAssignments` | 不动；OIDC JIT 复用 |
| `packages/iam-core/src/repos/audit.ts` | `insertAuditEvent` | 不动；OIDC 写 `auth.sso.login` 事件 |
| `packages/db-schema/drizzle/*` | 0007 已落 policy 表 | **P1 新增 0008 `sso_providers`** |
| `apps/gateway/internal/server/server.go:1013` | `parseIdentityFromJWT` 校验内部 JWT | 不动；本期不改 Gateway |

---

## 2. 分阶段交付（每个阶段单独 commit，可独立验收）

> **每阶段 commit 必须含**：`Plan-Id: 2026-05-06-enterprise-oidc-sso` + `Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md` + `Made-with: Damon Li`。

### Phase 1 — `@agenticx/auth` 内置 OIDC 客户端核心

**目标**：在 `@agenticx/auth` 包提供一个可被 web-portal / admin-console 共用的 OIDC 客户端服务，env-driven 配置 + claim 映射 + state/nonce/PKCE 工具齐全，**不绑任何 Next.js 路由**。

**Requirements**

```text
FR-1.1 提供 createOidcClient(config) 工厂，自 issuer 拉 OIDC discovery（缓存 5 分钟）。
FR-1.2 提供 buildAuthorizationUrl({ provider, state, nonce, codeVerifier, returnTo }) 返回 IdP 跳转 URL（含 PKCE S256）。
FR-1.3 提供 exchangeCallback({ provider, code, state, nonce, codeVerifier }) 完成 code → token，并校验 id_token（aud / iss / exp / nonce / signature）。
FR-1.4 提供 mapClaimsToAuthUser(claims, mapping, defaults) → { email, displayName, externalId, deptHint, roleCodeHints }，支持自定义 claim path（`roles`, `groups`, `dept`, `https://schemas.example.com/role` 等）。
FR-1.5 提供 ssoStateStore：HttpOnly Cookie + HMAC 签名（不依赖 Redis），TTL 10 分钟，单次使用后即删（防重放）。
FR-1.6 提供 OidcConfigError / OidcCallbackError 等明确异常类型，带 i18n-friendly code（如 `oidc.discovery_failed`、`oidc.invalid_state`）。
NFR-1.1 不引入 Redis / 状态服务依赖；state/nonce/PKCE 全靠 cookie + 签名。
NFR-1.2 单 IdP discovery 拉取耗时 ≥ 5s 时降级为缓存数据，避免阻塞首屏。
NFR-1.3 secret / token / id_token 不写日志；只记录 sub / email / provider / issuer。
AC-1.1 vitest 覆盖：buildAuthorizationUrl、PKCE verifier/challenge、claim 映射（含数组型 roles）、id_token nonce 校验失败应抛 `OidcCallbackError`。
AC-1.2 typecheck 通过：`pnpm --filter @agenticx/auth typecheck`。
```

**Files**

- Create:
  - `enterprise/packages/auth/src/services/oidc-client.ts`
  - `enterprise/packages/auth/src/services/oidc-state.ts`
  - `enterprise/packages/auth/src/services/oidc-claims.ts`
  - `enterprise/packages/auth/src/services/__tests__/oidc-client.test.ts`
  - `enterprise/packages/auth/src/services/__tests__/oidc-claims.test.ts`
- Modify:
  - `enterprise/packages/auth/src/providers/oidc-provider.ts`：把 stub 替换为「调用 `OidcClientService` 完成完整流程」。
  - `enterprise/packages/auth/src/providers/factory.ts`：`createAuthProvider("oidc")` 接收 `OidcClientService` 作依赖。
  - `enterprise/packages/auth/src/index.ts`：导出新增 service / 类型。
  - `enterprise/packages/auth/package.json`：新增 `"openid-client": "^6.0.0"` 依赖。

**关键代码骨架（参考实现）**

`oidc-client.ts`（节选）：

```ts
import * as oidc from "openid-client";

export type OidcProviderConfig = {
  providerId: string;            // "default" | tenantId-scoped
  issuer: string;                // https://login.example.com/realms/agenticx
  clientId: string;
  clientSecret?: string;         // public client 可空
  redirectUri: string;           // https://portal.example.com/api/auth/sso/oidc/callback
  scopes: string[];              // ["openid","profile","email"]
  postLogoutRedirectUri?: string;
  claimMapping: ClaimMapping;
};

export class OidcClientService {
  private readonly cache = new Map<string, { config: oidc.Configuration; expireAt: number }>();
  // ...buildAuthorizationUrl / exchangeCallback / endSessionUrl
}
```

**TDD 节奏**

1. `vitest packages/auth/src/services/__tests__/oidc-claims.test.ts -t "maps roles array"` 先写失败用例 → 实现 `mapClaimsToAuthUser`。
2. 同样为 PKCE / state cookie / nonce mismatch 各写一条失败用例再补实现。
3. 跑全量：`pnpm --filter @agenticx/auth test && pnpm --filter @agenticx/auth typecheck`。

**Commit**

```bash
git add enterprise/packages/auth
git commit -m "$(cat <<'EOF'
feat(enterprise/auth): add OIDC client core (discovery, PKCE, state, claim mapping)

## What & Why
- 在 @agenticx/auth 引入 openid-client，提供 OidcClientService / state / claims 三件套，作为 web-portal / admin-console 的共享底座。
- 旧 OidcProvider stub 替换为真实实现，但仅做"协议层"，不绑路由不引数据库。

## Requirements
- FR-1.1 ~ FR-1.6
- NFR-1.1 ~ NFR-1.3
- AC-1.1 / AC-1.2

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Phase 2 — web-portal 启用 OIDC SSO 登录

**目标**：前台员工可以走 IdP 单点登录，登录成功后回到 `/workspace` 与现有账密用户体感一致；首次登录自动创建本地 `users` 行（JIT provisioning），分配默认 `member` 角色或按 IdP claim 映射的角色。

**Requirements**

```text
FR-2.1 GET /api/auth/sso/oidc/start?provider=default[&returnTo=/workspace] → 302 IdP authorize URL；下发 sso_state cookie。
FR-2.2 GET /api/auth/sso/oidc/callback?code=...&state=... → 校验 state/nonce/PKCE → 调 token endpoint → 校验 id_token → 走 JIT 流程 → 签发 AgenticX 内部 access/refresh cookies → 302 returnTo（白名单校验，默认 /workspace）。
FR-2.3 JIT 规则：
       - 用 email（小写）作主键查 PG users；命中则 update display_name/dept_id（仅当 dept claim 解析成功且本地 deptId 为 null）。
       - 未命中：在 DEFAULT_TENANT_ID 下 ulid() 创建 users 行（password_hash 写一段不可登录占位 `oidc::<provider>::<sub>`），赋予 SSO_DEFAULT_ROLE_CODES（默认 ["member"]）。
       - 状态为 disabled / locked / lockedUntil > now → 拒绝登录，返回 /auth?sso_error=account_disabled。
FR-2.4 登录成功写一条 audit_events（event_type=auth.sso.login，detail={provider, issuer, sub, jit_created: bool}）。
FR-2.5 登录失败统一回 /auth?sso_error=<code>，前端用 toast 中文化展示（`oidc.discovery_failed` → "SSO 服务暂不可用，请稍后重试或使用账号密码登录"）。
FR-2.6 web-portal /auth 页面 SSO 按钮启用：仅当 process.env.NEXT_PUBLIC_SSO_PROVIDERS 至少 1 项时显示，否则维持 disabled。
FR-2.7 supports returnTo 白名单：仅允许同源 path 且必须以 / 开头（防 open redirect）。
NFR-2.1 callback 路径在 200 用户并发场景下 P95 ≤ 800ms（discovery 缓存命中场景）。
NFR-2.2 cookie 设置：access/refresh 同账密路径（`ACCESS_COOKIE` / `REFRESH_COOKIE`），httpOnly + sameSite=lax + secure（prod）。
NFR-2.3 sso_state cookie：单次使用、SameSite=lax、Path=/api/auth/sso、TTL 10 分钟。
AC-2.1 集成测试（vitest，mock IdP）：start → callback → cookie 写入 → /api/auth/session 200。
AC-2.2 e2e（已有 `enterprise/scripts/e2e-iam.ts` 模式）：在本地 docker-compose 起一个 Keycloak 容器，跑通 portal SSO 登录全链路。
AC-2.3 失败用例：state mismatch / id_token nonce mismatch / 用户 status=disabled / returnTo=外站 都需返回正确 sso_error code。
```

**Files**

- Create:
  - `enterprise/apps/web-portal/src/lib/sso-runtime.ts`（封装 OidcClientService 单例 + getSsoProviderConfigs() + handleOidcCallback）
  - `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/start/route.ts`
  - `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/callback/route.ts`
  - `enterprise/apps/web-portal/src/lib/__tests__/sso-runtime.test.ts`（mock IdP）
  - `enterprise/deploy/docker-compose/keycloak-dev.yml`（dev-only，可选，方便本地起 IdP）
- Modify:
  - `enterprise/apps/web-portal/src/lib/auth-runtime.ts`：新增 `loginWithOidcClaims(authUser): Promise<AuthTokens>` —— 不验密码，只签 JWT + 写审计 + sync。
  - `enterprise/apps/web-portal/src/app/auth/page.tsx`：SSO 按钮根据 `process.env.NEXT_PUBLIC_SSO_PROVIDERS` 启用，点击跳 `/api/auth/sso/oidc/start?provider=<id>`；接收 `?sso_error=` query 显示中文 toast。
  - `enterprise/apps/web-portal/package.json`：新增 `"openid-client": "^6.0.0"`（间接依赖也可，让 webpack 显式打包）。
  - `enterprise/turbo.json`：env 列表追加 `SSO_OIDC_*`、`NEXT_PUBLIC_SSO_PROVIDERS`、`SSO_DEFAULT_ROLE_CODES`、`SSO_RETURN_TO_ALLOWLIST`。
  - `enterprise/.env.local.example`（若不存在则 create）：示例 SSO env 一并写明。
- Tests:
  - `enterprise/apps/web-portal/src/lib/__tests__/sso-runtime.test.ts`
  - `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/__tests__/callback.test.ts`

**环境变量约定（P0 单 IdP）**

```bash
# 必填
SSO_OIDC_DEFAULT_ISSUER=https://keycloak.example.com/realms/agenticx
SSO_OIDC_DEFAULT_CLIENT_ID=agenticx-portal
SSO_OIDC_DEFAULT_CLIENT_SECRET=...
SSO_OIDC_DEFAULT_REDIRECT_URI=https://portal.example.com/api/auth/sso/oidc/callback
NEXT_PUBLIC_SSO_PROVIDERS=default:Keycloak

# 可选（claim 映射）
SSO_OIDC_DEFAULT_SCOPES=openid profile email groups
SSO_OIDC_DEFAULT_CLAIM_EMAIL=email
SSO_OIDC_DEFAULT_CLAIM_NAME=name
SSO_OIDC_DEFAULT_CLAIM_DEPT=department
SSO_OIDC_DEFAULT_CLAIM_ROLES=groups
SSO_DEFAULT_ROLE_CODES=member

# 安全
SSO_STATE_SIGNING_SECRET=...    # >= 32 字节
SSO_RETURN_TO_ALLOWLIST=/workspace,/dashboard
```

**TDD 节奏（举一例：state mismatch）**

```bash
# Step 1: 写失败测试
pnpm --filter @agenticx/app-web-portal test -t "callback rejects mismatched state" -- --run
# Expected: FAIL (handler not yet implemented)

# Step 2: 实现 callback 校验逻辑
# Step 3: 重跑
pnpm --filter @agenticx/app-web-portal test -t "callback rejects mismatched state" -- --run
# Expected: PASS

# Step 4: 全包跑
pnpm --filter @agenticx/app-web-portal test
pnpm --filter @agenticx/app-web-portal typecheck
```

**Commit**

```bash
git add enterprise/apps/web-portal enterprise/turbo.json enterprise/deploy/docker-compose/keycloak-dev.yml
git commit -m "$(cat <<'EOF'
feat(enterprise/web-portal): enable OIDC SSO login with JIT provisioning

## What & Why
- /api/auth/sso/oidc/{start,callback} 接通 @agenticx/auth 的 OidcClientService。
- 登录成功 JIT upsert users + 默认 member 角色，并签发现有 AgenticX 内部 JWT cookies。
- /auth 页 SSO 按钮启用，按 NEXT_PUBLIC_SSO_PROVIDERS 渲染。

## Requirements
- FR-2.1 ~ FR-2.7
- NFR-2.1 ~ NFR-2.3
- AC-2.1 / AC-2.3（AC-2.2 e2e 留 Phase 5 跑）

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Phase 3 — admin-console 启用 OIDC SSO 登录

**目标**：管理后台同样可走 SSO；但**强制要求** SSO 用户具备 `admin:enter` scope，否则拒绝（admin-console 是高权限端，不能 JIT 直接放行）。

**Requirements**

```text
FR-3.1 GET /api/auth/sso/oidc/start?provider=default → 同 web-portal 模式，但 redirect_uri 指向 admin-console 域名。
FR-3.2 GET /api/auth/sso/oidc/callback → 走 OidcClientService，但鉴权层调 authenticateAdminConsoleViaOidc(claims)。
FR-3.3 JIT 策略（admin 端更严）：
       - 命中本地 users 且 hasSomeScope(scopes, ["admin:enter"]) → 允许。
       - 命中本地 users 但缺 admin:enter → 拒绝（sso_error=admin_scope_missing），不 JIT。
       - 未命中本地 users → 拒绝（sso_error=admin_unprovisioned），不 JIT 创建（admin 用户必须由超管在 /iam/users 显式开通）。
FR-3.4 callback 成功 → 写 admin_console_session cookie（同账密路径），302 /dashboard。
FR-3.5 失败 → 302 /login?sso_error=<code>，UI 中文化展示。
FR-3.6 admin-console /login 页 SSO 按钮启用，文案改为「企业 SSO 登录」并去掉「敬请期待」。
NFR-3.1 admin-console 与 web-portal 共用 @agenticx/auth 的 OidcClientService 单例（避免 discovery 重复拉取）。
NFR-3.2 audit_events 必须记录 actor_user_id（即 SSO 命中的 userId）+ event_type=auth.sso.admin_login。
AC-3.1 集成测试：未持有 admin:enter 的 SSO 用户登录被拒。
AC-3.2 集成测试：持有 admin:enter 的 SSO 用户登录成功，cookies 写入正确。
AC-3.3 集成测试：未在本地 PG 中开通的 SSO 用户被拒（不会 JIT 出现 admin）。
```

**Files**

- Create:
  - `enterprise/apps/admin-console/src/lib/admin-sso-runtime.ts`
  - `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/start/route.ts`
  - `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/callback/route.ts`
  - `enterprise/apps/admin-console/src/lib/__tests__/admin-sso-runtime.test.ts`
- Modify:
  - `enterprise/apps/admin-console/src/lib/admin-pg-auth.ts`：新增 `authenticateAdminConsoleViaOidc(claims)` 复用 `loadAuthUserByEmail` + `hasSomeScope`。
  - `enterprise/apps/admin-console/src/app/login/page.tsx`：启用 SSO 按钮 + 中文化错误文案。
  - `enterprise/apps/admin-console/package.json`：依赖 `openid-client@^6.0.0`。

**Commit**

```bash
git add enterprise/apps/admin-console
git commit -m "$(cat <<'EOF'
feat(enterprise/admin-console): enable OIDC SSO with admin:enter scope guard

## What & Why
- admin-console 走 SSO 时，强制 admin:enter scope；不命中本地 users 不 JIT，避免高权限误开通。
- 复用 @agenticx/auth 的 OidcClientService 单例，admin/portal 共享 discovery 缓存。

## Requirements
- FR-3.1 ~ FR-3.6
- NFR-3.1 / NFR-3.2
- AC-3.1 ~ AC-3.3

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Phase 4 — DB 化多租户多 IdP 配置 + admin-console 设置面板

**目标**：让客户在不重启服务的前提下，通过 admin-console UI 增删改 SSO Provider；满足多租户独立 IdP 场景；所有变更审计可查。

**Requirements**

```text
FR-4.1 新建 PG 表 sso_providers（migration 0008_sso_providers.sql + drizzle schema）：
       - id (ulid, PK)
       - tenant_id (FK tenants)
       - provider_id (slug, e.g. "default" | "azure-ad")
       - display_name
       - issuer / client_id / client_secret_encrypted / redirect_uri / scopes (jsonb)
       - claim_mapping (jsonb)
       - default_role_codes (jsonb)
       - enabled (bool, default false)
       - created_at / updated_at / created_by / updated_by
       - UNIQUE(tenant_id, provider_id)
       - INDEX(tenant_id, enabled)
FR-4.2 client_secret 列采用 AES-256-GCM 加密存储；密钥来自 SSO_PROVIDER_SECRET_KEY env（与 AUTH_JWT_PRIVATE_KEY 不同）。
FR-4.3 admin-console 新增页面 /settings/sso：
       - 列出当前租户的 providers（启用/禁用 toggle）。
       - 新增/编辑表单：issuer / client_id / client_secret（write-only） / redirect_uri / scopes / claim_mapping / default_role_codes。
       - 测试连通性按钮 → 后端调 OidcClientService.fetchDiscovery() 返回握手成功与否。
FR-4.4 新增 admin API：GET/POST/PATCH/DELETE /api/admin/sso/providers，权限 require sso:manage（新 scope）。
FR-4.5 OidcClientService 增加配置源切换：默认走 env，若 DB 表存在该 provider 则覆盖。
FR-4.6 scope-registry 新增 sso = ["read", "create", "update", "delete", "manage"]；super_admin / owner 自动获得 sso:manage。
FR-4.7 客户端发起 /api/auth/sso/oidc/start 必须带 provider=<provider_id>；start handler 解析时 prefer DB > env。
FR-4.8 删除/禁用 provider 后已存在 SSO 登录用户不受影响（refresh token 仍可换 access）；新发起 SSO start 需返回 sso_error=provider_disabled。
NFR-4.1 设置页表单遵循已有 Cherry Studio 风格的设置面板视觉规范；保留底部唯一「保存」按钮，顶部「重置为默认」。
NFR-4.2 client_secret 修改后旧值不可见（write-only），UI 上显示 "已配置"+「重新设置」按钮。
NFR-4.3 sso_providers 表所有变更写 audit_events（auth.sso.provider.create / update / delete / toggle）。
AC-4.1 vitest：sso_providers repo round-trip + 加密/解密。
AC-4.2 集成测试：admin 在 UI 改 issuer 后，下一次 /api/auth/sso/oidc/start 立即用新 issuer（不需重启）。
AC-4.3 集成测试：缺 sso:manage scope 调 /api/admin/sso/providers 返回 403。
AC-4.4 e2e（playwright，复用 enterprise/scripts/e2e-visual-tour.ts 模式）：admin 创建 provider → 测试连通性按钮 OK → portal 端走该 provider 完成 SSO。
```

**Files**

- Create:
  - `enterprise/packages/db-schema/drizzle/0008_sso_providers.sql`
  - `enterprise/packages/db-schema/src/schema/sso-providers.ts`
  - `enterprise/packages/iam-core/src/repos/sso-providers.ts`
  - `enterprise/packages/iam-core/src/repos/__tests__/sso-providers.test.ts`
  - `enterprise/packages/auth/src/services/secret-cipher.ts`（AES-256-GCM 封装）
  - `enterprise/packages/auth/src/services/__tests__/secret-cipher.test.ts`
  - `enterprise/apps/admin-console/src/app/settings/sso/page.tsx`
  - `enterprise/apps/admin-console/src/app/api/admin/sso/providers/route.ts`
  - `enterprise/apps/admin-console/src/app/api/admin/sso/providers/[id]/route.ts`
  - `enterprise/apps/admin-console/src/app/api/admin/sso/providers/[id]/test/route.ts`
- Modify:
  - `enterprise/packages/db-schema/src/schema/index.ts`：导出新表。
  - `enterprise/packages/iam-core/src/scope-registry.ts`：追加 `sso: [...]`。
  - `enterprise/packages/iam-core/src/repos/roles.ts`：`SYSTEM_ROLE_SEED` 给 `super_admin` (`*`) 自动继承；给 `owner` 显式追加 `sso:manage`；新增 `sso_admin` 角色（仅 admin:enter + sso:*）。
  - `enterprise/apps/web-portal/src/lib/sso-runtime.ts`：解析 provider 优先级 DB > env。
  - `enterprise/apps/admin-console/src/lib/admin-sso-runtime.ts`：同上。

**Commit**（建议拆成 2 个：schema + UI/API）

```bash
# 4a: schema + repo + cipher
git add enterprise/packages/db-schema enterprise/packages/iam-core enterprise/packages/auth
git commit -m "$(cat <<'EOF'
feat(enterprise/db): add sso_providers schema + AES-256-GCM secret cipher

## What & Why
- 新建 sso_providers 表（多租户多 IdP），client_secret 加密存储。
- iam-core 扩 sso scope，新增 sso_admin 角色，super_admin/owner 自动继承 sso:manage。

## Requirements
- FR-4.1 / FR-4.2 / FR-4.6
- AC-4.1

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"

# 4b: admin UI/API + runtime DB-first lookup
git add enterprise/apps/admin-console enterprise/apps/web-portal
git commit -m "$(cat <<'EOF'
feat(enterprise/admin-console): SSO 设置面板与多租户多 IdP 支持

## What & Why
- /settings/sso 列表 + 编辑 + 测试连通性 + 启停 toggle，所有写操作落审计。
- web-portal / admin-console runtime 解析顺序改为 DB > env，热生效不重启。

## Requirements
- FR-4.3 / FR-4.4 / FR-4.5 / FR-4.7 / FR-4.8
- NFR-4.1 ~ NFR-4.3
- AC-4.2 / AC-4.3 / AC-4.4

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Phase 5 — 文档、客户演示话术、回归

**目标**：交付产物完整可用，客户验收时能演示出来。

**Requirements**

```text
FR-5.1 enterprise/docs/runbooks/sso-oidc-setup.md：覆盖 Keycloak / Azure Entra ID / 阿里 IDaaS 三个实例配置步骤。
FR-5.2 enterprise/packages/auth/README.md：补 OIDC 章节，含完整 env 列表 + claim 映射示例 + 错误码对照表。
FR-5.3 enterprise/README.md：「快速开始」追加 SSO 链路一句话，并把 SSO 入口标到登录页截图。
FR-5.4 enterprise/scripts/e2e-iam.ts 拆出一个 e2e-sso.ts：本地 docker-compose 起 keycloak-dev → portal/admin 各跑一遍 SSO 登录流。
FR-5.5 客户演示话术（enterprise/docs/sales/sso-demo-script.md）：3 分钟演示脚本，覆盖「为什么是 OIDC 而不是自研 OAuth2 Server」「兼容哪些 IdP」「如何 5 分钟接入」。
FR-5.6 验收 checklist（enterprise/docs/runbooks/sso-acceptance-checklist.md）：对齐《大模型一体化应用服务采购技术规范书》§(三) 1「200 用户并发登录」，含 200 路并发 SSO 登录的 k6 脚本与 P95 ≤ 800ms 验证流程。
AC-5.1 docs 通过审阅，链接 / 截图 / 命令样例可执行。
AC-5.2 e2e-sso 在本地 docker-compose 跑通。
AC-5.3 客户演示话术 ≤ 3 分钟可念完，关键点全覆盖。
```

**Files**

- Create:
  - `enterprise/docs/runbooks/sso-oidc-setup.md`
  - `enterprise/docs/runbooks/sso-acceptance-checklist.md`
  - `enterprise/docs/sales/sso-demo-script.md`
  - `enterprise/scripts/e2e-sso.ts`
- Modify:
  - `enterprise/packages/auth/README.md`（如不存在则 create）
  - `enterprise/README.md`

**Commit**

```bash
git add enterprise/docs enterprise/scripts/e2e-sso.ts enterprise/README.md enterprise/packages/auth/README.md
git commit -m "$(cat <<'EOF'
docs(enterprise/sso): runbooks, e2e-sso, sales demo script & acceptance checklist

## What & Why
- 文档/演示/验收三件套，对齐客户《大模型一体化应用服务采购技术规范书》§权限管控 + §200 用户并发登录验收口径。
- e2e-sso.ts 提供本地 docker-compose Keycloak 一键回归。

## Requirements
- FR-5.1 ~ FR-5.6
- AC-5.1 ~ AC-5.3

Plan-Id: 2026-05-06-enterprise-oidc-sso
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md
Made-with: Damon Li
EOF
)"
```

---

## 3. 验收（与客户文档强对齐）

| 客户条款 | 本期落点 | 验收方式 |
|---|---|---|
| §(二) 2 权限管控：完善访问控制 + 子账号管理 + 一键冻结回收 | OIDC 复用现有 PG users + RBAC scopes + soft-delete + status=disabled 即时拒绝 SSO 登录 | 在 IdP 端可登录，但本地 status=disabled → SSO 仍被拒 |
| §(三) 1 200 终端账号并发登录正常无卡顿 | discovery 缓存 + JwtService 复用 + JIT upsert 走 ON CONFLICT | k6 200 路并发 SSO 登录 P95 ≤ 800ms（Phase 5） |
| §(三) 1 调用远程模型时网关审计日志完整 | 不动 Gateway；SSO 后续仍透传同样的内部 JWT，Gateway audit 链路不变 | 现有 audit e2e 复跑通过 |

## 4. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| openid-client v6 是 ESM-only，与 Next.js 15 兼容性 | 已用同作者 jose@v6 验证可用；Phase 1 引入时立刻跑 typecheck + build | 退到 v5（CJS 友好）但功能差异较小 |
| IdP discovery 间歇性慢 | 5 分钟内存缓存 + 5s 超时降级 | 完全降级回账密登录（账密路径未动） |
| client_secret 加密 key 丢失 | SSO_PROVIDER_SECRET_KEY 与 AUTH_JWT_PRIVATE_KEY 同 secrets 流程托管，部署文档强提示 | 失密后管理员重置 IdP secret + 在 UI 重新填入 |
| admin SSO 误开高权限 | Phase 3 强 scope guard + 不 JIT；Phase 4 sso_admin 角色独立 | 误授权可在 /iam/users 立刻冻结/回收（已有能力） |
| Gateway 期望的 JWT claim 漂移 | 本期不动签发逻辑，复用 AuthService.toContext | 无 |

## 5. Out of Scope（明确遗留给后续 plan）

- SAML 2.0 SSO（保留 stub；如客户明确要求，新起 `2026-MM-DD-enterprise-saml-sso.plan.md`）。
- SCIM 2.0 自动用户/组同步（不在本期）。
- IdP-initiated SSO（仅支持 SP-initiated）。
- Single Logout 反向通道（本期仅清本地 cookie + 调 IdP `end_session_endpoint`）。
- AgenticX 作为 OAuth2 授权服务器（明确不做）。
- Desktop（Electron）端 SSO（本期仅 web-portal + admin-console）。

## 6. Definition of Done

- [ ] Phase 1 ~ Phase 5 五段 commits 全部带 `Plan-Id` / `Plan-File` / `Made-with: Damon Li` 三个 trailer。
- [ ] `pnpm --filter @agenticx/auth typecheck && pnpm --filter @agenticx/app-web-portal typecheck && pnpm --filter @agenticx/app-admin-console typecheck` 三端绿。
- [ ] `pnpm --filter @agenticx/auth test && pnpm --filter @agenticx/app-web-portal test && pnpm --filter @agenticx/app-admin-console test` 全绿。
- [ ] `enterprise/scripts/e2e-sso.ts` 在本地 docker-compose Keycloak 上跑通 portal + admin 两端 SSO 登录。
- [ ] `/update-conclusion --plan=.cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md` 把所有改动汇总到对应 conclusion 文档。
- [ ] 客户演示脚本 ≤ 3 分钟可念完，覆盖「为什么是 OIDC」「兼容哪些 IdP」「如何 5 分钟接入」三段。