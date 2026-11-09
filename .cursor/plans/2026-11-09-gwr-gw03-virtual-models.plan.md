# GW-03 虚拟模型

Planned-with: grok-4.7-high
Suggested-Impl-Model: grok-4.7-high

**Goal:** 管理员定义一个对外模型名，映射到若干 `(真实模型, 权重, 优先级)`。网关在渠道选择前把虚拟名解析成真实模型：取可用的最小优先级层，层内按权重抽样；该目标没有可路由渠道时按优先级尝试下一个目标。计量与审计记真实模型，并在现有 `routing_policy` JSON 里记下请求时的虚拟名。启用的虚拟模型出现在门户模型下拉中。

**Architecture:** 新表 `enterprise_runtime_virtual_models`（PG + MySQL）。管理台 CRUD 真写库，并用独立快照 `GET /api/internal/virtual-models` 下发（D-6）。网关 `GATEWAY_REMOTE_VIRTUAL_MODELS_URL` 轮询，解析发生在 `relay.Executor.Complete/Stream` 入口、渠道 `Pick` 之前。不接入 `configstatus`（C-01）。

**Tech Stack:** Drizzle PG/MySQL、Go gateway、admin-console Next.js、web-portal `listAvailableModelsForUser`。

---

## 根因与证据

复制自主规划 A-09 / U-05 / GW-03（2026-11-09 快照，本子规划已按当前 worktree 复核行号）：

- **A-09 没有虚拟模型。** 模型名直接用于 `registry.ListByModel(tenantID, model)`（`enterprise/apps/gateway/internal/channel/picker.go` 的 `PickWithPrefix`，当前第 61 行）和 `runtimeconfig.ResolveByModel`。
- **U-05。** 上游虚拟模型支持 weighted、conditional、callout、failover。本子规划只做 weighted + priority failover。
- **GW-02 已落地的优先级语义（不能改）：** 数值越小越优先，0 为最高。`lowestPriorityTier` 在 `picker.go` 第 137–157 行。同一层内的渠道选择不在本子规划改动。
- **GW-01 已落地的提交边界：** `relay/executor.go` 的 `Stream` 在 `result.committed` 时直接返回（当前第 211–212 行），不再换渠道。`streamOnChannel` 的 `wrappedPush`（第 251–258 行）在写出带内容的 delta 后把 `committed` 设为 true；客户端写失败包成 `clientPushError`（第 253、402 行）。虚拟目标切换必须服从同一边界。
- **审计没有 `requested_model` 列。** `audit.Event`（`internal/audit/writer.go` 第 23–83 行）的模型字段只有 `Model`。`RoutingPolicy json.RawMessage \`json:"routing_policy,omitempty"\`` 在第 73 行，由 `enrichAuditRoutingPolicy`（`internal/server/channel_relay.go` 第 86–95 行）把 `channel.PickDecision` 整段写入。PG 插入（`internal/audit/pg_writer.go` 第 111–137 行）**没有** `routing_policy` 列；该 JSON 进入 JSONL 审计事件。本子规划不改审计表。
- **配额模型键已经存在，不新增维度。** `quota.RequestContext.Model` 在 `server.go` `quotaContext`（第 1572–1585 行）于转发前用请求里的模型名建立。`selectRule`（`quota/tracker.go` 第 463–479 行）会按该字符串匹配模型规则。预扣与 `SettleContext` 继续用这个 `qctx`，不改。
- **计量用 `decision.Model`。** `reportUsageDetailed`（`internal/server/cache_integration.go` 第 143、162 行）用 `decision.Model` 计价并写入用量。`routingDecisionFromRelay` / `routingDecisionFromStream`（`channel_handlers.go` 第 165–169、290–294 行）把传入的 model 放进 `Decision.Model`。
- **门户模型列表。** `listAvailableModelsForUser`（`enterprise/apps/web-portal/src/lib/admin-providers-reader.ts` 第 165–208 行）只展开 `enterprise_runtime_model_providers` 里启用的模型，再按部门/用户可见性收窄。下拉消费 `GET /api/me/models`（`src/app/api/me/models/route.ts`）。聊天请求里的 `model` 若包含 `/`，`src/app/api/chat/completions/route.ts` 第 256–278 行会拆成 `x-agenticx-provider` + 纯模型名，并要求 id 在可见列表中；**不含 `/` 的模型名原样转发，不查 provider 表**。网关 `routing.Decider.Decide`（`internal/routing/decision.go` 第 52–80 行）在 admin provider 未命中时回落到默认路由，**不拒绝未知模型名**。渠道转发路径（`useChannelRelay()`）不使用 Decider 的 endpoint，而用 `Picker` 按模型名选渠道。
- **D-6（已决策）：** 独立快照 `api/internal/virtual-models`，不并入 channels 快照。
- **legacy 导入：** `@agenticx/iam-core/runtime-legacy-migrate` 只导入既有 JSON（如 `providers.json`）。没有虚拟模型的 legacy 文件，**不接入** migrator。

