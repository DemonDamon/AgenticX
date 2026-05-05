# Enterprise Deploy Notes (Hechuang)

## Production Template

- `docker-compose/dev.yml`：开发期基础依赖（Postgres + Redis）。
- `docker-compose/prod.yml`：生产模板（Nginx 入口 + 双网关 + 前后台 + PostgreSQL 主从 + Redis）。
- `nginx/gateway.conf`：公网入口反向代理与基础限流模板。
- `config/policies.yaml`：网关策略包装载清单（生产可按客户策略扩展）。

## Usage

启动前在 shell 中设置强口令的 `ADMIN_CONSOLE_LOGIN_PASSWORD`（勿写入仓库），再执行：

```bash
cd enterprise/deploy/docker-compose
POSTGRES_PASSWORD=replace-me \
JWT_PUBLIC_KEY="$(cat /path/to/jwt.pub)" \
JWT_PRIVATE_KEY="$(cat /path/to/jwt.key)" \
docker compose -f prod.yml up -d
```

（`prod.yml` 会通过 `${ADMIN_CONSOLE_LOGIN_PASSWORD?...}` 强制要求该变量已导出。）

## Local Development Startup Order

推荐顺序（本地开发）：

1. 先起中间件：Postgres + Redis（Docker）
2. 再起应用：gateway + web-portal + admin-console（脚本）

一条命令（推荐）：

```bash
cd enterprise
bash scripts/start-dev-with-infra.sh
```

常用变体：

```bash
# 仅起中间件
bash scripts/start-dev-with-infra.sh --infra-only

# 中间件已起，仅起应用
bash scripts/start-dev-with-infra.sh --skip-infra --ui=stream

# 同时拉起 customers/*
bash scripts/start-dev-with-infra.sh --all

# 关闭中间件
bash scripts/start-dev-with-infra.sh --down
```

## Reset Local Dev Data

当前后台 metering 与前台聊天历史对不上时，可用一键重置脚本回到干净基线。

```bash
cd enterprise

# 交互确认后清空（聊天历史 + 用量记录）
bash scripts/reset-dev-data.sh

# 无确认直接清空
bash scripts/reset-dev-data.sh --yes

# 清空后回填默认租户/用户种子
bash scripts/reset-dev-data.sh --with-seed --yes
```

会清空的数据：

- PostgreSQL：`chat_messages`、`chat_sessions`、`usage_records`
- 本地文件：`apps/gateway/.runtime/usage.jsonl`、`apps/gateway/.runtime/gateway/quota-usage.json`

## Important

- `prod.yml` 为模板，不直接承诺客户侧最终网络拓扑；上云前按客户 VPC、WAF、证书体系做二次适配。
- `config/policies.yaml` 是 Gateway 配置片段，默认挂载 `/app/plugins/moderation-*/manifest.yaml`；Admin 策略启停与额度配置写入共享 `/runtime/admin`。
- Gateway 新增 `GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`：
  - 优先加载 PG 发布生成的快照文件；
  - 若快照不存在，则回退到 `config/policies.yaml + GATEWAY_POLICY_OVERRIDE_FILE`；
  - `GATEWAY_POLICY_OVERRIDE_FILE` 仅保留兼容路径，后续版本会逐步弃用。
- PostgreSQL 主从复制参数（`wal_level`、`primary_conninfo` 等）由客户环境初始化脚本补齐。
