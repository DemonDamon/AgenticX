# SSO 验收清单

## 对齐条款

- 对齐《大模型一体化应用服务采购技术规范书》：
  - 权限管控（子账号管理、冻结回收）
  - 200 用户并发登录

## 功能验收

- [ ] web-portal 登录页显示「企业 SSO」入口
- [ ] admin-console 登录页显示「企业 SSO 登录」入口
- [ ] portal SSO 登录成功后写入 `agenticx_access_token` / `agenticx_refresh_token`
- [ ] admin SSO 登录仅对 `admin:enter` 用户放行
- [ ] 已禁用账号（`status=disabled`）SSO 登录被拒
- [ ] provider 禁用时返回 `provider_disabled`

### SAML 2.0 双栈验收

> 详情见 [`sso-saml-setup.md`](./sso-saml-setup.md)。

- [ ] 管理台可创建并启用 protocol=saml 的 provider，并通过「健康检查」按钮看到证书 validFrom/validTo
- [ ] portal `/api/auth/sso/saml/start` 触发跳转 IdP；callback 成功后落 access/refresh cookie
- [ ] admin SAML 登录走「预开户 + admin:enter」三态校验
- [ ] callback 失败写入 `auth.sso.login_failed` 审计，含 `protocol=saml` 与 `reason_code=saml.*`
- [ ] 设置 `SSO_SAML_DISABLED=true` 后 SAML 全部链路返回 `saml.provider_not_configured`，OIDC 不受影响

## 安全验收

- [ ] state cookie 为 `HttpOnly`，且 SameSite 策略符合环境：生产 `SameSite=None + Secure`，非生产 `SameSite=Lax`
- [ ] callback 支持 state 防重放
- [ ] `client_secret` 以加密形式存储（`client_secret_encrypted`）
- [ ] 日志中不打印 token/id_token/client_secret

## 并发验收（k6）

脚本：`enterprise/scripts/perf/sso-200-concurrent.js`（200 VU ramp，摘要中查看 P50/P95/P99 与错误率）。

```bash
# 需本机安装 k6；先启动 web-portal（默认 3000）
SSO_K6_BASE=http://127.0.0.1:3000 k6 run enterprise/scripts/perf/sso-200-concurrent.js
```

读数模板（摘自 k6 运行结束摘要）：

- `http_req_duration..............: avg=... min=... med=... max=... p(90)=... p(95)=...`
- `http_req_failed................: 0.00%`

验收建议（与采购条款对齐时用于自有基线；脚本内阈值为宽松默认，可按环境调紧）：

- 200 并发（或 ramp 峰值 200）下，`/api/auth/sso/oidc/start` **P95 < 800ms**（建议在 4C/8G 类机器、稳定网络下记录一次基线）
- callback 失败率为 0（测试账号有效前提）

可选归档：将摘要贴入 `enterprise/docs/perf-baselines/`（见该目录 README）。

## 回归命令

```bash
pnpm --filter @agenticx/auth test
pnpm --filter @agenticx/auth typecheck
pnpm --filter @agenticx/app-web-portal test
pnpm --filter @agenticx/app-web-portal typecheck
pnpm --filter @agenticx/app-admin-console test
pnpm --filter @agenticx/app-admin-console typecheck
pnpm e2e:sso
```
