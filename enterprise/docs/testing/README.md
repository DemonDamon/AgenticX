# 测试策略

Enterprise 测试分散在 Go gateway、TS packages/apps 与 scripts E2E 中。仓库**无**统一 CI 全绿保证文档（以各 package `test` script 为准）。

---

## 命令矩阵

| 命令 | 范围 | 前置 |
|---|---|---|
| `pnpm test` | turbo 各 package test | 因 package 而异 |
| `pnpm typecheck` | 全 TS monorepo | `pnpm install` |
| `pnpm lint` | ESLint | |
| `cd apps/gateway && go test ./...` | Gateway 单元测试 | Go 1.25+ |
| `pnpm e2e:iam` | Playwright IAM 冒烟 | :3000 + :3001 已起 |
| `pnpm e2e:sso` | SSO 入口可达性 | 同上 |
| `pnpm visual-tour` | 13 页 × 2 主题截图 | 同上 + Chromium |
| `pnpm sso:oidc-smoke` | OIDC env 字段自检 | 无网络 |
| `k6 run scripts/perf/sso-200-concurrent.js` | SSO 并发压测 | k6 已安装 |

---

## E2E：IAM

```bash
bash scripts/start-dev.sh
pnpm e2e:iam
```

覆盖 admin IAM 部门/角色/用户关键路径。

环境变量：

- `ADMIN_BASE_URL`（默认 `http://localhost:3001`）
- `ADMIN_CONSOLE_LOGIN_PASSWORD`

---

## E2E：SSO Smoke

```bash
pnpm e2e:sso
```

- `PORTAL_BASE` / `ADMIN_BASE`
- 仅验证 `/auth`、`/login` 与 SSO 入口可达，**不**完成完整 IdP 换票

---

## 视觉巡检

```bash
pnpm visual-tour:install   # 首次
bash scripts/start-dev.sh
export ADMIN_CONSOLE_LOGIN_PASSWORD=...
export AUTH_DEV_OWNER_PASSWORD=...
pnpm visual-tour
```

输出：`docs/visuals/v2/{page}-{theme}.png`（26 张，可能 gitignore）

用于 PR 视觉回归，参考 commit `feat/enterprise-visual-overhaul-v2`。

---

## OIDC 配置自检

```bash
pnpm sso:oidc-smoke
```

退出码：

- `0` — 字段齐全
- `1` — 缺字段或 issuer 占位
- `2` — 未配置 `NEXT_PUBLIC_SSO_PROVIDERS`

---

## SAML Mock IdP

```bash
pnpm sso:saml-mock-setup
pnpm sso:saml-mock
```

本地 mock IdP，见 `scripts/sso/mock-saml-idp/`。

---

## Channel 轮换 E2E

```bash
bash scripts/e2e-channel-rotate.sh
```

需 gateway channel registry 启用 + admin channels 配置。

---

## 性能压测

```bash
k6 run scripts/perf/sso-200-concurrent.js
```

**注意**：仓库无官方性能基线，勿将单次结果作为客户 SLA 承诺。见 [perf-baselines/README.md](../perf-baselines/README.md)。

---

## MVP 验收

现场演示前对照：[mvp-acceptance-checklist-v20260422.md](../mvp-acceptance-checklist-v20260422.md)

区分：

- ✅ 可演示 — IAM、chat、policy、audit、metering、模型服务
- ⚠️ 需小改 — 视部署 env
- ❌ 不可演示 — KB、MCP 市场、edge-agent、tool-watermark 等 stub

---

## 编写新测试

- **Unit**：各 package 内 vitest，贴近 public API
- **Integration**：优先 Playwright 对 admin/portal 关键路径
- **Gateway**：Go table-driven tests 在 `internal/*/*_test.go`

避免 implementation-coupled 断言（如断言具体 CSS class），除非视觉回归专用。

---

## 相关文档

- [development/local-dev.md](../development/local-dev.md)
- [../scripts/README.md](../scripts/README.md)
