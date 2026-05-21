# Enterprise Gateway：Channel + Relay/Adaptor + 预扣结算

- **Plan-Id**: 2026-05-19-enterprise-gateway-channel-relay
- **Plan-File**: `.cursor/plans/2026-05-19-enterprise-gateway-channel-relay.plan.md`
- **Owner**: Damon Li
- **Status**: Draft
- **创建日期**: 2026-05-19
- **关联背景**:
  - 调研对象：[QuantumNous/new-api](https://github.com/QuantumNous/new-api)（AGPLv3，34k★，自 One API 演进）
  - 上游协议参考：[`docs/thrdparty/newapi-chat接口.md`](../../docs/thrdparty/newapi-chat接口.md)、[`docs/thrdparty/newapi-补全接口.md`](../../docs/thrdparty/newapi-补全接口.md)
  - 仓内同期 plan（互补、不重叠）：
    - [`2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md`](2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md) —— 多 Key + 部门/用户级配额 + PAT
  - 兄弟实现参考：`cx/yun-ai-api-llm`（虚拟 Key + 策略选真实 Key + 流式代理，Java 侧已验证）
  - 现状：`enterprise/apps/gateway/internal/routing/decision.go` 仅按 `model→provider` 一对一选择；`provider/openai_http.go` 单 Key、无重试、无加权。

## 1. 背景与定位

### 1.1 为什么不直接集成 new-api

new-api 在「多上游聚合 / 协议广度 / 计费运营」上是行业头部参考，但**整库集成会引入不可接受的技术债**：

| 风险点 | 说明 |
|--------|------|
| AGPLv3 + 署名保护 | `AGENTS.md` Rule 5 强制保留 `new-api`/`QuantumNous` 品牌、模块路径；与 Enterprise Apache 主线冲突 |
| One API 数据库遗产 | `Channel`/`Ability`/`Token`/`User` schema 与我们 PG `gateway_audit_events` + IAM 是两套世界 |
| 三数据库兼容 | 强制 SQLite/MySQL/PG 同时支持，所有 raw SQL 要分支；我们只走 PG 生产 |
| 单体 + 内嵌 Web | `web/default` 自带控制台，与 `admin-console` 重复；i18n、主题、Rsbuild 又一套栈 |
| 协议广度的维护成本 | 30+ `relay/channel/*` 目录，随上游变更持续追改 |
| 与我们 JWT/Policy/Audit 模型不兼容 | new-api 是「自建 User+Token+Quota 整数币」体系，与我们「tenant/dept/user/session/scopes + Blake2b 链」不同源 |

**结论**：**只吸收机制，不吸收实现**。本 plan 用干净室方式在 `enterprise/apps/gateway` 内自研 Channel/Relay/Adaptor，保持 IAM、Policy、Audit 三条护城河不动。

### 1.2 现状盘点（关键文件）

| 模块 | 现状 | 涉及文件 |
|------|------|----------|
| 路由决策 | `Decider.Decide(model)` 出 `Provider+Endpoint+APIKey`，**单上游单 Key** | `routing/decision.go` |
| Provider 调用 | 直连 OpenAI 兼容上游，无重试、无熔断 | `provider/openai_http.go` |
| 模型配置 | admin 写 `providers.json` + `quotas.json` | `runtimeconfig/runtimeconfig.go` |
| 计量 | 上游 usage 一次性记录，无预扣/结算分离 | `metering/{reporter,sink}.go` |
| 流式 | `handleStream` 已三通道策略；缺 idle timeout、超大 chunk buffer | `server/server.go: handleStream` |
| 协议面 | 仅 `/v1/chat/completions` + `/v1/embeddings` | `server/server.go: Router` |

### 1.3 与兄弟 plan 的边界

| 关注点 | 归属 plan |
|--------|-----------|
| 单 provider **多 Key** 健康轮转 / cooldown | **keypool-quota-pat** |
| TPM / RPM / 部门用户精细配额 / PAT | **keypool-quota-pat** |
| **多 Channel**（同一 model 可绑多个 provider+key 集）+ 加权 + 失败重试 + Adaptor 协议扩展 + 预扣结算 | **本 plan** |

**互锁关系**：本 plan 的 `Channel` = `keypool` 的「多 Key 容器」**之上**再叠一层「多 provider 容器」。先落 keypool（FR-1），再落本 plan 的 Channel 选择器，**不并行同改 Provider 接口**，避免冲突。

## 2. 目标与非目标

### 2.1 目标（FR）

- **FR-1 Channel 抽象**：同一逻辑 model（如 `deepseek-chat`）可绑定多个 Channel；每个 Channel 含 `provider_type / base_url / key_pool_ref / weight / priority / status / supported_models[]`。
- **FR-2 加权选择 + 亲和**：默认按 `weight` 加权随机；同一 session/user 在 cooldown 期内尽量命中上一次成功 Channel（affinity）；Channel 全部失败则回退默认 Channel。
- **FR-3 失败重试**：上游 5xx / 429 / 连接错误 → 按 `max_retries`（默认 2）切换 Channel 重试；策略命中类业务错误**不**重试；审计每次重试都记 `attempt_index + channel_id`。
- **FR-4 Adaptor 接口**：抽出 `provider.Adaptor` 接口（`BuildRequest / Stream / Complete / Embeddings`），OpenAI 兼容为首个实现；保留 `Claude` / `Gemini` 占位实现路径，**当期不开放路由**。
- **FR-5 预扣 + 结算计量**：请求进入时按 `estimate_input_tokens + max_tokens` 预扣到内存账本；上游返回真实 usage 后做差额回写/退还；与现有 `quotaTracker` 协同（**不**新造 Quota 货币单位）。
- **FR-6 流式加固**：可配置 `stream_idle_timeout`（默认 60s）、`stream_scanner_max_buffer_mb`（默认 16）；超限返回标准化 SSE error（沿用 `90002` 等 code 规范）。
- **FR-7 admin 渠道页**：admin-console「模型服务」演进为「**Channel 管理**」：list / create / update / disable / 健康面板（最近成功率、p50 latency、cooldown 状态）。

### 2.2 非功能（NFR）

- **NFR-1 零回归**：未配置多 Channel 时，行为与今日单 Channel 完全一致；`providers.json` 兼容现状作为「单 Channel 简写」自动转 Channel。
- **NFR-2 性能**：Channel 选择 ≤ 0.5ms（内存映射 + 加权抽样）；不引入新的 PG/Redis 强依赖（PG 仅用于持久化 channel 配置）。
- **NFR-3 私有化友好**：禁用 Redis 时降级单实例本地 affinity；多实例部署再叠 keypool 的 Redis 状态。
- **NFR-4 协议中立**：内部 DTO 继续以 OpenAI 形态为 pivot；Adaptor 仅在边界做协议翻译。
- **NFR-5 可观测**：审计事件新增 `channel_id / attempt_index / retry_reason / estimated_tokens / actual_tokens / settle_delta` 字段，不破坏 Blake2b 链。

### 2.3 验收（AC）

- **AC-1 Channel 加权**：同 model `deepseek-chat` 配 2 个 Channel（weight 7:3），1000 次请求按 ±5% 偏差分布到两 Channel；admin 健康面板可见命中比。
- **AC-2 失败重试**：杀掉 Channel-A 上游 → 连续 50 次请求全部由 Channel-B 接管，0 个 5xx 返回给前端；审计事件每条含 `attempts=[A→fail, B→ok]`。
- **AC-3 重试边界**：策略 `block` 命中**不**触发重试，仅一次审计；上游 401（auth）也**不**重试，直接透传错误。
- **AC-4 Adaptor 接口落地**：`OpenAIAdaptor` 通过；`ClaudeAdaptor` / `GeminiAdaptor` 有空实现 + 单测占位（返回 `not_implemented`），**不**注册到路由。
- **AC-5 预扣结算**：单次请求实际 usage 比预扣少 30% 时，配额表 `used_total` 回退差额；超出时按 `block/warn/fallback` 三态执行；前台 token chip 与 admin 计量页一致。
- **AC-6 流式加固**：mock 上游推 100MB 单 chunk → 返回 `stream:buffer_exceeded`；mock 上游 stall 90s → 返回 `stream:idle_timeout`；均写入审计。
- **AC-7 兼容回归**：未配置 Channel 表时，启动加载老 `providers.json`，全部接口行为字节级等价（diff 当前 e2e 录像）。

### 2.4 非目标（明确不做）

- ❌ **不**实现 Claude/Gemini 入站路由（`/v1/messages`、`/v1beta/*`）—— Adaptor 接口预留，路由按未来独立 plan 推进。
- ❌ **不**做 OpenAI Responses 入站（`/v1/responses`）—— 本期以 Chat Completions 为 pivot；若未来有明确客户需求再单独立项。
- ❌ **不**做 Realtime / Image / Audio / Rerank / Midjourney / Suno 等任务型协议。
- ❌ **不**引入 new-api 的 Quota 整数币（500_000 = $1）；继续用「Token + 月度配额」语义。
- ❌ **不**做兑换码 / Stripe / EPay 等 C 端运营能力。
- ❌ **不**搬 new-api 控制台前端；admin-console 内增加 Channel 页即可。
- ❌ **不**做三数据库兼容；PG 单库。
- ❌ **不**改 `gateway_audit_events` / `audit_events` 表主结构，仅按 NFR-5 新增可空字段。

## 3. 架构设计

### 3.1 与现有模块的位置关系

```
┌─────────────────────────────────────────────────────────────┐
│  enterprise/apps/gateway (Chi)                              │
│                                                             │
│   handleChatCompletions / handleEmbeddings                  │
│     │                                                       │
│     ├── auth (JWT, RS256)                  现状             │
│     ├── policy.Evaluate(request)            现状（三通道）   │
│     ├── channel.Pick(model, identity)      ★ 新增 FR-1/2   │
│     │     └─ keypool.NextKey(channel)      keypool plan    │
│     ├── billing.PreConsume(estimate)        ★ 新增 FR-5    │
│     ├── relay.Adaptor(channel.ProviderType) ★ 新增 FR-4    │
│     │     └─ OpenAIAdaptor.Stream/Complete                 │
│     ├── retry loop（≤ max_retries）         ★ 新增 FR-3    │
│     ├── policy.Evaluate(response / chunk)   现状           │
│     ├── billing.Settle(actual usage)        ★ 新增 FR-5    │
│     └── audit.Write(channel_id, attempts…) 现状 + 新字段   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 关键数据模型（新增）

新表（PG）：
- `gateway_channels`：`id / tenant_id / name / provider_type / base_url / weight / priority / status / supported_models jsonb / metadata jsonb / created_at / updated_at`
- `gateway_channel_stats`（可选，先内存）：`channel_id / success_count / failure_count / last_error / cooldown_until`

不新建 `channel_keys` 表 —— 由 keypool plan 管理；本 plan 通过 `channel.metadata.key_pool_id` 外引。

### 3.3 选择器算法（伪代码）

```go
func Pick(model string, id Identity) (*Channel, error) {
    cands := registry.ListByModel(model, id.TenantID, "active")
    if len(cands) == 0 { return fallbackByConfig(model) }
    // 1. affinity：在 cooldown 内，命中上次成功
    if last, ok := affinity.Get(id.SessionID, model); ok && healthy(last) {
        return last, nil
    }
    // 2. 加权随机
    return weightedSample(cands), nil
}
```

### 3.4 Adaptor 接口（FR-4）

```go
type Adaptor interface {
    Name() string
    Stream(ctx, req, ch *Channel, push StreamPush) error
    Complete(ctx, req, ch *Channel) (Response, error)
    Embeddings(ctx, req, ch *Channel) (EmbeddingResp, error)
}
// 首批：OpenAIAdaptor（即现有 openai_http.go 重构包装）
// 占位：ClaudeAdaptor / GeminiAdaptor（仅签名 + not_implemented）
```

### 3.5 预扣结算（FR-5）

- 入口估算：`estimate = countMessages(req.Messages) + req.MaxTokens`（已有 `estimateTextTokens`）。
- 调 `quotaTracker.Reserve(identity, estimate)`：超额按现状策略；记 `reservation_id`。
- 上游返回 `usage.total_tokens` → `quotaTracker.Settle(reservation_id, actual)`：差额回写。
- 失败 / 重试：每次重试不重复预扣，结算时按最终 attempt 的 usage 结算。

## 4. 实施分期

| 阶段 | 周期感 | 交付物 | 前置 |
|------|--------|--------|------|
| **P0 Channel + Picker** | 1.5 周 | `gateway_channels` 表 + Registry + 加权选择 + admin Channel CRUD（最小） | keypool FR-1 合入 |
| **P1 Retry + Audit 扩展** | 1 周 | 失败重试、affinity、审计字段 `attempts[]`、Blake2b 链字段兼容 | P0 |
| **P2 Adaptor 重构** | 1 周 | 抽 `Adaptor` 接口；现有 `openai_http.go` 重构为 `OpenAIAdaptor`；空 Claude/Gemini 实现 | P0 |
| **P3 预扣结算** | 1 周 | `Reserve / Settle` 与 quotaTracker 协同；token chip 一致性回归 | P0、keypool FR-2 |
| **P4 流式加固** | 0.5 周 | idle timeout、buffer 上限、标准化 SSE error | 独立 |
| **P5 Admin 健康面板** | 0.5 周 | 命中比 / 成功率 / cooldown 可视化 | P0–P3 |

总周期 ~5 周（含联调与文档），与 keypool plan 串行最稳。

## 5. 测试与验证

- **单测**：`channel/picker_test.go`（加权分布、affinity）、`retry_test.go`（429/5xx vs 401 vs policy block）、`adaptor_openai_test.go`、`billing_settle_test.go`。
- **集成**：`scripts/start-dev.sh` 起 mock 上游 2 个 channel，`scripts/e2e-channel-rotate.sh` 模拟 kill-A 场景。
- **回归**：`enterprise/customers/hechuang/scripts/acceptance-gateway.sh` 全绿（保护和创验收基线）。
- **压测基线**：复用 `enterprise/docs/perf-baselines/`；新增「单 vs 多 Channel」对比截图。
- **审计链校验**：`verify-audit-chain.sh` 在多 attempts 场景下仍连续。

## 6. 风险与回退

| 风险 | 缓解 |
|------|------|
| Channel 模型与 keypool Key 池字段重叠 | 通过 `channel.metadata.key_pool_id` 外引，**不**复刻 keys 字段 |
| 预扣 / 结算与 keypool 限流冲突 | 在 quotaTracker 内串行：`Reserve → keypool.Limit → upstream → Settle` |
| 失败重试放大上游成本 | `max_retries=2` 硬上限 + 同一 cooldown channel 不再重试 |
| Adaptor 抽象过早 | 当期仅 OpenAI 实现真实落地；Claude/Gemini 仅签名占位避免接口反复改 |
| admin 控制台 UX 反复 | Channel 页与现有「模型服务」页**并存一个迭代**，下版本再切；不直接删旧页 |
| 审计字段新增破坏链 | 仅追加 nullable 字段，老事件 hash 输入序列化保持稳定（field order 锁定） |

回退策略：所有新逻辑在 `GATEWAY_CHANNEL_REGISTRY=on` 环境变量下生效；关闭即回到今日 `Decider` 单路径。

## 7. 与 New API 能力对照（明确「学什么 / 不学什么」）

| New API 能力 | 本 plan | 理由 |
|--------------|---------|------|
| Channel + Ability + 加权随机 | ✅ FR-1/2 | 核心运营价值 |
| 失败重试 + 多 Key 轮换 | ✅ FR-3（叠加 keypool） | 核心可用性 |
| Adaptor 工厂 | ✅ FR-4（接口先行） | 为后续 Claude/Gemini 留口 |
| 预扣 / 结算 / 退款 | ✅ FR-5（Token 语义） | 与 Quota 货币解耦 |
| 流式 scanner buffer / idle timeout | ✅ FR-6 | 稳定性 |
| OpenAI⇄Claude⇄Gemini 入站转换 | ❌ 本期 | 等明确客户需求再开 plan |
| Responses / Realtime / Image / Audio | ❌ | 本期非目标；有客户需求再单独立项 |
| Quota 整数币 + 充值 / 兑换码 / Stripe | ❌ | 企业场景无需 |
| User / Token / Group 全套体系 | ❌ | 我们走 JWT + PAT，见 keypool plan |
| 三数据库兼容 | ❌ | PG 单库 |
| 内嵌 React 控制台 | ❌ | 复用 admin-console |
| Midjourney / Suno / Dify 任务型 | ❌ | 非主线 |

## 8. 文档与归档

- 实施过程中：`enterprise/docs/runbooks/gateway-channel-relay.md`（运维侧）。
- 客户对外：`enterprise/customers/<name>/ledger/` 内补一条 Channel 容灾验收项（如适用）。
- 合规保护：**严禁**从 new-api 仓库复制源码 / 注释 / 测试夹具；所有实现走 OpenAI 官方协议文档 + 本仓 `docs/thrdparty/newapi-*.md` 行为描述。

## 9. 待澄清问题（开工前需用户回答）

1. P0 Channel 与现有 `providers.json` 是「在线迁移」还是「双轨并存一段时间」？默认建议双轨。
2. 是否需要把 Adaptor 接口同步暴露到 `cx/yun-ai-api-llm` Java 侧做参考实现？默认否，cx 自治。
3. 预扣结算粒度是「每请求」还是「每 attempt」？默认每请求一次预扣 + 最终一次结算。
4. admin Channel 页是替换还是并列「模型服务」页？默认并列一版本再切。

---

**Made-with: Damon Li**
