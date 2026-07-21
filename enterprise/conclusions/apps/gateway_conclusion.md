# AgenticX Enterprise gateway 模块总结

> 结论生成时间：2026-07-21（基于当前工作区代码重生成，覆盖旧版）

> 说明：本文档描述 **企业 AI 控制平面网关**（OpenAI 兼容 HTTP 数据面，多 provider 路由 + 治理）。与主仓 `agenticx/gateway`（IM 远程指令网关）、`agenticx/studio/server.py`（FastAPI 服务网关）是完全不同的模块，请勿混淆。本网关灵感借鉴 APIPark / Higress ai-load-balancer，但代码完全自研（`internal/channel/lb_policy.go` 顶部标注 Apache-2.0 NOTICE）。

## 模块定位

`apps/gateway` 是 **AgenticX 企业 AI 控制平面数据面**，Go 1.25 + Chi router 实现，默认监听 `:8088`（`GATEWAY_HTTP_ADDR` 可覆盖）。对外是 OpenAI 兼容的 HTTP 网关，前面挂多 vendor LLM（OpenAI、Anthropic Claude、Google Gemini、Azure OpenAI、AWS Bedrock、DeepSeek、Moonshot、自托管 Ollama / edge-agent），背后是一整套企业治理能力：**三路由决策（local · private-cloud · third-party）**、嵌入式 `policy-engine` 做 PII / 敏感词 / 字段级脱敏、配额与预算追踪、防篡改审计日志（File + Postgres + blake2b 链）、语义缓存（L1 内存/Redis + L2 语义相似度）、Wasm 插件链、MCP host + proxy、跨境数据合规、channel pool 负载均衡 + key pool 轮转、Prometheus 指标 + Pyroscope 性能剖析。所有运行时配置（providers/policy/pricing/budget/channels/PAT 吊销/session grants/compliance）通过 5-10s 轮询 admin-console 的 `/api/internal/*` 热加载，**支持优雅降级**（无 PG/Redis 时回退本地 jsonl，无 key 时回退 mock provider）。

## 目录结构（internal/* 真实包）

