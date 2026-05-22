# Enterprise Gateway：Key Pool + 多维度配额 + API Token (PAT)

- Plan-Id: 2026-05-19-enterprise-gateway-keypool-quota-pat
- Plan-File: `.cursor/plans/2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md`
- 起草：2026-05-19
- 修订：2026-05-22（对齐已完成的 Channel-Relay 实现）
- 作者：Damon Li
- Status: **Revised – Channel Relay ✅ 已落，本 plan 接力 Key 级 failover + 多维配额 + PAT 三件事**
- 关联背景：[`cx/大模型代理服务和虚拟ApiKey技术方案.md`](../../cx/大模型代理服务和虚拟ApiKey技术方案.md)、[`cx/README.md`](../../cx/README.md)

## 0. 2026-05-22 修订说明（先读这段）

距首版 plan 起草已过 3 天，期间 [`2026-05-19-enterprise-gateway-channel-relay.plan.md`](2026-05-19-enterprise-gateway-channel-relay.plan.md) 已全量落地（commit `27166b0` + `30862d0`）。本 plan 的原始设计与最新代码出现以下偏差，统一在此修订：

| 原设计 | 现状/修订 |
|--------|-----------|
| 单独的 `provider_key_pool` PG 表 + `/admin/keypool` 管理页 | **删除**。Key 作为 Channel 的子属性，通过 `gateway_channels.metadata.keyRefs` 承载；管理 UI 并入 `/admin/channels` 编辑页 |
| 改造 `provider/openai_http.go` 做 Key 切换 | **改在 `relay/executor.go`**——主路径已切到 Relay；`provider/openai_http.go` 不再是热点 |
| `internal/provider/keypool/` 完整包结构（`static.go`/`pg_loader.go`/`picker.go`） | **简化为** `internal/keypool/pool.go` 演进（已有 `Resolve` / `MarkUnhealthy` 骨架，未接线）；加 cooldown TTL + 调用接线即可 |
| `quota_rules` 独立 PG 表 | rules 配置仍走 `enterprise_runtime_token_quotas.config` JSON（schema 扩 `tpm/rpm/maxConcurrency`），runtime 计数器走 Redis/内存（不入 PG） |
| 审计字段 `provider_key` | **改名 `channel_key_ref`**，与 Channel 命名空间对齐 |
| AC-1 用双 env 自动发现切 Key | **改为** 管理员在 `/admin/channels` 同一 Channel 配 `metadata.keyRefs=["DEEPSEEK_API_KEY_1","DEEPSEEK_API_KEY_2"]` 后验证 |

PAT 设计（§5.1 `api_tokens` + §6 Phase 3）**完全保留**，是新实体且有 hash/lookup 热路径，必须独立建表。

---

## 1. 背景与定位

`cx/` 下中移互运营商版（`yun-ai-mq-member` + `yun-ai-api-llm`）已经把「LLM 反代 + 虚拟 ApiKey」打通；架构师方案文档真正有价值的不是「虚拟 Key」本身，而是它背后的 **多上游 Key 池 + 计费/限流/审计** 三件事。

`enterprise/apps/gateway` 当前已经具备 OpenAI 兼容代理、JWT 四主体身份、策略评估、Blake2b 哈希链审计、租户级配额；但仍缺三块能力，恰好是 cx 方案里的核心点：

1. **Key Pool / 多上游 Key + 自动降级**：当前 `OpenAICompatibleProvider` 一个 provider 一把 `<PROVIDER>_API_KEY`，单 Key 触发上游限流后无退路。
2. **部门 / 用户级 + token-based 配额**：`quota/tracker.go` 仅按 `users / departments / role` 月 token 做硬上限，未支持 TPM / QPM / 并发，admin-console 上也没有部门/用户级精细化设置。
3. **企业 API Token（PAT）**：让客户的**业务系统/IDE 客户端**用 `Bearer agx-pat-xxx` 直连网关；当前只有浏览器 JWT 会话，对 M2M 接入不友好。

本 plan **不**搬迁 cx 的 mq-member + OpenClaw K8s 链路（运营商 2C 形态，与 enterprise 2B 私有化场景错位）。

