# @agenticx/auth 模块总结

> 结论生成时间：2026-07-21（重新生成，覆盖当前代码 v0.1.0）

> 说明：本文档描述 **企业认证抽象层包**（`@agenticx/auth`）。它是 web-portal、admin-console 共用的认证 SDK，提供密码登录 + JWT、OIDC SSO、SAML SSO、信封加密、Next.js session 中间件。包 `package.json#description` 写的是「认证抽象层（Supabase/LDAP/SSO/账密）」，但**当前代码实际实现的 provider 只有 `password` / `oidc` / `saml` 三种**（见 `providers/types.ts` 的 `AuthProviderKind`），Supabase/LDAP 仅为描述性占位，不在本包源码内。

## 模块概述

`@agenticx/auth`（v0.1.0，workspace 包路径 `enterprise/packages/auth`）是 AgenticX Enterprise monorepo 的**认证抽象层**。被 `apps/web-portal`（员工前台）、`apps/admin-console`（管理后台）和 `packages/iam-core`（数据访问层）共同消费。它提供：

1. **密码登录** + bcrypt + JWT RS256 access/refresh token
2. **完整 OIDC SSO 客户端**（discovery cache + stale fallback + PKCE + state/nonce + claim 映射）
3. **完整 SAML 2.0 SSO**（基于 `@node-saml/node-saml`，HTTP-Redirect / HTTP-POST 双绑定 + 签名/audience/InResponseTo 校验）
4. **统一的 `SsoProtocolHandler` 抽象**——把 OIDC 和 SAML 归一到同一个 `SsoExternalIdentity` 形状
5. **AES-256-GCM + HKDF 信封加密** —— 同时用于 DB `client_secret` 列加密和签名的 state cookie
6. **portal/admin SSO 错误码** 单一权威源（zh/en 双语映射，`saml.*` + `oidc.*` 命名空间）
7. **Next.js Bearer-token session 中间件**

技术栈：TypeScript + `jose`（JWT）+ `openid-client` v6（OIDC）+ `@node-saml/node-saml` v5（SAML）+ `bcryptjs` + `node:crypto`（HKDF/AES-GCM）。依赖 `@agenticx/db-schema`（workspace）和 `drizzle-orm`。测试用 `vitest`，SAML fixture 构造用 dev 依赖 `xmlbuilder2`。

## 目录结构

```
packages/auth/
├── package.json           # name @agenticx/auth；deps: jose ^6.2.2, openid-client ^6, @node-saml/node-saml ^5, bcryptjs ^3, drizzle-orm ^0.45, @agenticx/db-schema workspace:*
├── README.md              # OIDC SSO 文档、安全说明、env vars、错误码示例
├── tsconfig.json
└── src/
    ├── index.ts           # 单一 barrel，re-export 所有类型/服务/中间件/provider
    ├── types.ts           # AuthUser, AuthContext, AuthTokens, LoginInput, RefreshSession, RefreshTokenStore, AuthUserRepository
    ├── middleware/
    │   └── next.ts        # createSessionMiddleware：Bearer token → AuthContext + scope 检查（401/403）
    ├── providers/         # 薄壳 AuthProvider 适配器（按 AuthProviderKind 区分）
    │   ├── types.ts           # AuthProvider 接口；AuthProviderKind = "password"|"oidc"|"saml"
    │   ├── factory.ts         # createAuthProvider(kind, authService, opts) switch
    │   ├── password-provider.ts  # 包 AuthService.loginWithPassword
    │   ├── oidc-provider.ts      # 包 OidcClientService（buildAuthorizationUrl / exchangeCallback）
    │   └── saml-provider.ts      # 桩；真 SAML 在 saml-protocol-handler
    └── services/          # 核心能力模块
        ├── auth.ts                  # AuthService + InMemory{RefreshTokenStore,AuthUserRepository}
        ├── jwt.ts                   # JwtService（RS256 access+refresh via jose）
        ├── password.ts              # hashPassword / verifyPassword（bcrypt cost 12）
        ├── secret-cipher.ts         # AES-256-GCM + HKDF；encryptSecret / decryptSecret；assertStrongSecretKey
        ├── oidc-claims.ts           # mapClaimsToAuthUser, ClaimMapping, OidcClaimError
        ├── oidc-client.ts           # OidcClientService：discovery cache + stale fallback + PKCE + 授权 URL + code 交换
        ├── oidc-state.ts            # build/validate 加密 OIDC state cookie（state/nonce/codeVerifier）
        ├── oidc-redirect-policy.ts  # assertOidcRedirectUriForRuntime（prod 强 https，dev 允许 localhost）
        ├── oidc-protocol-handler.ts # OidcProtocolHandler 实现 SsoProtocolHandler
        ├── oidc-error-codes.ts      # OIDC_ERROR_CODES + portal/admin zh/en 错误消息映射（saml.* + oidc.*）
        ├── sso-protocol-handler.ts  # SsoProtocolHandler 接口 + SsoStartResult / SsoExternalIdentity 类型
        ├── sso-sign-in-policy.ts    # buildNormalizedSsoLoginInput（audience=portal|admin）
        ├── saml-state.ts            # SAML RelayState cookie 加密（portal / admin 分开 cookie 名）
        ├── saml-attribute-mapper.ts # mapSamlProfileToIdentity, SamlAttributeMapping, SamlAttributeError
        ├── saml-protocol-handler.ts # SamlProtocolHandler：AuthnRequest 构造 + SAMLResponse 校验
        └── __tests__/               # 9 个 vitest spec（见底部测试节）
```