```
apps/gateway/
├── README.md                  # 构建/运行/环境变量文档（部分内容已陈旧，见"诚实缺口"）
├── Dockerfile                 # Distroless 多阶段构建，依赖 ../../packages/policy-engine
├── go.mod                     # go 1.25; chi, jwt, pgx, mysql-driver, redis, prometheus, wazero, fsnotify, blake2b, yaml
├── cmd/gateway/main.go        # 入口：config.Load → server.New → http.ListenAndServe(srv.Router())
├── scripts/build-image.sh
└── internal/
    ├── server/                # HTTP 层（Server struct, chi 路由注册, 请求生命周期）
    │   ├── server.go              # Server + New() + Router() + handleChatCompletions/handleStream/handleEmbeddings
    │   ├── protocol_handlers.go   # /v1/messages (Claude) / /v1beta/.../generateContent (Gemini) / /v1/responses
    │   ├── protocol_config.go     # GATEWAY_INBOUND_CLAUDE/GEMINI/RESPONSES 开关
    │   ├── mcp_handlers.go        # MCP host 端点（/mcp/registry、/mcp/{server}/streamable-http|sse|messages）
    │   ├── mcp_proxy_handlers.go  # 通用 MCP 反向代理（/v1/mcp/{server_id}/*）
    │   ├── channel_handlers.go    # /internal/channel-stats、/internal/keypool-stats、probe
    │   ├── channel_relay.go        # useChannelRelay() 判定 + 装配 channel/adaptor/keypool/relay
    │   ├── plugin_handlers.go     # /internal/plugins（list、reload、upload）
    │   ├── plugin_chain.go         # Wasm hook 在请求/响应/stream-chunk 前后的调用链
    │   ├── cache_handlers.go      # /internal/cache/{reload,evict}
    │   ├── cache_integration.go   # 缓存命中后回放 SSE 的包装
    │   ├── budget_integration.go  # 预算校验 + 调用后结算
    │   ├── crossborder_integration.go  # 跨境数据驻留校验
    │   ├── rbac_integration.go    # Scope 检查（workspace:chat 等）
    │   ├── trace_context.go       # Trace-id/Step 头部 → identity
    │   ├── health.go              # /healthz, /readyz
    │   └── init_cache.go          # 装配 cache.Service（可选 Redis L1+L2）
    ├── config/config.go       # YAML 配置（HTTPAddr、Models[]、PolicyManifest、AuditDir）+ env 覆盖
    ├── routing/decision.go    # Decider：admin 覆盖 → header 覆盖 → YAML 查表 → 默认
    ├── runtimeconfig/runtimeconfig.go  # 轮询 admin-console providers JSON（5s）；ResolveByModel() → ResolvedRoute
    ├── adaptor/               # 各 vendor 协议 adaptor（OpenAI shape in → vendor wire out）
    │   ├── adaptor.go             # Adaptor 接口
    │   ├── factory.go / factory_for.go  # Factory: openai|claude|gemini|azure|bedrock
    │   ├── openai.go / claude.go / gemini.go / azure.go / bedrock.go
    │   ├── sigv4.go               # AWS SigV4 签名
    │   ├── errors_map.go / metadata.go / stubs.go
    ├── inbound/               # vendor 协议 → OpenAI ChatCompletionRequest 翻译（claude/gemini/responses）
    ├── outbound/              # OpenAI 响应 → vendor 协议（claude/gemini/responses）
    ├── transform/             # tools_mapping、reasoning_effort、thinking-mode 归一化
    ├── openai/                # 共享 OpenAI 请求/响应类型 + 流式 reasoning 状态
    ├── provider/              # 旧路径"单 provider"直连（非 channel relay）
    │   ├── provider.go            # ChatProvider 接口
    │   ├── openai_http.go         # OpenAICompatibleProvider（env-key 回退链 → mock）
    │   └── mock.go                # 无 key 时回 mock
    ├── channel/               # 租户级 channel pool + LB + 健康检查
    │   ├── registry.go            # 从 channels.json 或 admin URL 加载，5s 重载；synthesizeFromProviders 向后兼容 providers.json
    │   ├── types.go               # Channel{BaseURL, APIKey, KeyRefs, Weight, Priority, SupportedModels}
    │   ├── picker.go              # Picker, StatsStore（LRU 统计）, AffinityStore（粘性）
    │   ├── lb_policy.go           # LBPolicy: weight / latency_aware / prefix_cache（fnv hash 粘性）
    │   └── probe.go               # Prober：周期 + on-demand 健康探测
    ├── keypool/pool.go        # 每 channel 多 key 轮转，401/429/5xx 后冷却
    ├── relay/executor.go      # 选 channel → adaptor.Call → 双层重试（defaultMaxRetries=2, cooldown=30s），返回 Attempts
    ├── quota/                 # token quota、RPM/TPM/RPD/RPW/RPM/并发、MCP 限速、预算告警
    │   ├── tracker.go             # Tracker（文件 或 PG-backed usage）；remote 10s 缓存
    │   ├── limiter.go / limiter_backend.go  # 内存 limiter
    │   ├── limiter_redis.go       # 分布式 redis limiter（fixed-window Lua 脚本）
    │   ├── budget.go / budget_alert_reporter.go  # cost & token 预算 + 告警写 PG
    │   ├── ledger.go / remaining.go / request_count.go / token_window.go / check_request.go
    ├── billing/service.go     # Reserve/Settle/Rollback 包装 quotaTracker（流式专用）
    ├── metering/              # 用量上报 sink（jsonl 或 PG usage_records）+ pricing 表加载
    │   ├── reporter.go            # PG reporter（INSERT usage_records）
    │   ├── sink.go                # Sink 接口 + FileSink
    │   ├── pricing.go / pricing.yaml / pricing_loader.go  # PricingTable + 10s 热加载
    │   ├── trace_reporter.go      # 多步 trace usage 回写
    │   └── usage_normalizer.go
    ├── audit/                 # 防篡改审计日志（blake2b prev_checksum 链）
    │   ├── writer.go              # FileWriter（jsonl + 链）+ Event/Digest/PolicyHit 类型
    │   ├── writer_iface.go        # EventWriter 接口
    │   ├── dual_writer.go         # File + Postgres 双写
    │   ├── pg_writer.go           # pgx INSERT gateway_audit_events
    │   ├── backfill.go            # 启动时把孤儿 file 事件回灌 PG（默认 7 天，GATEWAY_AUDIT_BACKFILL_DAYS）
    │   └── pending.go             # 背压队列
    ├── cache/                 # L1 LRU + L2 语义相似度缓存
    │   ├── service.go             # Service：Lookup / Write 协调（LayerL1/L2/None）
    │   ├── store.go / store_memory.go / store_redis.go
    │   ├── l2.go                  # 语义索引（cosine 阈值）
    │   ├── key.go / entry.go / replay.go / admin_config.go / config.go
    ├── auth/                  # JWT 以外的鉴权（PAT、session scope、吊销）
    │   ├── pat.go                 # PATVerifier（DB 查 + 内存 TTL cache）
    │   ├── session_grant.go       # SessionGrantStore（短期临时 scope）
    │   └── revocation.go          # PATRevocationStore（从 admin 拉哈希列表）
    ├── residency/             # 数据驻留 / 跨境判定
    │   ├── store.go               # ComplianceStore（每租户 policy 快照）
    │   └── judge.go               # JudgeRequest → allow / block / require_approval
    ├── mcp/                   # MCP **proxy**（转发到外部 MCP server + 审计 + 限速）
    │   ├── handler.go             # httputil.ReverseProxy + quota + audit
    │   ├── registry.go / loader.go / parse.go
    ├── mcphost/               # MCP **host**（网关自己说 MCP：echo / openapi backends）
    │   ├── host.go                # Host 编排（resolve + quota + policy + audit + backends）
    │   ├── protocol.go            # JSON-RPC 2.0 + initialize/list/call
    │   ├── transport.go / transport_sse.go  # Streamable-HTTP / SSE 传输
    │   ├── backend.go / backend_echo.go / backend_openapi.go / openapi_loader.go
    │   ├── registry.go            # ServerRecord（pgx-backed）
    │   ├── scopes.go              # CanListTools / CanCallTool
    │   └── types.go
    ├── wasmhost/              # 进程内插件链（wazero + 原生内置）
    │   ├── manager.go             # 发现 / 加载 / 按优先级排序 / fsnotify 热重载
    │   ├── runtime.go             # wazero Runtime 包装
    │   ├── loader.go              # Manifest（yaml）+ Scope / WasmSpec / NativeSpec
    │   ├── types.go               # Plugin 接口（5 hook 点）+ HookContext
    │   └── builtin.go             # KeywordRewrite, AuditTagger, WAFBasic, BearerExtractor
    ├── observability/         # Prometheus 指标 + Pyroscope 剖析
    │   ├── metrics.go             # agx_gateway_ttft_seconds / tokens_per_second / cache_hits / channel_health / active_streams / upstream_error / agx_plugin_* / http_*
    │   └── pyroscope.go           # 可选连续剖析
    ├── database/              # PG(pgx) + MySQL 双方言 DB 句柄（DATABASE_DIALECT）
    │   ├── config.go / dialect.go / handle.go / rebind.go / errors.go
    ├── gwerrors/fingerprint.go  # 错误指纹聚合（/internal/errors）
    └── gatewayinternal/http.go  # HTTPGet 辅助（Bearer token, IsHTTPURL）拉 admin internal API
```

