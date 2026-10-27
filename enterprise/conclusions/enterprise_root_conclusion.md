---
module_id: enterprise-root
module_name: enterprise-root
roots:
  - enterprise
summary_schema: code-module-summaries/v1
---

# enterprise-root

`enterprise/` 树里**未被更深模块认领**的胶水：workspace 清单、turbo、开发/压测/兼容脚本与仓库级文档入口。更深层的 `apps/*` / `features/*` / `packages/*` / `plugins/*` / `deploy/` 由对应模块拥有。

## Responsibility

- pnpm + turbo monorepo 根契约：`package.json`、`pnpm-workspace.yaml`、`turbo.json`、`tsconfig.base.json`。
- 本地开发入口：`scripts/start-dev.sh`、`start-dev-with-infra.sh`、`bootstrap.sh`、`reset-dev-data.sh`。
- 方言/可移植性：`scripts/db-compat/*`、`scripts/db-portability/*`、`scripts/ci/*`、`migrate-runtime-legacy.ts`。
- 冒烟 / e2e / 压测：`e2e-*.ts|sh`、`scripts/perf/*`、`load-test-keypool.ts`、gateway smoke。
- SSO 演示：`scripts/sso/oidc-smoke.ts`、`scripts/sso/mock-saml-idp/`。
- 仓库级 README / SECURITY / CODEOWNERS / `.env.local.example`。

明确不拥有：

- 各 app/feature/package 的实现与 schema（更深 root 优先）；`apps/context-service` 已拆为独立模块，见 `enterprise/conclusions/apps/context-service_conclusion.md`（根结论不展开其内部实现）。
- `enterprise/docs/**`（控制面 `exclude_paths`）。
- 客户仓 `customers/*`（独立 git；workspace 仅声明 glob）。
- 根目录截图 / webm 验收产物（已 exclude 前缀）。

## Entry points and public interfaces

| 入口 | 路径 | 角色 |
|------|------|------|
| Workspace | `enterprise/pnpm-workspace.yaml` | `apps/*` `features/*` `packages/*` `plugins/*`；可选 `../customers/*/apps|plugins` |
| Turbo | `enterprise/turbo.json` | `build` / `dev` / `lint` / `typecheck` / `test`；dev 注入 SSO/JWT 等 env |
| npm scripts | `enterprise/package.json` | `visual-tour`、`e2e:iam|sso`、`db:compat:*`、`db:migrate:pg-to-mysql`、`sso:*` |
| 开发栈 | `scripts/start-dev.sh` | 默认 portal:3000 + admin:3001；`--all` 才含 customers |
| 含中间件 | `scripts/start-dev-with-infra.sh` | compose 拉 PG/Redis 后再起应用 |
| 架构图 | `enterprise/assets/enterprise-architecture-{zh,en}.png` | 文档插图，非运行时（映射刷新期已替换二进制，不描述像素） |

## Core execution path

1. `pnpm` 按 workspace glob 解析包；Go gateway / Python sdk-py / skill-registry **不**进 pnpm 包图。
2. `start-dev.sh` 起 Next apps；需要 PG 时走 `start-dev-with-infra.sh`。local 的 `bootstrap.sh` 默认写入 `GATEWAY_REMOTE_BUDGET_CONFIG_URL`（admin `/api/internal/budget-snapshot`）；旧 `.env.local` 若缺该键，`start-dev.sh` 会由 `GATEWAY_REMOTE_PROVIDERS_URL` 推导同路径，避免管理台预算到不了 gateway。
3. 方言合同：`db:compat:list|test`；PG→MySQL：`db:migrate:pg-to-mysql`（`--dry-run` 为 verify）。`scripts/db-portability/table-manifest.ts` 显式 **47** 表（较 45 表新增 `connector_definitions` / `connector_connections`），`SENSITIVE_COLUMNS` 含 `encrypted_secret`。
4. 压测脚本在 `scripts/perf/`（k6 + mock-upstream + mint-perf-jwt），不进各 app 模块。

## Data and configuration

- 根 `packageManager: pnpm@9.12.0`，`engines.node >= 20`。
- JWT / SSO / admin 密码等由脚本与 turbo `dev.env` 声明，本模块不实现签发；`GATEWAY_REMOTE_BUDGET_CONFIG_URL` 与 providers/quotas 等 remote 地址一并由 `bootstrap.sh` 落 `.env.local`。
- 仓库 README 快速开始：开发态示例登录为 `admin@agenticx.local`（admin 用 `ADMIN_CONSOLE_LOGIN_PASSWORD`，portal 用 `AUTH_DEV_OWNER_PASSWORD`）。
- `.env.local.example` 是本地样例，不是密钥源。

## Dependencies

- **下游**：turbo 调度各 workspace 包；脚本调用 `iam-core`、gateway、Playwright。
- **上游**：仓库贡献者与 CI。

## Tests and operations

- `scripts/db-compat/__tests__/dialect-contract.test.ts`
- `scripts/db-portability/__tests__/portability.test.ts`
- `scripts/e2e-visual-tour.ts` / `e2e-visual-tour-i18n.ts`（`pnpm visual-tour`）
- `scripts/e2e-iam.ts`、`e2e-sso.ts`

## Unverified or ambiguous

- `scripts/perf` 基线数字是否仍有效：本结论只登记脚本入口，不把历史 P95 当当前承诺。
