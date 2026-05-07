# enterprise/scripts — 脚本一览

本目录收纳 enterprise（前台 web-portal + 后台 admin-console + 网关 apps/gateway）所需的本机开发与 E2E / 压测脚本。所有脚本默认相对仓库根 `enterprise/` 工作；推荐在 `enterprise/` 目录下执行，例如：

```bash
cd enterprise
bash scripts/start-dev.sh
```

> 一句话索引：
> - 第一次进项目：`bootstrap.sh`
> - 日常起服务：`start-dev.sh`（已有中间件）/ `start-dev-with-infra.sh`（连同 docker compose 一起拉）
> - 想从零跑一遍：`reset-dev-data.sh`（清痕迹） + `start-dev-with-infra.sh`（重启）
> - 验收 / 视觉巡检：`pnpm e2e:iam`、`pnpm e2e:sso`、`pnpm visual-tour`
> - 容量压测：`k6 run perf/sso-200-concurrent.js`

---

## bootstrap.sh — 一键环境初始化

适用首次进项目或换机，会生成 `.env.local`、`./.local-secrets/*.pem`，必要时通过 docker compose 拉起本地 Postgres/Redis 并完成 `db:migrate` + `db:seed`。

```bash
bash scripts/bootstrap.sh                  # 默认 local 模式（推荐）
bash scripts/bootstrap.sh --mode=server    # 服务器模式（要求外部提供 DATABASE_URL/密钥/密码）
bash scripts/bootstrap.sh --reset-db       # 销毁 postgres 数据卷后重建（仅限 local）
bash scripts/bootstrap.sh --skip-docker    # 即便 local 模式也不起 docker（本机已有 PG）
```

注意事项：

- 仅 local 模式会自动生成 RSA 密钥对并写 `.env.local`；server 模式必须自己提供 `AUTH_JWT_PRIVATE_KEY` / `AUTH_JWT_PUBLIC_KEY`、`SSO_*_SECRET` 等敏感项。
- 首次执行会交互式询问 `ADMIN_CONSOLE_LOGIN_PASSWORD`、`AUTH_DEV_OWNER_PASSWORD`（≥14 位且四类字符），勿在 `--reset-db` 后忘记。
- 完成后请走 `start-dev.sh` 启动应用；本脚本本身不启动 web-portal / admin-console / gateway。

---

## start-dev.sh — 本机一条命令起 enterprise

前置：已经跑过一次 `bootstrap.sh`，并且本机已有 Postgres/Redis（或前置使用 `start-dev-with-infra.sh`）。

```bash
bash scripts/start-dev.sh                  # 仅 enterprise（web-portal :3000 + admin-console :3001 + gateway :8088）
bash scripts/start-dev.sh --all            # 加上 customers/* 客户应用（如 hechuang :3100/:3101）
bash scripts/start-dev.sh --ui=stream      # 关闭 Turbo TUI，纯日志滚动
bash scripts/start-dev.sh -h
```

注意事项：

- 加载 `.env.local`，自动把 `AUTH_JWT_*_KEY_FILE` 指向的 PEM 读成环境变量再启进程。
- 默认 `AGX_AUTO_DB_MIGRATE=1`：仅当 `DATABASE_URL` 指向 `127.0.0.1` / `localhost` 才会自动 `db:migrate`，远程库自动跳过。需要手动跳过可 `AGX_AUTO_DB_MIGRATE=0`。
- 端口冲突时（3000/3001/8088 被占）请先 `lsof -i :8088` 杀进程。
- Ctrl+C 会触发 `cleanup` 一并 kill 所有子进程，无需逐个收尾。

---

## start-dev-with-infra.sh — 起中间件 + 应用

`start-dev.sh` 的超集，先用 `deploy/docker-compose/dev.yml` 拉起本地 Postgres/Redis，等健康检查通过再调用 `start-dev.sh`。

```bash
bash scripts/start-dev-with-infra.sh                # infra + enterprise 全栈
bash scripts/start-dev-with-infra.sh --all          # 加 customers/*
bash scripts/start-dev-with-infra.sh --ui=stream    # 透传给 start-dev.sh
bash scripts/start-dev-with-infra.sh --infra-only   # 只拉中间件，不起应用
bash scripts/start-dev-with-infra.sh --skip-infra   # 跳过中间件直接进应用栈
bash scripts/start-dev-with-infra.sh --down         # 仅关闭中间件容器
```

注意事项：

- 容器名固定为 `agenticx-postgres-dev` / `agenticx-redis-dev`；脚本会等 docker health 状态变 `healthy` 再继续。
- `--down` 会执行 `docker compose down`，**不会删数据卷**；需要清空 PG 数据请用 `bootstrap.sh --reset-db` 或在 `--down` 后手动 `docker volume rm`。
- 调试"前台报 chat history operation failed"等连库错时，多半是没起中间件直接跑了 `start-dev.sh`，建议改用本脚本。

---

## reset-dev-data.sh — 清空开发痕迹

清空本地"用户运行痕迹"（聊天 / 用量 / 网关计数 / 审计 / 策略命中），**不会**删策略规则定义、配额配置、provider 配置或 IAM 主数据。

```bash
bash scripts/reset-dev-data.sh                     # 默认：聊天 + 用量 + 网关本地 quota
bash scripts/reset-dev-data.sh --yes               # 跳过 YES 二次确认
bash scripts/reset-dev-data.sh --full              # 加清网关审计 / IAM 审计 / 策略命中 / 已发布快照
bash scripts/reset-dev-data.sh --full --yes
bash scripts/reset-dev-data.sh --with-seed         # 清空后跑 db:seed 恢复默认 owner
bash scripts/reset-dev-data.sh --with-seed --with-iam-seed --yes   # 顺带恢复多级部门/4 角色/10 演示用户
```

