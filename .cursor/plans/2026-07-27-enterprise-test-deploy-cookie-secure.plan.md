# Enterprise 测试环境部署与 Cookie Secure 开关提交清单

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: gpt-5.3-codex
Status: implemented-on-branch (chore/enterprise-test-deploy-cookie-secure)
Notes: Public main landing sanitizes compose defaults (no lab IPs/secrets); portal SSO/logout cookie paths unified onto `isAuthCookieSecure()`.

## 目标

记录当前需要提交的 Enterprise 测试环境部署文件，以及 `admin-console` / `web-portal` 中将认证相关 cookie 的 `secure` 属性改为可通过环境变量关闭的变更范围，便于后续按同一主题整理提交。

## 现状证据

- `git status --short` 显示 `enterprise/deploy/docker-compose/` 下已有多份测试环境 compose 文件新增。
- `admin-console` 中已存在 `isAdminCookieSecure()`，并已用于登录、注销、OIDC、SAML 相关 cookie 策略。
- `web-portal` 中已存在 `isAuthCookieSecure()`，已覆盖 access/refresh token 的主登录链路，但部分认证链路仍需提交前确认是否统一。

## 提交范围

### 1. 测试环境部署 yml

当前应纳入提交的测试环境部署文件：

- `enterprise/deploy/docker-compose/admin_test.yml`
- `enterprise/deploy/docker-compose/gateway_test.yml`
- `enterprise/deploy/docker-compose/nginx_test.yml`
- `enterprise/deploy/docker-compose/portal_test.yml`
- `enterprise/deploy/docker-compose/test.yml`

相关辅助脚本（若本次提交包含测试环境启动入口）：

- `enterprise/deploy/docker-compose/load-test-runtime-env.sh`

说明：

- `enterprise/deploy/docker-compose/prod.yml` 当前也有本地修改，但不属于本清单默认提交范围；仅在测试环境文件必须依赖其改动时再一并纳入。

### 2. `enterprise/apps/admin-console` 变更

目标：使 admin 端登录态 cookie 与 SSO state cookie 的 `secure` 属性可由 `AUTH_COOKIE_SECURE` 环境变量控制关闭；未配置时仍保持生产环境默认开启。

当前应纳入的文件：

- `enterprise/apps/admin-console/src/lib/admin-session.ts`
- `enterprise/apps/admin-console/src/app/api/auth/login/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/logout/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/start/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/callback/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/sso/saml/start/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/sso/saml/callback/route.ts`
- `enterprise/apps/admin-console/src/app/api/auth/sso/saml/__tests__/start-cookie-policy.test.ts`

### 3. `enterprise/apps/web-portal` 变更

目标：使 portal 端 access/refresh cookie 的 `secure` 属性可由 `AUTH_COOKIE_SECURE` 环境变量控制关闭；未配置时仍保持生产环境默认开启。

当前已纳入的文件：

- `enterprise/apps/web-portal/src/lib/session.ts`
- `enterprise/apps/web-portal/src/app/api/auth/login/route.ts`

如本次提交目标是“portal 认证链路全部统一”，则提交前应继续确认并视情况纳入：

- `enterprise/apps/web-portal/src/app/api/auth/logout/route.ts`
- `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/start/route.ts`
- `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/callback/route.ts`
- `enterprise/apps/web-portal/src/app/api/auth/sso/saml/start/route.ts`
- `enterprise/apps/web-portal/src/app/api/auth/sso/saml/callback/route.ts`

## 环境变量约定

- `AUTH_COOKIE_SECURE=true`：强制开启 cookie `secure`
- `AUTH_COOKIE_SECURE=false`：允许在测试 / HTTP 环境关闭 cookie `secure`
- 未配置：回退为 `NODE_ENV === "production"` 时开启，否则关闭

## 提交验收口径

- 测试环境通过 HTTP 访问时，设置 `AUTH_COOKIE_SECURE=false` 后可以正常写入登录态 / 会话 cookie。
- 不设置 `AUTH_COOKIE_SECURE` 时，生产环境行为保持现有默认值，不放宽线上 cookie 策略。
- `admin-console` 与 `web-portal` 的登录、注销、SSO 相关 cookie 策略口径一致，不残留单独写死 `process.env.NODE_ENV === "production"` 的链路。
- 本次提交仅聚焦测试环境部署 yml 与 cookie secure 开关相关改动，不混入无关文件。

## 待确认事项

- `web-portal` 当前 worktree 中仍有部分认证路由未显示纳入本次改动，提交前需要确认是否补齐到同一策略。
- `enterprise/deploy/docker-compose/prod.yml` 当前存在修改；若与测试环境部署无直接依赖，建议留在后续独立提交中处理。

## 追溯

- Plan-Id: `2026-07-27-enterprise-test-deploy-cookie-secure`
- Plan-File: `.cursor/plans/pending/2026-07-27-enterprise-test-deploy-cookie-secure.plan.md`
