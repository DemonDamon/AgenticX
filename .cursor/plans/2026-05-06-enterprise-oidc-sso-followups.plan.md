# Enterprise OIDC SSO — Code Review Follow-ups

- **Plan-Id**: `2026-05-06-enterprise-oidc-sso-followups`
- **创建时间**: 2026-05-06
- **作者**: Damon Li
- **状态**: Draft
- **关联 plan**: [`.cursor/plans/2026-05-06-enterprise-oidc-sso.plan.md`](./2026-05-06-enterprise-oidc-sso.plan.md)
- **关联 commits（已落地的 must-fix 收尾）**:
  - `278e84b feat(enterprise/auth): add OIDC client core ...`
  - `03c904c feat(enterprise/web-portal): enable OIDC SSO login ...`
  - `69c3ca7 feat(enterprise/admin-console): enable OIDC SSO with admin:enter scope guard`
  - `71f37fe feat(enterprise/iam-core): add sso_providers schema/repo + sso scope + sso_admin role`
  - `4f100f3 feat(enterprise/admin-console): SSO 设置面板 + 多租户多 IdP 管理 API`
  - `b904b3f docs(enterprise/sso): runbooks, e2e-sso, sales demo script & acceptance checklist`

---

## 1. 背景

主线 plan `2026-05-06-enterprise-oidc-sso` 已经把 OIDC 单点登录闭环交付到生产可演示状态。
本次 code review 中识别出的 **Critical / High / Must-fix Medium** 项已在主线 6 段 commit 中收尾，
本 plan 仅承接当时被划为 **Should fix / Nice to have / 后续可演进** 的子项，按"成本×收益"分组排期。

> 适用范围：所有改动仍严格收敛在 `enterprise/` 子树；**不得**误改 `desktop/`、`agenticx/`
> 等无关模块；每段改动必须能追溯到下面对应的 `FR-*` 编号（参考 `no-scope-creep.mdc`）。

## 2. Out of scope（明确不做）

- SAML 2.0 / SCIM 2.0：仍按主线 plan §5 留给独立 plan。
- IdP-initiated SSO / 反向 Single Logout：留给独立 plan。
- AgenticX 作为 OAuth2 授权服务器（明确不做）。
- Desktop/Electron 端 SSO：本 plan 不涉及。

---

## 3. 工作分组（按优先级）

### Group A · OIDC Provider 端硬化（中优先级）

#### A1 — `redirectUri` 强制 HTTPS + 与 issuer 同源校验（可选）（M-3）

```text
FR-A1.1  packages/auth/src/services/oidc-client.ts 在 buildAuthorizationUrl 前对
         provider.redirectUri 做 HTTPS-only 校验（开发态可读 NEXT_PUBLIC_DEV_INSECURE_REDIRECT
         白名单），生产态非 HTTPS 直接抛 OidcConfigError("oidc.invalid_redirect_uri")。
FR-A1.2  admin-console sso-url-guard 增加 assertSafeRedirectUri：禁止指向回环/私网 IP，
         可选要求与已配置 origin 列表（NEXT_PUBLIC_SSO_REDIRECT_ORIGIN_ALLOWLIST）匹配。
FR-A1.3  PATCH/POST /api/admin/sso/providers 在校验失败时返回 400 + i18n code
         oidc.invalid_redirect_uri，并在 settings UI 给可读提示。
AC-A1.1  vitest：HTTP redirect、私网 redirect、跨域 redirect 各一条失败用例。
AC-A1.2  e2e-sso：本地 dev 通过白名单走通 http://localhost; 生产模式被拒。
```

**Files**

- Modify: `enterprise/packages/auth/src/services/oidc-client.ts`
- Modify: `enterprise/apps/admin-console/src/lib/sso-url-guard.ts`
- Modify: `enterprise/apps/admin-console/src/app/api/admin/sso/providers/route.ts`
- Modify: `enterprise/apps/admin-console/src/app/api/admin/sso/providers/[id]/route.ts`
- Modify: `enterprise/apps/admin-console/src/app/settings/sso/page.tsx`

**Commit**

