# SP3: 合规内容审核（compliance-moderation）

Plan-Id: compliance-moderation
Parent-Plan: plans/security-governance/MASTER-PLAN.md（缺口 G3：合规内容审核空白——策略引擎偏凭据/注入类，涉政/色情/暴恐/广告无规则包、无第三方内容安全 API 适配）
Status: in_progress（2026-11-12）

## 一、探查结论

| 事实 | 位置 |
|---|---|
| 策略引擎规则四类 kind（keyword/regex/pii/field），Rule 带 TenantID/AppliesTo/Severity/Action；`HitEvent` 目前**无类别字段** | `enterprise/packages/policy-engine/types.go:3-80` |
| 网关三向拦截：请求 90001（server.go:895、protocol_handlers.go:151）、非流式响应 90002（server.go:1009）、流式逐块（server.go:1260→1333、protocol_handlers.go:343→409）；流式成功尾在 responseText 组装完成后（server.go:1385、protocol_handlers.go:425）——**第三方 API 的流式落点=流尾** | `gateway/internal/server/server.go`、`protocol_handlers.go` |
| snapshot 热加载：`reloadPolicyIfNeeded()` 每请求 stat mtime（文件）/5s 节流（URL），变更即重建 engine 原子替换——合规规则包发布后自动生效，无需新机制 | `server.go:547-553,594-697` |
| snapshot 规则结构 `snapshotRuleItem{ID,Code,Kind,Action,Severity,Message,Payload,AppliesTo}`，`Payload` 自由 map——**category 可走 payload 零迁移直达引擎**；Go 侧把它提升为一等字段即可 | `server.go:397-415,316-361` |
| **内置规则包播种机制**：`enterprise/plugins/moderation-*/manifest.yaml` → `ensureBuiltinSeed` 逐租户落库为 source=builtin 包（enabled=true，可改不可删，租户可停用=数据可配） | `enterprise/features/policy/src/services/pg-store.ts:208-308`、`mysql-store.ts`（同构）、现有样例 `plugins/moderation-pii-baseline/manifest.yaml` |
| console 规则落库 `payload` 是 jsonb 自由列——`normalizeRulePayload` 重建 payload 时需保留 category；`PolicyTestHit` 测试命中需带 category | `packages/db-schema/src/schema/policy.ts:52`、`features/policy/src/services/pg-store.ts:98-110`、`types.ts:102-111` |
| audit.PolicyHit 目前仅 `{policy_id,severity,action,matched_rule}`——需加 Category | `gateway/internal/audit/writer.go:16-21`、`server.go:1763-1774 toAuditPolicyHits` |
| SP4 告警底座：`Alert{Source,Severity,Title,Summary,TraceID,DedupKey…}` → Dispatcher 去重+限流+发送+落审计；degraded 的 CRITICAL 告警直接复用 | `gateway/internal/alertdispatch/alert.go:6-18`、`dispatcher.go` |
| 配置文件范式（SP4 先例）：console 落盘 `.runtime/admin/*.json` + `GATEWAY_ADMIN_*_FILE` env + 10s 轮询原子快照；通道配置卡片放在审计页 | `alertdispatch/config.go:34-53`、`admin-console/src/lib/alert-channels-store.ts`、`app/audit/alert-channels-card.tsx` |
| 测试基线：server 级接线测试用真实 Server 结构体 + httptest（SP4 `alert_dispatch_wiring_test.go` 范式）；Go 测试需 `GOPROXY=https://goproxy.cn,direct` | `gateway/internal/server/alert_dispatch_wiring_test.go` |

## 二、设计

### A. 合规规则包（数据，租户可配）

新增内置包 `enterprise/plugins/moderation-compliance/manifest.yaml`：四类规则（涉政 politics / 色情 porn / 暴恐 terrorism / 广告 ad）。
- 暴恐/涉政 → block/critical，色情 → block/high，广告 → warn/medium（误拦风险对策：WARN 档先行）
- 定位为**基线示例包**（注释明确：客户应替换为自有数据包），规则是数据——租户经 console 规则包 CRUD 改词/停用/增补，发布走既有 snapshot 热加载，网关零改动

