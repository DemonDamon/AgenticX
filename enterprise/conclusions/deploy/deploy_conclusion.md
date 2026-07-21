# Enterprise deploy/ 模块总结

> 结论生成时间：2026-07-21（基于当前 `enterprise/deploy/` 全量重生成）

> 说明：本文档是 **Enterprise 部署资产目录**的结论。如实核对每个文件实际存在内容，区分「可用模板 / 覆盖层 / 冒烟样例 / 占位」，不夸大未落地的生产能力（如 PG 主从复制、TLS、MySQL 生产 profile）。

## 模块概述

`deploy/` 是 AgenticX Enterprise 的**部署资产合集**，覆盖四种形态：

| 形态 | 适用 | 入口 |
|---|---|---|
| 本地 Docker Compose dev | 开发期中间件（PG + MySQL + Redis） | `docker-compose/dev.yml` |
| 生产 Docker Compose prod | 单机/小集群生产模板 | `docker-compose/prod.yml` + 镜像覆盖层 |
| Kubernetes 生产 | 企业集群 | `gateway/{deployment,service,hpa}.yaml` |
| 公私混合云路由 | 公有云 + 私有词元池 | `gateway/hybrid/` |

所有部署都假设 `apps/gateway` 已构建为 `ghcr.io/agenticx/enterprise-gateway:latest`（或私有仓库等价 tag），并按需注入 PG / Redis / JWT 公钥 / admin 口令等密钥。

## 目录结构（如实核对）

```
deploy/
├── README.md                          # 部署总入口（含移动云 / 阿里云 ACR 全流程）
├── config/
│   └── policies.yaml                  # 网关 policy 装载清单（2 行，极简）
├── docker-compose/
│   ├── dev.yml                        # 开发：PG + MySQL + Redis（profile 化）
│   ├── prod.yml                       # 生产模板：Nginx + 双网关 + 前后台 + PG 主从 + Redis
│   ├── prod.aliyun.yml                # 阿里云 ACR 镜像覆盖层（只改 image）
│   ├── prod.ecloud.yml                # 移动云私有仓库镜像覆盖层（只改 image）
│   └── mysql-init/
│       └── 00-session.sql             # MySQL 全局 UTC 时区初始化（2 行）
├── nginx/
│   └── gateway.conf                   # 公网入口反代 + 限流 + 路由分发
└── gateway/                           # K8s 部署资产
    ├── README.md                      # K8s 部署指南（探针 / 指标 / HPA）
    ├── deployment.yaml                # 2 副本 + 探针 + 资源 + Prometheus 注解
    ├── service.yaml                   # ClusterIP service
    ├── hpa.yaml                       # HPA v2：CPU 70%，min2/max10
    ├── values.example.yaml            # Helm/Kustomize 迁移参考（plain YAML）
    ├── compose.smoke.yml              # 冒烟 compose（mock 上游 + gateway）
    ├── lint-manifests.sh              # 清单 lint（kubeconform / kubectl / PyYAML）
    └── hybrid/                        # 公私混合部署
        ├── README.md                  # 混合部署指南
        ├── policies.hybrid.yaml       # 混合 policy（4 个模型映射）
        ├── channels.example.json      # channel 配置示例（4 channel，含 region/weight）
        ├── smoke-policies.yaml        # 冒烟 policy（mock 上游）
        ├── channels.smoke.json        # 冒烟 channel（2 mock channel）
        └── smoke-runtime/
            ├── quotas.json            # 冒烟配额（default 租户超高上限）
            └── policy-snapshot.json   # 冒烟快照（空 tenants）
```

## docker-compose 详解

### `dev.yml`（开发中间件）

三容器，全部 profile 化：
- `postgres:16-alpine`（profile `postgresql`）：DB `agenticx`，user `postgres`/`postgres`，端口 5432，`pg_isready` healthcheck
- `mysql:8.0.36`（profile `mysql`）：DB `agenticx`，user `agenticx`/`agenticx`，root `root`，端口 3306；`utf8mb4` + `STRICT_TRANS_TABLES`；挂 `./mysql-init` 只读；`mysqladmin ping` healthcheck
- `redis:7-alpine`（无 profile，默认起）：端口 6379，`--save "" --appendonly no`（无持久化纯缓存），`redis-cli ping` healthcheck