## 2. 目标与非目标

### FR（功能性需求）

- **FR-1 Key Pool**：单个 provider 支持配置多把上游 Key；按健康状态 + 剩余配额做轮询/加权选择；命中上游 429/5xx 进入 cooldown 自动降级。
- **FR-2 多维度配额**：在 `tenant / dept / user / api_token` 四个 scope 上分别支持 `monthly_tokens`、`tpm`（tokens-per-minute）、`rpm`（requests-per-minute）、`max_concurrency` 四种限制；命中后按 `Action`（block/warn/fallback）处置。
- **FR-3 API Token (PAT) 管理**：admin-console 提供「API Token」Tab；管理员可代发，普通用户可在 web-portal「个人中心」自行创建/吊销；网关 `Authorization: Bearer agx-pat-...` 鉴权链路打通。
- **FR-4 PAT 维度计费**：审计与 token 用量按 `api_token_id` 也写入维度字段；admin-console 计费页可按 PAT 维度筛选。
- **FR-5 配置可视化**：admin-console 提供 Key Pool 健康看板（key 命中次数、cooldown 状态、最近错误）与四维度配额设置 UI。

### NFR（非功能性需求）

- **NFR-1 安全**：PAT 落库存 SHA-256（或 Argon2id） hash，明文仅在创建时返回一次；前缀 `agx-pat-` 便于扫码识别与误用检测；支持 `expire_at` 与「上次使用时间」回填。
- **NFR-2 性能**：Key Pool 选择与配额检查必须在 ≤ 1ms 内完成（内存 + Redis），避免拖慢 SSE 首 token；TPM 限流用滑动窗口或 token-bucket，单实例并发安全。
- **NFR-3 私有化部署友好**：所有新增依赖（如 Redis）须支持「无 Redis 时降级为单实例本地内存」模式，不强制客户拉中间件。
- **NFR-4 灰度兼容**：未配置多 Key 时退回单 Key 现状行为；未创建 PAT 时浏览器 JWT 链路完全不受影响。

### AC（验收标准）

- **AC-1**：在 `/admin/channels` 把 deepseek-chat channel 的 `metadata.keyRefs` 配为 `["DEEPSEEK_API_KEY_1","DEEPSEEK_API_KEY_2"]`，让 _1 返回 401，连续 10 次请求不报错；审计事件 `channel_key_ref` 字段显示 _2 接管，编辑页健康灯显示 _1 进入 cooldown。
- **AC-2**：admin-console 新建一条「dept=研发, tpm=10000」规则，对该部门用户压测，超过即返回 `policy:quota:tpm_exceeded`；规则改为 `warn` 后压测可通过但响应头带 `X-AgenticX-Quota-Warn`。
- **AC-3**：在 web-portal「个人中心 → API Tokens」新建一条 PAT，复制 `agx-pat-...`，用 curl 直接调 `/v1/chat/completions` 成功；admin-console 计费页能按该 PAT 维度过滤出本次调用。
- **AC-4**：吊销 PAT 后 5 秒内（含网关缓存 TTL）调用返回 401 `auth:pat_revoked`；审计事件写入哈希链。
- **AC-5**：禁用 Redis 启动 gateway，FR-1/FR-2 仍可用（单实例语义），日志打印 `quota: redis disabled, falling back to in-process limiter`。

### 非目标（明确不做）

- ❌ 不引入 RocketMQ / Kafka 做异步签发（cx 是为 2C 海量开通做的，私有化用不上，PAT 同步签发即可）。
- ❌ 不做 OpenClaw / K8s 自动部署相关能力。
- ❌ 不为浏览器登录用户额外签发"虚拟 ApiKey"——浏览器侧已有 JWT 会话，再发一层冗余。
- ❌ 不替换现有 `gateway_audit_events` / `audit_events` 表结构，只新增字段。
- ❌ 不修改 cx 仓库；cx 维持现状，本 plan 不耦合其代码。

## 3. 现状盘点（关键文件，2026-05-22 修订）

