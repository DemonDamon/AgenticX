# Gateway Observability

网关用 Prometheus 文本指标暴露延迟、缓存和上游错误。默认关闭：`GATEWAY_METRICS` 不是 `on` 时 `GET /metrics` 返回 404，避免把内部计数器暴露到未鉴权端口。

## Metrics

Prometheus 端点：`GET /metrics`（`GATEWAY_METRICS=off` 时返回 404）。

核心指标：

| 指标 | 含义 |
|------|------|
| `agx_gateway_ttft_seconds` | 首 token 延迟 |
| `agx_gateway_tokens_per_second` | 生成吞吐 |
| `agx_gateway_cache_hits_total` | L1/L2 命中 |
| `agx_gateway_cache_lookups_total` | 缓存查找次数 |
| `agx_gateway_channel_health` | Channel 健康 |
| `agx_gateway_active_streams` | 当前流式连接 |
| `agx_gateway_upstream_error_total` | 上游错误 |

缓存开关与计费见 [architecture/cache-and-pricing.md](../architecture/cache-and-pricing.md)。

## Grafana

导入仓库内 `enterprise/docs/observability/grafana-ai-gateway.json`（网站拷贝在本目录旁的 JSON，若未同步则以主仓该路径为准），数据源指向 Prometheus。这是模板仪表盘，不是托管 Grafana 实例。

## 审计不是 Metrics

LLM / MCP 调用的合规记录在 `gateway_audit_events` + JSONL，不在 `/metrics`。查询走 admin `/audit`，见 [architecture/data-flow.md](../architecture/data-flow.md) 与 [runbooks/audit-pg-backfill.md](../runbooks/audit-pg-backfill.md)。

Made-with: Damon Li
