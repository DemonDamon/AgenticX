---
name: ""
overview: ""
todos: []
isProject: false
---

# Enterprise Gateway：AI 语义缓存 + Cache Token 分价计费 + AI 深度可观测

- **Plan-Id**: 2026-05-21-enterprise-gateway-ai-cache-observability
- **Plan-File**: `.cursor/plans/2026-05-21-enterprise-gateway-ai-cache-observability.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-21
- **关联背景**:
  - [Higress AI Cache 插件](https://higress.cn/plugin/ai-cache/) —— 语义缓存 + 精确缓存
  - [new-api Cache billing](https://github.com/QuantumNous/new-api) —— OpenAI prompt cache / Claude / DeepSeek 缓存 token 分价计费
  - [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) / [OpenAI prompt caching](https://platform.openai.com/docs/guides/prompt-caching)
  - 关联 plan：`2026-05-19-channel-relay`（usage 字段已就位）、`keypool-quota-pat`（计费维度）

## 1. 背景与定位

### 1.1 为什么是缓存 + 可观测

new-api 与 Higress 在"省钱"和"看得清"两件事上的能力是企业客户最容易感知的价值：

| 能力 | 客户价值 |
|---|---|
| **L1 精确缓存** | 相同 prompt 直接命中，零上游 token 成本，毫秒级返回 |
| **L2 语义缓存** | 相似 prompt（embedding sim ≥ 阈值）命中，节省 60–80% 重复查询 |
| **Cache token 分价计费** | OpenAI / Claude / DeepSeek prompt cache token 单价远低于普通 token，必须按真实计价反映给客户 |
| **TTFT / TPS / first-token / cache-hit-rate** | AI 特有 SRE 指标，对客户演示与排障价值极高 |
| **Channel 健康 + 上游错误指纹** | 客户运维感能力 |

我们现状：基础审计有 `total_tokens`，但不区分 `cached_tokens` / `cache_creation_input_tokens`；无缓存层；指标只有 latency 一个。

### 1.2 现状盘点

| 模块 | 现状 | 涉及文件 |
|---|---|---|
| 计量 | `usage.total_tokens / prompt / completion` 三字段；按 model 单价 | `enterprise/apps/gateway/internal/metering/` |
| 配额 | `tokens / requests` 二维 | `quota/tracker.go` |
| 流式审计 | 仅最终 usage 写一次 | `audit/writer.go` |
| 指标 | 仅 Prometheus 基础 HTTP latency | `server/metrics.go`（如有） |
| 缓存 | 无 | — |

## 2. 目标与非目标

### 2.1 目标（FR）

- **FR-1 L1 精确缓存**：以 `sha256(canonical(req)) + tenant_id + model + relevant_params` 为 key 缓存上游完整响应（含 stream 拼接结果）；Redis 优先，无 Redis 时单进程 LRU；TTL 默认 1h、可配；命中跳过上游调用，直接重放（流式按原始 chunk 间隔回放或 "全量一次性"，可配）。
- **FR-2 L2 语义缓存**（可选 / 默认关闭）：对启用的 channel/model 走 embedding 相似度匹配，sim ≥ `cache_semantic_threshold`（默认 0.92）命中；embedding 由独立 channel 提供（`bge-large` / `text-embedding-3-small` 等，admin 配置）；命中策略 `nearest` / `weighted-nearest`。
- **FR-3 Cache token 分价计费**：metering 与 usage 扩展为多维：
  ```
  usage = {
    prompt_tokens, completion_tokens,
    cached_tokens,                        // OpenAI prompt cache hit
    cache_creation_input_tokens,          // Claude cache write
    cache_read_input_tokens,              // Claude cache hit
    reasoning_tokens,                     // o1 / thinking 模型
  }
  pricing = {
    input, output,
    cached_input,
    cache_creation, cache_read,
    reasoning_output (optional)
  }
  cost = Σ tokens × unit_price
  ```
  - `metering/pricing.yaml` 加 cache_* 价格字段；缺省与 input/output 取等价回退
- **FR-4 缓存命中审计**：审计事件加 `cache_layer`（none / L1 / L2 / upstream-cache）、`cache_key_hash`、`semantic_similarity`（L2 时）；命中事件 `latency_ms_upstream=0`、`latency_ms_total` 仍记。
- **FR-5 Prometheus AI 指标导出**：新增系列：
  - `agx_gateway_ttft_seconds{model, channel, inbound_protocol}` Histogram
  - `agx_gateway_tokens_per_second{model, channel}` Histogram
  - `agx_gateway_cache_hits_total{layer}` Counter
  - `agx_gateway_cache_lookups_total{layer, result}` Counter
  - `agx_gateway_channel_health{channel, status}` Gauge（含 cooldown）
  - `agx_gateway_active_streams{model}` Gauge
  - `agx_gateway_upstream_error_total{channel, reason}` Counter
- **FR-6 Grafana Dashboard**：提供 JSON dashboard（`enterprise/docs/observability/grafana-ai-gateway.json`），含 6 面板：QPS / TTFT p50p95p99 / TPS / Cache hit ratio / Channel health / Top error reasons。
- **FR-7 Admin 缓存管理 UI**：admin-console `/admin/cache` 页：开关、TTL、阈值、按 model 白/黑名单、L2 embedding channel 选择、人工驱逐特定 key（按 prefix）。
- **FR-8 Admin 计费页 cache 维度**：现有 `/admin/metering` 表头追加 `cached_tokens / cache_read / cache_creation` 三列；导出 CSV 含 cache 维度；客户账单按 cache 单价档实际折算。
- **FR-9 Anthropic `cache_control` 透传**：入站 Claude Messages 时遵守 `cache_control` 标签，转 OpenAI pivot 时保留为 `__cache_control` 注解，出站到 Claude 上游恢复（直通）；上游 usage 的 `cache_*` 字段忠实回写计费链。

### 2.2 非功能（NFR）

- **NFR-1 默认安全**：L1 默认开启但 TTL 仅 5 分钟、且 **system 含 PII / 工具调用产生副作用** 的请求自动 bypass（按可配规则）；L2 默认关闭，由 admin 显式开启。
- **NFR-2 私有化友好**：L2 embedding 可走本地 Ollama 或私有部署 bge；不强制公网 API。
- **NFR-3 性能**：L1 lookup ≤ 1ms（Redis pipeline）；L2 lookup ≤ 50ms（向量近邻搜索）；命中后端到端总耗时 ≤ 20ms。
- **NFR-4 计费一致**：上游若返回 `cached_tokens`，必须以上游为准；网关 L1/L2 命中产生的"虚拟 usage"按 input 单价的 `cache_layer_discount_ratio`（默认 0.1）折算并清晰标注 `usage.source=gateway_cache`。
- **NFR-5 指标低开销**：Prometheus collector 全在请求生命周期内同步采样，无单独 goroutine 池；总开销 ≤ 50µs/请求。

### 2.3 验收（AC）

- **AC-1**：相同 query 重发，第二次审计 `cache_layer=L1`、`latency_ms_upstream=0`、`usage.source=gateway_cache`；客户账单显示对应 cache 折算行。
- **AC-2**：L2 开启，"今天北京天气如何" 与 "北京今天天气怎样" sim ≥ 0.92，第二次命中 L2；admin UI 显示 `semantic_similarity=0.94`。
- **AC-3**：OpenAI 上游返回 `prompt_tokens_details.cached_tokens=1200`，metering 落库分行展示，计费按 `cached_input` 单价；admin CSV 含该字段。
- **AC-4**：Claude 上游返回 `cache_creation_input_tokens=500 / cache_read_input_tokens=1500`，metering 与计费同步落库。
- **AC-5**：Grafana 导入 dashboard JSON，6 面板均出图；模拟 50 并发流压测，TTFT p95 < 2s（按 mock 上游配置）。
- **AC-6**：缓存关闭（`GATEWAY_CACHE_L1=off`），所有用例行为退回今日基线；审计 `cache_layer=none`。
- **AC-7**：单测覆盖 `cache/key_test.go`（canonical 包含 messages/tools/temperature 等）、`cache/repeat_test.go`（流式回放）、`metering/pricing_cache_test.go`、`observability/metrics_test.go`。

### 2.4 非目标（明确不做）

- ❌ **不**做"用户级缓存共享 vs 隔离"复杂治理（默认 tenant + user 双隔离）。
- ❌ **不**做"缓存预热"（warm-up）/ 离线批量灌入。
- ❌ **不**做端到端 Tracing（OpenTelemetry 追踪是独立 plan；本 plan 只做 metrics）。
- ❌ **不**做"按 prompt 模板压缩"（如 prompt compression）等正交优化。
- ❌ **不**强制上线 L2 语义缓存——客户场景敏感（误命中风险），默认关闭。

## 3. 架构设计

### 3.1 缓存层时序

```
client → handler
  ├── auth / policy.Evaluate(request)
  ├── cache.LookupL1(canonical) ── hit ──▶ replay + audit(cache_layer=L1) ──▶ return
  │                                  miss
  ├── [optional] cache.LookupL2(embedding) ── hit ──▶ replay + audit(cache_layer=L2)
  │                                                miss
  ├── channel.Pick → adaptor.Stream
  ├── (collect chunks; on success) cache.WriteL1 / WriteL2
  └── audit(cache_layer=none, usage with cached fields)