## 请求流（handleChatCompletions 标准生命周期）

`server.go` 的 `Server` 结构体编排一切。`New(cfg, logger)` 装配：database handle（可选 PG/MySQL）、metering sink（PG reporter 或 jsonl 回退）、trace reporter、runtimeconfig loader（5s admin 轮询）、quota tracker、policy engine（snapshot 或 manifest glob，热重载）、audit writer（file 或 file+PG 双写 + backfill）、cache service、MCP host & proxy、channel relay、wasm manager、observability registry、budget alert reporter。

**`handleChatCompletions`（`server.go:663`）是标准请求生命周期**：

1. **身份**（`identityFromRequest`）：`agx-pat-*` 走 `PATVerifier`（DB 查 + TTL cache），其余走 RS256 JWT（issuer `agenticx-enterprise-web-portal`，audience `agenticx-web-users`，env `AUTH_JWT_PUBLIC_KEY`，强制 `typ=access`）
2. **scope 检查**：`hasEffectiveScope(r, identity, "workspace:chat")`，PAT 命中时 `NoteUsed`
3. **路由决策**：`decider.Decide(r, model)` → `Decision{Route, Provider, Endpoint, APIKey, Model, ChannelID}`
4. **跨境合规**：`enforceCrossBorder` 基于 `DataResidency` claim + 租户 policy 决定 allow/block/require_approval
5. **wasm 请求 hook**：`runWasmRequestHooks` 可短路返回（命中即写 audit 后 return）
6. **配额+预算闸门**：`runChatQuotaGate` 预占 tokens，`billingService.ReleaseContext` defer 兜底
7. **缓存查找**：`tryServeFromCache` 命中即回放 SSE/JSON
8. **policy 前置**：`evaluatePolicy(latestUserText, "request")` —— 仅扫最后一条 user 消息（`latestUserMessageContent`），避免历史 PII 污染整轮；block 写 audit + 返回 `90001`；redact 替换最后一条 user content
9. **执行**：`useChannelRelay()` 为真走 `handleChatCompleteRelay`（`relay.Executor`），否则 `provider.Complete`
10. **policy 后置**：`evaluatePolicy(responseContent, "response")`，block 返回 `90002`，redact 替换；再 `applyResponseFieldPolicy` 做字段级脱敏
11. **wasm 响应 hook**：`transformChatResponseJSON`
12. **写缓存 + 审计 + 上报 usage**：`writeChatCache` + `writeAuditEvent` + `reportUsageDetailed` + `reconcileQuotaUsage`

