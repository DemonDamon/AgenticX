# Gateway Kubernetes 部署

Enterprise Go 网关的容器化交付资产：Deployment、Service、HPA 与探针配置。

## 前置

- 已构建镜像：`bash enterprise/apps/gateway/scripts/build-image.sh`
- 集群内创建 Secret（示例）：

```bash
kubectl create secret generic agenticx-gateway-env \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=REDIS_URL='redis://...' \
  --from-literal=AUTH_JWT_PUBLIC_KEY="$(cat jwt.pub)"
```

## 应用清单

```bash
kubectl apply -f deployment.yaml -f service.yaml -f hpa.yaml
```

参数模板见 `values.example.yaml`（供 Helm/Kustomize 迁移参考，本目录为 plain YAML）。

## 探针与指标

| 路径 | 用途 |
|------|------|
| `GET /healthz` | 存活探针 — 进程可用即 200 |
| `GET /readyz` | 就绪探针 — 检查 PG / Redis（若配置）与策略快照 |
| `GET /metrics` | Prometheus — `agx_gateway_http_requests_total`、`agx_gateway_http_request_duration_seconds`、`agx_gateway_active_streams` 等 |

环境变量 `GATEWAY_METRICS=off` 可关闭 `/metrics`（默认 on）。

## HPA

默认 CPU 70% 扩缩；`hpa.yaml` 内注释块展示如何接入 `agx_gateway_active_streams` 自定义指标（需 Prometheus Adapter）。

## 混合部署

公私云 + 私有化词元池路由样例见 [`hybrid/README.md`](./hybrid/README.md)。

## 验证

```bash
# 清单 lint（需 kubeconform 或 kubectl）
bash lint-manifests.sh

# 本地探针冒烟（需 gateway 进程）
bash ../../scripts/smoke-gateway-probes.sh http://127.0.0.1:8088
```

## 相关

- 生产 compose 模板：`../docker-compose/prod.yml`
- 压测基线：`../../docs/perf-baselines/gateway-baseline-report.md`
