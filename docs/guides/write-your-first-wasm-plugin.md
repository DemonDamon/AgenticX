# 编写第一个 Wasm 插件（Gateway）

当前推荐路径：**先用内置插件验证 manifest + hook 链**，再编译 TinyGo/Rust wasm。

## 1. 最快验证：builtin 插件

在 `enterprise/plugins/wasm-keyword-rewrite/manifest.yaml`：

```yaml
name: wasm-keyword-rewrite
runtime: wasm
enabled: true
wasm:
  binary: builtin:keyword-rewrite
config:
  replacements:
    secret-keyword: "[REDACTED]"
```

重启或热加载后，聊天响应中的 `secret-keyword` 会被替换。

## 2. 外部 .wasm

1. 实现 proxy-wasm 子集导出（Go SDK 模板后续补充）
2. 上传 manifest + `plugin.wasm` 到 Admin `/admin/plugins`
3. 在 manifest 声明 `host_capabilities` 白名单

## 3. 调试

- 审计 JSONL：`plugins_invoked` 字段
- Prometheus：`agx_plugin_*`
- 关闭运行时：`GATEWAY_WASM_PLUGINS=off`

Made-with: Damon Li
