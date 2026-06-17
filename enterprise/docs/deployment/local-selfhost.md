# 本地化 / 私有化部署（Docker 自托管）

> **适用场景**：在自有服务器或本机以 Docker 起 Postgres/Redis，运行 web-portal + admin-console + Gateway 三端，不依赖 Vercel / Supabase 等托管平台。
> **目标读者**：私有化交付、内网部署、离线评估。
> **最后更新**：2026-06-01

Vercel 托管部署见 [README.md](./README.md) 与 [vercel-env-checklist.md](./vercel-env-checklist.md)；本文是**完全本地化**路径。

---

## 一、前置依赖

| 工具 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 运行 web-portal / admin-console（Next.js） |
| pnpm | 最新稳定版 | monorepo 包管理 |
| Go | ≥ 1.22 | 编译运行 AI 网关 |
| Docker + Compose v2 | 任意近版 | 起本地 Postgres / Redis |
| openssl | 系统自带 | 生成 RSA JWT 密钥对 |

需要空闲端口：**3000**（前台）、**3001**（后台）、**8088**（Gateway）、**5432**（Postgres）、**6379**（Redis）。

---

## 二、从零启动（推荐路径）

先判断你是哪一种场景：

| 场景 | 推荐命令 | 说明 |
|---|---|---|
| 第一次在这台机器上部署 | `bash scripts/bootstrap.sh` | 初始化 `.env.local`、密钥、Postgres/Redis、迁移和种子数据 |
| 测试环境想清空重来 | `bash scripts/bootstrap.sh --reset-db` | 会删除本地 Postgres 数据卷后重建，仅限开发 / POC |
| 已有外部 Postgres | `bash scripts/bootstrap.sh --mode=server` | 不起 Docker 中间件，要求外部注入 `DATABASE_URL` 和密钥 |

> 注意：删除 Docker 镜像不等于清空数据库。Postgres 数据通常保存在 Docker volume 里；如果旧库里残留半成品迁移、旧表或异常连接，单纯删镜像再重跑仍可能失败。测试环境要重建，请用 `--reset-db`。

### 1. 首次初始化

```bash
cd enterprise

# 交互式设置两个登录密码，各 ≥14 位，含大小写 / 数字 / 符号
bash scripts/bootstrap.sh
```

如果是测试环境重装，明确允许清库时用：

```bash
cd enterprise
bash scripts/bootstrap.sh --reset-db
```

### 2. 启动三端服务

`bootstrap.sh` 成功后，再启动应用：

```bash
bash scripts/start-dev-with-infra.sh --ui=stream
```

`--ui=stream` 会直接输出三端日志，现场排障比 Turbo TUI 更清晰。

### 3. 成功标准

启动后访问：

| 服务 | URL |
|---|---|
| 员工前台 | <http://localhost:3000> |
| 管理后台 | <http://localhost:3001> |
| 网关健康检查 | <http://localhost:8088/healthz> |

默认登录账号 `admin@agenticx.local`，密码即第 2 步设置的值（落在 `enterprise/.env.local`）：

```bash
grep -E 'ADMIN_CONSOLE_LOGIN_PASSWORD|AUTH_DEV_OWNER_PASSWORD' .env.local
```

> `staff@agenticx.local` **不在**默认种子里，需登录后台手动创建。

### 4. 如果 `bootstrap.sh` 中途失败

先不要反复重跑。按下面顺序采集信息：

```bash
cd enterprise
ls -lt .runtime/logs/
tail -n 120 .runtime/logs/bootstrap-*.log
tail -n 120 .runtime/logs/db-migrate-*.log 2>/dev/null || true
docker ps
docker logs --tail=120 agenticx-postgres-dev
```

如果终端只看到类似：

```text
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @agenticx/db-schema@0.1.0 db:migrate: `drizzle-kit migrate`
Exit status 1
```

这只是 pnpm/drizzle 的摘要，不是真正原因。真正的 PostgreSQL 错误通常在 `.runtime/logs/bootstrap-*.log` 或 Postgres 容器日志里。

---

## 三、`bootstrap.sh` 做了什么

1. 预检 node / pnpm / go / docker / openssl
2. 生成 `enterprise/.env.local`（chmod 600，已 gitignore）
3. 生成 RSA-2048 JWT 密钥对至 `enterprise/.local-secrets/*.pem`
4. `pnpm install`
5. Docker 起 Postgres + Redis（`deploy/docker-compose/dev.yml`）
6. `db:migrate` + `db:seed`（建表 + 默认租户 / owner）
7. `migrate:legacy-runtime`（旧 JSON 配置幂等导入 PG）

常用选项：

