# Enterprise Deploy Notes (Hechuang)

## Production Template

- `docker-compose/dev.yml`：开发期基础依赖（Postgres + Redis）。
- `docker-compose/prod.yml`：生产模板（Nginx 入口 + 双网关 + 前后台 + PostgreSQL 主从 + Redis）。
- `docker-compose/prod.aliyun.yml`：国内/阿里云镜像覆盖层（只改 `image`，与 `prod.yml` 叠加使用）。
- `nginx/gateway.conf`：公网入口反向代理与基础限流模板。
- `config/policies.yaml`：网关策略包装载清单（生产可按客户策略扩展）。
- `gateway/`：K8s Deployment / Service / HPA、混合部署样例与 compose 冒烟（见 `gateway/README.md`）。

## Usage

启动前在 shell 中设置强口令的 `ADMIN_CONSOLE_LOGIN_PASSWORD`（勿写入仓库），再执行：

```bash
cd enterprise/deploy/docker-compose
POSTGRES_PASSWORD=replace-me \
JWT_PUBLIC_KEY="$(cat /path/to/jwt.pub)" \
JWT_PRIVATE_KEY="$(cat /path/to/jwt.key)" \
DATABASE_URL="postgresql://agenticx:replace-me@postgres-primary:5432/agenticx?sslmode=disable" \
docker compose -f prod.yml --profile postgresql up -d
```

（`prod.yml` 会通过 `${ADMIN_CONSOLE_LOGIN_PASSWORD?...}` / `${DATABASE_URL?...}` 强制要求相关变量已导出；内置 Postgres 需加 `--profile postgresql`。）

## 国内 / 阿里云部署（镜像加速）

直连 Docker Hub（`docker.io`）在国内机房常出现 `i/o timeout`。**不要改 `prod.yml`**，叠加 `prod.aliyun.yml` 覆盖镜像源：

```bash
cd enterprise/deploy/docker-compose

# 1) 拉镜像（基础库走 DaoCloud；业务镜像默认仍 ghcr.io）
POSTGRES_PASSWORD=replace-me \
ADMIN_CONSOLE_LOGIN_PASSWORD=replace-me \
DATABASE_URL="postgresql://agenticx:replace-me@postgres-primary:5432/agenticx?sslmode=disable" \
JWT_PUBLIC_KEY="$(cat /path/to/jwt.pub)" \
JWT_PRIVATE_KEY="$(cat /path/to/jwt.key)" \
docker compose -f prod.yml -f prod.aliyun.yml --profile postgresql pull

# 2) 启动
docker compose -f prod.yml -f prod.aliyun.yml --profile postgresql up -d
```

### 覆盖了哪些镜像

| 服务 | `prod.yml` 原地址 | `prod.aliyun.yml` 默认 |
|---|---|---|
| nginx / redis / postgres-* | `docker.io/library/...` | `docker.m.daocloud.io/library/...` |
| gateway / web-portal / admin-console | `ghcr.io/agenticx/...` | 仍为 `ghcr.io/agenticx/...`（可用环境变量改到 ACR） |

### 业务镜像同步到阿里云 ACR（可选）

若 `ghcr.io` 同样拉不动，先把四个业务镜像推到你们 ACR，再设前缀：

```bash
export ENTERPRISE_IMAGE_REGISTRY=registry.cn-hangzhou.aliyuncs.com/<your-namespace>
export ENTERPRISE_IMAGE_TAG=latest   # 可选

docker compose -f prod.yml -f prod.aliyun.yml --profile postgresql pull
docker compose -f prod.yml -f prod.aliyun.yml --profile postgresql up -d
```

同步示例（在能访问 ghcr 的机器上执行）：

```bash
SRC=ghcr.io/agenticx
DST=registry.cn-hangzhou.aliyuncs.com/<your-namespace>
TAG=latest

for name in enterprise-gateway enterprise-web-portal enterprise-admin-console; do
  docker pull "$SRC/$name:$TAG"
  docker tag "$SRC/$name:$TAG" "$DST/$name:$TAG"
  docker push "$DST/$name:$TAG"
done
```

### 可调环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `DOCKER_HUB_MIRROR` | `docker.m.daocloud.io/library` | 官方 library 镜像前缀 |
| `ENTERPRISE_IMAGE_REGISTRY` | `ghcr.io/agenticx` | 业务镜像仓库前缀 |
| `ENTERPRISE_IMAGE_TAG` | `latest` | 业务镜像 tag |

也可改用其它加速前缀，例如：

```bash
export DOCKER_HUB_MIRROR=dockerproxy.net/library
```

### 排障

- `dial tcp ... registry-1.docker.io:443: i/o timeout`：确认已加 `-f prod.aliyun.yml`，且 `docker compose ... config` 里 nginx/redis 的 `image` 已不是 `docker.io`。
- `POSTGRES_PASSWORD variable is not set`：启动前必须 export，或放同目录 `.env`（勿提交仓库）。
- `--profile mysql`：当前 `prod.yml` 只有 `postgresql` profile；MySQL 生产 profile 尚未并入该模板。
- 仅加速 Docker Hub 不够时：配置宿主机 `/etc/docker/daemon.json` 的 `registry-mirrors` 是补充手段，**不能**替代 `ghcr.io` → ACR 同步。

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
- 国内机房拉 Docker Hub 超时：叠加 `prod.aliyun.yml`，不要改 `prod.yml` 本体（见上文「国内 / 阿里云部署」）。
- `config/policies.yaml` 是 Gateway 配置片段，默认挂载 `/app/plugins/moderation-*/manifest.yaml`；Admin 策略启停与额度配置写入共享 `/runtime/admin`。
- Gateway 新增 `GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`：
  - 优先加载 PG 发布生成的快照文件；
  - 若快照不存在，则回退到 `config/policies.yaml + GATEWAY_POLICY_OVERRIDE_FILE`；
  - `GATEWAY_POLICY_OVERRIDE_FILE` 仅保留兼容路径，后续版本会逐步弃用。
- PostgreSQL 主从复制参数（`wal_level`、`primary_conninfo` 等）由客户环境初始化脚本补齐。
