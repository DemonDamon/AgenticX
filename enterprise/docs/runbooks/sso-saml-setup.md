# 企业 SSO（SAML 2.0）接入与回退 Runbook

> 适用范围：`enterprise/apps/web-portal`、`enterprise/apps/admin-console` 双栈 SAML SP 配置；与 OIDC 链路并存。
>
> 本文是 [`sso-oidc-setup.md`](./sso-oidc-setup.md) 的姊妹文档；OIDC 部分继续以原 runbook 为准。

## 0. 一键回退（最重要）

如果 SAML 出现严重问题（断言异常、IdP 不稳定、合规要求暂停），可通过环境变量快速回退到「只剩 OIDC」状态：

```bash
# .env.local 或部署环境
SSO_SAML_DISABLED=true
```

回退后立即生效（重启 portal/admin-console 后）：

- portal `/api/auth/sso/saml/start`、admin `/api/auth/sso/saml/start`：直接 redirect 回登录页，错误码 `saml.provider_not_configured`。
- portal/admin `/api/auth/sso/saml/callback`：返回 HTTP 400，body `{"error":"saml.provider_not_configured"}`，并写入一条审计 `auth.sso.login_failed (protocol=saml)`。
- 管理台「新增 SSO Provider」选择 SAML 协议时被服务端拒绝 (`SSO_SAML_DISABLED=true` 时禁止建 SAML provider)。
- OIDC 链路、错误码、路由、审计字段**完全不受影响**。

> 该开关只关 SAML。请勿引入 `SSO_DISABLED`、`SSO_OIDC_DISABLED` 等总开关——OIDC 不应该被 SAML 故障牵连下线。

## 1. 路由总览

| 角色 | 起点（GET） | 回调（POST） |
| --- | --- | --- |
| 前台 portal | `/api/auth/sso/saml/start?provider=<id>&returnTo=<safe>` | `/api/auth/sso/saml/callback` |
| 管理台 admin | `/api/auth/sso/saml/start?provider=<id>` | `/api/auth/sso/saml/callback` |

实现位置：

- 协议处理：`enterprise/packages/auth/src/services/saml-protocol-handler.ts`
- RelayState：`enterprise/packages/auth/src/services/saml-state.ts`
- 属性映射：`enterprise/packages/auth/src/services/saml-attribute-mapper.ts`
- portal 路由：`enterprise/apps/web-portal/src/app/api/auth/sso/saml/{start,callback}/route.ts`
- admin 路由：`enterprise/apps/admin-console/src/app/api/auth/sso/saml/{start,callback}/route.ts`

底层依赖：`@node-saml/node-saml` v5（已锁定，不引入 `passport-saml` 旧分支）。

## 2. 必要环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SSO_STATE_SIGNING_SECRET` | 由 `bootstrap.sh` 生成 | 加密 RelayState/cookie 的对称密钥；**与 OIDC 共用** |
| `SSO_PROVIDER_SECRET_KEY` | 由 `bootstrap.sh` 生成 | provider clientSecret/PEM 等敏感字段加密密钥 |
| `SSO_SAML_DISABLED` | `false` | 一键回退开关，详见上一节 |
| `NEXT_PUBLIC_SSO_PROVIDERS` | `default:企业统一认证` | 登录页按钮列表；如需 SAML 入口，按 `<providerId>:<显示名>` 追加 |

新增任何 SAML 专属环境变量后，必须同步更新：

- `enterprise/.env.local.example`
- `enterprise/turbo.json` 的 `globalEnv`
- `enterprise/scripts/bootstrap.sh` 默认值
- 本文档

## 3. 配置一个 SAML Provider（管理台）

### 3.1 IdP 准备

- 在 IdP 侧（飞书 / Okta / 中移动 IDaaS）创建一个 SAML 应用：
  - 服务提供方 / SP Entity ID：通常使用 `https://<your-portal-domain>/`（与 admin-console 共享则填管理台域）
  - ACS（Assertion Consumer Service）URL：`https://<host>/api/auth/sso/saml/callback`
  - NameID Format：建议 `emailAddress`
  - Required attributes：`email` 必填；可选 `displayName / firstName / lastName / dept / roles`

### 3.2 admin-console 录入

`/settings/sso` 页面 → 选择协议 `SAML 2.0` → 填写：

- Provider ID：与 portal 登录页 `?provider=` 对应
- IdP Entity ID / IdP SSO URL / 可选 SLO URL
- 一份或多份 IdP 签名证书 PEM（每张证书完整保留 `BEGIN/END CERTIFICATE` 块）
- SP Entity ID / ACS URL（必须与 IdP 应用配置一致）
- NameID Format / 时钟偏移（默认 60 秒）
- 是否要求 Assertion 签名（推荐开启）/ Response 签名
- attribute mapping（`email` 必填）

保存后管理台自动写入 PG `sso_providers.saml_config`，并写一条审计 `auth.sso.provider.create`（含 `protocol`）。

### 3.3 健康检查

管理台「健康检查」按钮（POST `/api/admin/sso/providers/<id>/health`）会：

- 解析每张 IdP 证书，给出 `validFrom / validTo / 是否过期`。
- 对 `idpSsoUrl` 发一次 HTTP HEAD（5s 超时）确认网络可达性；非 200 不视为致命错误，仅作为参考。