```bash
git add enterprise/packages/auth/src/services/oidc-client.ts \
        enterprise/apps/admin-console/src/lib/sso-url-guard.ts \
        enterprise/apps/admin-console/src/app/api/admin/sso/providers \
        enterprise/apps/admin-console/src/app/settings/sso
git commit -m "$(cat <<'EOF'
feat(enterprise/sso): enforce https-only + private-IP guard for OIDC redirect_uri

## Requirements
- FR-A1.1 / FR-A1.2 / FR-A1.3
- AC-A1.1 / AC-A1.2

Plan-Id: 2026-05-06-enterprise-oidc-sso-followups
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso-followups.plan.md
Made-with: Damon Li
EOF
)"
```

#### A2 — sso-url-guard DNS 解析加 timeout / TTL 缓存（M-7）

```text
FR-A2.1  assertSafeIssuerUrl 的 dns.lookup 加 5s timeout，超时直接拒绝。
FR-A2.2  增加 LRU 缓存（容量 64 / TTL 60s），避免对同一 issuer 频繁 DNS 探测；
         缓存 key=hostname，value={ resolvedAt, lookupResult }。
FR-A2.3  暴露 invalidateIssuerHost(host) 工具函数，PATCH 修改 issuer 时一并清缓存。
AC-A2.1  vitest：mock dns.lookup hang → 5s 内拒绝；命中缓存场景 lookup 调用次数=1。
```

**Files**

- Modify: `enterprise/apps/admin-console/src/lib/sso-url-guard.ts`
- Modify: `enterprise/apps/admin-console/src/app/api/admin/sso/providers/[id]/route.ts`
- Create: `enterprise/apps/admin-console/src/lib/__tests__/sso-url-guard.test.ts`

**Commit**

```bash
git add enterprise/apps/admin-console/src/lib/sso-url-guard.ts \
        enterprise/apps/admin-console/src/lib/__tests__/sso-url-guard.test.ts \
        enterprise/apps/admin-console/src/app/api/admin/sso/providers/[id]
git commit -m "$(cat <<'EOF'
feat(enterprise/sso): timeout & LRU cache for issuer DNS lookup in sso-url-guard

## Requirements
- FR-A2.1 ~ FR-A2.3
- AC-A2.1

Plan-Id: 2026-05-06-enterprise-oidc-sso-followups
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso-followups.plan.md
Made-with: Damon Li
EOF
)"
```

---

### Group B · 审计与可观测性增强（中优先级）

#### B1 — JIT 创建/SSO 登录失败的结构化审计（M-4）

```text
FR-B1.1  web-portal callback：JIT 创建用户路径写 audit_events
         (event_type="auth.sso.jit_create"，detail={ provider, issuer, sub,
         email_lower, role_codes, jit_created: true })。
FR-B1.2  web-portal/admin-console callback：state/nonce 校验失败、id_token
         exp/aud/iss 校验失败、account_disabled、admin_scope_missing 等失败路径，
         统一写 auth.sso.login_failed，detail 包含 reason_code + provider + 必要 sub/email。
FR-B1.3  失败 detail 严禁带 access_token / id_token / client_secret 等敏感原文，
         统一通过 audit-redact 包装函数过滤。
AC-B1.1  集成测试：mock 一次 state mismatch + 一次 admin_scope_missing，PG 中
         可分别查到对应 reason_code 的 audit 行。
```

**Files**

- Modify: `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/callback/route.ts`
- Modify: `enterprise/apps/admin-console/src/app/api/auth/sso/oidc/callback/route.ts`
- Modify: `enterprise/packages/iam-core/src/repos/audit.ts`（如需 helper）
- Create: `enterprise/apps/web-portal/src/app/api/auth/sso/oidc/__tests__/audit.test.ts`

#### B2 — discovery 缓存命中率指标（L-2）

```text
FR-B2.1  OidcClientService 暴露 getCacheStats(): { hits, misses, staleHits,
         staleEvictions, lastError } 简单计数器。
FR-B2.2  admin-console 新增 GET /api/admin/sso/providers/stats（require sso:read），
         返回每个 provider 的 cache stats，UI 在 settings/sso 里显示「最近 1h 命中率」。
FR-B2.3  失败 5 次内连续触发的 stale fallback 写一条 audit_events
         (auth.sso.discovery_degraded)。
AC-B2.1  vitest：连续 5 次 mock discovery 抛错 → staleHits 累加 + 第 6 次后超龄触发抛错。
```

---

### Group C · 测试与运行时韧性补强（中低优先级）

#### C1 — token endpoint / userinfo 失败用例补 vitest（L-1）

