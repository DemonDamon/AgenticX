---
name: 网关自动扩缩容与公私混合部署编排
overview: 为 Go 网关补齐弹性伸缩与混合部署的部署侧资产——容器化 + K8s 部署/HPA 清单 + 健康/就绪/指标端点 + 公有云与私有化「词元池」联动的配置编排与文档，使「自动扩缩容/混合部署」可落地交付。
todos:
  - id: t1-healthz-metrics
    content: 网关补齐 health/ready/metrics 端点（供探针与 HPA 指标）
    status: completed
  - id: t2-container
    content: 提供网关容器镜像构建（Dockerfile + 构建脚本）
    status: completed
  - id: t3-k8s-hpa
    content: K8s Deployment + Service + HPA 清单（CPU/自定义指标）
    status: completed
  - id: t4-hybrid-config
    content: 公有云/私有化词元池路由配置编排与文档
    status: completed
  - id: t5-smoke
    content: 本地 kind/compose 验证起停与探针，HPA 清单 lint
    status: completed
isProject: false
---

# 网关自动扩缩容与公私混合部署编排

**Plan-Id**: 2026-06-05-gateway-autoscaling-hybrid-deployment
**Plan-File**: `.cursor/plans/2026-06-05-gateway-autoscaling-hybrid-deployment.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现状：Go 网关无 autoscaling 落地代码/部署清单；混合部署「公有云 + 私有化词元池联动」仅在 ADR/文档层。客户要求「自动扩缩容应对峰值」「混合部署（公有云 + 私有化词元池联动）」。本 plan 聚焦**部署侧资产**（容器/K8s/HPA/探针/路由编排），不改网关业务逻辑（探针/指标端点除外）。

## 需求

- FR-1: 网关暴露 `/healthz`（存活）、`/readyz`（就绪：依赖 PG/Redis/快照可达）、`/metrics`（Prometheus，含 QPS/并发/延迟直方图），供探针与 HPA。
- FR-2: 提供容器镜像构建（多阶段 Dockerfile + 构建脚本），产出可运行网关镜像。
- FR-3: 提供 K8s 清单：Deployment（资源 request/limit、探针）、Service、HPA（基于 CPU + 可选自定义指标如并发/QPS）。
- FR-4: 混合部署编排：通过 channel/上游配置区分「公有云模型池」与「私有化词元池（如本地 Ollama/自建）」，提供按策略/优先级/可用性的路由配置样例与文档（路由能力复用现有 channel relay，不新造路由引擎）。
- NFR-1: 探针/指标为新增只读端点，不影响业务路径性能（指标采集低开销）。
- NFR-2: 清单为交付资产，参数（副本数/阈值/镜像）可配置，不写死。
- AC-1: 容器本地起后 `/healthz`/`/readyz`/`/metrics` 正常响应。
- AC-2: HPA 清单 `kubectl apply --dry-run` / kubeconform lint 通过。
- AC-3: 混合部署配置样例能区分公有云池与私有池并按优先级路由（本地验证一例）。

## 改动范围（严格）

1. `enterprise/apps/gateway/internal/server/`
   - 新增 `health.go`：`/healthz`、`/readyz`、`/metrics`（接 Prometheus client；若已有部分探针则补齐就绪依赖检查）。
2. `enterprise/apps/gateway/`
   - `Dockerfile`（多阶段）+ `scripts/build-image.sh`。
3. `enterprise/deploy/gateway/`（新）
   - `deployment.yaml`、`service.yaml`、`hpa.yaml`、`values` 样例；README 部署说明。
4. `enterprise/deploy/gateway/hybrid/`
   - 公私混合路由的 channel 配置样例 + 文档（联动现有 relay/channel 配置）。

不动：网关计量/策略/审计/限流业务逻辑、Desktop。

## 验证步骤

1. `go build` + 本地起容器，curl 三个端点（AC-1）。
2. `kubeconform` 或 `kubectl apply --dry-run=client -f enterprise/deploy/gateway/`（AC-2）。
3. 本地用 compose/kind 起公有云 mock + 私有 Ollama，按配置验证优先级路由（AC-3）。

## 回滚

- 探针/指标为新增端点可保留；部署清单与 Dockerfile 为交付资产，删除目录即回滚，不影响运行中网关逻辑。