## 核心服务详解

### `AuthService` (`services/auth.ts`)

**用途**：编排密码登录 + JWT 签发 + refresh token 轮换；含**爆破锁定**（`MAX_FAILED_ATTEMPTS = 5` 次失败 → 锁 `LOCK_MINUTES = 15` 分钟）

**关键 API**：
- `loginWithPassword(input) → AuthTokens`
- `verifyAccess(token) → AuthContext | null`
- `refresh(refreshToken) → AuthTokens`

**构造**：`new AuthService({ userRepo: AuthUserRepository, jwtService: JwtService, refreshStore?: RefreshTokenStore })`

**默认实现**：`InMemoryRefreshTokenStore` + `InMemoryAuthUserRepository`（dev 用）；生产用 `packages/iam-core` 的 PG/MySQL 后端

### `JwtService` (`services/jwt.ts`)

**用途**：RS256 JWT 签发 / 校验，基于 `jose`

**密钥**：从 env 加载 `AUTH_JWT_PRIVATE_KEY` (PKCS8) / `AUTH_JWT_PUBLIC_KEY` (SPKI) PEM；非 prod 模式下若设 `ALLOW_EPHEMERAL_JWT_KEYS=true` 可临时生成

**关键 API**：
- `signAccessToken(AuthContext)` —— TTL 默认 1h
- `signRefreshToken(AuthContext)` —— TTL 默认 7d
- `verifyAccessToken(token)`
- `verifyRefreshToken(token)`

**Claims**：包含 `typ: "access"|"refresh"` 类型判别 + `userId / tenantId / deptId / email / sessionId / scopes`

### `OidcClientService` (`services/oidc-client.ts`)

**用途**：基于 `openid-client` v6 的薄包装 + 运行时硬化

**核心特性**：
- **Per-provider discovery cache**（`DISCOVERY_CACHE_TTL_MS = 60 * 1000`）
- **降级回退**：discovery 失败时复用 stale cache（`DISCOVERY_CACHE_STALE_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000`）；记录 `hit / miss / staleHits / staleEvictions` 统计
- **降级上报**：5 次连续 stale fallback 后调用注册的 `OidcDiscoveryDegradedReporter` 做审计上报

**关键 API**：
- `getConfiguration`
- `createCodeVerifier` / `createCodeChallenge`（PKCE S256）
- `buildAuthorizationUrl({provider, state, nonce, codeVerifier, returnTo})`
- `exchangeCallback({provider, callbackUrl, expectedState, expectedNonce, codeVerifier}) → {claims, mapped, rawTokens}`
- `invalidateProvider`
- `getOidcCacheStats`

**错误**：
- `OidcConfigError`（discovery / config / redirect-uri）
- `OidcCallbackError`（code: `oidc.invalid_nonce` / `oidc.callback_failed`）
- `OidcClaimError`（透传）

### SAML 栈 (`services/saml-{protocol-handler,state,attribute-mapper}.ts`)

**用途**：SAML 2.0 SP（Service Provider），基于 `@node-saml/node-saml`

