# @agenticx/auth

认证抽象层（Supabase/LDAP/SSO/账密）

## OIDC SSO

`@agenticx/auth` 提供了 OIDC 客户端核心能力：

- `OidcClientService`：OIDC discovery 缓存、构造授权 URL、处理 callback code exchange
- `mapClaimsToAuthUser`：按 claim mapping 解析 email/displayName/dept/roles
- `buildStateCookieValue` / `validateStateFromCookie`：state/nonce/pkce verifier 的加密 cookie 存储与校验（**AES-256-GCM**，密钥材料经 **HKDF** 从 `SSO_STATE_SIGNING_SECRET` 派生）
- `encryptSecret` / `decryptSecret`：AES-256-GCM 加密 provider `client_secret` 落库字段

### 安全语义（摘要）

- **redirect_uri**：生产环境强制 HTTPS；本地开发仅允许 `localhost`/`127.0.0.1` 的 http 或其它在 `SSO_DEV_INSECURE_REDIRECT_ALLOWLIST` 中的 origin（由 `oidc-redirect-policy` 校验，`OidcConfigError("oidc.invalid_redirect_uri")`）。
- **OIDC discovery 缓存**：短 TTL 内存缓存；失败时可回落到未过最大年龄的 stale 配置；连续 5 次 stale 回落可由集成方注册 `registerOidcDiscoveryDegradedReporter` 写审计。
- **错误码单一来源**：`oidc-error-codes.ts`（`OIDC_ERROR_CODES` + 中英对照 getter）供 portal / admin UI 共用。

### 常用环境变量

```bash
NEXT_PUBLIC_SSO_PROVIDERS=default:企业统一认证
SSO_STATE_SIGNING_SECRET=replace-with-32-plus-bytes-random-secret
SSO_PROVIDER_SECRET_KEY=replace-with-32-plus-bytes-random-secret

SSO_OIDC_DEFAULT_ISSUER=https://idp.example.com/realms/agenticx
SSO_OIDC_DEFAULT_CLIENT_ID=agenticx-portal
SSO_OIDC_DEFAULT_CLIENT_SECRET=replace-with-client-secret
SSO_OIDC_DEFAULT_REDIRECT_URI=http://localhost:3000/api/auth/sso/oidc/callback
SSO_OIDC_DEFAULT_ADMIN_REDIRECT_URI=http://localhost:3001/api/auth/sso/oidc/callback
SSO_OIDC_DEFAULT_SCOPES=openid profile email groups
```

### 错误码示例

- `oidc.discovery_failed`：OIDC metadata 拉取失败
- `oidc.invalid_state`：state 不匹配或过期
- `oidc.callback_failed`：code exchange 失败
- `oidc.account_disabled`：本地账号状态不可登录