**`handleStream`（`server.go:1060`）结构相同，但 policy 与 metering 每 chunk 增量执行**：`push` 回调内对合并后的 `delta.Content` 调 `evaluatePolicy(merged, "response")`，命中即 `policy blocked stream chunk` 并截断；流式结束 `billingService.SettleContext(reserved, actual)` 对账，错误 `RollbackContext`。

### 策略三通道（核实）

| 通道 | 触发点 | 代码位置 |
|---|---|---|
| **请求前置** | `evaluatePolicy(latestUserText, makeEvalContext(identity, "request"))` | `server.go:741` |
| **响应后置** | `evaluatePolicy(responseContent, makeEvalContext(identity, "response"))` + `applyResponseFieldPolicy` | `server.go:835` / `server.go:870` |
| **流式 per-chunk** | `evaluatePolicy(merged, makeEvalContext(identity, "response"))` 在 `push` 回调内 | `server.go:1107` |

## 核心组件分析

### routing 包（`routing/decision.go`）

`Decider.Decide(r, model)` 返回 `Decision{Route, Provider, Endpoint, APIKey, Model, ChannelID}`，决策优先级：**admin runtimeconfig `ResolveByModel` → `x-agenticx-provider` / `x-agenticx-route` 请求头 → YAML `Models[]` 查表 → `DefaultRoute`**。三种路由：`local`（本机 / edge-agent / Ollama）/ `private-cloud`（私有云上游）/ `third-party`（公有 LLM）。

### adaptor + provider（两路并存）

1. **旧路径：直连 `provider.OpenAICompatibleProvider`** —— 用 `Decision.Endpoint` + `Decision.APIKey` 直连；env-key 回退链：`<PROVIDER>_API_KEY` → `LLM_API_KEY` → mock
2. **新路径：`relay.Executor` 中继**（`useChannelRelay()` 为真时启用，`channel_relay.go:18`）—— `channel.Picker.PickWithPrefix` 选 channel → `keypool.Pool` 拿 key → `adaptor.Factory.For(ch)` 返回 `OpenAIAdaptor`/`ClaudeAdaptor`/`GeminiAdaptor`/`AzureAdaptor`/`BedrockAdaptor` 之一；**双层重试**（`executor.go`）：外层 `IsChannelRetryable` 决定换 channel（`defaultMaxRetries=2`，`cooldown=30s`），内层 `IsKeyRetryable` 决定换 key（401/403/429/5xx、net error、超时）

