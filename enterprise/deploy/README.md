# Enterprise Deploy Notes (Hechuang)

## Production Template

- `docker-compose/dev.yml`：开发期基础依赖（Postgres + Redis）。
- `docker-compose/prod.yml`：生产模板（Nginx 入口 + 双网关 + 前后台 + PostgreSQL 主从 + Redis）。
- `docker-compose/prod.ecloud.yml`：移动云私有镜像仓库覆盖层（只改 `image`，与 `prod.yml` 叠加使用）。
- `docker-compose/prod.aliyun.yml`：国内/阿里云镜像覆盖层（只改 `image`，与 `prod.yml` 叠加使用）。
- `nginx/gateway.conf`：公网入口反向代理与基础限流模板。
- `config/policies.yaml`：网关策略包装载清单（生产可按客户策略扩展）。
- `gateway/`：K8s Deployment / Service / HPA、混合部署样例与 compose 冒烟（见 `gateway/README.md`）。

## Usage

启动前在 shell 中设置强口令的 `ADMIN_CONSOLE_LOGIN_PASSWORD`（勿写入仓库），再执行：

```bash
cd enterprise/deploy/docker-compose
POSTGRES_PASSWORD=replace-me \
ADMIN_CONSOLE_LOGIN_PASSWORD=replace-me \
JWT_PUBLIC_KEY="$(cat /path/to/jwt.pub)" \
JWT_PRIVATE_KEY="$(cat /path/to/jwt.key)" \
DATABASE_URL="postgresql://agenticx:replace-me@postgres-primary:5432/agenticx?sslmode=disable" \
docker compose -f prod.yml --profile postgresql up -d
```

（`prod.yml` 会通过 `${ADMIN_CONSOLE_LOGIN_PASSWORD?...}` / `${DATABASE_URL?...}` 强制要求相关变量已导出；内置 Postgres 需加 `--profile postgresql`。）

## 移动云私有镜像仓库生产部署

移动云部署优先使用移动云控制台提供的私有镜像仓库访问地址，避免运行时依赖 Docker Hub、GHCR、公共代理或跨云 ACR。`prod.ecloud.yml` 不内置任何猜测的域名：不同地域、网络类型或交付环境的地址可能不同，必须从当前移动云项目的控制台复制实际 Registry 域名。

### 1. 准备仓库并登录

在移动云控制台创建 namespace，以及 `nginx`、`redis`、`postgres`、`enterprise-gateway`、`enterprise-web-portal`、`enterprise-admin-console` 六个仓库。部署主机与镜像仓库网络可达时，优先选择控制台提供的内网/专网访问地址。

```bash
# 以下值必须从移动云控制台复制，不要照抄示例域名。
export ECLOUD_REGISTRY_HOST="COPY_ACTUAL_REGISTRY_HOST_FROM_CONSOLE"
export ECLOUD_NAMESPACE=agenticx
export ECLOUD_IMAGE_PREFIX="$ECLOUD_REGISTRY_HOST/$ECLOUD_NAMESPACE"
export ECLOUD_REGISTRY_USERNAME="COPY_ACTUAL_USERNAME_FROM_CONSOLE"

read -rsp "Registry password: " ECLOUD_REGISTRY_PASSWORD
echo
printf '%s' "$ECLOUD_REGISTRY_PASSWORD" \
  | docker login --username "$ECLOUD_REGISTRY_USERNAME" \
      --password-stdin "$ECLOUD_REGISTRY_HOST"
unset ECLOUD_REGISTRY_PASSWORD
```

登录域名必须与后续镜像地址中的域名完全一致。生产部署账号只授予镜像拉取权限；同步镜像使用独立的推送账号。

### 2. 将全部镜像同步到移动云

在能同时访问 Docker Hub、GHCR 和移动云镜像仓库的受控机器执行。目标 tag 使用唯一发布版本，禁止 `latest`：