## 精确落点

| 改动 | 路径 |
| --- | --- |
| PG 迁移 | `enterprise/packages/db-schema/drizzle/0075_enterprise_runtime_virtual_models.sql` |
| PG journal | `enterprise/packages/db-schema/drizzle/meta/_journal.json` 追加 idx 74 |
| MySQL 迁移 | `enterprise/packages/db-schema/drizzle-mysql/0049_enterprise_runtime_virtual_models.sql` |
| MySQL journal | `enterprise/packages/db-schema/drizzle-mysql/meta/_journal.json` 追加 idx 49 |
| Drizzle | `src/schema/runtime-config.ts`、`src/mysql-schema/runtime-config.ts` 表尾追加 |
| 清单测试 | `src/__tests__/migration-inventory.test.ts`、`src/__tests__/schema-parity.test.ts` 的表数量 109→110 与 MySQL journal 末项 |
| 网关包 | 新建 `enterprise/apps/gateway/internal/virtualmodel/` |
| 解析接入 | `internal/relay/executor.go` 的 `Complete` / `Stream` |
| 可路由探测 | `internal/channel/picker.go` 新增 `HasRoutableChannel` |
| 审计与计量 | `internal/server/channel_relay.go`、`channel_handlers.go`、`server.go` `handleStream`、`protocol_handlers.go` `protocolComplete` |
| 启动接线 | `internal/server/server.go` `New` 与 `channel_relay.go` `initChannelRelay` |
| 快照路由 | `enterprise/apps/admin-console/src/app/api/internal/virtual-models/route.ts` |
| Admin API | `src/app/api/admin/virtual-models/route.ts` 与 `[id]/route.ts` |
| Store | `src/lib/virtual-models-store.ts` + `db-stores/postgresql/virtual-models-store.ts` + `db-stores/mysql/virtual-models-store.ts` |
| UI | 新建 `src/app/admin/_sections/virtual-models.tsx`，在 `models.tsx` 主 return 的根 `</div>`（约第 945 行）之前挂上 |
| 文案 | `messages/zh.json` 与 `en.json` 的 `pages.admin.models` 内新增 `virtualModels` |
| 门户 | `admin-providers-reader.ts` 的 `listAvailableModelsForUser` |

合入集成分支时 PG 0075/0076、MySQL 0049/0050 已被 GW-05 与 REG-01 占用，本迁移顺延为 PG `0077_enterprise_runtime_virtual_models`（idx 76）与 MySQL `0051_enterprise_runtime_virtual_models`（idx 51），清单测试计数随之调整。

## 表结构（写全）

`enterprise_runtime_virtual_models`

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | varchar(26) | PK |
| `tenant_id` | varchar(26) | NOT NULL，沿用现有 runtime 表，不加 tenants 外键 |
| `name` | varchar(128) | NOT NULL，租户内唯一，对外模型名 |
| `display_name` | varchar(256) | NOT NULL |
| `enabled` | boolean | NOT NULL DEFAULT true |
| `targets` | PG jsonb / MySQL json | NOT NULL DEFAULT `[]` |
| `created_at` / `updated_at` | 与 `auditColumns` 一致 | NOT NULL |

唯一索引名：`enterprise_runtime_vm_tenant_name_uk` on (`tenant_id`, `name`)。

`targets` 元素：

```json
{"model":"gpt-4o-mini","weight":70,"priority":0}
```

- `model`：渠道 `supportedModels` 使用的真实模型名，非 `provider/model`。
- `weight`：整数，抽样时 `< 1` 视为不参与；层内全为 0 时每个目标按 1。
- `priority`：整数，缺省 0。**数值越小越优先**，与 GW-02 相同。

快照 JSON（internal GET 与网关 loader 共用）：

```json
{"virtualModels":[{"tenantId":"...","name":"...","displayName":"...","enabled":true,"targets":[{"model":"...","weight":1,"priority":0}]}]}
```