| 模块 | 现状 | 涉及文件 |
|------|------|----------|
| **Channel + Relay**（新增） | ✅ 多上游 Channel、加权选择、Channel 级 cooldown、失败重试已落地；`metadata.keyRefs` / `metadata.keyPoolId` 字段已就位 | `enterprise/apps/gateway/internal/{channel,relay,adaptor}/`、`packages/db-schema/src/schema/gateway-channels.ts` |
| **Key Pool 骨架** | ⚠️ `pool.go` 有 `Resolve` / `MarkUnhealthy`，但 `MarkUnhealthy` **未被任何代码调用**；无 cooldown TTL；`relay/executor.go` 在 401 时 `IsRetryable=false` 直接返回，**不会切下一把 Key** | `enterprise/apps/gateway/internal/keypool/pool.go`、`relay/executor.go` |
| **Adaptor 接口** | OpenAI 完整实装；Claude/Gemini stubs | `internal/adaptor/{openai.go,stubs.go}` |
| 配额 | `tenant / users / departments / role` 月 token，单进程内存；rules 持久化在 `enterprise_runtime_token_quotas.config` JSON | `internal/quota/tracker.go`、`packages/db-schema/src/schema/runtime-config.ts` |
| 鉴权 | JWT RS256，四主体 (`tenant/dept/user/session`) | `internal/server/server.go`、`packages/auth/` |
| 审计 | PG 主写 `gateway_audit_events` + JSONL 兜底 + Blake2b 链；已有 `channel_id` / `attempts` 字段 | `internal/audit/` |
| Admin UI | 已有 `iam / policy / audit / metering/quota / admin/channels`；`/admin/channels` 编辑页可承载 Key 管理 | `apps/admin-console/src/app/` |
| Portal UI | 已有 `auth / workspace`，无「个人 → API Tokens」 | `apps/web-portal/src/app/` |

## 4. 总体架构（2026-05-22 修订，对齐 Channel-Relay）

```
                     ┌──────────────────────────────────────────────┐
                     │              admin-console (UI)              │
                     │  /admin/api-tokens                           │
                     │  /admin/channels（编辑页含 keyRefs + 健康灯） │
                     │  /metering/quota（升级为四维度）              │
                     └──────────────────────────────────────────────┘
                            │ REST                  │ REST
                            ▼                       ▼
                     ┌──────────────┐    ┌────────────────────────────┐
   web-portal ─────▶│ PG: api_tokens│    │ PG: gateway_channels       │
   (个人 PAT 管理)   │ (新建)        │    │   enterprise_runtime_      │
                    └──────────────┘    │   token_quotas (扩 TPM/RPM) │
                                        └────────────────────────────┘
                            ▲                       ▲
                            │                       │
   client ─────▶ gateway ───┴───────────────────────┘
   (Bearer JWT     │   1. auth:   JWT or PAT (sha256 lookup, LRU 60s)
    or PAT)        │   2. quota:  api_token > user > dept > tenant
                   │              (rpm/tpm/concurrency/month, Redis optional)
                   │   3. route:  Channel.Picker(model, identity)
                   │   4. key:    keypool.Resolve(channelID, channel.keyRefs)
                   │   5. retry:  on 401/429/5xx → keypool.MarkUnhealthy(channelID, keyRef)
                   │              → 同 Channel 内换下一把 Key 重试
                   │              → 仍失败 → Channel.Picker 换 Channel
                   │   6. audit:  追加 api_token_id / channel_key_ref 字段
                   └────────▶ Upstream (OpenAI/DeepSeek/百炼/Moonshot ...)
```

**关键变化**：Key Pool 不再是与 Channel 平行的概念，而是 **Channel 内部的子层**（同一 Channel 可绑多把 Key）；重试链是 **「Key 内重试 → Channel 间重试」** 两段式。

## 5. 数据模型变更（2026-05-22 修订）

### 5.1 新增表：`api_tokens`（唯一新建表）

