# SSO OIDC 配置手册

## 目标

在 `enterprise` 中启用 OIDC 单点登录，支持 `web-portal` 与 `admin-console` 统一认证。

## 通用前置条件

- 已完成 `bash scripts/bootstrap.sh`
- `DEFAULT_TENANT_ID` 已配置
- `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY` 已配置
- `SSO_STATE_SIGNING_SECRET` 与 `SSO_PROVIDER_SECRET_KEY` 已配置（建议 32+ 字节）

## 环境变量（最小集）

```bash
NEXT_PUBLIC_SSO_PROVIDERS=default:企业统一认证
SSO_STATE_SIGNING_SECRET=replace-with-32-plus-bytes-random-secret
SSO_PROVIDER_SECRET_KEY=replace-with-32-plus-bytes-random-secret

SSO_OIDC_DEFAULT_ISSUER=https://idp.example.com/realms/agenticx
SSO_OIDC_DEFAULT_CLIENT_ID=agenticx-portal
SSO_OIDC_DEFAULT_CLIENT_SECRET=replace-with-client-secret
SSO_OIDC_DEFAULT_REDIRECT_URI=http://localhost:3000/api/auth/sso/oidc/callback
SSO_OIDC_DEFAULT_ADMIN_REDIRECT_URI=http://localhost:3001/api/auth/sso/oidc/callback
```

## Keycloak 示例

1. 创建 Realm：`agenticx`
2. 创建 Client：
   - `Client ID`: `agenticx-portal`
   - `Access Type`: `confidential`
   - `Valid redirect URIs`:
     - `http://localhost:3000/api/auth/sso/oidc/callback`
     - `http://localhost:3001/api/auth/sso/oidc/callback`
3. 复制 client secret 到 `SSO_OIDC_DEFAULT_CLIENT_SECRET`
4. 设置 `SSO_OIDC_DEFAULT_ISSUER=https://<keycloak-host>/realms/agenticx`

## Azure Entra ID 示例

1. 新建 App Registration：`AgenticX Enterprise`
2. 添加 Web Redirect URI：
   - `http://localhost:3000/api/auth/sso/oidc/callback`
   - `http://localhost:3001/api/auth/sso/oidc/callback`
3. 创建 Client Secret
4. Issuer 使用 `https://login.microsoftonline.com/<tenant-id>/v2.0`

## 阿里云 IDaaS 示例

1. 创建 OIDC 应用
2. 配置回调地址同上
3. 记录 issuer/clientId/clientSecret 到 SSO 配置

## 验证步骤

1. 启动：`bash scripts/start-dev.sh --ui=stream`
2. 打开 `http://localhost:3000/auth`，点击「企业 SSO」
3. 完成 IdP 登录后应跳转到 `/workspace`
4. 打开 `http://localhost:3001/login`，点击「企业 SSO 登录」
5. 若用户具备 `admin:enter`，应进入 `/dashboard`

## 常见问题

- `oidc.invalid_state`：多标签页登录或 cookie 过期，重新发起登录。
- `admin_scope_missing`：账号缺 `admin:enter`，需在后台角色中授予。
- `provider_disabled`：provider 被禁用，需在 `/settings/sso` 启用。
