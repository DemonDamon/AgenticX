# GW-02 渠道优先级分层故障转移

Planned-with: grok-4.7-high
Suggested-Impl-Model: grok-4.7-high

**Goal:** 渠道选择先按优先级分层，只在当前可用的最高层内沿用现有 prefix / 亲和 / latency / weight 策略；整层不可用才降到下一层。数值越小越优先，0 为最高。存量渠道全部是 0，行为与改动前一致。

**Architecture:** 在 `PickWithPrefix` 于 `filterHealthy` 之后切出最小 `Priority` 层，后续四个选择分支只看这一层。`PickDecision` 增加 `Priority`，由选出渠道的分支回填。审计侧已经把整个 `PickDecision` 序列化进 `routing_policy`，因此不必改审计 schema，也不必改 `routingDecisionFromStream` / `routingDecisionFromRelay`。管理台只在编辑框下方加一句提示。

**Tech Stack:** Go（`enterprise/apps/gateway`）、管理台 next-intl 文案（`messages/zh.json`、`messages/en.json`）与 `channels.tsx`。

---

## 根因与证据

以下两段从主规划原文复制，行号以本 worktree 2026-11-09 重新核对后的代码为准（见下一节）。

**A-05 渠道优先级是「可填但不生效」的字段。**

- `enterprise/apps/gateway/internal/channel/types.go` 第 23 行定义了 `Priority int`。
- 管理台 `enterprise/apps/admin-console/src/app/admin/_sections/channels.tsx` 第 253、283、403、704–705 行可以编辑和展示它；中文文案在 `enterprise/apps/admin-console/messages/zh.json` 第 1671 行（`weightPriority`）和第 1689 行（`priorityLabel` = 优先级）。
- 但 `rg "\.Priority" enterprise/apps/gateway/internal` 的非测试命中只有 `wasmhost/manager.go:76`（插件排序）。`channel/picker.go` 的 `PickWithPrefix()`（第 48–99 行）完全不看优先级。
- 旧版 provider 转出的渠道固定为 `Priority: 0`（`channel/registry.go` 第 238 行）。

重新核对（本 worktree，`gwr/gw02`）：

- `types.go:23` 仍是 `Priority int \`json:"priority"\``。
- `channels.tsx` 仍在 253、283、403、704–705 读写 `priority`。`useTranslations("pages.admin.channels")` 在第 117 行。
- `zh.json` / `en.json` 的 `pages.admin.channels.weightPriority` 在第 1671 行，`priorityLabel` 在第 1689 行。两份文件都还没有 `priorityHint`。
- `picker.go` 的 `PickWithPrefix` 在第 48–99 行，`filterHealthy` 之后直接对 `healthy` 做 prefix（70–74）、亲和（76–84）、latency（86–92）、weight（94–98），没有任何 `Priority` 比较。
- `registry.go:238` 仍是 `Priority: 0`。本任务不改这一行。
- `rg "\.Priority" enterprise/apps/gateway/internal` 非测试命中仍只有 `wasmhost/manager.go:76`。

**U-02 优先级与亲和。** `llm/mod.rs` 的 `AIBackend` 约在 88–130 行，按优先级把 provider 分成多个桶。桶数大于 1 时默认开启健康驱逐；同一个桶内用 power-of-two-choices 选择。亲和（affinity）只在当前可用的最高优先级桶内生效，**不会**把请求带回低优先级或不健康的端点。

本任务只内化「分层 + 亲和不越级 + 整层不可用才降层」。同层内继续用现有 weight / latency / prefix / 亲和，不改成 power-of-two-choices，也不新增健康驱逐策略。

**语义（不得更改）：** 优先级数值越小越优先，0 为最高。存量渠道全部是 0，属于同一层，所以行为与现状完全一致。同一层内仍然按现有策略（prefix、亲和、latency、weight）选择。比较方式是取候选里的最小整数，不把负数钳成 0：若库里出现负数，它会单独成为更高的一层。产品约定的最高层是 0，存量数据全是 0。

## 精确落点（重新核对）

