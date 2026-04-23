# AgenticX AI Gateway

企业级 AI 管控网关。基于 [APIPark](https://github.com/APIParkLab/APIPark) 二次开发。

## 职责

1. **三路路由**：本地 · 企业独享云 · 第三方远程
2. **策略引擎**：关键词 / 正则 / PII / Prompt 规则
3. **审计日志**：JSON 结构化落盘（写 ClickHouse / 本地文件）
4. **OpenAI 兼容 API**：`/v1/chat/completions` / `/v1/embeddings`
5. **管控 API**：给 admin-console 读写配置

## 技术栈

- Go 1.22+
- Gin / Fiber
- 基于 APIPark Apinto 插件链

## 构建

```bash
cd apps/gateway
go build -o bin/gateway ./cmd/gateway
```