### channel + keypool

- `channel.Registry` —— 租户级 channel 快照，5s 重载（`registry.go:22`）；`synthesizeFromProviders` 把 admin providers 自动合成单 Channel（向后兼容 `providers.json`）
- `channel.Picker` —— LB 策略（`lb_policy.go`）：`weight` / `latency_aware`（InverseLatencyWeight）/ `prefix_cache`（fnv hash 前缀粘性，默认 4 条消息）；支持 affinity 粘性
- `channel.Prober` —— 周期 + on-demand 健康探测
- `keypool.Pool` —— 每 channel 多 key 轮转，失败后冷却

### cache 包（两层，`cache/service.go`）

- **L1 精确匹配 LRU**（`store_memory.go` 内存或 `store_redis.go` Redis）
- **L2 语义相似度**（`l2.go` cosine 阈值匹配 prompt 向量）
- `Service.Lookup` 返回 `LookupResult{Layer: LayerL1|LayerL2|LayerNone}`；遵循 per-model allow-list；`replay.go` 从缓存的 stream entry 重构 SSE chunks

### quota + billing

- `quota.Tracker`（`tracker.go`）—— 多维度限制：`MonthlyTokens` / `DailyTokens` / `WeeklyTokens` / `TPM` / `RPM` / `MaxConcurrency` / `ToolCallsPerMinute` / `RequestsPerDay/Week/Month`；remote URL 10s 缓存（`tracker.go:369`）
- `quota.RedisLimiter`（`limiter_redis.go`）—— 分布式限流（fixed-window Lua 脚本，key 前缀 `agx-gateway-rl:`，60s 窗口），Redis 不可用时回退 in-process
- `quota.BudgetAlertReporter` —— 预算告警写 PG
- `billing.Service` —— **Reserve/Settle/Rollback 三段式**：流式开始前 `ReserveContext` 估算配额，结束时 `SettleContext(reserved, actual)` 对账（返回 `Delta`），错误 `RollbackContext`——解决流式 token 数估算偏差

### audit 包（防篡改，`audit/writer.go`）

`audit.Event` 字段非常宽：tenant / user / model / route / channel / channel_key_ref / tokens / latency / policy hits / cache layer / MCP 字段 / 跨境字段 / 插件链 / **blake2b prev_checksum 链**。

- **哈希链实现**（`writer.go:124`）：`blake2b.Sum512(prevChecksum + "|" + rawEvent)`，截取前 64 hex 字符（256-bit）作为 `Checksum`；首条事件 `PrevChecksum = "GENESIS"`；`ChecksumVersion = "v2"`
- `FileWriter` —— 按日 `audit-YYYYMMDD.jsonl` 落盘 + 哈希链
- `DualWriter` —— File + Postgres 双写
- `pg_writer.go` —— pgx INSERT `gateway_audit_events` 表
- `backfill.go` —— 启动时把孤儿 file 事件回灌 PG（默认 7 天，`GATEWAY_AUDIT_BACKFILL_DAYS`），保证最终一致

### mcp + mcphost（双模 MCP）

- **`mcp` = MCP 代理模式**（`mcp/handler.go`）：`Handler` 是 `httputil.ReverseProxy`，重写 auth header，调 quota，响应后写审计；10min 超时
- **`mcphost` = MCP host 模式**（`mcphost/host.go`）：网关自己说 MCP（Streamable-HTTP + SSE 两种传输）；`BackendEcho` 是 demo，`BackendOpenAPI` 自动从 OpenAPI 3 spec **推导出 MCP tools**；每工具配额 + 工具参数 policy 评估 + 审计；`Registry` pgx-backed

### wasmhost 包（插件链，`wasmhost/`）

