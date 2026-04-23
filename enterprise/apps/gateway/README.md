# AgenticX AI Gateway

企业级 AI 管控网关（AgenticX 自研实现）。

## 职责

1. **三路路由**：本地 · 企业独享云 · 第三方远程
2. **策略引擎**：关键词 / 正则 / PII / Prompt 规则
3. **审计日志**：JSON 结构化落盘（写 ClickHouse / 本地文件）
4. **OpenAI 兼容 API**：`/v1/chat/completions` / `/v1/embeddings`
5. **管控 API**：给 admin-console 读写配置

## 技术栈

- Go 1.22+
- Chi Router
- OpenAI Compatible API
- YAML 配置加载

## 构建

```bash
cd apps/gateway
go build -o bin/gateway ./cmd/gateway
```

## 运行（开发）

```bash
cd apps/gateway
go run ./cmd/gateway
# default: http://localhost:8088
```

可选环境变量：

- `GATEWAY_HTTP_ADDR`：监听地址，默认 `:8088`
- `GATEWAY_CONFIG_PATH`：外部 YAML 配置文件路径