卷：`pgdata` / `mysqldata` / `redisdata`。

### `prod.yml`（生产单机模板，仅 `postgresql` profile）

8 个服务：

| 服务 | 镜像 | 说明 |
|---|---|---|
| `nginx` | `nginx:1.27-alpine` | 公网入口 80/443；挂 `gateway.conf` + `certs/`（只读） |
| `gateway-a` + `gateway-b` | `ghcr.io/agenticx/enterprise-gateway:latest` | **双副本网关**；挂 `config/policies.yaml` + `../../plugins` 只读 + `gateway_runtime` 共享卷 |
| `web-portal` | `ghcr.io/agenticx/enterprise-web-portal:latest` | 端口 3000（容器内） |
| `admin-console` | `ghcr.io/agenticx/enterprise-admin-console:latest` | 端口 3001；挂 `gateway_runtime` + `../../plugins` |
| `postgres-primary` | `postgres:16-alpine`（profile `postgresql`） | 主库；`pg_isready` healthcheck |
| `postgres-replica` | `postgres:16-alpine`（profile `postgresql`） | 从库；`depends_on` primary healthy |
| `redis` | `redis:7-alpine` | AOF 持久化（`--appendonly yes --save 900/300`） |

强制环境变量（`${VAR:?...}` 语法）：`DATABASE_URL`、`ADMIN_CONSOLE_LOGIN_PASSWORD`；`POSTGRES_PASSWORD`、`JWT_PUBLIC_KEY`、`JWT_PRIVATE_KEY` 由调用方注入。gateway 关键 env：`GATEWAY_PORT=8088`、`GATEWAY_CONFIG_PATH=/app/config/policies.yaml`、`GATEWAY_QUOTA_CONFIG_FILE`、`GATEWAY_QUOTA_USAGE_FILE`、`GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`、`GATEWAY_POLICY_OVERRIDE_FILE`。

> 诚实缺口：(1) **`postgres-replica` 的主从复制参数（`wal_level` / `primary_conninfo` 等）未在 compose 内配置**，注释明确「由客户环境初始化脚本注入」——即 replica 当前只是骨架容器，开箱不会自动复制。(2) **`prod.yml` 仅定义 `postgresql` profile，没有 `mysql` 生产 profile**（`dev.yml` 有 mysql，prod 没有）；README 排障项明确「MySQL 生产 profile 尚未并入该模板」。(3) 镜像 tag 硬编码 `latest`，生产需通过覆盖层替换为不可变 tag。

### `prod.aliyun.yml` / `prod.ecloud.yml`（镜像覆盖层，只改 image）

两个覆盖层结构一致，仅替换 8 个服务的 `image` 字段为私有仓库地址：
- 阿里云：`${ALIYUN_ACR_PREFIX:?...}/<repo>:${*_IMAGE_TAG:?...}`
- 移动云：`${ECLOUD_IMAGE_PREFIX:?...}/<repo>:${*_IMAGE_TAG:?...}`

均强制 4 个 tag 变量（`NGINX_IMAGE_TAG` / `REDIS_IMAGE_TAG` / `POSTGRES_IMAGE_TAG` / `ENTERPRISE_IMAGE_TAG`），**禁止 `latest`**。编排 / 网络 / 卷一律以 `prod.yml` 为准，覆盖层不动。README 提供完整的「登录 → 同步镜像 → 准备 env 文件（600 权限）→ 校验 / 拉取 / 启动」四步流程，并要求每条 compose 命令显式带同一 `--env-file`。

### `mysql-init/00-session.sql`

仅 2 行：`SET GLOBAL time_zone = '+00:00';`——强制 MySQL 连接 UTC 时区。无表结构初始化（schema 由 `db:migrate` 在应用侧处理）。

## nginx / config 详解

### `nginx/gateway.conf`