- `Manager` 在 root dir 下发现 manifests，加载 wazero Wasm 模块和原生 builtins，`fsnotify` 热重载（`manager.go:97`）
- 原生 builtins（`builtin.go`）：`KeywordRewritePlugin`、`AuditTaggerPlugin`、`WAFBasicPlugin`、`BearerExtractorPlugin`
- `Plugin` 接口 5 个 hook 点（`types.go:46`）：`OnRequestHeaders` / `OnRequestBody` / `OnResponseHeaders` / `OnResponseBody` / `OnStreamChunk`
- 插件失败自动 disable，不影响主流程

### residency + auth

- `residency.ComplianceStore` + `judge.go` —— 基于 `DataResidency` claim + 租户 policy 决定 `allow` / `block` / `require_approval`
- `auth.PATVerifier` —— `agx-pat-*` token，DB 查询 + TTL cache（`GATEWAY_PAT_CACHE_TTL` 默认 5s）
- `SessionGrantStore` —— 短期临时 scope
- `PATRevocationStore` —— 从 admin 拉哈希列表（近实时吊销）

### observability + metering

- `observability.Registry`（`metrics.go`）Prometheus 指标：`agx_gateway_ttft_seconds` / `agx_gateway_tokens_per_second` / `agx_gateway_cache_hits_total` / `agx_gateway_cache_lookups_total` / `agx_gateway_channel_health` / `agx_gateway_active_streams` / `agx_gateway_upstream_error_total` / `agx_plugin_invocations_total` / `agx_plugin_errors_total` / `agx_plugin_latency_seconds` / `agx_gateway_http_requests_total` / `agx_gateway_http_request_duration_seconds`
- 可选 Pyroscope 连续剖析
- `metering.Reporter`（`reporter.go`）写 `UsageRecord` 到 PG `usage_records` 表，回退 `FileSink` jsonl

## 外部依赖与集成点

**Go 依赖**（`go.mod`）：`chi/v5` · `golang-jwt/jwt/v5` · `jackc/pgx/v5` · `go-sql-driver/mysql` · `redis/go-redis/v9` · `prometheus/client_golang` · `tetratelabs/wazero` · `fsnotify` · `golang.org/x/crypto/blake2b` · `gopkg.in/yaml.v3` · `google.golang.org/protobuf` · `alicebob/miniredis/v2`（测试）。

**本地 replace**：`github.com/agenticx/enterprise/policy-engine → ../../packages/policy-engine`（`go.mod:42`）。

**数据库**：`database/` 包支持 **PostgreSQL（pgx）与 MySQL 双方言**（`dialect.go`，`DATABASE_DIALECT` env 控制，默认 postgres）。PG 表：`usage_records`（metering）、`gateway_audit_events`（audit，与 IAM CRUD 用的 `audit_events` **分表**）、PAT / session_grants / compliance。Redis：分布式限流、cache L1/L2。本地 `.runtime/` jsonl：优雅降级兜底。

**与 admin-console 的内部集成**（通过 `GATEWAY_INTERNAL_TOKEN` Bearer 鉴权的 HTTPS GET，`gatewayinternal/http.go`）：

| 环境变量 | 用途 | 刷新 |
|---|---|---|
| `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | 哈希 diff 热重载 policy | 5s（`GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL`） |
| `GATEWAY_REMOTE_PROVIDERS_URL` | 等价 `providers.json` | 5s |
| `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | 等价 `quotas.json` | 10s |
| `GATEWAY_REMOTE_PRICING_CONFIG_URL` | 计价快照 | 10s |
| `GATEWAY_REMOTE_BUDGET_CONFIG_URL` | 成本/词元预算 | 10s |
| `GATEWAY_REMOTE_PAT_REVOCATION_URL` | 吊销 hash 列表 | 按需 |
| `GATEWAY_REMOTE_SESSION_GRANTS_URL` | 会话临时 scope | 按需 |
| `GATEWAY_REMOTE_COMPLIANCE_URL` | 数据驻留 / 跨境策略 | 按需 |
| `GATEWAY_REMOTE_CHANNELS_URL` | channel 列表 | 5s |