**类别字段贯穿**（`payload.category` 存库 → snapshot → 引擎一等字段 → 命中回显）：

```text
manifest.yaml rule.category
  → pg/mysql-store 播种写入 rule payload.category（normalizeRulePayload 保留该键）
  → PolicyRulePayload.category / PolicyTestHit.category（TS types）
  → 快照 rule.Payload["category"]
  → Go snapshotManifestsFromRaw 提升为 policyengine.Rule.Category
  → applyHit → HitEvent.Category（json "category,omitempty"）
  → 90001/90002 body 的 hits[] 自动带 category（writePolicyError 原样序列化 HitEvent）
  → audit.PolicyHit.Category → 防篡改审计链
```

### B. 第三方内容安全 API 适配层（provider 可插拔）

新 Go 包 `gateway/internal/moderation/`：

- `provider.go`：`Provider` 接口 `Check(ctx, Req{TenantID,Stage,Text,Categories}) (Verdict{Blocked,Categories,Score,Detail}, error)`；
  - `httpProvider`：**通用 JSON 契约**（POST {url}，`Authorization: Bearer <apiKey>`，body `{tenantId,stage,text,categories}` → resp `{blocked,categories[],score,detail?}`，超时默认 3s）——任何厂商（阿里云内容安全/腾讯天御/数美等）可经薄适配或网关侧 shim 接入；实现新 Provider 即可插拔
  - `noopProvider`：未配置租户 = 现状等价（零外呼）
- `config.go`：`ConfigLoader` 轮询 `.runtime/admin/moderation.json`（`GATEWAY_ADMIN_MODERATION_FILE`，SP4 范式）：

```json
{ "tenants": { "<tid>": {
    "enabled": true, "mode": "degraded",          // degraded | strict（strict 选装，不全局默认）
    "blockSeverity": "critical", "timeoutSeconds": 3,
    "categories": ["politics","porn","terrorism","ad"],
    "provider": { "type": "http", "name": "vendor-x", "url": "https://…", "apiKey": "…" }
} } }
```

- `service.go`：`Service.Enforce(ctx, tenantID, stage, text)` → `Result{Hits, Degraded, BlockSeverity}`，封装 block 判定与降级逻辑，供 server 侧接线

### C. 降级语义（对齐统一纪律 3）

| 情形 | degraded（默认） | strict（租户选装） |
|---|---|---|
| provider 调用失败（网络/超时/5xx/坏 JSON） | 本地合规规则照常生效（evaluatePolicy 已跑），provider 结论跳过；**CRITICAL 告警**（source=moderation_degraded，dedup 租户+provider 防风暴，AlertDispatcher 去重窗口兜底）；不静默放行也不一刀切 | fail-closed：合成 block hit（category=moderation）→ 先审计后 90001/90002 |
| provider 判 blocked | 合成 `HitEvent{RuleID: "moderation_<provider>", Kind: "moderation", Action: block, Category: 主类别, Severity: blockSeverity}` → **先写 policy_hit 审计**（失败即 500 fail-closed，同现有策略拦截）→ dispatchPolicyAlert（复用 SP4，summary 带类别）→ 90001/90002 | 同左 |

### D. 接线点（六处，全部复用统一 helper）

| # | 路径 | 阶段 | 落点 | 行为 |
|---|---|---|---|---|
| 1 | handleChat | request | 本地 reqPolicy 通过后（90001 之前不外呼） | block → 90001 |
| 2 | handleChat 非流式 | response | respPolicy 通过后、写响应前 | block → 90002 |
| 3 | handleStream | response 尾 | responseText 组装完成后、写缓存/审计前 | block → 90002 SSE error + 按中断流结算 |
| 4 | dispatchProtocol | request | 同 #1 | block → 90001 |
| 5 | protocolComplete | response | 审计事件写完后、写响应前 | block → 90002 |
| 6 | protocolStream | response 尾 | 同 #3 | block → 90002 SSE error |

流式=流尾、非流式=终态（MASTER-PLAN 既定）；请求侧一次（流式分支前），embedding 路径不接（本地规则已覆盖，向量输入不适用内容安全模型语义）。

