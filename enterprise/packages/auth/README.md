# @agenticx/auth

认证抽象层（Supabase/LDAP/SSO/账密）

## OIDC SSO

`@agenticx/auth` 提供了 OIDC 客户端核心能力：

- `OidcClientService`：OIDC discovery 缓存、构造授权 URL、处理 callback code exchange
- `mapClaimsToAuthUser`：按 claim mapping 解析 email/displayName/dept/roles
- `buildStateCookieValue` / `validateStateFromCookie`：state/nonce/pkce verifier 的签名 cookie 存储与校验
- `encryptSecret` / `decryptSecret`：AES-256-GCM 加密 provider secret

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