含禁用行，网关只解析 `enabled=true`。

## Before / After

**解析（`virtualmodel.Plan`）：**

```go
// before: 请求 model 原样进入 PickWithPrefix
// after:
order := Plan(targets, picker.HasRoutableChannel, rng)
// order[0] = 可用目标里最小 priority 层的加权抽样
// 该层全部 HasRoutableChannel==false 时，跳到下一个 priority
// 所有层都不可路由时，仍对最小 priority 层加权抽样（交给现有 Pick 的冷却回落，不比今天更早失败）
```

`HasRoutableChannel(tenant, model)`：`ListByModel` 之后，至少一个渠道不在 cooldown。不要用 `Pick`：`filterHealthy` 在整层冷却时会回落为全部候选（`picker.go` 第 119–133 行），那会让「全部冷却」仍算可用。

**Executor：** 非虚拟名走现有 `Complete`/`Stream` 循环，一行不改语义。虚拟名在循环之前得到 `order`：

- 对 `order[i]` 把本次请求副本的 `Model` 设为该真实名，再跑现有的单模型重试循环。
- 该循环返回 `no channel for model ...` 时，若尚未向客户端输出，尝试 `order[i+1]`。
- 上游错误（含已 `committed`）不换虚拟目标。`committed` 路径已经在单模型循环内返回，外层看不到「无渠道」，因此不会切换。
- 上游 5xx 且未输出时，仍只在**当前真实模型**的渠道间重试，不换虚拟目标。换虚拟目标的唯一条件是 Pick 失败（无渠道）。

**审计：** `annotateVirtualModelAudit(event, virtualName, resolved)` 在 `enrichAuditRoutingPolicy` 之后调用。`resolved != ""` 时 `event.Model = resolved`。`virtualName != ""` 时把 `requested_model` 合并进已有 `routing_policy` 对象。非虚拟名两个参数都空，事件与今天一致。

**计量：** `routingDecisionFromRelay/Stream` 的 model 参数在 `result.ResolvedModel != ""` 时改传真实模型，因此 `reportUsageDetailed` 的计价和用量行是真实模型。`qctx` 仍是请求里的名字。

**门户：** 可见 provider 模型算完后，追加本租户 `enabled=true` 的虚拟模型：

```ts
{
  id: name,            // 不含 '/'
  provider: "virtual",
  providerLabel: displayName,
  model: name,
  label: displayName,
  route: "third-party",
  isDefault: false,
}
```

`id` 不含 `/`，`/api/chat/completions` 不会拆 provider，body.model 就是虚拟名。网关 Decider 不要求该名字存在于 provider 配置；渠道转发在 Executor 里解析。禁用的不出现。

启用的虚拟模型只有在**每一个目标模型**都落在该用户已经算出的可见模型集合里时才追加。可见 id 通常是 `provider/model`，目标通常是真实模型名。匹配规则：目标与某个可见 id 完全相等，或两边去掉最后一个 `/` 之前的前缀后模型段相等。任一目标对不上就不展示。

## FR / AC

- FR-1 权重：同一优先级、可用，10000 次，权重 1:3 的命中比例在 25%±5% 与 75%±5%。
  - AC-1 `enterprise/apps/gateway/internal/virtualmodel/resolve_test.go` `TestPlanWeightDistribution`。
- FR-2 首选目标全部渠道冷却时，Plan 的首个模型是次选。
  - AC-2 同文件 `TestPlanSkipsCooledPreferredTarget`，用真实 `Picker.HasRoutableChannel` + `MarkFailure` 冷却。
- FR-3 非虚拟名不变。
  - AC-3 `TestLookupMissReturnsOriginal`。
- FR-4 流式已输出后不切换目标。
  - AC-4 `enterprise/apps/gateway/internal/relay/virtual_model_test.go` `TestStreamDoesNotSwitchVirtualTargetAfterOutput`：目标 A 写出两段后断开，目标 B 的 httptest 命中数为 0。
- FR-5 审计同时有虚拟名与真实模型。
  - AC-5 `enterprise/apps/gateway/internal/server/virtual_audit_test.go`：`event.Model` 为真实模型，`routing_policy.requested_model` 为虚拟名；空虚拟名不改 `routing_policy`。
- FR-6 loader 解析失败保留最后快照；远端 404 在已有快照时同样保留，错误文本含 `remote 404`。
  - AC-6 `virtualmodel/loader_test.go`。