```bash
export NGINX_IMAGE_TAG=1.27-alpine-20260716
export REDIS_IMAGE_TAG=7-alpine-20260716
export POSTGRES_IMAGE_TAG=16-alpine-20260716
export SOURCE_ENTERPRISE_IMAGE_TAG="published-source-tag"
export ENTERPRISE_IMAGE_TAG="2026.07.16-gitsha"

mirror_to_ecloud() {
  source_image="$1"
  target_repo="$2"
  target_tag="$3"
  target_image="$ECLOUD_IMAGE_PREFIX/$target_repo:$target_tag"

  docker pull "$source_image"
  docker tag "$source_image" "$target_image"
  docker push "$target_image"
}

mirror_to_ecloud nginx:1.27-alpine nginx "$NGINX_IMAGE_TAG"
mirror_to_ecloud redis:7-alpine redis "$REDIS_IMAGE_TAG"
mirror_to_ecloud postgres:16-alpine postgres "$POSTGRES_IMAGE_TAG"
mirror_to_ecloud "ghcr.io/agenticx/enterprise-gateway:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-gateway "$ENTERPRISE_IMAGE_TAG"
mirror_to_ecloud "ghcr.io/agenticx/enterprise-web-portal:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-web-portal "$ENTERPRISE_IMAGE_TAG"
mirror_to_ecloud "ghcr.io/agenticx/enterprise-admin-console:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-admin-console "$ENTERPRISE_IMAGE_TAG"
```

若 GHCR 仓库不是公开仓库，同步前需用具备 `read:packages` 权限的凭证执行 `docker login ghcr.io`。同步后应记录目标镜像 digest，供发布审计和回滚核对。

### 3. 准备部署环境变量

在仓库外创建 `/etc/agenticx/prod.ecloud.env` 并设置 `600` 权限：

```dotenv
ECLOUD_IMAGE_PREFIX=COPY_ACTUAL_REGISTRY_HOST_FROM_CONSOLE/agenticx
NGINX_IMAGE_TAG=1.27-alpine-20260716
REDIS_IMAGE_TAG=7-alpine-20260716
POSTGRES_IMAGE_TAG=16-alpine-20260716
ENTERPRISE_IMAGE_TAG=2026.07.16-gitsha

POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
ADMIN_CONSOLE_LOGIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
DATABASE_URL=postgresql://agenticx:REPLACE_WITH_URL_ENCODED_PASSWORD@postgres-primary:5432/agenticx?sslmode=disable
```

```bash
sudo chown root:root /etc/agenticx/prod.ecloud.env
sudo chmod 600 /etc/agenticx/prod.ecloud.env

export JWT_PUBLIC_KEY="$(cat /secure/path/jwt.pub)"
export JWT_PRIVATE_KEY="$(cat /secure/path/jwt.key)"
```

### 4. 校验、拉取并启动

```bash
cd enterprise/deploy/docker-compose

# 输出的 8 行镜像必须全部以实际 ECLOUD_IMAGE_PREFIX 开头，且不能出现 latest。
docker compose --env-file /etc/agenticx/prod.ecloud.env \
  -f prod.yml -f prod.ecloud.yml --profile postgresql config --images

docker compose --env-file /etc/agenticx/prod.ecloud.env \
  -f prod.yml -f prod.ecloud.yml --profile postgresql pull

docker compose --env-file /etc/agenticx/prod.ecloud.env \
  -f prod.yml -f prod.ecloud.yml --profile postgresql up -d

docker compose --env-file /etc/agenticx/prod.ecloud.env \
  -f prod.yml -f prod.ecloud.yml --profile postgresql ps
curl --fail http://127.0.0.1/healthz
```

排障要点：

