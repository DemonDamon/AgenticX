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

## 安全验收

- [ ] state cookie 为 `HttpOnly + SameSite=Lax`
- [ ] callback 支持 state 防重放
- [ ] `client_secret` 以加密形式存储（`client_secret_encrypted`）
- [ ] 日志中不打印 token/id_token/client_secret

## 并发验收（k6 示例）

`k6/sso-login.js` 示例（按实际 IdP 调整）：

```javascript
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 200,
  duration: "1m",
};

export default function () {
  const res = http.get("http://localhost:3000/api/auth/sso/oidc/start?provider=default");
  check(res, {
    "start endpoint 302": (r) => r.status === 302,
  });
  sleep(1);
}
```

验收建议：

- 200 并发下，`/api/auth/sso/oidc/start` P95 < 800ms
- callback 失败率为 0（测试账号有效前提）

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
