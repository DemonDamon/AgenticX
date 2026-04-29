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

## 接入真实模型 Key

网关的 `OpenAICompatibleProvider` 会按 **「provider 专属 Key → 通用兜底 Key → mock 回退」** 的顺序解析：

| 来源 | 环境变量 | 适用场景 |
|---|---|---|
| Provider 专属 | `<PROVIDER>_API_KEY`（provider 名转大写、连字符替换为下划线） | 主流第三方，例如 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`OPENAI_API_KEY`、`EDGE_AGENT_API_KEY` |
| 通用兜底 | `LLM_API_KEY` | 自托管 OpenAI 兼容网关 / 单一供应商场景 |
| 都没配 | — | 自动回退本地 mock，链路（鉴权 → 策略 → 审计 → 计量）依然完整 |

provider 名取自 `Config.Models[].provider`（默认 `deepseek` / `moonshot` / `edge-agent`）。`Endpoint` 取自同一行的 `endpoint`，请按上游真实地址配置（注意以 `/v1` 结尾，不要带 `/chat/completions`）。

### 本地最小开通示例

```bash
# enterprise/.env.local 末尾追加（不要提交）
DEEPSEEK_API_KEY=sk-...
# 可选：覆盖默认 endpoint
GATEWAY_CONFIG_PATH=./apps/gateway/config/gateway.local.yaml
```

`bootstrap.sh` 启动的 `start-dev.sh` 会把 `.env.local` 自动注入到 gateway 进程，前台聊到 `deepseek-chat` 时即走真调；未配置 Key 时会回退到提示「mock 回复」的占位文案。

> Key 切换是热重启级别的：改完 `.env.local` 后重启 `start-dev.sh` 即可。生产环境请通过 K8s Secret / Vault 等外部 Secret 管理注入，不要落盘到 `.env.local`。
