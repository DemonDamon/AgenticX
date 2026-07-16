# 排障指南

常见问题与处置。更完整脚本说明见 [../scripts/README.md](../scripts/README.md)。

---

## 启动与环境

| 现象 | 原因 | 处置 |
|---|---|---|
| `start-dev.sh` 报缺 `AUTH_JWT_*` | 未 bootstrap 或 PEM 被删 | `bash scripts/bootstrap.sh` |
| 前台 `chat history operation failed` | PG/Redis 未起 | `bash scripts/start-dev-with-infra.sh` |
| 端口占用 3000/3001/8088 | 旧进程 | `lsof -i :8088` 后 kill |
| Turbo TUI Ctrl+C 无反应 | TUI 捕获信号 | 先 Esc 再 q，或 `--ui=stream` |
| 手动 pnpm 前台登录缺 JWT key | 未展开 `*_FILE` | 见 [local-dev.md](./local-dev.md) 手动 export |

### Docker CLI 卡住 / daemon 无响应

现象：`start-dev-with-infra.sh` 停在 `booting middleware...`，或 `docker info` / `docker version` **长时间无输出**；Docker Desktop 托盘图标仍在，但 CLI 不返回。

常见原因（本机曾复现）：

| 原因 | 信号 | 处置 |
|---|---|---|
| **Docker 引擎卡死** | 多个 `docker info` 进程堆积 | `pkill -f 'docker info'`；**Quit** Docker Desktop 后重开 |
| **系统盘几乎满** | `df -h` 使用率 >90% | 腾出 ≥20GB；Docker Desktop → Settings → 清理镜像/Build cache |
| **Docker.raw 过大** | `~/Library/Containers/com.docker.docker/.../Docker.raw` 占满数据盘 | 同上；必要时 Settings → Resources 缩小 disk image 后 Reset |
| **Shell 代理** | `http_proxy`/`all_proxy` 指向本机 Clash 等 | Docker API 走 unix socket，建议：`env -u http_proxy -u https_proxy -u all_proxy docker version` |

**中间件已在跑、仅 CLI 挂掉时**：若 `5432`/`6379` 能连通，可直接跳过 Docker 起应用：

```bash
bash scripts/start-dev-with-infra.sh --skip-infra --ui=stream
```

相关：`AGENTS.md`（Docker MCP 与代理）、`runbooks/cloudflare-quick-tunnel-setup.md`（`env -u ...` 绕过代理模式）、`examples/browser-use-mcp.md`（子进程代理隔离）。

验证 Docker 恢复：

```bash
env -u http_proxy -u https_proxy -u all_proxy docker version
curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000
```

### 拉镜像超时 / `registry-1.docker.io ... Client.Timeout`（国内服务器无法访问 Docker Hub）

现象：`start-dev-with-infra.sh` 在 `booting middleware...` 阶段卡住并报
`Get "https://registry-1.docker.io/v2/": net/http: request canceled ... (Client.Timeout exceeded while awaiting headers)`。

**先厘清一个误解**：Enterprise 安装脚本**不内置任何国内镜像地址**。`deploy/docker-compose/dev.yml`
只声明标准镜像名 `postgres:16-alpine` 与 `redis:7-alpine`，**从哪个 registry 拉取完全由这台机器的 Docker
守护进程决定**。看到 `registry-1.docker.io` 超时，说明**当前主机的镜像加速没生效**（常见：只在别的机器配过、
改了 `daemon.json` 没重启 docker、配置路径不对），并非产品"没有国内镜像源"。

处置（在目标服务器上按序执行）：

1. **确认 daemon 真的有镜像加速并已重启**

   ```bash
   docker info 2>/dev/null | grep -A5 -i 'Registry Mirrors'   # 应列出国内镜像站
   cat /etc/docker/daemon.json                                # 核对 registry-mirrors
   sudo systemctl restart docker                              # 改完必须重启才生效
   ```