```sql
CREATE TABLE api_tokens (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       VARCHAR(26)  NOT NULL,
  user_id         VARCHAR(26)  NOT NULL,            -- 归属用户
  dept_id         VARCHAR(26),
  name            VARCHAR(128) NOT NULL,
  token_hash      VARCHAR(128) NOT NULL UNIQUE,     -- sha256(明文)；明文仅创建时返回一次
  token_prefix    VARCHAR(20)  NOT NULL,            -- agx-pat-xxxx（前 12 位明文，用于面板回显）
  scopes          JSONB        NOT NULL DEFAULT '[]',
  status          VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active / revoked / expired
  expire_at       TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  created_by      VARCHAR(26)  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_tokens_tenant_user ON api_tokens(tenant_id, user_id);
CREATE INDEX idx_api_tokens_status      ON api_tokens(status);
```

> **新建 schema 文件**：`enterprise/packages/db-schema/src/schema/api-tokens.ts`，drizzle migration 走 `packages/db-schema/drizzle/`。

### 5.2 扩展 `gateway_channels.metadata`（承载 Key Pool）

不新建 `provider_key_pool` 表。Channel 已有的 `metadata jsonb` 扩展约定字段（schema 只是约定，不需 DDL 变更）：

```jsonc
{
  "keyRefs": ["DEEPSEEK_API_KEY_1", "DEEPSEEK_API_KEY_2"],  // 环境变量名列表
  "keyPoolId": "deepseek-prod",                              // 可选：跨 Channel 共享 cooldown 状态
  "keyWeights": { "DEEPSEEK_API_KEY_1": 100, "DEEPSEEK_API_KEY_2": 50 }  // 可选
}
```

`channel.APIKey`（cipher）依然存在，作为「单 Key 简写」与 `keyRefs` 互斥（运行时优先级：`APIKey > keyRefs`）。

### 5.3 扩展 `enterprise_runtime_token_quotas.config`（承载四维度配额）

config JSON schema 扩展：

```jsonc
{
  "defaults": {
    "role": { "admin": { "monthlyTokens": 1500000, "tpm": 100000, "rpm": 1000, "maxConcurrency": 10, "action": "warn" } },
    "model": { ... }
  },
  "users":       { "<userId>":      { "monthlyTokens": ..., "tpm": ..., "rpm": ..., "maxConcurrency": ..., "action": "block" } },
  "departments": { "<deptId>":      { ... } },
  "apiTokens":   { "<apiTokenId>":  { ... } }    // 新增第四维度
}
```

**配置走 JSON**，**runtime 计数器走 Redis（可选）/ 单进程 sliding window**：

| 计数器 | 后端 | 备注 |
|--------|------|------|
| `monthlyTokens` | 已有 `quota-usage.json` + Redis（如配置） | 沿用现状 |
| `tpm` / `rpm` | Redis `INCR + EXPIRE` 滑窗 lua / 单实例内存环形 | 无 Redis 时仅单实例语义 |
| `maxConcurrency` | Redis `SET NX EX` / 单实例 semaphore | 同上 |

### 5.4 扩展 `gateway_audit_events`（drizzle migration）

```sql
ALTER TABLE gateway_audit_events
  ADD COLUMN IF NOT EXISTS api_token_id     BIGINT,
  ADD COLUMN IF NOT EXISTS channel_key_ref  VARCHAR(128);
```

> 字段命名 `channel_key_ref`（不是首版 plan 写的 `provider_key`），与 Channel 命名空间对齐。

## 6. 实现拆解（2026-05-22 修订，按阶段提交）

### Phase 0 — 准备 / 共识（0.5d）

- [ ] **T0.1**：本文 plan 修订版与用户对齐（命名、表结构、Phase 拆分）
- [ ] **T0.2**：在 `enterprise/docs/gateway/` 新增 `keypool-pat-overview.md` 简介，给客户技术对接用

### Phase 1 — Key 级 failover（P0，~1.5d，小改）

> 目标：在已落地的 Channel-Relay 之上，**同一 Channel 内**多把 Key 自动切换；不新增管理页，仅 `/admin/channels` 编辑页加 Key 输入与健康灯。

- [ ] **T1.1** `internal/keypool/pool.go` 演进：
  - 新增 `cooldownTTL`（默认 60s）；`MarkUnhealthy` 写入 `cooldownUntil` 时间戳；`Resolve` 时跳过未过期、清理已过期项
  - 计入 `consecutiveFailures` 计数，连续 ≥3 次失败才进入 cooldown，避免单次抖动误杀
  - 暴露 `Stats(poolID) []KeyStat` 供 admin UI 健康灯查询