**上游 LLM provider**：OpenAI、DeepSeek、Moonshot (Kimi)、Anthropic Claude Messages、Google Gemini、Azure OpenAI、AWS Bedrock (SigV4)、自托管 OpenAI 兼容（Ollama、edge-agent）。

**入站鉴权**：RS256 JWT（issuer `agenticx-enterprise-web-portal`，audience `agenticx-web-users`，`AUTH_JWT_PUBLIC_KEY`）+ PAT tokens（`agx-pat-*` 前缀）。

## 显著的设计模式

| 模式 | 体现 |
|---|---|
| **Adaptor 模式** | `adaptor.Adaptor` 接口统一 vendor 协议；OpenAI 请求形状是规范的内部模型，`inbound/outbound/transform` 在边界翻译 Claude/Gemini/Responses |
| **两层执行路径并存** | 旧 `provider.ChatProvider` 直连 vs 新 `relay.Executor` + `channel.Picker` + `keypool.Pool`；都产出相同的 `openai.ChatCompletionResponse` |
| **Middleware/Hook 链** | wasm 插件通过 5 个 hook 点（`OnRequestHeaders/Body`、`OnResponseHeaders/Body`、`OnStreamChunk`）执行；policy engine 在前置/per-chunk/后置三阶段评估 |
| **全栈热重载** | policy、providers、channels、quotas、pricing、budgets、PAT 吊销、session grants、compliance —— 全部 fsnotify 或 5-10s 轮询，无需重启 |
| **优雅降级** | 每个外部依赖可选：无 PG → file sink；无 Redis → 内存 limiter；无 key → mock；无 remote URL → 本地 JSON；无 Pyroscope env → 跳过 |
| **防篡改审计链** | 每个 `Event` 携带 `prev_checksum` + `checksum`（blake2b-512 截 256-bit），首条 `GENESIS`，支持事后完整性校验 |
| **Reserve/Settle 配额对账** | 流式开始 `ReserveContext` 预占，结束 `SettleContext(reserved, actual)` 对账，错误 `RollbackContext`——解决流式 token 数估算偏差 |
| **Channel + Key 两级重试** | `IsChannelRetryable` / `IsKeyRetryable` 区分 401/429/5xx vs net error vs 不可重试（cancel / idle timeout）|
| **多协议入站** | 同一内部管线服务 OpenAI chat/embeddings、Claude Messages、Gemini generateContent (流+非流)、OpenAI Responses API —— 在入站边界翻译，由 `GATEWAY_INBOUND_*` 开关按需启用 |

## 与 admin-console / policy-engine 的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/admin-console` | 配置源（snapshot 拉取）| admin 是网关运行时配置的**唯一源头**；网关 5-10s 轮询其 `/api/internal/*`；admin 发布的 `policy-snapshot.json` 默认落 `enterprise/.runtime/admin/`，网关 `DefaultBudgetConfigPath` 等相对 `../../.runtime/admin/` 读取 |
| `apps/web-portal` | 间接 | portal 通过 admin 控制网关；其 SSO JWT 由网关验证；portal `/api/chat/completions` 反向代理时填 `x-agenticx-provider` 头 |
| `apps/edge-agent` | 上游（local route）| 默认 `local` 路由指向 `http://127.0.0.1:11434/v1`（Ollama 风格）；edge-agent Go 单二进制当前是 skeleton，**网关侧未硬接 edge-agent sidecar** |
| `packages/policy-engine` | Go 包 replace 引入 | 嵌入在网关进程内做 PII / 敏感词 / 字段级脱敏；**不嵌入 LiteLLM**，上游模型调用走 Go 标准库 `net/http` 的 OpenAI 兼容客户端 |
| `plugins/moderation-*` / `plugins/wasm-*` | 策略规则 / wasm 插件 | policy 通过 manifest glob 装载；wasm 由 `wasmhost.Manager` 装载 |

