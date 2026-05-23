# Wasm 插件运维 Runbook

## 开关

- `GATEWAY_WASM_PLUGINS=off`：关闭整个 Wasm 运行时（声明式 rule-pack 不受影响）
- `GATEWAY_PLUGINS_DIR`：插件根目录，默认 `enterprise/plugins`

## 热加载

1. 修改 `plugins/<name>/manifest.yaml` 或上传新 wasm
2. 文件系统 watcher 会自动 reload；也可调用：
   - Gateway：`POST /internal/plugins/reload`（需 `GATEWAY_INTERNAL_TOKEN`）
   - Admin：`PUT /api/admin/plugins`

## 示范插件

| 插件 | 作用 | 默认 |
|---|---|---|
| wasm-keyword-rewrite | 响应关键词替换 | 启用 |
| wasm-waf-basic | Prompt injection / 基础 WAF | 关闭 |
| wasm-audit-tagger | 审计 tag 注入 | 关闭 |
| wasm-bearer-extractor | 自定义 header → property | 关闭 |

## 故障隔离

- 插件 panic 会被 hook 层捕获，主网关继续服务
- 启动失败的插件会被跳过（manifest 校验 / Start 失败）
- Prometheus：`agx_plugin_invocations_total` / `agx_plugin_errors_total` / `agx_plugin_latency_seconds`

## Pyroscope（可选）

```bash
export PYROSCOPE_URL=https://pyroscope.example.com
export GATEWAY_PYROSCOPE=on
```

Admin `/admin/perf` 展示跳转链接。

Made-with: Damon Li