- [ ] **T1.2** `internal/relay/executor.go` 接线：
  - 在 `Complete` / `Stream` 失败分支识别 `UpstreamError.StatusCode ∈ {401, 403, 429, 5xx}`
  - 调用 `keypool.MarkUnhealthy(channel.ID, currentKeyRef)`，**同一 Channel 内**重试下一把 Key（最多 `len(keyRefs)-1` 次）
  - 仍失败再走原有 Channel 间重试链
  - **流式重试约束**：仅在首 token 之前允许切 Key；已出 token 直接报错，不重试
  - `resolveKey` 需返回选中的 `keyRef` 以便审计与 `MarkUnhealthy`（当前 `Resolve` 只返回 key 值）
- [ ] **T1.3** 审计事件追加 `channel_key_ref`（环境变量名，不写明文 Key）
  - `audit/writer.go` 增字段；`gateway_audit_events` schema migration（§5.4）
- [ ] **T1.4** `/admin/channels` 编辑页加：
  - 「Key Refs」多输入框（逗号分隔的 env 名）
  - 每把 Key 的健康灯（active / cooldown / 最近错误） + 「重置 cooldown」按钮
  - 后端走 `apps/admin-console/src/lib/gateway-channels-store.ts` + 新增 `/api/admin/channels/:id/keypool/stats`
- [ ] **T1.5** 单测：`internal/keypool/pool_test.go` 覆盖 cooldown TTL、连续失败阈值、并发安全；`relay/executor_test.go` 增 mock 上游 401 切 Key 用例

**Commit 1** ｜ `feat(gateway): wire key-level failover within channel with cooldown TTL`

### Phase 2 — 四维度配额（P0，~4d）

- [ ] **T2.1** Go：`internal/quota/` 扩展（**不重写**）
  - `rule.go`：`Rule { MonthlyTokens, TPM, RPM, MaxConcurrency, Action }`（向后兼容仅 monthlyTokens 的旧配置）
  - `limiter.go`：`SlidingWindow`（TPM/RPM）+ `Semaphore`（并发）；Redis 后端 + 单进程内存 fallback；Redis 用 `INCR + EXPIRE` + 滑窗 lua
  - `tracker.go`：四 scope 优先级 `api_token > user > dept > tenant`，第一个命中即终止
- [ ] **T2.2**：限流命中返回 `policy:quota:{tpm|rpm|concurrency|monthly}_exceeded`，响应头 `X-AgenticX-Quota-Used` / `-Limit` / `-Reset`
- [ ] **T2.3**：`enterprise_runtime_token_quotas.config` schema 扩展（§5.3）；`apps/admin-console/src/lib/token-quota-store.ts` 适配新字段；`/api/metering/quota` 输入输出兼容
- [ ] **T2.4**：admin-console `/metering/quota` 改 tabs：租户 / 部门 / 用户 / **PAT**；每行编辑 monthly/TPM/RPM/并发/action
- [ ] **T2.5**：单测：滑窗精度、并发安全、Redis 失联降级到内存

**Commit 2** ｜ `feat(gateway): add tpm/rpm/concurrency quota across tenant/dept/user/pat scopes`

### Phase 3 — API Token (PAT)（P1，~6d）

- [ ] **T3.1** drizzle schema：`packages/db-schema/src/schema/api-tokens.ts` + migration（§5.1）
- [ ] **T3.2** `packages/auth/src/services/pat-service.ts`：`create / verify(hash) / revoke / list`；`verify` LRU 缓存 60s，吊销时 publish invalidate
- [ ] **T3.3** Go gateway 鉴权中间件分轨：
  - `Bearer eyJ...`（JWT）→ 现有逻辑
  - `Bearer agx-pat-...`（PAT）→ 调 `internal/server` 的 PAT verify client（HTTP 调 admin-console 的 internal API，或直连 PG）→ 反查 `tenant/dept/user`，构造与 JWT 等价的 `AuthContext`
  - 其它 → 401 `auth:pat:invalid_format`
