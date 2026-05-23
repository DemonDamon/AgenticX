# Gateway Plugin Runtime

## 架构

```
request → auth → policy → wasm hooks → channel relay → wasm stream/response hooks → audit
```

`internal/wasmhost/` 负责：

- manifest 发现与加载（`loader.go`）
- 内置插件（`builtin.go`，`wasm.binary: builtin:*`）
- wazero 外部 wasm 占位（`runtime.go` + `WazeroPlugin`）
- fsnotify 热加载（`manager.go`）

## ABI 子集

| Hook | 说明 |
|---|---|
| `OnRequestHeaders` | 请求头阶段 |
| `OnRequestBody` | 请求体（含 WAF） |
| `OnResponseBody` | 非流式响应改写 |
| `OnStreamChunk` | SSE chunk 改写 |

返回 `ActionContinue` / `ActionStop`；Stop 时网关直接回写 `StopBody`。

## Manifest

```yaml
runtime: wasm
enabled: true
priority: 100
scope:
  tenant_ids: ["*"]
  routes: ["/v1/*"]
wasm:
  binary: builtin:keyword-rewrite
  host_capabilities: [audit_log, metrics_inc]
config:
  replacements:
    secret-keyword: "[REDACTED]"
```

## 运维 API（internal）

- `GET /internal/plugins`
- `POST /internal/plugins/reload`
- `POST /internal/plugins/upload`
- `GET /internal/errors` — 24h 错误指纹聚类
- `POST /internal/channels/{id}/probe` — Channel 自检
- `GET /internal/perf` — Pyroscope 配置

Made-with: Damon Li