```bash
bash scripts/bootstrap.sh --reset-db      # 销毁 PG 数据卷后重建（仅开发）
bash scripts/bootstrap.sh --skip-docker   # 本机已有独立 Postgres，不经 compose
bash scripts/bootstrap.sh --mode=server   # 非交互；所有密钥/密码须从外部环境变量注入
```

`bootstrap.sh` 是初始化脚本，不是长期服务启动命令。生产 / 客户测试环境应把数据库迁移作为单独发布步骤执行一次，不要让多个应用副本启动时同时跑迁移。

---

## 四、日常与维护命令

```bash
# 中间件已在跑，只起应用
bash scripts/start-dev.sh --ui=stream

# 只关闭中间件容器（不删数据卷）
bash scripts/start-dev-with-infra.sh --down

# 旧 JSON 运行时配置 → PG（换机恢复 / 前台无模型时）
pnpm migrate:legacy-runtime

# 清空开发痕迹（聊天 / 用量 / 网关计数），不删主数据
bash scripts/reset-dev-data.sh
```

中间件容器名固定为 `agenticx-postgres-dev` / `agenticx-redis-dev`；`--down` 不会删数据卷，需清空 PG 用 `bootstrap.sh --reset-db`。

---

## 五、接通真实模型（可选）

**推荐（后台 GUI）**：管理后台 → 平台配置 → 模型服务 → 添加厂商 → 填 API Key → 检测 → 保存 → 身份与权限 → 用户 → 勾选「可见模型分配」。

**备选（环境变量）**：在 `enterprise/.env.local` 追加，例如：

```bash
DEEPSEEK_API_KEY=sk-...
LLM_API_KEY=sk-...   # 通用兜底
```

> 运行时配置（模型服务 / 用户可见模型 / Token 配额）以 Postgres 为单一数据源（`enterprise_runtime_*` 表）。Gateway 每 ~5 秒重读一次 provider 配置，admin 改完几秒内生效，无需重启。Key 解析规则详见 [../gateway/runtime-config.md](../gateway/runtime-config.md)。

---

## 六、企业服务器（非交互 / 外部 Postgres）

服务器上不交互、密钥全部由外部注入：

```bash
export DATABASE_URL='postgresql://user:pass@db-host:5432/agenticx'
export AUTH_JWT_PRIVATE_KEY="$(cat /secure/path/auth_private.pem)"
export AUTH_JWT_PUBLIC_KEY="$(cat /secure/path/auth_public.pem)"
export ADMIN_CONSOLE_LOGIN_PASSWORD='...'
export ADMIN_CONSOLE_SESSION_SECRET='...'
bash scripts/bootstrap.sh --mode=server
```

- `--mode=server` 不起 docker，要求外部已有可达 Postgres（`DATABASE_URL`）。
- 生产构建用 `pnpm build` + 各 app 自带 `start`；Gateway 用 `go build ./apps/gateway/cmd/gateway` 产出单二进制独立进程托管。
- 全量环境变量分组见 [../configuration/env-vars.md](../configuration/env-vars.md)。

---

## 七、常见问题速查

| 现象 | 处置 |
|---|---|
| `start-dev.sh` 报缺 `AUTH_JWT_*` | 未 bootstrap 或 PEM 被删 → 重跑 `bootstrap.sh` |
| 前台 `chat history operation failed` | PG/Redis 没起 → 用 `start-dev-with-infra.sh` |
| admin 登录密码错误 | seed 后改过 env → 重跑 bootstrap 或 `reset-dev-data.sh --with-seed` |
| 前台无模型可选 | admin 未配模型 / 未分配可见模型 → 配置后或 `pnpm migrate:legacy-runtime` |
| `db:migrate` 只有 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` | 先看 `.runtime/logs/bootstrap-*.log` / `db-migrate-*.log`，不要只看终端摘要 |
| 清镜像后仍迁移失败 | 镜像不是数据；测试环境可用 `bash scripts/bootstrap.sh --reset-db` 清 PG 数据卷 |
| 端口被占（3000/3001/8088） | `lsof -i :8088` 后 kill 旧进程 |
| Docker CLI 卡住无响应 | 见 [../development/troubleshooting.md](../development/troubleshooting.md#docker-cli-卡住--daemon-无响应) |
| 拉镜像超时 `registry-1.docker.io`（国内服务器） | 脚本只用标准镜像名，须在本机 daemon 配国内加速并重启；见 [../development/troubleshooting.md](../development/troubleshooting.md#拉镜像超时--registry-1dockerio-clienttimeout国内服务器无法访问-docker-hub) |

更完整排障见 [../development/troubleshooting.md](../development/troubleshooting.md) 与 [../../scripts/README.md](../../scripts/README.md)。