- FR-7 internal 快照 401/200。
  - AC-7 `admin-console/src/app/api/internal/virtual-models/__tests__/route.test.ts`。
- FR-8 admin API 增删改真调 store，校验失败 400。
  - AC-8 `src/app/api/admin/virtual-models/__tests__/route.test.ts` 与 `src/lib/__tests__/virtual-models-validate.test.ts`（纯校验，不连库）。
- FR-9 门户列表含启用虚拟模型，不含禁用。虚拟模型仅当全部目标都对该用户可见时展示。
  - AC-9 `web-portal/src/lib/__tests__/admin-providers-reader.test.ts`：目标全可见（含 `gpt-4` 与 `openai/gpt-3.5` 两种写法）则展示；任一目标不可见则不展示；停用则不展示。
- FR-10 配额与预算预检使用首选真实模型，并且 Executor 首先尝试的就是这一次解析出的顺序，不再单独抽样。
  - 预检模型是 `Plan` 的 `order[0]`，通过 `context` 传给 `Executor.Complete/Stream`。
  - 对账是差额修正：预检已经计入预估量。实际模型与预检模型相同时，差额仍记在预检模型上。
  - 故障转移或预算回落后实际模型不同：把预估量从预检模型回滚，再把实际用量记到实际模型。月度计数按用户而不是按模型分桶；模型名决定采用哪条规则。实际模型没有月度规则或规则拒绝入账时，仍把实际用量写入用户计数，避免回滚后漏计。故障转移不再做第二次预检。
  - 非虚拟名的预检、对账、回滚参数与改动前一致。
  - 预算 `applyBudgetFallback` 若把 `req.Model` 改成一个非虚拟名，Executor 不再套用原来的虚拟计划，按普通模型转发。配额预检不因这次替换重做。
  - AC-10 `server/virtual_quota_test.go`：只针对 `real-x` 的月度规则用尽时，虚拟名 `virt` 被拒绝；直接用 `virt` 查规则仍会落到更宽的角色规则。成功结算后用量记在真实模型侧，用量文件没有以虚拟名为键的行。故障转移后用量等于已结算量加实际量，不把预估再加一遍。
  - AC-11 `relay/virtual_model_test.go` `TestExecutorUsesAdmissionPlanInsteadOfSamplingAgain`：上下文里的计划首项是低权重模型时，Executor 不改去抽高权重目标。
- FR-11 门户聊天转发对不含 `/` 的模型名不做服务端可见性校验。虚拟名沿用该既有分支，不新增校验。见文末「观察到但未处理」。

## 校验规则（admin，写全）

- `name`：trim 后 1–128，字符集 `^[A-Za-z0-9._:-]+$`，拒绝 `/` 与空白。
- `displayName`：trim 后 1–256。
- `targets`：1–20 个。`model` trim 后非空且 ≤128，同样拒绝 `/`。`weight` 为整数 ≥1。`priority` 为整数，缺省 0。
- 同名（租户内）创建或改名冲突：400，message `virtual model name already exists`。
- 权限与渠道 API 相同：GET `provider:read`，POST `provider:create`，PUT `provider:update`，DELETE `provider:delete`。
- 删除是硬删除。UI 用应用内 Dialog 二次确认，不用 `window.confirm`。

## In scope / Out of scope

**In scope：** 上表全部落点。

**Out of scope：** 条件路由（C-02）、callout、按虚拟模型单独配额、接入 configstatus、改审计表、改 `filterHealthy` 的冷却回落、改门户聊天 UI 组件、改非渠道转发路径的 provider 调用、legacy JSON 导入、在业务代码里硬编码迁移文件名。

## 观察到但未处理

- `gateway_audit_events` 的 PG/MySQL 插入不含 `routing_policy` 列（GW-02 已把该字段放在 JSONL `Event` 上）。虚拟名因此出现在 JSONL 事件，不出现在 PG 行。按主规划不改表。
- `reportUsageDetailed` 里 `SettleCheckedBudget` 在**没有** budget receipt 时会用 `decision.Model` 重选规则。渠道转发的正常路径有 receipt。
- 门户 `POST /api/chat/completions` 只在 `model` 含 `/` 时对照可见模型列表拒绝请求。普通模型名不含 `/` 时本来就直接转发。虚拟名同样不含 `/`，手工提交一个对该用户不可见的虚拟名不会被这条校验拦住。按确认的修法，不为虚拟名单独加服务端校验。列表本身已经按全部目标可见性过滤。