```text
FR-C1.1  packages/auth/src/services/__tests__/oidc-client.test.ts 增加：
         - authorizationCodeGrant 抛 401 → 期望 OidcCallbackError("oidc.callback_failed")。
         - getValidatedIdTokenClaims 抛 nonce mismatch → 期望
           OidcCallbackError("oidc.invalid_nonce")。
FR-C1.2  增加 mapClaimsToAuthUser email 缺失 + email 不为字符串场景，断言
         OidcClaimError("oidc.claim.email_missing")。
AC-C1.1  pnpm --filter @agenticx/auth test 覆盖率 +5pp。
```

#### C2 — provider_disabled 端到端覆盖（L-4 收尾）

```text
FR-C2.1  在 web-portal/src/app/api/auth/sso/oidc/__tests__ 下加 vi.mock
         "@agenticx/iam-core" → getSsoProviderByProviderId 返回 enabled:false
         的 fixture，断言 callback 返回 302 /auth?sso_error=oidc.provider_disabled。
FR-C2.2  admin-console 同样路径 → 302 /login?sso_error=oidc.provider_disabled。
AC-C2.1  pnpm --filter @agenticx/app-web-portal test 覆盖该路径。
AC-C2.2  pnpm --filter @agenticx/app-admin-console test 覆盖该路径。
```

#### C3 — 200 路并发登录 k6 真实压测脚本（L-3）

```text
FR-C3.1  enterprise/scripts/perf/sso-200-concurrent.js（k6）：mock IdP 后端
         （通过环境变量切到 in-memory IdP fixture），200 VUs / 60s ramp，
         统计 P50 / P95 / P99 + 错误率。
FR-C3.2  enterprise/docs/runbooks/sso-acceptance-checklist.md 引用本脚本，
         给出执行命令与读数模板。
FR-C3.3  CI（可选）：手动触发 workflow 跑一次 nightly 基线，结果归档到
         enterprise/docs/perf-baselines/。
AC-C3.1  本地能跑通；P95 ≤ 800ms 在 4-core / 8GB 机器上达成。
```

---

### Group D · 文档与开发者体验（低优先级）

#### D1 — README / runbook 收口（M-8）

- 把 plan §"必须做"已经落地的安全语义（state cookie 加密 / HKDF / SSRF guard）
  补到 `enterprise/packages/auth/README.md` 与 `docs/runbooks/sso-oidc-setup.md`。
- 在 `docs/sales/sso-demo-script.md` 增加「为什么 admin 端不 JIT」一段话术。

#### D2 — error code 国际化对照表（L-5）

- 集中维护 `enterprise/packages/auth/src/services/oidc-error-codes.ts`：
  导出一个 `OIDC_ERROR_CODES` 常量数组 + 中英对照映射，供前端 i18n 与文档同源生成。
- 替换 web-portal/admin-console 各 `page.tsx` 中重复的 switch-case 错误码映射。

---

## 4. 排期建议

| 周 | 内容 | 备注 |
|---|---|---|
| W1 | A1 + A2 | 安全硬化优先；上线无破坏性 |
| W2 | B1 + B2 | 审计/observability，配合客户验收材料更新 |
| W3 | C1 + C2 | 提升测试覆盖；为后续 PR 减少回归风险 |
| W4 | D1 + D2 | 文档收口；视客户演示节奏穿插 |
| 弹性 | C3 | 视客户压测口径再启动；脚本可以先入仓 |

每段独立 commit，统一带：

```text
Plan-Id: 2026-05-06-enterprise-oidc-sso-followups
Plan-File: .cursor/plans/2026-05-06-enterprise-oidc-sso-followups.plan.md
Made-with: Damon Li
```

## 5. Definition of Done

- [ ] Group A 全部子项落地 + 对应 vitest 全绿。
- [ ] Group B 落地后，admin-console 设置页能直观看到 SSO 失败原因 / discovery 命中率。
- [ ] Group C 落地后，`pnpm -w test` 全绿；新增覆盖率不少于 +5pp。
- [ ] Group D 落地后，`docs/runbooks/sso-oidc-setup.md` 与 `docs/sales/sso-demo-script.md`
  与代码现状一致；`OIDC_ERROR_CODES` 单一来源。
- [ ] 每个 follow-up commit 都带 `Plan-Id` / `Plan-File` / `Made-with: Damon Li` 三个 trailer。