2. **单独验证能拉到这两个镜像**

   ```bash
   docker pull postgres:16-alpine
   docker pull redis:7-alpine
   ```

   两条都成功后再重新执行 `bash scripts/start-dev-with-infra.sh --ui=stream`。

3. **daemon 加速仍超时 → 用镜像站全路径预拉 + 打回标准 tag**（compose 命中本地标签后不再访问 Hub；
   下例为阿里云 `library`，替换成客户实际镜像前缀）：

   ```bash
   docker pull registry.cn-hangzhou.aliyuncs.com/library/postgres:16-alpine
   docker pull registry.cn-hangzhou.aliyuncs.com/library/redis:7-alpine
   docker tag  registry.cn-hangzhou.aliyuncs.com/library/postgres:16-alpine postgres:16-alpine
   docker tag  registry.cn-hangzhou.aliyuncs.com/library/redis:7-alpine     redis:7-alpine
   ```

4. **已有可用 Postgres/Redis → 干脆跳过 Docker 中间件**

   ```bash
   # 5432/6379 已在监听时
   bash scripts/start-dev-with-infra.sh --skip-infra --ui=stream
   # 或初始化用外部库
   bash scripts/bootstrap.sh --skip-docker   # 需配置 DATABASE_URL
   ```

> 说明：`docker compose pull` 在镜像加速正确生效时一般**不会**卡在 Hub 超时；因此"超时"基本等价于
> "这台机器的加速未真正生效"，按上述第 1 步排查即可。

### `db:migrate` 失败但终端几乎无报错

现象：`pnpm --filter @agenticx/db-schema db:migrate` 或 `start-dev-with-infra.sh` 在迁移阶段以
`Exit status 1` / `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` 退出，终端只有一行失败摘要，看不到具体 SQL 错误。

原因：`drizzle-kit` 个别版本（如 `0.31.10`）在 migrate 失败时会**吞掉底层 Postgres 错误**；并非日志没采集。

先判断这次失败发生在哪一步：

```text
postgres is ready
running db:migrate
...
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... drizzle-kit migrate
```

如果日志停在这里，说明 Docker 和 Postgres 已经起来了，失败点是数据库迁移。不要继续反复执行 `bootstrap.sh`，先拿到底层错误。

**第一步：看脚本落盘日志**（`bootstrap.sh` / `start-dev.sh` 已自动写入 `.runtime/logs/`）：

```bash
cd enterprise
ls -lt .runtime/logs/
tail -n 80 .runtime/logs/db-migrate-*.log
# bootstrap 全流程：.runtime/logs/bootstrap-*.log
```

失败时终端也会打印 `[log] db:migrate failed — full output: ...`，把该文件发给运维即可。

如果当前目录已经是 `enterprise/`，用：

```bash
ls -lt .runtime/logs/
tail -n 120 .runtime/logs/bootstrap-*.log
tail -n 120 .runtime/logs/db-migrate-*.log 2>/dev/null || true
docker logs --tail=120 agenticx-postgres-dev
```

**第二步：确认是不是“只清镜像，没有清数据库”**

Docker 镜像和 Postgres 数据卷是两回事。执行过 `docker rmi` 或“清镜像”后，旧数据库数据通常仍在 Docker volume 里。旧表、半成品迁移或旧迁移记录仍可能导致 `db:migrate` 失败。

开发 / POC 环境如果可以清库，直接走重建路径：

```bash
cd enterprise
bash scripts/bootstrap.sh --reset-db
bash scripts/start-dev-with-infra.sh --ui=stream
```

`--reset-db` 会执行 docker compose `down -v`，删除本地 Postgres 数据卷后重新建库。不要在需要保留数据的环境使用。

**第三步：不能清库时，保留现场继续查**

确认容器和连接状态：

```bash
cd enterprise
docker ps
docker exec -it agenticx-postgres-dev psql -U postgres -d agenticx -c '\dt'
docker exec -it agenticx-postgres-dev psql -U postgres -d agenticx -c 'select * from drizzle.__drizzle_migrations order by created_at desc limit 5;'
```