| 文件 | 符号 | 行号 | 锚点 |
| --- | --- | --- | --- |
| `enterprise/apps/gateway/internal/channel/picker.go` | `PickWithPrefix` | 48–99 | `healthy := p.filterHealthy(cands, exclude)` 之后、`policy == LBPrefixCache` 之前 |
| 同上 | `filterHealthy` | 101–131 | 第 115–129 行：`len(healthy)==0` 时回落为 `cands`（有 exclude 时再滤掉 exclude） |
| 同上 | 四个成功返回 | 72、80、91、98 | `PickDecision{ChannelID: ch.ID, Policy: ..., Reason: "..."}` |
| `enterprise/apps/gateway/internal/channel/lb_policy.go` | `PickDecision` | 22–27 | `type PickDecision struct`，字段 `ChannelID` / `Policy` / `Reason` |
| `enterprise/apps/gateway/internal/channel/types.go` | `Channel.Priority` | 23 | 已有字段，本任务不改 |
| `enterprise/apps/gateway/internal/server/channel_relay.go` | `enrichAuditRoutingPolicy` | 86–95 | `json.Marshal(decision)` 写入 `event.RoutingPolicy` |
| `enterprise/apps/gateway/internal/server/channel_handlers.go` | `routingDecisionFromRelay` / `routingDecisionFromStream` | 165–170、290–295 | 只在 `result.Channel.ID != ""` 时调用 `decisionFromChannel`，不读 `PickDecision` |
| `enterprise/apps/gateway/internal/audit/writer.go` | `Event.RoutingPolicy` | 73 | `json.RawMessage \`json:"routing_policy,omitempty"\``，schema 不动 |
| `enterprise/apps/admin-console/messages/zh.json` | `pages.admin.channels` | 1689 附近 | `"priorityLabel": "优先级"` 之后插入 `priorityHint` |
| `enterprise/apps/admin-console/messages/en.json` | 同上 | 1689 附近 | `"priorityLabel": "Priority"` 之后插入 `priorityHint` |
| `enterprise/apps/admin-console/src/app/admin/_sections/channels.tsx` | 编辑弹窗优先级输入 | 703–706 | `<Label>{t("priorityLabel")}</Label>` 与对应 `<Input>` 的父级 `<div>` |

`PickDecision` 不在 `types.go`，在 `lb_policy.go`。主规划允许「定义所在文件」，因此改 `lb_policy.go` 而不是把结构体搬到 `types.go`。

## 与主规划措辞的核对（不是行为偏离）

主规划写「`PickDecision` 新增 `Priority`，供 `routingDecisionFromStream` 和 `routingDecisionFromRelay` 写入审计」。重新核对后，这两函数不消费 `PickDecision`。审计里的路由决策是 `enrichAuditRoutingPolicy` 对整个 `PickDecision` 做 `json.Marshal`。因此「写入路由决策」的最小改动是：给 `PickDecision` 加字段，并在 `picker.go` 每个成功分支填上被选中渠道的 `Priority`。`routing_policy` JSON 会自动多出 `priority`。不改 `channel_handlers.go`、`routing.Decision`、`audit.Event`。

## Before / After

### 1. 分层插入点（`picker.go` `PickWithPrefix`）

Before（约 65–98 行）：`filterHealthy` 得到 `healthy` 后，prefix / 亲和 / latency / weight 全部直接遍历 `healthy`。

After：

```go
healthy := p.filterHealthy(cands, exclude)
if len(healthy) == 0 {
    return Channel{}, PickDecision{}, false
}
tier := lowestPriorityTier(healthy)
if len(tier) == 0 {
    return Channel{}, PickDecision{}, false
}
// 此后 pickByPrefix(tier)、亲和 for-range tier、latencyAwareSample(tier)、weightedSample(tier)
```

`lowestPriorityTier` 放在同文件 `filterHealthy` 之后：空切片返回 nil；否则取 `Priority` 最小值，返回所有等于该值的渠道，保持原相对顺序。

`filterHealthy` 的冷却回落（115–129 行）原样保留。回落结果再进 `lowestPriorityTier`。因此：

- 高层全部冷却、低层仍健康：`filterHealthy` 只留下低层，选低层。
- 全部候选都在冷却：回落为全部候选（再去掉 exclude），然后仍只取最小优先级层，不因为「都在冷却」就去选低层。

### 2. 亲和不越级

Before（76–83 行）：在 `healthy` 里找 `affinity.Get` 返回的 channel id，找到就 `Reason: "affinity"` 返回。

