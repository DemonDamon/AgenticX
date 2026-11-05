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
- `GATEWAY_TRUSTED_PROXY_CIDRS`：逗号分隔的可信入口代理 IP/CIDR，默认不信任任何转发头；覆盖 YAML 的 `trusted_proxy_cidrs` 列表，显式空值可关闭信任。无效地址和 `/0` 会阻止启动。

### 客户端来源地址

默认以 TCP 连接来源作为策略与审计的客户端地址。只有来源命中可信代理列表，才解析 `X-Forwarded-For`（从右向左停在第一个不可信地址）；不存在 XFF 时才使用单个 `X-Real-IP`。无效链条保留连接来源。入口代理须覆盖或正确追加客户端来源，且只配置实际受控的代理地址，不要把所有用户所在网段都列为可信代理。

```yaml
trusted_proxy_cidrs:
  - "192.0.2.10/32"
  - "2001:db8:1::/48"
```

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

## 容器镜像（公网网关）

在仓库 **`enterprise/`** 目录执行：

```bash
docker build -f apps/gateway/Dockerfile -t agenticx-gateway:latest .
```

## 远程拉取 admin internal 配置

当 admin-console 在 **Vercel**、网关在自建/Fly 等侧时，可让网关周期性 HTTP GET 控制台暴露的 internal 路由（需与 admin 侧 `GATEWAY_INTERNAL_TOKEN` 一致）：

| 变量 | 说明 |
|---|---|
| `GATEWAY_INTERNAL_TOKEN` | Bearer Token；附在 `Authorization: Bearer …` |
| `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | HTTPS URL，优先级高于 `GATEWAY_POLICY_SNAPSHOT_FILE`，body 更新时按内容 hash 触发热加载 |
| `GATEWAY_REMOTE_PROVIDERS_URL` | HTTPS URL（JSON 等价于桌面态 `providers.json`），后台约 5s 轮询 |
| `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | HTTPS URL（JSON 等价于 `quotas.json`），约 **10 秒** 本地缓存 |
| `GATEWAY_REMOTE_PRICING_CONFIG_URL` | admin `GET /api/internal/pricing-snapshot`（JSON 计价快照），约 **10 秒** 本地缓存；失败回落 `GATEWAY_PRICING_FILE` / 默认 `pricing.yaml` |
| `GATEWAY_REMOTE_BUDGET_CONFIG_URL` | admin `GET /api/internal/budget-snapshot`（JSON 成本/词元预算快照），约 **10 秒** 本地缓存；失败回落 `GATEWAY_BUDGET_CONFIG_FILE` |
| `GATEWAY_BUDGET_CONFIG_FILE` | 本地预算配置路径（默认 `../../.runtime/admin/budgets.json`） |
| `GATEWAY_BUDGET_USAGE_FILE` | 本地预算累计用量路径（默认 `../../.runtime/gateway/budget-usage.json`） |
| `GATEWAY_PAT_CACHE_TTL` | PAT 校验内存缓存 TTL（默认 `5s`） |
| `GATEWAY_REMOTE_PAT_REVOCATION_URL` | admin `GET /api/internal/pat-revocation-snapshot`（吊销 hash 列表 + version） |
| `GATEWAY_REMOTE_SESSION_GRANTS_URL` | admin `GET /api/internal/session-grants-snapshot`（会话临时 scope） |
| `GATEWAY_REMOTE_COMPLIANCE_URL` | admin `GET /api/internal/compliance-snapshot`（数据驻留 / 跨境策略） |
| `GATEWAY_DEFAULT_UPSTREAM_REGION` | 非 channel 路由时上游地域默认（如 `us`），用于跨境判定 |
| `GATEWAY_PRICING_FILE` | 本地计价表路径（默认 `internal/metering/pricing.yaml`） |

未配置上述远程 URL 时，仍使用 `GATEWAY_ADMIN_PROVIDERS_FILE`、`GATEWAY_QUOTA_CONFIG_FILE`、`GATEWAY_POLICY_SNAPSHOT_FILE` 等本地路径逻辑。

## 有界请求阶段诊断

默认关闭。临时排查时显式设置 `GATEWAY_REQUEST_DIAGNOSTICS_SAMPLE_EVERY=100`，每个 Gateway 进程按序采样每 100 个 HTTP 请求中的 1 个（首个请求采样）；`1` 表示全部，`0`、缺失、无效值或超过 `1000000` 均关闭。各副本独立采样；这不是全局日志速率上限。关闭/未采样请求沿用原 context，不创建阶段记录器。

采样请求完成时最多输出一条 `event=gateway.request_phases` 的固定字段日志：

- `admission_wait_ms` 是共享 chat 准入门整体耗时，包含额度/预算存储与等待，不单独声称等于数据库耗时。
- `upstream_start_ms`、`response_headers_ms`、`first_body_byte_ms`、`first_content_ms` 是相对 HTTP 请求进入诊断中间件的首次阶段偏移。响应头/字节取自共享流读取器，字节到达不必等整条 SSE 帧；内容是成功 push 的文本、推理或工具 delta，role/usage-only 不计。重试不覆盖已经记录的首次阶段。
- `total_ms` 是请求整体耗时，`reason` 仅为固定终结原因；未知错误归为 `upstream_error` 或 `other`，不记录错误文本。未到达/未接入的阶段为 `-1`，所有有效时长限制在 24 小时内。缓存命中、非流调用和未接入共享传输的实现可能缺少传输阶段；缺失不代表错误。

日志不含正文、令牌、URL、模型名、用户、查询、nonce 或任意关联标识。已有 trace reporter 仅在采样请求上附加相同的固定字段 `request_phases` 元数据（计量报告时的快照，`total_ms` 可早于最终日志），不新增数据库或异步队列。新指标复用现有 `/metrics` registry：`agx_gateway_request_phase_seconds{phase}` 仅使用六个固定阶段值（含 total），`agx_gateway_request_terminal_total{reason}` 仅使用白名单终结原因。二者都是**采样数据**，不能当作完整请求数；既有 TTFT/TPS 的采样和语义不变。`GATEWAY_METRICS=off` 关闭指标，诊断日志仍由采样开关单独控制。

日志轮转与保留由部署平台设置，本功能不修改真实环境。例如在容器部署中，可把诊断采样和容器 stdout 轮转一起显式配置：

```yaml
services:
  gateway:
    environment:
      GATEWAY_REQUEST_DIAGNOSTICS_SAMPLE_EVERY: "100"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

该示例约束单容器的本地 stdout 日志文件（约 30 MB 加轮转开销），不约束副本总量、外部日志采集器、独立审计文件或 trace 数据库；它们分别需要保留策略。排查结束后恢复采样值 `0`。本示例仅为文档，不会应用到任何环境。