如果 `drizzle.__drizzle_migrations` 不存在或表结构与预期不一致，把输出和日志一起回传。

在日志仍不够时，临时降级 `drizzle-kit` 以暴露真实 PG 错误：

```bash
cd enterprise
pnpm --filter @agenticx/db-schema add -D drizzle-kit@0.31.9
set -a && source .env.local && set +a
pnpm --filter @agenticx/db-schema db:migrate
```

**第四步：排查是否有并发迁移**

如果同时出现大量 `CREATE TABLE waiting` 或 `too many clients already`，参考 [PostgreSQL DDL 锁等待 Runbook](../runbooks/postgres-ddl-lock-waiting.md)。这通常是多个进程 / 多个副本同时执行迁移，不是正常应用访问。

---

## 登录与 IAM

> 机制说明（env 何时生效、seed 写 hash）：[local-dev.md#密码与登录env-vs-postgres](./local-dev.md#密码与登录env-vs-postgres)

| 现象 | 原因 | 处置 |
|---|---|---|
| admin / 前台「密码错误」但 `.env.local` 密码「明明对」 | 有 `DATABASE_URL` 时验 **库内 hash**，不是 env；或改 env 后未重跑 seed | `set -a && source .env.local && set +a` 后 `pnpm --filter @agenticx/db-schema db:seed` |
| 重启后密码「变了」 | 重启 **不会**改库；常见是 env 与库不一致或账号被锁 | PostgreSQL：`docker exec agenticx-postgres-dev psql -U postgres -d agenticx -c "SELECT email, status, failed_login_count, locked_until FROM users WHERE email='admin@agenticx.local';"`；MySQL：`docker exec agenticx-mysql-dev mysql -uagenticx -pagenticx agenticx -e "SELECT email, status, failed_login_count, locked_until FROM users WHERE email='admin@agenticx.local';"` |
| 密码正确仍 `invalid credentials` | 连续 5 次失败锁定（portal / admin 共用 `users` 表）；UI 不区分锁定与密码错 | 解锁：`UPDATE users SET status='active', failed_login_count=0, locked_until=NULL WHERE email='admin@agenticx.local';` 或等锁定窗口过后再试 |
| `DATABASE_DIALECT` / URL 冲突启动失败 | 方言与 scheme 不一致（故意 fail-fast） | 对齐 `DATABASE_DIALECT` 与 `DATABASE_URL`；本地用 `bash scripts/start-dev-with-infra.sh --db=postgresql\|mysql` |
| MySQL 下 migrate 找不到表 / charset 异常 | 未用 profile `mysql` 或未跑 `drizzle-mysql` 链 | 确认 compose profile 与 `db:migrate` 日志中的 `dialect=mysql` |
| admin 密码错误（确认真输错） | seed 后改了 `AUTH_DEV_OWNER_PASSWORD` 未同步 PG | 重跑 `db:seed` 或 `reset-dev-data.sh --with-seed` |
| 用了 `ADMIN_CONSOLE_LOGIN_PASSWORD` 登不上 | 有 PG 时 admin **不读**该变量验密（仅无库兜底） | 以 `AUTH_DEV_OWNER_PASSWORD` 为准，或重跑 seed 同步 hash |
| `staff@...` Invalid credentials | 无此种子用户 | 用 `admin@agenticx.local` 或后台创建 |
| 前台无模型可选 | 未分配可见模型 / PG 空 | admin 模型服务 + 用户可见模型；或 `migrate:legacy-runtime` |
| IAM 403 | scope 不足 | 查 [rbac/scopes.md](../rbac/scopes.md) |

---

## Gateway 与模型

| 现象 | 原因 | 处置 |
|---|---|---|
| 只有 mock 回复 | 无 Key | admin 配 Provider 或 env `*_API_KEY` |
| 策略不拦截 | 快照路径错 / 未发布 | 确认 `policy-snapshot` 路径；admin 点发布；重启 gateway |
| 规则已保存仍不生效 | userIds 占位不匹配 | applies_to 留空或填真实 id |
| blocked=false 但选了拦截 | 测试接口用库内旧 action | 用 `/api/policy/test` 合并表单预览 |
| Channel 不健康 | `GATEWAY_INTERNAL_BASE_URL` 端口错 | 对齐 8088 与 internal token |
| `proxyconnect … 127.0.0.1:7890: connection refused` | Go 读大写 `HTTP_PROXY`/`HTTPS_PROXY` 指向旧端口 7890，与小写 `http_proxy`（7897）不一致 | 重启 dev 栈（`start-dev.sh` 已对 gateway 去掉大写代理）；或 `unset HTTP_PROXY HTTPS_PROXY ALL_PROXY` 后重启；确认 `lsof -i :7897` 有 Clash |

---

## 策略与审计

| 现象 | 原因 | 处置 |
|---|---|---|
| reset `--full` 后无策略命中 | 快照被清 | admin 重新发布 + 重启 gateway |
| 后台有审计、PG  pending 涨 | PG 短暂不可用 | [runbooks/audit-pg-backfill.md](../runbooks/audit-pg-backfill.md) |
| 部门审计 403 | 缺 `audit:read:dept` | 升级角色 scopes |

---

## SSO

| 现象 | 原因 | 处置 |
|---|---|---|
| SSO 按钮不显示 | 未配 `NEXT_PUBLIC_SSO_PROVIDERS` | 配 env 并**完整重启** Next 进程 |
| `oidc.discovery_failed` | issuer 不可达或占位 | `pnpm sso:oidc-smoke` 自检 |
| 改 SSO env 不生效 | Next 热更新不读 env | 完整重启 admin + portal |

Runbooks：[sso-oidc-setup.md](../runbooks/sso-oidc-setup.md) · [sso-saml-setup.md](../runbooks/sso-saml-setup.md)

---

## Vercel 分体部署

| 现象 | 原因 | 处置 |
|---|---|---|
| Gateway 空 providers | `GATEWAY_REMOTE_*` URL 错 / token 不一致 | [internal-api.md](../api/internal-api.md) |
| 前台 0 条历史、后台有数据 | 不同 DATABASE_URL | 核对 Vercel env |
| Token 永远 0 | usage 未回写 | 确认 gateway DATABASE_URL 与 portal 同库 |

清单：[deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md)

---

## E2E / 视觉

| 现象 | 原因 | 处置 |
|---|---|---|
| chromium not found | 未装 Playwright | `pnpm visual-tour:install` |
| visual-tour 超时 | 未起 dev server / 未 export 密码 | 先 `start-dev.sh`，export 登录密码 |

---

## 日志位置

| 组件 | 日志 |
|---|---|
| **DB 迁移 / bootstrap** | `enterprise/.runtime/logs/db-migrate-*.log`、`bootstrap-*.log`（`start-dev.sh` / `bootstrap.sh` 自动写入） |
| Gateway 审计 JSONL | `apps/gateway/.runtime/audit/` |
| Gateway 计量 JSONL | `GATEWAY_USAGE_LOG` 或 `apps/gateway/.runtime/usage.jsonl` |
| PG pending 审计 | `apps/gateway/.runtime/audit/.pg-pending` |
| Quota 本地 | `.runtime/gateway/quota-usage.json` |

> 说明：`enterprise/.runtime/logs/` 为本地排障目录（已在 `.gitignore`），不接入 ELK/OTel；运行时服务日志标准化见后续 observability roadmap。

---

## 获取帮助

1. 确认 `DATABASE_URL` 指向预期库（尤其 reset 脚本会 echo URL）
2. `curl --noproxy '*' http://127.0.0.1:8088/healthz`
3. Admin `GET /api/gateway/health`
4. Gateway 进程日志（`--ui=stream` 模式）