**核心类型**：
- `SamlSpProviderConfig` —— `idpEntityId / idpSsoUrl / idpCertPemList / spEntityId / acsUrl / wantAssertionsSigned / wantResponseSigned / clockSkewSeconds / attributeMapping / authnRequestBinding`
- 实现接口 `SsoProtocolHandler<SamlStartHandlerInput, SamlCallbackHandlerInput>`
- 支持 HTTP-Redirect + HTTP-POST 两种 AuthnRequest 绑定
- 校验 `InResponseTo` + 签名 + audience + issuer + 时钟漂移

**RelayState** 通过 `saml-state.ts` 加密 cookie 持久化（默认 TTL 10 分钟），**portal 与 admin 用不同的 cookie 名**（`DEFAULT_SAML_PORTAL_STATE_COOKIE` / `DEFAULT_SAML_ADMIN_STATE_COOKIE`）

**Attribute 映射**：`mapSamlProfileToIdentity` 把 SAML attributes 归一到 `SsoExternalIdentity`

**错误**：`SamlConfigError` / `SamlCallbackError` / `SamlAttributeError` —— 都带 `.code` 对应 `oidc-error-codes.ts` 中的 `saml.*` 键

### `password.ts`

`hashPassword(raw)` + `verifyPassword(raw, hash)` —— bcryptjs `BCRYPT_COST = 12`。被 `AuthService`、admin bulk-import、`iam-core` user repo 使用

### `secret-cipher.ts`

**算法**：AES-256-GCM + 12 字节随机 IV；密钥通过 `hkdfSync("sha256", secret, "agenticx.sso.secret-cipher.v1", "aes-256-gcm.key", 32)` 派生

**强度校验**：`assertStrongSecretKey` 要求 **≥ `MIN_SECRET_KEY_LENGTH = 32` 字节 + ≥8 个不同字符**（违反抛 `WeakSecretKeyError`）

**输出格式**：`base64url(iv || tag || ciphertext)`

**使用方**：
- DB 中 OIDC/SAML provider 的 `client_secret` 列（用 `SSO_PROVIDER_SECRET_KEY` 加密静态存储）
- 所有签名 state cookie（`oidc-state.ts` + `saml-state.ts`，用 `SSO_STATE_SIGNING_SECRET`）

### Refresh-token store

接口 `RefreshTokenStore { set / get / delete }` 在 `types.ts`；`InMemoryRefreshTokenStore` 在 `services/auth.ts`（dev 用）；生产实现在 `packages/iam-core/src/refresh-token-pg-store.ts`（现已为方言派发 facade，可接 PG 或 MySQL）—— 不在本包

### SSO 统一层

- **`sso-protocol-handler.ts`**：`SsoProtocolHandler<StartInput, CallbackInput>` 接口；`SsoStartResult`（redirect | form_post，含可选 cookie）；`SsoExternalIdentity { externalSubject, email, displayName, deptHint, roleCodeHints, rawAttributes, rawTokens }` —— 让路由用同样方式处理 OIDC 和 SAML
- **`sso-sign-in-policy.ts`**：`buildNormalizedSsoLoginInput({audience: "portal"|"admin", protocol, providerId, issuer, identity}) → NormalizedSsoLoginInput`；portal 做 JIT provisioning；admin 强制预 provisioning + `admin:enter` scope（这部分逻辑在 app 中，不在本包）

### Next.js 中间件

`middleware/next.ts`：`createSessionMiddleware(authService)` 返回 `withSession(handler, {required, requiredScopes})`，用于 Next.js route handler。解析 `Authorization: Bearer <jwt>`，把 `{ auth: AuthContext | null }` 挂到第二个参数；失败返回 JSON：
- `{code:"40101"}` (401 未授权)
- `{code:"40301"}` (403 缺权限)

## 公共 API 表面（从 `@agenticx/auth` import）

**类型**：`AuthUser, AuthContext, AuthTokens, LoginInput, RefreshSession, RefreshTokenStore, AuthUserRepository, AuthProvider, AuthProviderKind, ClaimMapping, OidcMappedUser, OidcProviderConfig, OidcExchangeResult, OidcStatePayload, SamlStatePayload, SamlSpProviderConfig, SamlAttributeMapping, SamlProfileLike, SsoProtocol, SsoStartResult, SsoStartCookie, SsoExternalIdentity, SsoCallbackResult, SsoProtocolHandler, SsoAudience, NormalizedSsoLoginInput` + 各种 `*HandlerInput / Result`

