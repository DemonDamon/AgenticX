# Gateway Observability

## Metrics

Prometheus 端点：`GET /metrics`（`GATEWAY_METRICS=off` 时返回 404）。

核心指标：

- `agx_gateway_ttft_seconds`
- `agx_gateway_tokens_per_second`
- `agx_gateway_cache_hits_total`
- `agx_gateway_cache_lookups_total`
- `agx_gateway_channel_health`
- `agx_gateway_active_streams`
- `agx_gateway_upstream_error_total`

## Grafana

导入 `enterprise/docs/observability/grafana-ai-gateway.json`，数据源指向 Prometheus。