- `ECLOUD_IMAGE_PREFIX is required`：确认每条命令都带同一个 `--env-file`。
- `unauthorized`：确认登录域名与镜像域名一致，并检查部署账号的拉取权限。
- `i/o timeout`：核对移动云仓库访问地址、部署主机网络和访问控制，不要静默回退公共代理。
- `manifest unknown`：目标仓库或 tag 尚未同步，或者同步到了其他地域/namespace。
- 当前 `prod.yml` 仅定义 PostgreSQL profile；以后生产模板加入 MySQL 服务时，`prod.ecloud.yml` 还需同步增加 MySQL 镜像覆盖，现阶段不能只靠 override 凭空启用 MySQL。

## 阿里云 ACR 生产部署

直连 Docker Hub 或 GHCR 在国内机房可能超时。生产环境不依赖公共代理：先把全部基础镜像和业务镜像同步到私有 ACR，再将 `prod.aliyun.yml` 与 `prod.yml` 叠加使用。

### 1. 准备 ACR

1. 从 ACR 控制台复制部署网络对应的实际访问域名。企业版公网域名通常形如 `<instance>-registry.cn-hangzhou.cr.aliyuncs.com`；VPC 部署必须使用控制台提供的专有网络域名，不要根据示例猜测。
2. 创建 namespace，以及 `nginx`、`redis`、`postgres`、`enterprise-gateway`、`enterprise-web-portal`、`enterprise-admin-console` 六个仓库。
3. 对仓库开启镜像版本不可变，并为部署账号配置最小只读权限和网络白名单。
4. 在部署主机登录 ACR。登录域名必须和后续拉取使用的域名一致：

```bash
export ALIYUN_ACR_HOST="your-instance-registry.cn-hangzhou.cr.aliyuncs.com"
export ALIYUN_ACR_NAMESPACE=agenticx
export ALIYUN_ACR_PREFIX="$ALIYUN_ACR_HOST/$ALIYUN_ACR_NAMESPACE"
export ALIYUN_ACR_USERNAME="your-ram-user@your-account-alias"

read -rsp "ACR password: " ALIYUN_ACR_PASSWORD
echo
printf '%s' "$ALIYUN_ACR_PASSWORD" \
  | docker login --username "$ALIYUN_ACR_USERNAME" --password-stdin "$ALIYUN_ACR_HOST"
unset ALIYUN_ACR_PASSWORD
```

### 2. 同步并固化镜像

在能够访问 Docker Hub、GHCR 和 ACR 的受控机器执行。目标 tag 必须是唯一发布版本，禁止使用 `latest`；同步完成后记录 ACR 返回的 digest。

```bash
export NGINX_IMAGE_TAG=1.27-alpine-20260716
export REDIS_IMAGE_TAG=7-alpine-20260716
export POSTGRES_IMAGE_TAG=16-alpine-20260716
export SOURCE_ENTERPRISE_IMAGE_TAG="published-source-tag"
export ENTERPRISE_IMAGE_TAG="2026.07.16-gitsha"

mirror_image() {
  source_image="$1"
  target_repo="$2"
  target_tag="$3"
  target_image="$ALIYUN_ACR_PREFIX/$target_repo:$target_tag"

  docker pull "$source_image"
  docker tag "$source_image" "$target_image"
  docker push "$target_image"
}

mirror_image nginx:1.27-alpine nginx "$NGINX_IMAGE_TAG"
mirror_image redis:7-alpine redis "$REDIS_IMAGE_TAG"
mirror_image postgres:16-alpine postgres "$POSTGRES_IMAGE_TAG"
mirror_image "ghcr.io/agenticx/enterprise-gateway:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-gateway "$ENTERPRISE_IMAGE_TAG"
mirror_image "ghcr.io/agenticx/enterprise-web-portal:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-web-portal "$ENTERPRISE_IMAGE_TAG"
mirror_image "ghcr.io/agenticx/enterprise-admin-console:$SOURCE_ENTERPRISE_IMAGE_TAG" \
  enterprise-admin-console "$ENTERPRISE_IMAGE_TAG"
```

如果 GHCR 仓库不是公开仓库，同步前还需用具备 `read:packages` 权限的凭证执行 `docker login ghcr.io`。