**类**：`AuthService, JwtService, OidcClientService, OidcProtocolHandler, SamlProtocolHandler, PasswordProvider, OidcProvider, SamlProvider, InMemoryRefreshTokenStore, InMemoryAuthUserRepository`

**错误**：`OidcConfigError, OidcCallbackError, OidcClaimError, OidcInvalidRedirectError, SamlConfigError, SamlCallbackError, SamlAttributeError, WeakSecretKeyError`

**函数**：`hashPassword, verifyPassword, encryptSecret, decryptSecret, assertStrongSecretKey, mapClaimsToAuthUser, mapSamlProfileToIdentity, randomStateToken, randomRelayState, encodeSignedState, decodeSignedState, buildStateCookieValue, validateStateFromCookie, encodeSignedSamlState, decodeSignedSamlState, buildSamlStateCookieValue, validateSamlStateFromCookie, assertOidcRedirectUriForRuntime, createSessionMiddleware, createAuthProvider, createOidcProtocolHandler, createSamlProtocolHandler, buildNormalizedSsoLoginInput, registerOidcDiscoveryDegradedReporter`

错误消息辅助：`getPortalSsoErrorMessage{Zh,En}, getAdminSsoErrorMessage{Zh,En}`

**常量**：`OIDC_ERROR_CODES`（readonly union）、`OIDC_PORTAL_ERROR_MESSAGES_{ZH,EN}`、`OIDC_ADMIN_ERROR_MESSAGES_{ZH,EN}`、`DEFAULT_OIDC_STATE_COOKIE`、`DEFAULT_SAML_PORTAL_STATE_COOKIE`、`DEFAULT_SAML_ADMIN_STATE_COOKIE`、`MIN_SECRET_KEY_LENGTH`

**已确认的消费者**：
- **web-portal**：`auth-runtime`, `sso-runtime`, SSO OIDC/SAML start/callback routes, chat-history
- **admin-console**：`admin-pg-auth`, `admin-sso-runtime`, IAM bulk-import, SSO provider CRUD/health/test routes
- **packages/iam-core**：`pg-auth-user-repository`（现为方言派发 facade）、`refresh-token-pg-store`（同为 facade）、`repos/users`

## 测试布局

全部测试在 `src/services/__tests__/`（9 个 vitest spec 文件）：

| 文件 | 覆盖 |
|---|---|
| `oidc-protocol-handler.test.ts` | OIDC 协议 handler 流程 |
| `oidc-client.test.ts` | discovery cache + stale fallback + 统计 |
| `oidc-state.test.ts` | 加密 state cookie |
| `oidc-claims.test.ts` | claim → AuthUser 映射 |
| `oidc-error-codes.test.ts` | 错误码 + 双语消息 |
| `saml-protocol-handler.test.ts` | SAML 协议 handler |
| `saml-attribute-mapper.test.ts` | SAML attribute 映射 |
| `saml-state.test.ts` | SAML RelayState cookie |
| `secret-cipher.test.ts` | AES-256-GCM + HKDF |

运行：`pnpm --filter @agenticx/auth test`（vitest run）

**注**：`AuthService`、`JwtService`、`password.ts`、`middleware/next.ts`、provider 适配器**没有包内单元测试** —— 由消费 app 中的集成测试覆盖。`xmlbuilder2` 是 dev dependency，用于 SAML 测试构造 fixture response。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/iam-core` | 提供后端实现 | `pg-auth-user-repository` / `refresh-token-pg-store` 现均为方言派发 facade，按 `DATABASE_DIALECT` 接 PostgreSQL 或 MySQL，实现本包的 `AuthUserRepository` / `RefreshTokenStore` |
| `packages/db-schema` | 类型依赖 | 共用 schema 表定义（refresh sessions、SSO providers） |
| `apps/web-portal` | 主消费者 | 全部 SSO 路由 + session 中间件 |
| `apps/admin-console` | 主消费者 | 同上 + IAM bulk-import + SSO provider 管理 |
| `apps/gateway`（Go） | 验证 JWT | 用本包签发的 access token 公钥 (`AUTH_JWT_PUBLIC_KEY`) 校验入站 JWT |