- `worker_processes auto`，`worker_connections 4096`
- 限流：`limit_req_zone ... rate=20r/s`（zone `api_limit`）+ `limit_conn_zone`（zone `api_conn`）
- upstream：`gateway_backend`（`least_conn`，`gateway-a:8088` / `gateway-b:8088`，`max_fails=3 fail_timeout=10s`）、`web_portal_backend`（`web-portal:3000`）、`admin_console_backend`（`admin-console:3001`）
- server listen 80 路由：`/healthz` → gateway；`/v1/`（`burst=60 nodelay` + `limit_conn 40` + 600s 超时）→ gateway；`/api/chat/`（`burst=40` + 600s）→ gateway；`/admin/` → admin_console；`/` → web_portal

> 诚实缺口：**仅 listen 80，未配置 TLS**，注释自述「生产建议开启 TLS；此处保留 HTTP 入口用于内网/反向代理上游接入」。`certs/` 目录被挂载但**仓库内未提供证书**。生产前置 TLS 终端或补 TLS server 块是客户侧责任。

### `config/policies.yaml`

仅 2 行：`policy_manifest: /app/plugins/moderation-*/manifest.yaml` + `audit_dir: /runtime/audit`。通配符让 gateway 启动时扫所有 `moderation-*` 包 manifest（容器内 `/app/plugins/` 是 `enterprise/plugins/` 的只读挂载）。生产策略扩展由 admin 发布快照接管（`GATEWAY_POLICY_SNAPSHOT_FILE` 优先加载，回退到本文件 + override）。

## gateway/ K8s 详解

### `deployment.yaml`

- `replicas: 2`，镜像 `ghcr.io/agenticx/enterprise-gateway:latest`，`imagePullPolicy: IfNotPresent`
- 端口 `8088`（http）；Prometheus annotation：`scrape=true` / `path=/metrics` / `port=8088`
- env：`GATEWAY_HTTP_ADDR=:8088`、`GATEWAY_METRICS=on`、`GATEWAY_CHANNEL_REGISTRY=on`、`GATEWAY_CONFIG_PATH=/app/config/policies.yaml`、`GATEWAY_QUOTA_CONFIG_FILE=/runtime/admin/quotas.json`、`GATEWAY_POLICY_SNAPSHOT_FILE=/runtime/admin/policy-snapshot.json`、`GATEWAY_ADMIN_CHANNELS_FILE=/runtime/admin/channels.json`
- Secret 注入（`agenticx-gateway-env`，全部 `optional: true`）：`DATABASE_URL` / `REDIS_URL` / `AUTH_JWT_PUBLIC_KEY`
- 探针：readiness `/readyz`（initialDelay 10s / period 10s）、liveness `/healthz`（initialDelay 5s / period 10s）
- 资源：requests `250m / 256Mi` → limits `2 / 1Gi`
- 卷：`runtime`（emptyDir）、`gateway-config`（configMap `agenticx-gateway-config`，optional）

### `service.yaml` / `hpa.yaml` / `values.example.yaml`

- `service.yaml`：ClusterIP，`port 8088 → targetPort http`
- `hpa.yaml`：autoscaling/v2，`minReplicas: 2` / `maxReplicas: 10`，CPU `averageUtilization: 70`；自定义指标 `agx_gateway_active_streams`（averageValue 20）**以注释块给出**，需 Prometheus Adapter 才能启用；scaleUp 60s/100%、scaleDown 300s/50%
- `values.example.yaml`：plain YAML 参数模板（image / replicaCount / service / resources / hpa / env / probes / volumes），供迁移 Helm/Kustomize 参考——**本目录不是 Helm chart**

### `compose.smoke.yml` / `lint-manifests.sh`

- `compose.smoke.yml`：本地冒烟，三服务——`mock-cloud`（build `scripts/perf/mock-upstream`，19099:9099）、`redis:7-alpine`、`gateway`（build `apps/gateway/Dockerfile`，18088:8088）；挂 `smoke-policies.yaml` / `channels.smoke.json` / `smoke-runtime` / `moderation-perf` fixture
- `lint-manifests.sh`：对 deployment/service/hpa 三清单做 lint，优先 `kubeconform`，次选 `kubectl apply --dry-run=client`，离线回退 PyYAML 语法检查

### 探针与指标（来自 gateway/README.md）