**策略快照路径一致性**（重要排障点）：admin 发布的 `policy-snapshot.json` 默认在 `enterprise/.runtime/admin/`；网关进程读到的是否为**同一路径**取决于默认配额根（`quota.DefaultBudgetConfigPath` 等相对 `../../.runtime/`）。若误指仓库根 `.runtime` 会导致网关长期空快照、表现为「规则已保存/发布但前台仍不拦截」。

## 当前能力矩阵（v 当前）

| 能力 | 状态 |
|---|---|
| OpenAI 兼容 chat / embeddings | ✅ |
| 多 vendor adaptor（OpenAI/Claude/Gemini/Azure/Bedrock + SigV4） | ✅ |
| 多协议入站（Claude Messages / Gemini generateContent / Responses，按 env 开关） | ✅ |
| 三路由决策（local/private-cloud/third-party） | ✅ |
| Channel + KeyPool + 双层重试 + 健康探测 + LB（weight/latency_aware/prefix_cache） | ✅ |
| L1 内存/Redis + L2 语义缓存 + SSE 回放 | ✅ |
| Wasm 插件链（wazero + 4 原生 builtin，5 hook 点，fsnotify 热重载） | ✅ |
| MCP host（Streamable-HTTP/SSE + OpenAPI 推导 tools）+ MCP proxy | ✅ |
| Policy engine 字段级脱敏 + RBAC scope | ✅ |
| 防篡改审计链（blake2b-512→256）+ File+PG 双写 + backfill | ✅ |
| 跨境数据驻留判定（allow/block/require_approval） | ✅ |
| 多维度配额（tokens/RPM/TPM/RPD/RPW/RPM/并发/MCP 限速）+ Redis 分布式限流 | ✅ |
| Reserve/Settle/Rollback 流式预算对账 | ✅ |
| PAT + Session Grant + 近实时吊销 | ✅ |
| Prometheus 指标 + Pyroscope 连续剖析 | ✅ |
| 全栈热重载（fsnotify + 5-10s 轮询 admin internal API） | ✅ |
| 优雅降级（无 PG/Redis/key 均可工作） | ✅ |
| PG + MySQL 双数据库方言 | ✅ |

## 诚实缺口（据代码核实）

1. **policy-engine 规则种类有限**：`packages/policy-engine/types.go:5` 仅定义 4 种 `RuleKind` —— `keyword` / `regex` / `pii` / `field`，**不含 `keyword-list`**；Go `loader.go` 的 `Extends` 字段是**单字符串**（`types.go:43`），自定义 manifest 用数组会反序列化失败或只取首项。
2. **PII 基线仅 5 类**：`engine.go:192` 的 `baselinePIIRegex` 只覆盖 `mobile` / `email` / `id-card` / `bank-card` / `api-key`。**"17 种密钥检测"仍留在 AgenticX Python 框架，未进 Go 网关**——客户方案中如需完整密钥扫描，需明确这不在网关侧。
3. **文本 Evaluate 不处理 field 规则**：`engine.go:75` 的 `EvaluateWithContext` 只 switch `keyword/regex/pii`；`field` 规则需经 `fields.go:25` 的 `EvaluateJSONFields` 单独入口（`server.go` 的 `applyResponseFieldPolicy` 已正确分流调用）。
4. **README 部分内容陈旧**：`README.md:9` 称审计写 "ClickHouse / 本地文件"，但实际代码写 PG `gateway_audit_events`（或 jsonl），**无 ClickHouse 集成**；`README.md:15` 称 "Go 1.22+"，`go.mod:3` 实为 `go 1.25.0`。
5. **edge-agent 侧未硬接**：默认 `local` 路由指向 Ollama 风格的 `http://127.0.0.1:11434/v1`；`packaging/edge-agent` Go 单二进制是空壳 skeleton，网关进程内**没有**专门对接 edge-agent sidecar 的代码路径，描述端侧闭环时宜用「本地后端服务」等中性措辞。
6. **配额维度以租户/角色/模型为主**：`quota/Config` 支持 `users` / `departments` / `apiTokens` map，但 admin-console「额度控制」页仍偏查询展示；按部门/用户级 TPM/QPM/并发**真正限流落地**需独立 plan，不可在客户对接中口头承诺「已支持」。
