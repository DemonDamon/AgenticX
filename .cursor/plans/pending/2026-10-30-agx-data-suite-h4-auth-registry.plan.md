# AGX Data Suite H4 — 认证路由全面 AuthStrategyRegistry 收口

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h4-auth-registry`  
> **Depends on:** H3 merged (`8e229eac` / PR #170); **S2-1…S2-3 start-route protocol assert already done — DO NOT redo.**  
> **Main-repo gate:** 通用可插拔认证壳；禁止客户 IdP 适配实例（B5）。

**Goal:** 四个 SSO **callback** 路由显式走 `assert*SsoStrategyProtocol`（与 start 对称），证明：
1. 全部 OIDC/SAML/Keycloak SSO 路由经 `AuthStrategyRegistry`
2. 新认证方式 = 注册 strategy 插件；核心路由不变
3. Fake strategy（`fake-customer-iam`）register → resolve → protocol 可测
4. enterprise SSO 相关 vitest（registry 登录路径）通过；不依赖现场 Keycloak

**Inventory（H4 前）**

| 面 | 状态 |
|----|------|
| admin/portal oidc+saml **start** | 已 `assert*SsoStrategyProtocol`（S2 / harden-2/3） |
| `get*ProviderConfig(Server)` | 内部已 assert（埋点） |
| admin/portal oidc+saml **callback** | **缺口**：无路由级显式 assert / 无错协议·未知 strategy 用例 |
| `@agenticx/auth` registry + fake | 已有；缺 resolve(`custom`)→fake 与「插件化」叙述性用例 |
| e2e-sso.ts | 仅登录页可达 smoke，非 registry 证明；H4 不发明 live IdP |

**Out of scope:** H5 ACL/脱敏；客户 IdP（B5）；重做 start 路由；FinnewsHunter；合并本 PR。

## File map

| Path | Responsibility |
|------|----------------|
| `enterprise/apps/admin-console/.../oidc/callback/route.ts` | state 解出 providerId 后 `assertAdminSsoStrategyProtocol(..., "oidc")` |
| `enterprise/apps/admin-console/.../saml/callback/route.ts` | 同上 `"saml"` |
| `enterprise/apps/web-portal/.../oidc/callback/route.ts` | `assertPortalSsoStrategyProtocol(..., "oidc")` |
| `enterprise/apps/web-portal/.../saml/callback/route.ts` | 同上 `"saml"` |
| `enterprise/apps/admin-console/src/lib/admin-sso-runtime.ts` | assert 将 unknown strategy 归一为 `*.provider_not_configured` |
| `enterprise/apps/web-portal/src/lib/sso-runtime.ts` | 同上 |
| `.../oidc/__tests__/callback-strategy-protocol.test.ts`（admin+portal） | 错协议 / 未知 strategy → 登录页 error |
| `.../saml/__tests__/callback-strategy-protocol.test.ts`（admin+portal） | 错协议（STRATEGY=oidc）→ saml error |
| `enterprise/packages/auth/src/strategies/__tests__/registry.test.ts` | Fake：get + protocol=custom |
| `enterprise/packages/auth/src/strategies/__tests__/resolve.test.ts` | `protocol: custom` → `fake-customer-iam` |
| runtime tests（admin/portal） | 可选：fake resolve 通过 assert 拒绝 oidc 期望 |

## Interfaces

```ts
// 已有；callback 与 start 共用
assertAdminSsoStrategyProtocol(providerId, "oidc" | "saml", protocolHint?): AuthStrategy
assertPortalSsoStrategyProtocol(providerId, "oidc" | "saml", protocolHint?): AuthStrategy
// Keycloak 仍经 registry：STRATEGY=keycloak 或 BASE_URL+REALM；无 Keycloak-only callback fork
```

provider id 来源：OIDC = `validateStateFromCookie` → `decoded.providerId`；SAML = `decodeSignedSamlState` → `preliminaryProviderId`。

## Tasks

### Task 1 — Plan + assert harden + callback wire
- [x] 本 plan 落盘
- [x] assert 捕获 registry unknown → `oidc|saml.provider_not_configured`
- [x] 四 callback 显式 assert（mirror start）
- [x] Commit: `feat(auth): assert SSO strategy protocol on callback routes`

### Task 2 — Tests（TDD 友好可同 commit 或紧随）
- [x] callback-strategy-protocol tests（admin/portal × oidc/saml）
- [x] Fake pluggability：registry + resolve(custom)
- [x] 现有 callback / runtime / auth package 测试保持绿
- [x] Commit: `test(auth): callback protocol reject + fake strategy pluggability`

### Task 3 — Gate + PR
- [x] `pnpm --filter @agenticx/auth test`
- [x] admin-console / web-portal SSO 相关 vitest（runtime + callback suites）
- [x] 可选：`pnpm -C enterprise sso:oidc-smoke`（无网络配置自检）
- [x] **不**跑依赖 live Keycloak 的 Playwright；Fake/mock registry 路径即可
- [x] Mark plan Done；push；`gh pr create`；**不 merge；不启动 H5**

## Done when
1. 四 callback 源码可见 `assert*SsoStrategyProtocol`
2. 错协议 / 未知 strategy 有失败用例且绿
3. Fake strategy register→resolve→protocol 有明确测试
4. Keycloak 仍经 registry（无硬编码 callback fork）
5. 无客户 IdP / 无 FinnewsHunter 提交

## Gate before H5
Merge this PR（或用户 stack）后再开 H5 ACL+脱敏分支。