### 3. 准备生产环境变量

在仓库外创建 `/etc/agenticx/prod.env`，权限设为 `600`。以下变量均为必填；数据库密码中的 URL 特殊字符必须进行百分号编码：

```dotenv
ALIYUN_ACR_PREFIX=your-instance-registry.cn-hangzhou.cr.aliyuncs.com/agenticx
NGINX_IMAGE_TAG=1.27-alpine-20260716
REDIS_IMAGE_TAG=7-alpine-20260716
POSTGRES_IMAGE_TAG=16-alpine-20260716
ENTERPRISE_IMAGE_TAG=2026.07.16-gitsha

POSTGRES_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
ADMIN_CONSOLE_LOGIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
DATABASE_URL=postgresql://agenticx:REPLACE_WITH_URL_ENCODED_PASSWORD@postgres-primary:5432/agenticx?sslmode=disable
```

```bash
sudo chown root:root /etc/agenticx/prod.env
sudo chmod 600 /etc/agenticx/prod.env
```

JWT PEM 保持从受控文件读取，避免写入仓库：

```bash
export JWT_PUBLIC_KEY="$(cat /secure/path/jwt.pub)"
export JWT_PRIVATE_KEY="$(cat /secure/path/jwt.key)"
```

### 4. 校验、拉取并启动

每条 Compose 命令都显式传同一个 `--env-file`，避免 `pull` 与 `up` 使用不同环境变量：

```bash
cd enterprise/deploy/docker-compose

# 输出必须全部以实际 ALIYUN_ACR_PREFIX 开头，且不能出现 latest。
docker compose --env-file /etc/agenticx/prod.env \
  -f prod.yml -f prod.aliyun.yml --profile postgresql config --images

docker compose --env-file /etc/agenticx/prod.env \
  -f prod.yml -f prod.aliyun.yml --profile postgresql pull

docker compose --env-file /etc/agenticx/prod.env \
  -f prod.yml -f prod.aliyun.yml --profile postgresql up -d
```

启动后至少检查：

```bash
docker compose --env-file /etc/agenticx/prod.env \
  -f prod.yml -f prod.aliyun.yml --profile postgresql ps
curl --fail http://127.0.0.1/healthz
```

### 排障

- `ALIYUN_ACR_PREFIX is required` 或 tag 变量缺失：确认每条命令都带 `--env-file /etc/agenticx/prod.env`。
- `unauthorized`：确认已 `docker login`，登录域名与 `ALIYUN_ACR_PREFIX` 的域名完全一致，并检查 RAM 权限。
- `i/o timeout`：检查部署主机到 ACR 域名的网络、VPC 访问控制和公网/VPC 白名单；该覆盖文件不会回退到 Docker Hub、GHCR 或公共代理。
- `manifest unknown`：目标仓库或目标 tag 尚未同步，或同步到了另一个地域/namespace。
- `--profile mysql`：当前 `prod.yml` 只有 `postgresql` profile；MySQL 生产 profile 尚未并入该模板。

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
- 阿里云部署须先将全部镜像同步到私有 ACR，再叠加 `prod.aliyun.yml`；不要改 `prod.yml` 本体（见上文「阿里云 ACR 生产部署」）。
- `config/policies.yaml` 是 Gateway 配置片段，默认挂载 `/app/plugins/moderation-*/manifest.yaml`；Admin 策略启停与额度配置写入共享 `/runtime/admin`。
- Gateway 新增 `GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`：
  - 优先加载 PG 发布生成的快照文件；
  - 若快照不存在，则回退到 `config/policies.yaml + GATEWAY_POLICY_OVERRIDE_FILE`；
  - `GATEWAY_POLICY_OVERRIDE_FILE` 仅保留兼容路径，后续版本会逐步弃用。
- PostgreSQL 主从复制参数（`wal_level`、`primary_conninfo` 等）由客户环境初始化脚本补齐。