- [ ] **T3.4** admin-console `/admin/api-tokens` 页面：列表（按租户/用户筛选）、创建（**明文仅本次返回**，强提示复制）、吊销、查看最近使用；scope `admin:api_tokens:write`
- [ ] **T3.5** web-portal「个人中心 → API Tokens」：用户自助创建/吊销自己的 PAT；不可见他人 PAT
- [ ] **T3.6** 审计事件加 `api_token_id`；`/metering` 计费页加 PAT 维度筛选
- [ ] **T3.7** `last_used_at` 异步回写（每 60s flush，仅 PAT 真正命中时记录）
- [ ] **T3.8** 安全：创建写 `auth:pat:create`、吊销写 `auth:pat:revoke`；任何 5xx 不回吐 token 明文；强制 `expire_at` 默认 90 天
- [ ] **T3.9** 文档：`enterprise/docs/gateway/api-tokens.md`（用户视角 + 客户对接 curl 样例）

**Commit 3** ｜ `feat(enterprise): personal access token (PAT) for gateway`

### Phase 4 — 端到端验收（~1d）

- [ ] **T4.1** `enterprise/scripts/e2e-visual-tour.ts` 补 `/admin/api-tokens`、`/metering/quota`（含 PAT tab）、`/admin/channels` 编辑页 keypool 健康灯三处截图（dark + light）
- [ ] **T4.2** 压测脚本 `enterprise/scripts/load-test-keypool.ts`：mock 上游 401/429，验证 Key Pool 切换有效率 ≥ 95%
- [ ] **T4.3** `start-dev-with-infra.sh` 跑全链路冒烟：浏览器 JWT + PAT curl + TPM 限流命中
- [ ] **T4.4** 录制 GIF 放 PR 描述

**Commit 4** ｜ `test(enterprise): e2e and load tests for keypool + pat + quota`

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| **PAT 明文泄露** | 仅创建时一次性回吐、库内只存 hash、前缀 `agx-pat-` 便于 GitHub secret scan、强制 `expire_at` 默认 90 天 |
| **Key Pool 切 Key 时流式已经出过 token** | 仅在「首 token 之前」允许重试；已出 token 报错并 markUnhealthy 但不重试，避免重复内容 |
| **Redis 单点** | 所有限流/缓存须有 in-process fallback；Redis 失联降级为「单实例语义」并打告警日志 |
| **PG 迁移失败** | 迁移用 `IF NOT EXISTS`，且 quota 仍可从 JSON 启动；提供回滚脚本 |
| **PAT 缓存 TTL 导致吊销延迟** | TTL 60s 可接受；admin-console 显式吊销时主动 `INVALIDATE` Redis key（pubsub） |
| **Key Pool 健康判定误杀** | cooldown 默认 60s，连续 3 次失败才进 cooldown；admin UI 可手动 reset |
| **多实例并发计数偏差** | TPM/RPM 用 Redis 的 INCR + 滑窗 lua 脚本；并发用 `SET NX EX`；无 Redis 时仅单实例近似 |
| **PG 写 `last_used_at` 抖动** | 每 60s 批量 flush，且仅在 PAT 真正命中时记录 |

## 8. 与现有 Plan 的关系

- **前置**：[`2026-05-19-enterprise-gateway-channel-relay.plan.md`](2026-05-19-enterprise-gateway-channel-relay.plan.md) ✅ 已落（2026-05-21）。本 plan 在其 Channel/Adaptor/Relay 框架之上做 Key 级 failover、Quota 扩维与 PAT 鉴权，**不重写 Channel 选择/重试链**。
- 接力 [`2026-05-04-gateway-audit-production.plan.md`](2026-05-04-gateway-audit-production.plan.md)：本 plan 仅在审计事件上**新增字段**（`api_token_id` / `channel_key_ref`），不重写写入链路、不破坏 Blake2b 链。
- 与 `policy-rule-center_181c93c7.plan.md` 协作：策略命中 `block` 仍优先于配额；配额是「计量层」，策略是「合规层」。
- **下游依赖**：本 plan 的 PAT (Phase 3) 是 [`2026-05-21-enterprise-gateway-mcp-hosting.plan.md`](2026-05-21-enterprise-gateway-mcp-hosting.plan.md) 的硬依赖；Quota 多维度（Phase 2）是 AI Cache plan 计费维度的复用项。
- 不与 cx 仓库耦合：cx 维持单仓现状。