```

### 3.2 包结构

```
enterprise/apps/gateway/internal/
├── cache/                       ★ 新包
│   ├── key.go                   canonical key 计算（messages/tools/temperature/stream-irrelevant 字段剔除）
│   ├── store_redis.go
│   ├── store_memory.go          LRU + ttl
│   ├── replay.go                stream chunks 回放
│   ├── l1.go
│   └── l2.go                    embedding similarity（向量库可选 chroma / qdrant / 简易倒排）
├── metering/                    现有，扩展
│   ├── pricing.go               + cached_input / cache_creation / cache_read 价格
│   └── usage_normalizer.go      ★ 把不同上游 usage 形态归一
├── observability/               ★ 新包
│   ├── metrics.go               Prometheus collectors
│   ├── ttft.go                  首 token 时间观测中间件
│   └── grafana/                 dashboard JSON
└── server/server.go             chain 编排
```

### 3.3 Canonical Key 算法

```
canonical(req) = sha256( JSON_sorted({
  model_resolved (after reasoning-effort strip),
  messages (role+content+tool_calls 规整),
  tools, tool_choice, temperature, top_p, top_k,
  max_tokens, stop, response_format,
  // 排除：stream, user, metadata, idempotency_key, …
}) )
```

不同 inbound 协议先归一到 pivot 再计算，确保跨协议命中。

### 3.4 上游 usage 归一表

| 上游 | 字段映射 |
|---|---|
| OpenAI | `prompt_tokens_details.cached_tokens → cached_tokens` |
| Anthropic | `cache_creation_input_tokens` / `cache_read_input_tokens` 原样保留 |
| DeepSeek | `prompt_cache_hit_tokens → cached_tokens` |
| Gemini | `cachedContentTokenCount → cached_tokens` |
| 其他 | 不写 cache 字段 |

## 4. 实施分期

| 阶段 | 周期感 | 交付物 | 前置 |
|---|---|---|---|
| **P0 L1 精确缓存** | 1.5 周 | `cache/` 包 + Redis/Memory store + 流回放 + handler 接线 | — |
| **P1 Usage 归一 + Pricing 扩展** | 1 周 | `usage_normalizer.go` + `pricing.yaml` cache 字段 + metering 落库 | P0 |
| **P2 Prometheus + Grafana** | 1 周 | TTFT/TPS/cache/channel-health 指标 + dashboard JSON | P0 |
| **P3 Admin 缓存 + 计费 UI** | 1 周 | `/admin/cache` + `/admin/metering` cache 列 + CSV 导出 | P0/P1 |
| **P4 L2 语义缓存** | 1.5 周 | embedding lookup + admin 开关 + 私有 embedding channel 接入 | P0 |
| **P5 Anthropic cache_control 透传** | 0.5 周 | 与协议 plan 联调 | 多协议 plan P0 |

总周期 ~6.5 周。可与 MCP / 多协议 plan 并行（P5 待协议 plan）。

## 5. 测试与验证

- **单测**：`cache/key_test.go`（包含字段顺序、stream 字段排除）、`cache/replay_test.go`（流式回放等价性）、`metering/usage_normalizer_test.go`（4 家上游 fixture）、`observability/metrics_test.go`
- **集成**：`cache/integration_test.go` 双命中 + 回放等价 + cache 命中时不调上游
- **AC 性能**：`scripts/perf-cache.sh`：L1 命中 ≤ 5ms，L2 命中 ≤ 60ms
- **L2 安全**：`cache/l2_safety_test.go` 验证敏感 PII 类请求 bypass
- **Grafana**：手工导入截图归档至 `enterprise/docs/observability/screenshots/`

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| L2 误命中（语义相近但答案不同） | 默认关闭；阈值默认严格 0.92；admin 可设白/黑名单 model；命中时审计带 `semantic_similarity` 供事后审 |
| 缓存导致工具调用副作用丢失 | 含 `tools` 且 `tool_choice != "none"` 的请求自动 bypass L1/L2（含工具调用副作用） |
| Stream 回放节奏失真 | 配置 `replay_mode = real-time` / `burst`；默认 `burst`（一次性 flush，省时） |
| 上游 cache token 字段格式变化 | `usage_normalizer.go` 每家上游独立处理 + fixture 单测保护 |
| 缓存 key 泄漏导致跨租户串台 | key 必含 `tenant_id`，无 `tenant_id` 请求拒缓存 |
| Prometheus 高基数标签 | 仅 `model / channel / inbound_protocol / status` 等低基；禁止 user_id 入标签 |

**回退**：缓存以 `GATEWAY_CACHE_L1=off` / `_L2=off` 关闭；指标以 `GATEWAY_METRICS=off` 关闭；行为完全等价今日。

## 7. 与对照对象的能力对齐

| Higress AI Cache | 本 plan |
|---|---|
| 精确缓存 | ✅ FR-1 |
| 语义缓存 + embedding | ✅ FR-2 |
| 流式回放 | ✅ FR-1 replay |
| 多模型支持 | ✅（按 model 白名单） |

| new-api Cache billing | 本 plan |
|---|---|
| OpenAI cached_tokens 分价 | ✅ FR-3 |
| Claude cache_creation/read 分价 | ✅ FR-3 |
| DeepSeek prompt_cache_hit_tokens | ✅ FR-3 |
| Token 整数币 / 充值 | ❌（沿用 token + 月配额） |

## 8. 文档与归档

- `enterprise/docs/runbooks/ai-cache.md`（运维：开关、阈值、驱逐）
- `enterprise/docs/observability/README.md`（指标定义、Grafana 导入指南）
- `enterprise/docs/architecture/cache-and-pricing.md`（canonical key + usage 归一 + pricing 算法）
- `docs/guides/cache-billing.md`（客户：节省成本演示 + 计费口径）

## 9. 待澄清问题

1. **L1 stream 回放节奏**：默认 `burst` 一次性 flush vs 按原始 chunk 间隔回放？建议默认 burst（用户体验近"瞬时"，更突出"节省"价值）；admin 可配。
2. **L2 向量库选型**：Chroma / Qdrant / 简易倒排（内置）？建议默认走 admin 配置的 Chroma（已是 Machi KB 同款），无需新组件。
3. **Anthropic cache_control 是否影响我们 L1 key 计算**？建议 L1 仍按 canonical（与 cache_control 无关）；上游若有 cache hit，usage 字段忠实计费即可。

---

**Made-with: Damon Li**