After：只在 `tier` 里找。记录指向的渠道不在当前层（低优先级，或已被 exclude / 冷却滤掉）时，忽略这次亲和，继续走 latency 或 weight。不把请求拉回低层。

### 3. `PickDecision.Priority`

Before：

```go
type PickDecision struct {
    ChannelID string   `json:"channel_id"`
    Policy    LBPolicy `json:"policy"`
    Reason    string   `json:"reason"` // affinity|prefix|latency|weight
}
```

After：在 `Reason` 后追加 `Priority int \`json:"priority"\``。不加 `omitempty`：0 是最高层，必须出现在 JSON 里，不能被当成空值省略。

四个成功返回改为带上 `Priority: ch.Priority`。可用同文件小函数 `decisionFor(ch, policy, reason)` 集中填充，避免某个分支漏填。失败返回仍是空 `PickDecision{}`。

### 4. 管理台提示

`zh.json` 的 `pages.admin.channels.priorityHint`：

`数值越小越优先；同一优先级内按权重分流，整层不可用时才使用下一层`

`en.json` 的同名键：

`Lower numbers are preferred. Channels with the same priority share traffic by weight. The next tier is used only when the whole tier is unavailable.`

`channels.tsx` 第 703–706 行的优先级 `<div>` 内，在 `<Input>` 下方增加：

```tsx
<p className="mt-1 text-xs text-muted-foreground">{t("priorityHint")}</p>
```

样式对齐同文件第 602 行 `keyRefsHint`。新建弹窗（约 543–546 行）没有优先级输入，不加提示。

## FR / AC

- **FR-1：** 高优先级层存在健康渠道时，低优先级渠道不会被选中。
  - **AC-1：** `enterprise/apps/gateway/internal/channel/picker_priority_test.go` 的 `TestPickStaysInHighestPriorityTier`。构造 A(p=0,w=1)、B(p=0,w=1)、C(p=1,w=100)，租户 `t1`、模型 `m1`、`StatusActive`。`PickWithPrefix` 1000 次。断言 `counts["C"] == 0`，A+B 合计 1000，且每次 `decision.Priority == 0`、`decision.Reason == "weight"`。
- **FR-2：** 高优先级层整层冷却或被排除时，降到下一层。
  - **AC-2：** 同文件 `TestPickFallsBackWhenHigherTierUnavailable`。对 A、B 调用 `MarkFailure(..., 30*time.Second)` 后，单次 Pick 的 `ch.ID == "C"` 且 `decision.Priority == 1`。另起一个没有冷却的 picker，`exclude` 含 A 与 B，结果同样是 C。
  - **AC-2b（主规划第 3 条，防回归）：** 同文件 `TestPickAllCooldownStaysOnHighestTier`。A、B、C 全部 `MarkFailure` 30s 后，100 次 Pick 的渠道只能是 A 或 B，`counts["C"] == 0`，`decision.Priority == 0`。这锁定「冷却回落后仍只取最小层」。
- **FR-3：** 亲和不越级。
  - **AC-3：** 同文件 `TestPickAffinityDoesNotCrossPriorityTier`。`AffinityStore.Set("sess1", "m1", "C")`，A 与 B 健康。Pick 50 次，每次 `ch.ID` 为 A 或 B，且 `decision.Reason != "affinity"`。
- **FR-4：** 存量行为不变。
  - **AC-4：** 不修改 `picker_test.go`、`picker_lb_test.go`、`lb_policy_test.go` 的断言。`cd enterprise/apps/gateway && go test ./internal/channel/ -count=1` 全绿。全部 p=0 时 `lowestPriorityTier` 返回原切片，四个分支的选择集合与改动前相同。
  - **AC-5：** `priorityHint` 中英都有，编辑框下方渲染该键。`pnpm --filter @agenticx/app-admin-console test` 与 `typecheck` 通过（安装步骤见验收）。

## 验收命令

在 `enterprise/apps/gateway`：

```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
go test ./... -count=1
go vet ./...
gofmt -l internal/channel/picker.go internal/channel/lb_policy.go internal/channel/picker_priority_test.go
```

`internal/mcphost` 的 `TestConnectorBackendExecuteActionMissingConnection` 基线即失败，不修。其余必须全绿。`gofmt -l` 若列出改动前就已经未格式化的文件，只修正本次新增行，不整文件重排。