## 9. 工作量估算

| Phase | 人天 | 关键交付 |
|-------|------|----------|
| 0 | 0.5 | plan/文档/对齐 |
| 1 Key 级 failover | **1.5** | Executor 接线 + cooldown TTL + Channel 编辑页 Key 健康灯（**比首版省 1d**：删 `/admin/keypool` 页 + 不新建 PG 表） |
| 2 配额四维度 | 4 | TPM/RPM/并发 + 扩展 token_quotas.config + UI tabs |
| 3 PAT | 6 | 新建 `api_tokens` 表 + PatService + 网关双轨鉴权 + admin/portal UI |
| 4 验收/压测 | 1 | e2e + GIF |
| **合计** | **~13d** | — |

## 10. 验收脚本（参考）

```bash
# Key Pool 故障切换（修订：通过 admin-console /admin/channels 编辑页配 keyRefs）
export DEEPSEEK_API_KEY_1=sk-bad
export DEEPSEEK_API_KEY_2=sk-good
# 在 /admin/channels 编辑 deepseek-chat 的 channel，metadata.keyRefs = ["DEEPSEEK_API_KEY_1","DEEPSEEK_API_KEY_2"]
pnpm --filter @apps/gateway dev
for i in $(seq 1 10); do
  curl -s -H "Authorization: Bearer $JWT" http://localhost:8787/v1/chat/completions \
    -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}' | jq .id
done
# 期望：全部 200，/admin/channels 编辑页显示 KEY_1 cooldown、KEY_2 命中 10 次；审计事件 channel_key_ref 字段可见

# PAT 直连
TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/api-tokens \
  -H "Cookie: $ADMIN_COOKIE" -d '{"name":"ci-bot","expireDays":30}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/chat/completions \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'

# TPM 限流
# 在 admin-console 给当前用户配 tpm=100，循环发 1000-token 请求，第 2 次应被拦
```

## 11. 提交规范

- 所有相关 commit 均按 [`AGENTS.md`](../../AGENTS.md) 与 `.cursor/rules/plan-management.mdc`：
  - 走 `/commit --spec=.cursor/plans/2026-05-19-enterprise-gateway-keypool-quota-pat.plan.md`
  - trailer 含 `Plan-Id` / `Plan-File` / `Made-with: Damon Li`
- 每个 Phase 独立 commit，先 `pnpm -w typecheck && pnpm -w build` 绿后再进下一段
- 完成后用 `/update-conclusion --plan=...` 维护 conclusion

---

## 附录 A：为什么不照搬 cx 的「虚拟 ApiKey」

| 维度 | cx (2C 运营商) | enterprise (2B 私有化) | 取舍 |
|------|----------------|----------------------|------|
| 用户基数 | 千万级，靠 MQ 异步签发 | 几千~几万，CRUD 同步即可 | enterprise 不引入 MQ |
| 客户画像 | 终端 C 端消费者 | 客户的员工 + 系统 | enterprise 用 JWT + PAT 双轨而非"每人一把虚拟 Key" |
| 计费维度 | 按用户月权益 | 按租户/部门/用户/PAT 多维 | enterprise 四维度配额更细 |
| 部署形态 | 平台托管 | 私有化 + SaaS | enterprise 必须 Redis-optional |
| Key 存储 | 库里明文 + AES | 库里 hash（PAT），上游 Key 走 env/secret | enterprise 安全更严 |

## 附录 B：命名与前缀约定

- PAT 明文格式：`agx-pat-` + 32 位 base62（如 `agx-pat-8e79F28d9s78K908z76B89v87n89m78P`）
- `token_prefix` 字段存前 12 位（`agx-pat-8e79`）用于 UI 展示
- 不使用 cx 的"虚拟 ApiKey"中文术语；中文 UI 统一为「API Token」
