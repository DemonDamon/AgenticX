---
name: Enterprise Token 用量在不限额窗口下的可见性修复
overview: 保留现有 0=不限额兼容语义，同时让网关在日/周不限额或硬顶开关关闭时继续记录可展示的 Token 用量，并保证门户读取到同一份账本。
todos:
  - id: t1-token-counter
    content: 为日/周 Token 窗口建立独立于共享池硬顶开关的计量计数器，并接入 Tracker
    status: completed
  - id: t2-record-and-enforce
    content: 将日/周计量与硬顶拦截拆开；0 仍表示不限额但不再跳过用量记录
    status: completed
  - id: t3-remaining-read
    content: 让网关 Remaining 查询读取日/周计量账本，门户在数据库无对应行时回退本地账本
    status: completed
  - id: t4-tests
    content: 补充 Go 配额测试与 iam-core 门户账本读取测试
    status: completed
  - id: t5-live-regression
    content: 在本地 Enterprise 真实页面发送请求，确认今日/本周/月用量均随请求更新
    status: completed
isProject: false
---

# Enterprise Token 用量在不限额窗口下的可见性修复

**Planned-with**: gpt-5.6-terra
**Suggested-Impl-Model**: gpt-5.6-terra（网关 Go 计量、门户 TypeScript 读取和跨后端账本一致性需要一次性收口）
**Plan-Id**: 2026-08-01-enterprise-token-usage-unlimited-window-fix
**Plan-File**: `.cursor/plans/2026-08-01-enterprise-token-usage-unlimited-window-fix.plan.md`

## 根因与证据

现有配置协议把 `monthlyTokens/dailyTokens/weeklyTokens <= 0` 归一化为 `0`，并把 `0` 解释为不限额。这个兼容语义本身不是月度用量为 0 的原因：

- `enterprise/apps/gateway/internal/quota/tracker.go` 的 `CheckAndAddContext` 在月度规则为 0 时仍以 `recordOnly=true` 写入用户月度账本。
- `enterprise/packages/iam-core/src/quota-remaining.ts` 的月度读取会保留该 `used`，门户组件 `enterprise/apps/web-portal/src/components/QuotaCard.tsx` 只是展示 API 返回的 `used`，没有把 `limit=0` 改写为 0。
- `enterprise/apps/gateway/internal/quota/token_window.go` 当前在 `GATEWAY_TOKEN_WINDOW_QUOTA` 未打开时直接返回，并且对 `dailyTokens/weeklyTokens <= 0` 直接 `continue`，因此日/周账本没有写入。
- 日/周计数器复用了 `Tracker.poolCounter`；而 `newPoolCounter` 在 `GATEWAY_QUOTA_POOL` 未打开时返回 nil。共享池硬顶是否启用不应决定用户个人日/周用量能否被展示。
- 门户配置了 `DATABASE_URL` 时优先查 PostgreSQL 日/周账本；若网关使用本地账本且数据库没有对应行，当前读取路径把“无行”当成 0，存在本地开发环境读不到实际计量的风险。

此前本地真实页面在 origin/hc-0730 测试代码上完成多轮普通对话、联网搜索和深度研究后，侧栏表现为“今日 已用 0 Token、本周 已用 0 Token、本月 已用 58.6K Token”。这与上述代码路径一致：月度账本有记录，日/周窗口没有可读计数。

## 目标与边界

### In scope

1. 新增独立的日/周 Token 计量计数器：不受 `GATEWAY_QUOTA_POOL` 共享池开关影响；配置了可用数据库时使用与门户一致的 PG/MySQL 后端，测试和显式 local 配置仍可使用本地文件。
2. `checkTokenWindowLimits` 始终为有效请求写入日/周计量；只有 `GATEWAY_TOKEN_WINDOW_QUOTA=on` 且对应上限大于 0 时才执行日/周硬顶/告警。
3. `dailyTokens/weeklyTokens=0` 继续代表“不限额”，但仍返回真实已用 Token；不引入破坏旧配置的 schema 迁移。
4. 网关 `RemainingForWindow` 与门户 `getQuotaWindowUsageForScope` 读取同一 `tok_day/tok_week` 账本，并对数据库无对应行的本地账本场景做安全回退。

### Out of scope

- 不修改后台配额编辑页的交互，不把 0 改成新的数据库枚举或 nullable 字段。
- 不改月度 reserve/settle 账本，也不改变现有日/周“按请求进入时估算 Token 计量、不过度回填 settle”的约定。
- 不改变硬顶开关默认关闭的策略，不扩大到请求数、RPM、TPM、预算或其他配额维度。
- 不修改桌面端、组织管理、聊天中断或其他内部 bug。