管理台（worktree 的 `enterprise/pnpm-lock.yaml` 不入库）：

```bash
cd enterprise
npx pnpm@9.12.0 install --no-frozen-lockfile
npx pnpm@9.12.0 --filter @agenticx/app-admin-console test
npx pnpm@9.12.0 --filter @agenticx/app-admin-console typecheck
```

需要联网时 `http_proxy=https_proxy=http://127.0.0.1:7900`。

## In scope

- `picker.go`：`lowestPriorityTier`、`PickWithPrefix` 只在当前层内选择、成功分支回填 `Priority`。
- `lb_policy.go`：`PickDecision.Priority`。
- `picker_priority_test.go`：AC-1、AC-2、AC-2b、AC-3。
- `messages/zh.json`、`messages/en.json` 的 `pages.admin.channels.priorityHint`。
- `channels.tsx` 编辑弹窗优先级输入框下方的提示。

## Out of scope

- 同层内改用 power-of-two-choices。
- 修改冷却时长、`filterHealthy` 的回落条件、`StatsStore` / `AffinityStore` 的存储结构。
- 改 `registry.go` 里 legacy 渠道的默认 `Priority: 0`。
- 虚拟模型（GW-03）。
- 改审计 schema（`audit.Event`、PG/MySQL）、改 `routing.Decision`、改 `routingDecisionFromStream` / `routingDecisionFromRelay` / `decisionFromChannel`。
- 新建弹窗补优先级输入、列表卡片文案、其它设置页。
- 健康驱逐、延迟惩罚跨层、修改 `wasmhost` 插件排序。
- 第 7 节「明确不做」的全部条目（不引入外部网关二进制、xDS、CEL、A2A、网格隧道、注册中心集群、Raft、DNS 发现等）。
- 桌面端与 Python 框架。

## 实施顺序

1. 本文件先落在 `.cursor/plans/pending/`，实施前 `git add` 再 `git mv` 到 `.cursor/plans/`。
2. 写 `picker_priority_test.go`（先红后绿）。
3. 改 `lb_policy.go` 与 `picker.go`。
4. 改两份 messages 与 `channels.tsx`。
5. 按验收命令跑网关与管理台。
6. 一个 commit，只包含本任务文件。

## 观察到但未处理

- `picker_test.go` 第 19 行 `picked := p.weightedSample(cands)` 前有多余缩进空格，`gofmt` 会想重排该文件。本任务不改 `picker_test.go`，也不整文件格式化。
- `routingDecisionFromRelay`（`channel_handlers.go:165`）与 `routingDecisionFromStream`（同文件 290 行）不读 `PickDecision`。`Channel.Priority` 也不会被 `decisionFromChannel`（`channel_relay.go:36`）复制进 `routing.Decision`。审计能看到优先级，是因为 `enrichAuditRoutingPolicy` 序列化整个 `PickDecision`。本次只加 `PickDecision.Priority`，不扩展 `routing.Decision`。
- 编辑保存使用 `Number(editing.priority) || 0`（`channels.tsx:283`）。这是既有逻辑：空串变成 0；负数可以保存。本任务不改保存解析。
- 新建弹窗只有权重、没有优先级输入（约 543–546 行）。新建渠道的优先级沿用原默认值。本任务不加输入框。
- 管理台 `test` 在本改动与 `git stash` 后的基线上都失败同一批 8 个套件（564 个用例通过）：`app-shell-nav.test.ts`、`nav-groups-messages.test.ts`（`AppShell.tsx` 的 oxc `vite:define` 转换错误）、`DreamReviewBanner.test.tsx`、`RunDetailSheet.test.tsx`、`SessionReplayTimeline.test.tsx`、`LimitEditor.test.tsx`、`agent-webhook-messages.test.ts`（JSX 被当成非法 JS）、`ma-evals/__tests__/routes.test.ts`（缺少 `datasets/[datasetId]/items/import-session/route`）。`typecheck` 同样在基线失败，错误在 `routes.test.ts`、`platform-readonly.test.ts`、`data-suite-store.test.ts`、`ecp-tenant-settings-store.ts`、`graph-store.ts`、`idmapping-store.ts`、`platform-catalog-distribution.ts`。均未改这些文件。