健康检查请求经 `sso-url-guard` 防 SSRF；不会向 IdP 发送任何用户信息或 SAMLRequest。

## 4. 端到端验收（建议在本地 mock IdP fixture 下完成）

| 场景 | 入口 | 期望结果 |
| --- | --- | --- |
| 合法 happy path | portal `/api/auth/sso/saml/start?provider=<id>` | 登录成功，写 access/refresh cookie，跳转 `returnTo` |
| 缺 email 属性 | 同上 | 错误码 `saml.attribute_email_missing`，redirect 回登录页 |
| 签名错误 | 篡改 SAMLResponse 签名 | 错误码 `saml.invalid_signature` |
| 断言过期 | 把 NotOnOrAfter 设为过去 | 错误码 `saml.expired_assertion` |
| issuer 不匹配 | 改 IdP entityID | 错误码 `saml.invalid_issuer` |
| audience 不匹配 | 改 SP entityID | 错误码 `saml.invalid_audience` |
| RelayState 篡改 | 修改 cookie | 错误码 `saml.relay_state_invalid` |
| Provider 禁用 | 在管理台关闭 enabled | 错误码 `saml.provider_disabled` |
| admin `admin:enter` 缺失 | 用未授权账号登录 | 错误码 `admin_scope_missing` |

每一项失败都会写入 `auth.sso.login_failed` 审计事件，详情字段：

```json
{
  "protocol": "saml",
  "reason_code": "saml.invalid_signature",
  "provider_id": "<id>",
  "issuer": "<idpEntityId>",
  "external_subject": "<NameID 或 null>",
  "email_hint": "<可选>"
}
```

成功登录写 `auth.sso.login`（portal）或 `auth.sso.admin_login`（admin），同样附带 `protocol = "saml"`。

## 5. 常见 IdP 配置入口（供运营索引）

- 飞书 SAML SSO：飞书管理后台 → 安全 → SSO → SAML 2.0 → 自定义应用。
- Okta SAML：Okta Admin → Applications → Create Custom SAML 2.0 App。
- 中移动 IDaaS：占位，实际接入参数由客户提供（可参考 `sso-oidc-setup.md` 的「中移动 IDaaS 接入信息收集清单」）。

## 6. 故障排查速查

| 现象 | 第一步排查 |
| --- | --- |
| 登录页跳转后立即回错误页 | 看 URL `?sso_error=` 的错误码；对照本文档「端到端验收」表 |
| Callback 报 `saml.relay_state_invalid` | 多半是 cookie 被代理裁掉或 SameSite 策略与环境不匹配；生产应使用 `SameSite=None + Secure` 以支持跨站回调，非生产保持 `SameSite=Lax` 以降低本地调试风险 |
| Callback 报 `saml.callback_failed` | 看后端日志，通常是 IdP 证书与 PEM 不匹配，或 audience 不一致 |
| 审计中只有 `protocol=saml` 的失败事件 | 代表 SP-init 流程已经走通到回调阶段；继续看 `reason_code` |
| 想暂停 SAML | 把 `SSO_SAML_DISABLED=true`，重启 portal/admin-console |

## 7. 本地 mock IdP fixture（仅本地）

为了在没有真实 IdP 的环境下验证 SAML 流程，仓库内置了一份只读、本地专用的 mock IdP，位于
`enterprise/scripts/sso/mock-saml-idp/`。使用步骤：

```bash
# 1) 一次性生成本地签名 keypair（永不提交）
pnpm sso:saml-mock-setup
# 2) 启动 mock IdP（默认 127.0.0.1:4444）
pnpm sso:saml-mock
```

启动后可访问：

- `GET /metadata` — IdP 元数据 XML（含 X.509 公钥）
- `GET /sso?acs=<acsUrl>&audience=<spEntityId>&email=<email>&displayName=<name>&roles=<csv>&RelayState=<state>&inResponseTo=<requestId>`
  — 返回一个自动 POST 到 SP `acsUrl` 的 HTML 表单，附 `SAMLResponse + RelayState`

补充：为支持本地 fixture，`admin-console` 仅在**非生产环境**允许将 `idpEntityId/idpSsoUrl` 配置为 `http://localhost` 或 `http://127.0.0.1`；生产环境仍强制 HTTPS 且禁止本地地址。

> 该 keypair 仅用于本地集成测试，禁止部署到任何对外环境。`scripts/sso/mock-saml-idp/.fixture/`
> 已加入 `.gitignore`，正常工作流不会把私钥纳入 git 历史。

mock IdP 与管理台 SAML provider 的对接示例参见
[`enterprise/scripts/sso/mock-saml-idp/README.md`](../../scripts/sso/mock-saml-idp/README.md)。

## 8. 与 OIDC 的关系

- 任何 OIDC 改动不得借助 SAML 链路绕过；反之亦然。
- 错误码命名空间：`oidc.*` 与 `saml.*` 分开维护，集中在 `enterprise/packages/auth/src/services/oidc-error-codes.ts`。
- 两条链路共享：`SSO_STATE_SIGNING_SECRET`、`sso-url-guard` SSRF 防护、`sanitizeSsoAuditDetail` 审计脱敏。
- 两条链路独立：`agenticx_oidc_state_*` / `agenticx_saml_state_*` 两套 cookie；start/callback 路由分目录。
