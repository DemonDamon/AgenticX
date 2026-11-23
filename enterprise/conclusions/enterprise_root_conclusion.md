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
- 冒烟 / e2e / 压测：`e2e-*.ts|sh`、`scripts/perf/*`、`load-test-keypool.ts`、gateway smoke；`enterprise/e2e/`（独立 npm 项目，不进 pnpm workspace，`e2e` Web 引擎，管理台 Webhook / NL2SQL 等）；`scripts/e2e-*.ts` Playwright 烟囱（数据套件、图谱、门户、安全问数、规则治理等）；`scripts/demo-*-record.ts` 产品演示录屏（旁白 + 截图/MP4）。
- 托管智能体本地胶水（非运行时实现）：`ma:backfill-agent-versions`、`ma:provision-dev-tokens`。
- SSO 演示：`scripts/sso/oidc-smoke.ts`、`scripts/sso/mock-saml-idp/`。
- 仓库级 README / SECURITY（含事件响应 SOP §4.5 与红队演练入口）/ CODEOWNERS / `.env.local.example`。

明确不拥有：

- 各 app/feature/package 的实现与 schema（更深 root 优先）；`apps/context-service` 已拆为独立模块，见 `enterprise/conclusions/apps/context-service_conclusion.md`；`apps/agent-runtime` 已拆为独立模块，见 `enterprise/conclusions/apps/agent-runtime_conclusion.md`（根结论不展开其 HTTP/执行器内部，仅保留 `start-dev`/`bootstrap` 等启动与密钥胶水）。
- `enterprise/docs/**`（控制面 `exclude_paths`）。
- 客户仓 `customers/*`（独立 git；workspace 仅声明 glob）。
- 根目录截图 / webm 验收产物（已 exclude 前缀）。

## Entry points and public interfaces

| 入口 | 路径 | 角色 |
|------|------|------|
| Workspace | `enterprise/pnpm-workspace.yaml` | `apps/*` `features/*` `packages/*` `plugins/*`；可选 `../customers/*/apps|plugins` |
| Turbo | `enterprise/turbo.json` | `build` / `dev` / `lint` / `typecheck` / `test`；dev 注入 SSO/JWT 等 env |
| npm scripts | `enterprise/package.json` | `visual-tour`、`e2e:iam|sso`、`e2e:data-boards|data-security`、`ma:backfill-agent-versions`、`ma:provision-dev-tokens`、`db:compat:*`、`db:migrate:pg-to-mysql`、`sso:*` |
| 开发栈 | `scripts/start-dev.sh` | 默认 portal:3000 + admin:3001；`--all` 才含 customers；`--with-agent-runtime` 可选拉起 `:8092`（见 agent-runtime 模块，非本模块实现） |
| 含中间件 | `scripts/start-dev-with-infra.sh` | compose 拉 PG/Redis 后再起应用；可透传 `--with-agent-runtime` |
| Admin Web e2e | `enterprise/e2e/` | 独立 `npm install` + `npx e2e run`；依赖管理台与（用例需要时）已启用的托管运行时 |
| 架构图 | `enterprise/assets/enterprise-architecture-{zh,en}.png` | 文档插图，非运行时（映射刷新期已替换二进制，不描述像素） |

## Core execution path

1. `pnpm` 按 workspace glob 解析包；Go gateway / Python sdk-py / skill-registry **不**进 pnpm 包图。
2. `start-dev.sh` 起 Next apps；需要 PG 时走 `start-dev-with-infra.sh`。local 的 `bootstrap.sh` 默认写入 `GATEWAY_REMOTE_BUDGET_CONFIG_URL`（admin `/api/internal/budget-snapshot`）及 `GATEWAY_REMOTE_VIRTUAL_MODELS_URL`；旧 `.env.local` 若缺 budget/virtual-models/heartbeat 键，`start-dev.sh` 会由 `GATEWAY_REMOTE_PROVIDERS_URL` 推导 `budget-snapshot`、`virtual-models`、`gateway-heartbeat`，避免管理台配置到不了 gateway。`bootstrap.sh` / `start-dev.sh` 还会在本地生成 `MA_INTERNAL_TOKEN_FILE`、`MA_VAULT_MASTER_KEY_FILE` 并落 `.env.local`；自动迁移链路在 `migrate:legacy-runtime` 之后执行 `ma:backfill-agent-versions`。`--with-agent-runtime` 时：`start-dev` 补全托管 PAT（`pnpm ma:provision-dev-tokens`）并以隔离 `HOME` 子进程启动 `apps/agent-runtime` 的 uvicorn——进程生命周期归本脚本，业务语义归 agent-runtime 模块。
3. 方言合同：`db:compat:list|test`；PG→MySQL：`db:migrate:pg-to-mysql`（`--dry-run` 为 verify）。`scripts/db-portability/table-manifest.ts` 显式 **47** 表（较 45 表新增 `connector_definitions` / `connector_connections`），`SENSITIVE_COLUMNS` 含 `encrypted_secret`。
4. 压测脚本在 `scripts/perf/`（k6 + mock-upstream + mint-perf-jwt），不进各 app 模块。

## Data and configuration

- 根 `packageManager: pnpm@9.12.0`，`engines.node >= 20`；`pnpm.overrides` 钉 `typescript@5.9.3`（与 workspace devDep 对齐）。
- JWT / SSO / admin 密码等由脚本与 turbo `dev.env` 声明，本模块不实现签发；`GATEWAY_REMOTE_BUDGET_CONFIG_URL` 与 providers/quotas/virtual-models 等 remote 地址一并由 `bootstrap.sh` 落 `.env.local`。
- `.env.local.example` 增补托管智能体相关占位：`MA_RUNTIME_*`、`MA_INTERNAL_TOKEN`、评测 UI 开关、`MA_VAULT_MASTER_KEY_FILE` / `MA_VAULT_RESOLVE_ENABLED`（样例非密钥源）。
- 仓库 README 快速开始：开发态示例登录为 `admin@agenticx.local`（admin 用 `ADMIN_CONSOLE_LOGIN_PASSWORD`，portal 用 `AUTH_DEV_OWNER_PASSWORD`）。
- `.env.local.example` 是本地样例，不是密钥源。

## Dependencies

- **下游**：turbo 调度各 workspace 包；脚本调用 `iam-core`、gateway、Playwright。
- **上游**：仓库贡献者与 CI。

## Tests and operations

- `scripts/db-compat/__tests__/dialect-contract.test.ts`
- `scripts/db-portability/__tests__/portability.test.ts`
- `scripts/e2e-visual-tour.ts` / `e2e-visual-tour-i18n.ts`（`pnpm visual-tour`）
- `scripts/e2e-iam.ts`、`e2e-sso.ts`；`pnpm e2e:data-boards`、`e2e:data-security` 及同目录大量 `scripts/e2e-*.ts`（Playwright，需已起的 admin/portal）
- `enterprise/e2e/`：`npm run test`（`e2e run`），见目录内 `README.md`
- `pnpm ma:backfill-agent-versions`、`ma:provision-dev-tokens`（本地 DB / PAT 准备，bootstrap 与 `--with-agent-runtime` 会调用）

## Unverified or ambiguous

- `scripts/perf` 基线数字是否仍有效：本结论只登记脚本入口，不把历史 P95 当当前承诺。
- `enterprise/e2e` 与部分 `e2e-*.ts` 依赖真实模型密钥与可选 agent-runtime，未纳入 turbo `test` 默认门禁。