## 实现落点

### FR-1：独立日/周计量存储

文件：`enterprise/apps/gateway/internal/quota/tracker.go` 的 `Tracker`、`NewTracker`；`enterprise/apps/gateway/internal/quota/ledger.go` 的计数器构造辅助。

- 在 `Tracker` 增加 `tokenWindowCounter PoolCounter`。
- `NewTracker` 保留现有 `poolCounter` 的共享池 feature gate，同时初始化 token window counter；该计数器使用同一 `PoolKey`/`tok_day`/`tok_week` 行格式，确保门户无需新表。
- 后端选择规则：显式 `GATEWAY_QUOTA_POOL_BACKEND=local` 时用本地 JSON；显式 `pg`/`mysql` 且数据库句柄可用时用数据库；未显式设置时优先使用可用数据库句柄，以匹配门户存在 `DATABASE_URL` 时的读取路径，无法连接时保留已有本地回退。

### FR-2：拆分计量与硬顶

文件：`enterprise/apps/gateway/internal/quota/token_window.go` 的 `checkTokenWindowLimits`。

当前意图：

```go
if poolCounter == nil || !tokenWindowFeatureEnabled() { return }
for each window {
    if limit <= 0 { continue }
    read -> enforce -> add
}
```

改为：

```go
if tokenWindowCounter == nil || tokens <= 0 { return }
enforce := tokenWindowFeatureEnabled()
for each day/week window {
    read current only when enforce && limit > 0
    if enforce && limit > 0 && current+tokens exceeds limit {
        block or warn using existing result semantics
    }
    add tokens to tok_day/tok_week counter for display
    only fail closed on add error when enforcement is active and action=block
}
```

计数写入必须继续使用 `LedgerEventReserve`，保持现有近似计量约定；不限额和开关关闭时只影响“是否拦截”，不影响“是否记录”。

### FR-3：网关读取和门户账本回退

文件：`enterprise/apps/gateway/internal/quota/remaining.go` 的 `readWindowUsed`；`enterprise/packages/iam-core/src/quota-remaining.ts` 的 `readTokenWindowUsed`。

- Go 日/周读取改用 `tokenWindowCounter`，共享池 `poolCounter` 的现有月度行为不变。
- 门户 PostgreSQL/MySQL 查询到对应行时直接返回数据库值；查询成功但没有行时读取配置的本地 `quota-pool-usage.json`，避免显式 local backend 的开发环境被错误显示为 0。
- `used` 在 `limit=0` 时仍原样返回，`unlimited=true` 只表达不拦截，不覆盖计量值。

## 验收标准

- **AC-1 Go 计量**：`enterprise/apps/gateway/internal/quota/token_window_test.go` 覆盖 `GATEWAY_TOKEN_WINDOW_QUOTA=off`、`dailyTokens=0/weeklyTokens=0`、`GATEWAY_QUOTA_POOL=off` 三种场景；调用 `CheckRequest` 后 `RemainingForWindow(day/week)` 的 `Used` 等于请求 Token 累计，且请求均允许通过。
- **AC-2 Go 硬顶不回归**：已有日/周 block、跨日重置、日周独立测试继续通过；`GATEWAY_TOKEN_WINDOW_QUOTA=on` 且有限上限时仍返回 `Kind=token_day` 或 `token_week` 并阻断超限请求。
- **AC-3 月度兼容**：已有 unlimited monthly usage 测试继续证明月度 `Used` 正常增长，且不把 0 误当作已用 0。
- **AC-4 门户读取**：`enterprise/packages/iam-core/src/__tests__/quota-remaining.test.ts` 覆盖日/周 `limit=0` 但本地账本有值时，返回真实 `used` 且 `unlimited=true`；已有 day/week/month 和部门读取测试继续通过。
- **AC-5 实际页面**：使用本地 Enterprise 测试账户在同一会话连续发送至少两轮请求；刷新/等待侧栏用量请求完成后，今日、本周和本月均显示大于发送前的实际用量，且不限额仍允许继续发送。测试完成后关闭本轮启动的页面和进程。
- **AC-6 回归命令**：`go test ./internal/quota/...`、iam-core 定向 Vitest、门户 quota summary route 定向 Vitest 全部通过；仅本计划涉及文件进入提交。

## No-scope-creep 检查

提交前核对：变更只涉及 gateway quota ledger/token window/remaining、iam-core quota reader/tests、plan；不把当前交付工作树的前端主题、桌面依赖、文档或缓存文件带入提交。
