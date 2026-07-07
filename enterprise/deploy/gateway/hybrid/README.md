# 公私混合部署 — 路由编排说明

本目录提供 **公有云模型池** 与 **私有化词元池** 联动的配置样例，复用网关现有 channel relay + YAML 路由能力，不引入新路由引擎。

## 架构

```text
Client (portal / desktop)
        │
        ▼
  agenticx-gateway (K8s HPA)
        │
        ├─ route=third-party / private-cloud  → 公有云 API（DeepSeek / Moonshot 等）
        │
        └─ route=local                         → 私有化词元池（Ollama / vLLM / 内网推理）
```

## 启用 Channel Registry

```bash
export GATEWAY_CHANNEL_REGISTRY=on
export GATEWAY_ADMIN_CHANNELS_FILE=/runtime/admin/channels.json
```

将 `channels.example.json` 复制到运行时目录并按环境改 `baseUrl`、密钥引用。

Channel 字段说明：

| 字段 | 混合部署用途 |
|------|----------------|
| `route` | `third-party` / `private-cloud` = 公有云；`local` = 私有化池 |
| `priority` | 数值越小越优先（同模型多通道 failover） |
| `weight` | 同 priority 内加权负载 |
| `metadata.pool` | 文档/运维标签：`public-cloud` vs `private-token-pool` |
| `region` | 与跨境合规审计字段对齐 |

## YAML 模型回落

未启用 channel registry 时，`policies.hybrid.yaml` 的 `models[]` 按模型名映射 endpoint。

也可通过请求头强制路由（与现有 `routing.Decider` 一致）：

```http
x-agenticx-route: local
```

## 典型策略

1. **成本优先**：敏感/高频小模型走 `local`（Ollama）；长上下文走公有云大模型。
2. **可用性优先**：公有云 channel `priority=10`，本地池 `priority=5` 作预热备用；主通道 cooldown 后自动切本地。
3. **合规优先**：带 `region=on-prem` 的 local channel 仅服务特定 tenant；配合策略引擎 block 跨境。

## 本地验证（compose）

```bash
cd enterprise/deploy/gateway
docker compose -f compose.smoke.yml up -d --build
bash ../../scripts/smoke-gateway-probes.sh http://127.0.0.1:18088
```

Mock 公有云上游 + 本地 Ollama（可选）见 `compose.smoke.yml` 注释。

## K8s 部署

```bash
kubectl apply -f ../deployment.yaml -f ../service.yaml -f ../hpa.yaml
```

就绪探针 `/readyz` 会在配置了 `DATABASE_URL` / `REDIS_URL` 时检查依赖；Prometheus 抓取 `/metrics` 中的 `agx_gateway_http_requests_total` 与 `agx_gateway_active_streams` 可用于 HPA 自定义指标（需 Prometheus Adapter）。

## 多周期配额生产启用

默认行为保持关闭（升级后零行为变化）；与客户确认限额数值后再开启：

```bash
export GATEWAY_REQUEST_COUNT_QUOTA=on
export GATEWAY_TOKEN_WINDOW_QUOTA=on
export GATEWAY_REQUEST_COUNT_BACKEND=pg
export DATABASE_URL=postgres://...
```

- `GATEWAY_REQUEST_COUNT_QUOTA=on`：启用日/周/月请求次数配额。
- `GATEWAY_TOKEN_WINDOW_QUOTA=on`：启用日/周 Token 窗口硬顶。
- `GATEWAY_REQUEST_COUNT_BACKEND=pg`：多副本部署建议使用 PG 后端，保证跨实例计数一致。
- `DATABASE_URL`：PG 计数/池用量所需连接。
