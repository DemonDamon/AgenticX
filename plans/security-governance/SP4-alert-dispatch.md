# SP4: 告警分发通道（AlertDispatcher）

Plan-Id: alert-dispatch
Parent-Plan: plans/security-governance/MASTER-PLAN.md（缺口 G4：告警只入库不分发）
Status: implemented（2026-11-12 实施+测试通过，待 commit）

## 一、探查结论

| 事实 | 位置 |
|---|---|
| 预算告警只 insert `gateway_budget_alerts` 表，无分发；`Emit` 是异步 goroutine，never blocks | `enterprise/apps/gateway/internal/quota/budget_alert_reporter.go:33-67` |
| 预算告警 sink 注入点：`srv.quotaTracker.SetBudgetAlertSink(budgetReporter.Emit)` | `server/server.go:259-262` |
| policy_hit 审计两个入口：请求侧 90001（L856）、响应侧 90002（L971）；`PolicyHit{PolicyID, Severity, Action, MatchedRule}` 已带 severity | `server/server.go:852-885,967-998,1751-1756`、`audit/writer.go:16-21` |
| 审计写入口：`s.writeAuditEvent(ev)` → `s.audit.Write(&ev)`（JSONL 防篡改链） | `server/server.go:1768-1775` |
| 审计链校验目前在 console 侧按需触发（`/api/audit/chain-verify` → `verifyGatewayAuditChain`），无网关侧持续自检 | `admin-console/src/app/api/audit/chain-verify/route.ts` |
| 配置链路模式：console 落盘 `enterprise/.runtime/admin/*.json`（gateway-cache-store.ts 范式）→ 网关 `GATEWAY_ADMIN_*_FILE` env + 后台轮询热加载（runtimeconfig Loader 范式：atomic snapshot + ticker） | `runtimeconfig/runtimeconfig.go:61-160`、`admin-console/src/lib/gateway-cache-store.ts:31-47` |
| severity 是自由字符串（如 "high"），需统一排序 | `server/server.go:401` |

## 二、设计

### 数据流

```
源1 policy_hit（server.go 两处，写审计成功后）
源2 预算告警（quota sink 包装：warn→HIGH / exceed→CRITICAL）
源3 审计链自检失败（网关侧新增周期校验，CRITICAL——比 console 按需点检更强，7×24）
  → Dispatcher.Dispatch(alert)
    → 租户通道配置查询（alerts.json 快照）
    → severity 过滤（channel.minSeverity）
    → 去重窗口（dedup_key = source+rule+subject，默认 10min）
    → 通道级限流（每分钟 N 条，默认 10，滑动窗口计数）
    → 异步发送：webhook=通用 JSON POST；feishu=群机器人卡片 POST
    → 分发结果写审计（event_type="alert_dispatch"，Event 新增 AlertDispatch 字段进防篡改链）
```

### 通道配置文件 `enterprise/.runtime/admin/alert-channels.json`

```json
{
  "tenants": {
    "tenant-1": {
      "channels": [
        {"type": "webhook", "url": "https://ops.example.com/hook", "minSeverity": "HIGH"},
        {"type": "feishu", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "minSeverity": "CRITICAL"}
      ],
      "dedupWindowSeconds": 600,
      "rateLimitPerMinute": 10
    }
  }
}
```

无该租户配置 = 不分发（现状等价，零侵入）。severity 排序 CRITICAL > HIGH > MEDIUM > LOW，未知值按 MEDIUM。

### 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `gateway/internal/alertdispatch/`（新包） | alert.go（Alert+severity 排序）/ config.go（Loader 轮询热加载）/ dispatcher.go（去重+限流+发送+审计）/ chaincheck.go（周期链自检→CRITICAL 告警） |
| 2 | `gateway/internal/audit/writer.go` | Event 增加 `AlertDispatch *AlertDispatchRecord`（omitempty，进 checksum 链） |
| 3 | `gateway/internal/server/server.go` | 构造 Dispatcher；policy_hit 两处写审计后 dispatch；budget sink 包装双写；chaincheck.Start |
| 4 | `admin-console/src/lib/alert-channels-store.ts`（新） | 文件存取 `.runtime/admin/alert-channels.json`（gateway-cache-store 范式） |
| 5 | `admin-console/src/app/api/alerts/channels/route.ts`（新） | GET/PUT 租户通道配置 |
| 6 | console 设置页 | 告警通道配置表单（webhook/飞书 URL + severity 门槛） |
| 7 | `alertdispatch/dispatcher_test.go` 等（新） | 单测+集成测试 |

### 纪律对齐

- 分发失败 never block 业务路径（沿用 BudgetAlertReporter 的 goroutine 范式）
- 分发动作先写审计再发送（审计事件含 channel/url摘要/dedup_key/outcome）
- off 等价现状：无通道配置的租户零行为变化
- feishu 卡片与 webhook 用同一 HTTP 出站路径（超时 5s，无重试风暴风险由限流兜底）

## 三、验收标准（对齐 MASTER-PLAN 第八节）

- [x] Go 测试：policy_hit → 真实 HTTP 接收端（httptest）收到告警 JSON — `TestDispatchPolicyHitToWebhook`（真实 HTTP roundtrip，含 payload 字段断言）
- [x] Go 测试：飞书通道发出卡片格式 payload — `TestDispatchFeishuCard`（msg_type=interactive，HIGH→orange 模板断言）
- [x] Go 测试：同 dedup_key 窗口内重复命中只发一条；超窗口再发 — `TestDedupWindow` + `TestDedupExpirySendsAgain`
- [x] Go 测试：通道限流生效（超 N 条/分钟被丢弃且落审计 outcome=rate_limited）— `TestChannelRateLimit`（4 条限 2，2 送达 2 rate_limited 落审计）
- [x] Go 测试：分发动作本身写 audit 事件（event_type=alert_dispatch，在链上可查）— `TestDispatchAuditedOnChain`（含 VerifyAuditChain 通过）
- [x] Go 测试：链自检检测到篡改（改一行 jsonl）→ CRITICAL 告警发出 — `TestChainCheckDetectsTampering`（定位到行号）+ `TestChainCheckDispatchesCritical`（真实 HTTP 收到 chain_check/CRITICAL）
- [x] E2E：server 级接线验证 — `TestServerDispatchPolicyAlertWiring` / `TestServerDispatchBudgetAlertWiring`（真实 Server helper → Dispatcher → httptest 飞书端点，policy_hit 含去重断言）；真实飞书群送达待用户提供 webhook secret 后走同一路径复测（console 已可配置）
- [x] console：通道配置 CRUD API 测试 8/8 过 + 审计页告警通道配置卡片（表单式 CRUD，保存后网关 10s 内热加载）
- [x] 回归：alertdispatch 10 + server 全量 + audit + quota 全绿；console alerts+audit 10 测试过；typecheck 我的文件零错误（仓库既有错误与本次无关）
- [ ] commit 带 Plan-Id/Plan-File/Impl-Model: GLM-5.3/Made-with: Damon Li