| 路径 | 用途 |
|---|---|
| `GET /healthz` | 存活探针（进程可用即 200） |
| `GET /readyz` | 就绪探针（配置了 `DATABASE_URL`/`REDIS_URL` 时检查依赖 + 策略快照） |
| `GET /metrics` | Prometheus：`agx_gateway_http_requests_total` / `agx_gateway_http_request_duration_seconds` / `agx_gateway_active_streams` 等 |

`GATEWAY_METRICS=off` 可关 `/metrics`（默认 on）。

## gateway/hybrid/ 公私混合详解

**用途**：同一集群内部分流量走公有云 provider、部分走私有化词元池（Ollama / vLLM），复用 gateway 现有 channel relay + YAML 路由，不引入新路由引擎。

- `policies.hybrid.yaml`：4 个模型映射——`deepseek-chat`（third-party）、`moonshot-v1-8k`（private-cloud）、`local-ollama-llama3`（local）、`qwen2.5-72b-instruct`（local）；含 `default_route: third-party` + `local_route_header: x-agenticx-route`
- `channels.example.json`：4 个 channel——`cloud-deepseek-primary`（w80/p10/cn-north）、`cloud-moonshot-fallback`（w20/p20/cn-east）、`private-ollama-local`（w100/p5/on-prem）、`private-vllm-cluster`（w50/p15/on-prem）；含 `metadata.pool`（public-cloud / private-token-pool）与 `region` 字段
- `smoke-policies.yaml` + `channels.smoke.json`：冒烟用，2 个 mock channel 指向 `mock-cloud:9099`
- `smoke-runtime/quotas.json`：`{"tenants":{"default":{"monthlyTokenLimit":1000000000,"monthlyRequestLimit":1000000}}}`——冒烟配额上限极高（实质不限）
- `smoke-runtime/policy-snapshot.json`：`{"tenants":{}}`——空快照

启用方式（README）：`GATEWAY_CHANNEL_REGISTRY=on` + `GATEWAY_ADMIN_CHANNELS_FILE=/runtime/admin/channels.json`；多周期配额需额外开 `GATEWAY_REQUEST_COUNT_QUOTA=on` / `GATEWAY_TOKEN_WINDOW_QUOTA=on` / `GATEWAY_REQUEST_COUNT_BACKEND=pg`（默认关闭，升级零行为变化）。

## 诚实缺口汇总

| 项 | 现状 | 影响 |
|---|---|---|
| PG 主从复制 | `postgres-replica` 容器存在但复制参数未配（注释交客户脚本） | 开箱不自动复制，需客户侧补 `wal_level`/`primary_conninfo` |
| MySQL 生产 profile | `prod.yml` 仅 `postgresql` profile，无 `mysql` 生产 profile | 生产模板暂不支持 MySQL 后端 |
| TLS | `nginx/gateway.conf` 仅 listen 80，无 TLS server 块；`certs/` 仓库无证书 | 生产需前置 TLS 终端或自补 TLS 配置 |
| 镜像 tag | `prod.yml` / `deployment.yaml` 硬编码 `latest` | 生产必须用覆盖层 / 镜像替换为不可变 tag |
| `values.example.yaml` | plain YAML，非 Helm chart | 仅作迁移参考，不能直接 `helm install` |
| HPA 自定义指标 | `agx_gateway_active_streams` 以注释给出 | 需 Prometheus Adapter 才能基于流式连接数扩缩 |
| 压测基线 | README 引用 `../../docs/perf-baselines/gateway-baseline-report.md` | 本目录不含基线数据，需另查 |

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/gateway` | 被部署对象 | compose / K8s 都拉此镜像 |
| `apps/web-portal` / `apps/admin-console` | 被部署对象 | `prod.yml` 中两个 Next.js 服务 |
| `plugins/moderation-*` | 运行时挂载 | compose 把 `enterprise/plugins/` 只读挂到 `/app/plugins/`；gateway 经 `policies.yaml` 扫描装载 |
| `scripts/{bootstrap,start-dev,start-dev-with-infra,reset-dev-data}.sh` | 入口脚本 | README 推荐命令路由到这里 |
| `apps/gateway/scripts/build-image.sh` | 镜像构建 | K8s 部署前置 |
| `scripts/perf/mock-upstream` + `moderation-perf` fixture | 冒烟上游 | `compose.smoke.yml` 引用 |