清单（实现细节请见脚本本身）：

| 维度 | 默认 | `--full` |
|---|---|---|
| PG | `chat_messages` / `chat_sessions` / `usage_records` | + `gateway_audit_events` / `audit_events` / `policy_publish_events` |
| 网关运行态 | `.runtime/gateway/quota-usage.json` (+ `.lock`)、`apps/gateway/.runtime/usage.jsonl` | + `apps/gateway/.runtime/audit/audit-*.jsonl`、`audit/seals/*`、`audit/.pg-pending` |
| 策略 | — | + `.runtime/admin/policy-snapshot.json` / `policy-overrides.json` |

注意事项：

- 默认有 `YES` 二次确认；脚本会回显当前 `DATABASE_URL`，**请务必确认连的是本地库**（`127.0.0.1` / `localhost`），脚本不会拒绝远程连接。
- `--full` 之后：策略已发布快照消失，需到 admin-console 重新点"发布"；网关进程如仍在跑请重启 `apps/gateway` 释放内存中的旧快照与配额计数。
- `--with-iam-seed` 必须配合 `--with-seed`（先恢复基础租户与 owner 才能注入 demo 数据）。

---

## e2e-iam.ts — IAM 端到端冒烟（Playwright）

入口：`pnpm -C enterprise e2e:iam`

走完 admin-console 上 IAM（部门 / 角色 / 用户）的关键交互。前置：

- web-portal :3000 + admin-console :3001 已启动（一般是 `start-dev.sh`）。
- `ADMIN_CONSOLE_LOGIN_PASSWORD` 或 `AUTH_DEV_OWNER_PASSWORD` 与 `db:seed` 一致；可通过 `ADMIN_BASE_URL` 改基址。

首次跑前需安装 Chromium：`pnpm -C enterprise visual-tour:install`（共用同一个 Playwright 浏览器）。

---

## e2e-sso.ts — SSO 入口可达性 smoke

入口：`pnpm -C enterprise e2e:sso`

最轻量的 portal `/auth` 与 admin `/login` 可达性校验，常用于 PR / CI 早期确认服务起来了。环境变量：

- `PORTAL_BASE`（默认 `http://localhost:3000`）
- `ADMIN_BASE`（默认 `http://localhost:3001`）

---

## e2e-visual-tour.ts — 双主题视觉巡检

入口：`pnpm -C enterprise visual-tour`

为 13 个关键页（portal / admin）× dark + light 共 26 张全页长截图落到 `enterprise/docs/visuals/v2/{page}-{theme}.png`，常用于 v2 视觉重塑后的 PR 描述与回归对比。

```bash
pnpm -C enterprise visual-tour:install   # 首次：安装 Chromium 二进制（~150MB）
pnpm -C enterprise visual-tour
```

注意事项：

- 脚本不会帮你拉 server，**必须先** `start-dev.sh` 起前台。
- 登录阶段会读 `ADMIN_CONSOLE_LOGIN_PASSWORD` / `AUTH_DEV_OWNER_PASSWORD`，未导出时会卡在 `page.waitForURL` 超时。
- 可用 `PORTAL_BASE_URL` / `ADMIN_BASE_URL` 替换默认基址。

---

## perf/sso-200-concurrent.js — OIDC SSO 并发压测（k6）

入口：`k6 run enterprise/scripts/perf/sso-200-concurrent.js`

对 web-portal `/api/auth/sso/oidc/start`（302 跳转到 IdP）做 ramping-vus 压测：30s 爬到 50 → 30s 爬到 200 → 维持 60s。本压测覆盖应用侧路由 + discovery 准备阶段；完整"回调换票"链路需另行接 mock IdP。

```bash
# 默认基址 http://127.0.0.1:3000
k6 run enterprise/scripts/perf/sso-200-concurrent.js

# 自定义基址
SSO_K6_BASE=http://stage.internal/portal k6 run enterprise/scripts/perf/sso-200-concurrent.js
```

注意事项：

- 需要本机已安装 [`k6`](https://k6.io/docs/get-started/installation/)（macOS：`brew install k6`）。
- 压测对象必须可达；本地建议先 `start-dev-with-infra.sh` 把 portal 拉起来再开测。
- 仓库目前**没有**长期维护的官方压测基线，此脚本属于"按需现场跑"的容量演示，不要把单次结果当硬指标向客户承诺。

---

## 排障速查

| 现象 | 大概率原因 | 处置 |
|---|---|---|
| `start-dev.sh` 报缺 `AUTH_JWT_*` | 没跑 `bootstrap.sh` 或 `.local-secrets/*.pem` 被删 | 重跑 `bootstrap.sh` |
| 前台 `chat history operation failed` | PG / Redis 没起 | 改用 `start-dev-with-infra.sh` |
| admin 登录"密码错误" | `db:seed` 后修改了 `ADMIN_CONSOLE_LOGIN_PASSWORD` | 重跑 `bootstrap.sh` 或 `reset-dev-data.sh --with-seed` |
| `reset-dev-data.sh` 后 admin 看不到策略命中 | 已发布快照被 `--full` 清掉 | 在 admin-console "策略规则中心" 重新点"发布"，并重启 gateway |
| `visual-tour` / `e2e:iam` 报 `chromium not found` | 没装 Playwright 浏览器 | `pnpm -C enterprise visual-tour:install` |
