# 默认观测盒

本目录描述 **私有化默认观测盒**：一套可本机或现场拉起的 SigNoz（Foundry），给调查侧按关联键取证用。人看的看板不是产品；产品面是 `TelemetryQuery`（`get_trace` / `get_logs` / `get_recent_changes`）。

## 端口与资源

- UI：`http://127.0.0.1:8080`
- OTLP gRPC：`4317`
- OTLP HTTP：`4318`
- Docker 至少 **4GB** 内存。ClickHouse 吃 RAM；笔记本不够就只跑 FirstParty（读 `messages.json`），不要硬起这套盒。

## 安装（Foundry）

官方从 v0.130.0 起用 `foundryctl` + `casting.yaml`，仓库旧 `deploy/` compose 已弃用。不要再抄过期 `install.sh`。

1. 安装当前文档中的 `foundryctl`
2. 在本目录执行（命令以你本机 `foundryctl` 版本文档为准）：

```bash
foundryctl gauge -f casting.yaml
foundryctl forge -f casting.yaml
foundryctl cast -f casting.yaml
```

`foundryctl gauge -f deploy/observability/casting.yaml` 能过即可。若实施日 `apiVersion` 微调，保持 `flavor: compose` / `mode: docker`，不要改成 Loki / Tempo / Grafana 组合。

本目录的 `pours/` 是 Foundry 生成物，**不要提交**（已写入仓库 `.gitignore`）。

## Runtime 导出到本盒

```bash
export AGENTICX_OTEL_ENABLED=true
export AGENTICX_OTEL_ENDPOINT=http://127.0.0.1:4317
export AGENTICX_OTEL_CONSOLE=false
```

Studio `agx serve` 只在 `AGENTICX_OTEL_ENABLED` 为真时启用 OTel；默认关闭，行为与改前一致。

调查工具默认关闭。需要时再设 `AGENTICX_OPS_TOOLS=1`，并按需设：

```bash
export AGENTICX_TELEMETRY_BACKEND=auto
export SIGNOZ_API_URL=http://127.0.0.1:8080
# export SIGNOZ_API_KEY=...
```

`auto` 且未设 `SIGNOZ_API_URL` 时只走 FirstParty。

## 不要做的事

- **不要**再起一份 Loki / Tempo / Grafana 当默认盒
- **不要**手搓第三套 ClickHouse schema
- **不要**改 Gateway `metrics.go` 的 Prometheus label（高基数禁令仍有效）

## Gateway `/metrics` 刮取（可选 sidecar）

Gateway 已有 Prometheus `/metrics`。用本目录 `gateway-scrape/` 的 Collector 刮取后再 OTLP 打到本盒 `4317`。

指标端口以现场 `GATEWAY_METRICS` 实际 listen 为准。默认假设宿主机 `9090`。改 `otel-collector-config.yaml` 里 `targets`，或设环境变量 `GATEWAY_METRICS_HOST`。

```bash
docker compose -f deploy/observability/gateway-scrape/docker-compose.yml up -d
```

compose 只跑 `otel/opentelemetry-collector-contrib` 一个服务。