### E. Console 配置

- `lib/moderation-store.ts`：file store 范式读写 moderation.json
- `api/admin/security/moderation/route.ts`：GET/PUT（SP2 security API 范式）+ `insertAuditEvent` 留痕（moderation_config_updated）
- `app/audit/moderation-card.tsx`：内容安全卡片（enabled/mode/provider url+key/categories/超时/级别），置于审计页告警通道卡旁；网关 10s 热加载
- 规则包四类 category 在策略页规则命中测试（PolicyTestHit.category）与 audit 策略命中中可见

## 三、改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `enterprise/plugins/moderation-compliance/manifest.yaml`（新） | 四类合规基线规则（数据） |
| 2 | `enterprise/packages/policy-engine/types.go` + `engine.go` | Rule.Category / HitEvent.Category + applyHit 传递 + 单测 |
| 3 | `gateway/internal/server/server.go` | snapshotManifestsFromRaw 读 payload["category"]→Rule.Category；toAuditPolicyHits 带 Category；三处 chat 接线；NewServer 构造 moderation Service |
| 4 | `gateway/internal/server/protocol_handlers.go` | 三处 protocol 接线 |
| 5 | `gateway/internal/server/moderation.go`（新） | enforce helper（audit→alert→90001/90002 统一封装） |
| 6 | `gateway/internal/audit/writer.go` | PolicyHit.Category |
| 7 | `gateway/internal/moderation/`（新包） | provider.go（接口+http/noop）+ config.go（Loader）+ service.go（Enforce）+ 测试 |
| 8 | `enterprise/features/policy/src/types.ts` + `services/pg-store.ts` + `mysql-store.ts` | payload.category 保留/播种/测试命中回显 |
| 9 | `admin-console/src/lib/moderation-store.ts`（新）+ `api/admin/security/moderation/route.ts`（新） | 配置 CRUD + 审计留痕 |
| 10 | `admin-console/src/app/audit/moderation-card.tsx`（新）+ `audit-page.tsx` | 配置卡片 |
| 11 | Go/TS 测试 | moderation 包单测 + server 接线 E2E + console vitest |

## 四、验收标准（对齐 MASTER-PLAN 第八节）

- [ ] Go：规则包命中——snapshot 带 category 的规则 → 请求/响应两侧 90001/90002 且 hits[].category 正确（server 级 E2E）
- [ ] Go：httpProvider contract 测试（httptest 断言请求契约 + verdict 解析 + 超时）
- [ ] Go：blocked → policy_hit 先落审计（含 category）→ 90001/90002 → 告警分发（httptest 收到，summary 带类别）
- [ ] Go：degraded E2E——provider 故障 → 请求放行（本地规则仍拦）+ CRITICAL moderation_degraded 告警送达 + 去重窗口内不重复
- [ ] Go：strict 模式——provider 故障 → fail-closed 90001/90002 + 告警
- [ ] Go：未配置租户零行为变化（不外呼、不阻断）
- [ ] TS：normalizeRulePayload 保留 category；播种包 payload 带 category；PolicyTestHit 回显
- [ ] vitest：moderation store/route CRUD + audit 留痕
- [ ] 回归：policy-engine + server + audit + moderation 包全绿；console 相关测试过
- [ ] commit 带 Plan-Id/Plan-File/Impl-Model: GLM-5.3/Made-with: Damon Li

## 五、纪律对齐

- 规则是数据：内置包=示例基线，租户可改可停；category 走 payload 数据通道不硬编码
- fail-closed 仅限凭据类：内容审核外部故障默认 degraded+CRITICAL 告警；strict 按租户选装（master plan 风险表既定）
- 默认开启+flag 兜底：moderation 配置缺省 disabled=现状等价；内置包 enabled=true 但广告类=warn
- 先审计后动作：moderation block 先落 policy_hit（写失败 500），再写 90001/90002；degraded 降级经 SP4 alert_dispatch 审计链留痕
- 不自建内容安全模型：只做规则数据 + 可插拔 API 适配（MASTER-PLAN 第四节第 1 条）
