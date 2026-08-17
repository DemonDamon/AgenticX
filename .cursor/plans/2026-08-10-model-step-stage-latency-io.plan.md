# 模型步骤级可观测补全：阶段语义 + 真实耗时 + 失败态（可选 I/O 采样）

Planned-with: Claude Opus 5
Suggested-Impl-Model: 见下方「子任务 → 推荐模型」表

> 前序：`2026-08-10-enterprise-trace-runtime-tree`（聚合 API + 过程树）、`2026-08-10-trace-runtime-conversation-ui`（双栏 + 本轮对话 I/O）。
> 本 plan 补齐**每个模型步骤自身**的可观测信息，让过程树上的 `model_step` 节点从「一堆只有 token 数的匿名步骤」变成「看得出是哪一阶段、跑了多久、成没成功」。

## 背景与根因（证据链，勿依赖对话记忆）

1. **只有 Gateway 写 `agent_token_traces`。** 生产唯一写入点是
   `enterprise/apps/gateway/internal/server/cache_integration.go` 的
   `reportUsageDetailed()`（L118–177），内部调用
   `enterprise/apps/gateway/internal/metering/trace_reporter.go` 的
   `TraceReporter.ReportAsync()`（L53–118）做 upsert。
   web-portal / admin-console **不直接写这张表**，portal 只负责递增
   `x-agenticx-trace-step` 并透传 `x-agenticx-trace-id`。

2. **三个字段建好了但从没写过。** `TraceSpanRecord`（trace_reporter.go L14–31）
   已有 `DurationMS` / `ErrorMessage` / `Metadata`，SQL upsert（L89–113）也把这三列
   写进 `agent_token_traces`，但 `reportUsageDetailed` 的构造体（cache_integration.go
   L161–175）**一个都没填**：`Status` 硬编码 `"ok"`、`DurationMS` 缺省 0、`Metadata` 为 nil。
   结果：过程树里 model 节点 `durationMs` 恒为 0（双栏 UI 的耗时迷你条对 model 节点完全失效），
   失败的模型调用根本不落 span。

3. **步骤没有阶段语义。** 深度调研一轮会打十几次 Gateway
   （`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` 的
   `gatewayCallHeaders()` L303–310 每次 `nextTraceStep()` +1），
   联网搜索走 `enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts`
   `callGatewayStream()` L357–365。落库后全都是 `step_kind='model'`，
   admin 侧只能显示 `step 1 / step 2 / …`，分不清哪一步是 plan、哪一步是 lane 扩写、
   哪一步是章节流式写作。

4. **deep-research resume 丢 trace。**
   `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`
   构造 gatewayHeaders（约 L544–553）时**没有** `x-agenticx-trace-id`，
   而首轮 `app/api/chat/completions/route.ts` L174 会传 `traceId: logCtx.traceId`。
   续跑产生的 span 因此挂不到原 trace 上（或因 traceID 为空被
   `ReportAsync` L56 直接丢弃）。

5. **正文 I/O 不在这张表。** `agent_token_traces` 只有计量字段；对话正文在
   `chat_messages`（已由前序 plan 的 `trace-conversation-io.ts` 读出）。
   单步的 prompt / completion 目前**任何地方都没有落库**——这是 Phase B 要解决的，
   但涉及 PII 与存储成本，默认关闭。

## Goal

- Phase A（默认开启、零新增 PII）：过程树上每个 model 节点能显示**阶段名 + 真实耗时 + 成功/失败**。
- Phase B（默认关闭、显式开关）：允许按租户采样落单步 prompt/completion 摘要，
  复用 `agent_token_traces.metadata`，**不新增数据库列、不需要 migration**。

## In scope

- FR-1：Gateway 落 `duration_ms`（上游真实耗时）
- FR-2：Gateway 落 `status` / `error_message`，失败调用也写 span
- FR-3：新增 `X-AgenticX-Trace-Stage` 请求头协议，Gateway 落到 `metadata.stage`
- FR-4：web-portal 三条链路（直连 / 联网搜索 / 深度调研）在各调用点带上 stage
- FR-5：deep-research resume 补 `x-agenticx-trace-id`
- FR-6：admin 过程树用 stage 渲染 model 节点标题，耗时条生效
- FR-7（Phase B，默认关闭）：`GATEWAY_TRACE_IO_CAPTURE` 开关 + 截断落 `metadata.io`

## Out of scope（no-scope-creep 边界）

- 不新增数据库列、不写 migration（Phase B 复用既有 `metadata` jsonb/json 列）
- 不改 `usage_records` / 计费 / 配额逻辑
- 不引入 OTLP exporter 或额外外部追踪依赖
- 不改 `chat_messages` 写路径与前端 chat store
- 不做 Desktop 端（`desktop/`）任何改动
- 不把 Enterprise chat 改造成 OpenAI `tool_calls` 循环（现状：联网搜索是 search-first，
  深度调研是多阶段 JSON/stream 调用，本 plan 不动这个架构）

---

## Phase A：阶段语义 + 耗时 + 失败态

### FR-1 / FR-2：Gateway 落耗时与失败态

**落点：** `enterprise/apps/gateway/internal/server/cache_integration.go`

`reportUsageDetailed` 增加一个 span 元信息参数。为避免 8 处调用点全部大改，
**新增一个可选参数结构体**并保留旧签名语义：

```go
// cache_integration.go 新增
type spanMeta struct {
    DurationMS   int
    Status       string // "" → "ok"
    ErrorMessage string
    Stage        string
}

func (s *Server) reportUsageDetailed(
    identity requestIdentity,
    decision routing.Decision,
    usage openai.Usage,
    budgetCheck *quota.CheckResult,
    span spanMeta, // 新增末位参数
) { ... }
```

L160–176 的构造体改为：

```go
if s.traceReporter != nil && strings.TrimSpace(identity.TraceID) != "" && identity.TraceStep > 0 {
    meta := map[string]any{}
    if stage := strings.TrimSpace(firstNonEmpty(span.Stage, identity.TraceStage)); stage != "" {
        meta["stage"] = stage
    }
    if decision.Route != "" {
        meta["route"] = decision.Route
    }
    s.traceReporter.ReportAsync(metering.TraceSpanRecord{
        // …既有字段保持不变…
        Status:       defaultIfEmpty(span.Status, "ok"),
        DurationMS:   span.DurationMS,
        ErrorMessage: span.ErrorMessage,
        Metadata:     meta,
    })
}
```

**调用点逐个改（共 8 处，全部列出，不要遗漏也不要顺手改别的）：**

| 文件 | 行号（当前） | 传入 |
|---|---|---|
| `internal/server/cache_integration.go` | L57 | `spanMeta{DurationMS: int(time.Since(ctx.startedAt).Milliseconds())}`（缓存命中路径，`ctx.startedAt` 见 server.go L818 组装的 ctx） |
| `internal/server/cache_integration.go` | L225 | 同上 |
| `internal/server/protocol_handlers.go` | L231 | 该函数内的 `startedAt` |
| `internal/server/protocol_handlers.go` | L396 | 同上 |
| `internal/server/channel_handlers.go` | L56 | 同上 |
| `internal/server/server.go` | L858 | `handleChatCompletions` 的 `startedAt`（L695） |
| `internal/server/server.go` | L1254 | `handleStream` 的 `startedAt`（参数，L1102） |
| `internal/server/server.go` | L1629 | `reportUsage` 包装器透传 `spanMeta{}` |

若某调用点拿不到 `startedAt`，传 `spanMeta{}`（duration 记 0），**不要**为了拿时间去重构该函数的调用链。

**失败态：** 在 `handleChatCompletions` / `handleStream` 中上游返回非 2xx 或
transport error 的分支（server.go 约 L763 / L795 / L1029 / L1084 已有审计写入点），
额外调一次 `reportUsageDetailed(identity, decision, openai.Usage{}, nil, spanMeta{
DurationMS: …, Status: "error", ErrorMessage: <脱敏后的错误摘要，截断 500 字符>})`。
错误摘要**不得**包含 Authorization / apiKey / 完整上游响应体。

### FR-3：`X-AgenticX-Trace-Stage` 协议

**落点：** `enterprise/apps/gateway/internal/server/trace_context.go`

```go
const (
    headerTraceID    = "X-AgenticX-Trace-Id"
    headerTraceStep  = "X-AgenticX-Trace-Step"
    headerTraceStage = "X-AgenticX-Trace-Stage" // 新增
)

func enrichTraceFromRequest(identity requestIdentity, r *http.Request) requestIdentity {
    if r == nil { return identity }
    identity.TraceID = strings.TrimSpace(r.Header.Get(headerTraceID))
    identity.TraceStep = parseTraceStep(r.Header.Get(headerTraceStep))
    identity.TraceStage = sanitizeStage(r.Header.Get(headerTraceStage)) // 新增
    return identity
}

// 白名单式清洗：仅保留 [a-z0-9._-]，长度上限 64，超出截断；非法字符整串丢弃返回 ""
func sanitizeStage(raw string) string
```

`requestIdentity` 结构体（定义处：`internal/server/` 内搜 `type requestIdentity`）
新增 `TraceStage string` 字段。

**stage 取值约定（固定枚举，实施时照抄）：**

| stage | 含义 |
|---|---|
| `chat.answer` | 直连模型单次问答 |
| `websearch.answer` | 联网搜索后的作答 |
| `websearch.rewrite` | 搜索前的查询改写（若有该调用） |
| `dr.plan` | 深度调研生成研究计划 |
| `dr.clarify` | 澄清提问 |
| `dr.lane.expand` | 单条支线扩写 |
| `dr.memo` | 备忘/摘要 |
| `dr.reflect` | 反思 |
| `dr.outline` | 大纲 |
| `dr.section` | 章节流式写作 |

### FR-4：portal 各调用点带 stage

**落点 1：** `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` L159–162

```diff
   "x-agenticx-trace-id": traceId,
   "x-agenticx-trace-step": "1",
+  "x-agenticx-trace-stage": "chat.answer",
```

L260 / L276 / L287 三处同样补上（按各自分支语义取 `chat.answer`）。

**落点 2：** `enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` L357–365

`callGatewayStream` 增加 `stage?: string` 参数，拼进 headers；
L588 / L605 / L688 三个调用点分别传 `"websearch.rewrite"` / `"websearch.answer"`
（按各自实际语义，实施时对照上下文判断；无法判断时统一 `"websearch.answer"`）。

**落点 3：** `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` L303–310

```diff
-function gatewayCallHeaders(deps: DeepResearchDeps): Record<string, string> {
+function gatewayCallHeaders(deps: DeepResearchDeps, stage?: string): Record<string, string> {
   const step = deps.nextTraceStep?.() ?? "1";
   return {
     ...deps.headers,
     ...(deps.traceId ? { "x-agenticx-trace-id": deps.traceId } : {}),
     "x-agenticx-trace-step": step,
+    ...(stage ? { "x-agenticx-trace-stage": stage } : {}),
   };
 }
```

调用点（当前行号）：L480（`callGatewayStream` → `dr.section`）、
L493（`callGatewayJson` → 由调用方透传）、L964、L1217、L1477（lane expand → `dr.lane.expand`）、
L1675（memo → `dr.memo`）、L1924（reflect → `dr.reflect`）、L2075（section stream → `dr.section`）。
`callGatewayJson` / `callGatewayStream` 各加一个 `stage?: string` 形参往下传。

### FR-5：resume 补 trace_id

**落点：** `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts` 约 L544–553

gatewayHeaders 补 `"x-agenticx-trace-id": <当前请求 logCtx.traceId>`，
并把 `traceId` 传进 `runDeepResearchTurn` 的 deps（对齐
`app/api/chat/completions/route.ts` L174 的写法）。

### FR-6：admin 过程树显示 stage 与耗时

**落点：** `enterprise/apps/admin-console/src/lib/trace-timeline.ts`

组装 `model_step` 节点处（当前把 span 映射成 `TraceNode` 的那段）：

- `label`：优先 `metadata.stage`，格式 `step {step_no} · {stage} · {model}`；
  无 stage 时保持现状 `step {step_no} · {model}`
- `durationMs`：读 `span.durationMs`（此前恒 0，Phase A 后有值）
- `status`：读 `span.status`，`error` 时前端已有红色失败样式（`isFailed()` 见
  `enterprise/apps/admin-console/src/components/trace-timeline-tree.tsx`）
- `attrs.stage` / `attrs.error_message` 一并透出，供右侧详情面板展示

i18n：`enterprise/apps/admin-console/messages/{zh,en}.json` 的
`pages.ops.traceRuntime.detail` 下新增 `stage` / `errorMessage` 两个 key
（zh：`阶段` / `错误信息`；en：`Stage` / `Error`），
在 `TraceExplorer` 右侧详情用 `DetailField` 渲染。

---

## Phase B（默认关闭）：单步 I/O 采样

> 只有当 Phase A 上线后仍需要看「这一步到底喂了什么 prompt、模型回了什么」时才做。
> 默认关闭，避免把 prompt 正文无差别写进审计库。

- 开关：Gateway 环境变量 `GATEWAY_TRACE_IO_CAPTURE`（`off` 默认 / `on`），
  读取位置与其他 gateway env 一致（`internal/config/`）。
- 落库：写入 `agent_token_traces.metadata.io`，结构
  `{ "prompt_preview": string, "completion_preview": string, "truncated": bool }`。
  **单字段上限 2000 字符**，超出截断并置 `truncated: true`；
  metadata 整体序列化上限 8KB，超限则只保留 `stage` 与 `truncated: true`。
- 脱敏：写入前过滤 `Authorization`、`api_key`、`sk-` 前缀串、邮箱、手机号
  （复用 gateway 现有脱敏工具；没有则新建 `internal/metering/redact.go` 并配单测）。
- 前端：admin 右侧详情面板在 `attrs.io` 存在时渲染 prompt/completion 预览，
  沿用前序 plan 已有的截断提示文案风格。
- **不新增数据库列，不写 migration。**

---

## 子任务 → 推荐模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1 / FR-2 / FR-3 Gateway Go 改动 | Codex 系列（代码专精中档） | 8 处调用点签名变更 + 失败分支，后端实施型，需稳但不需审美 |
| FR-4 / FR-5 portal header 透传 | Composer 2.5 / Kimi Code | 机械透传，样板活 |
| FR-6 admin 树标签与 i18n | Composer 2.5 | 小范围前端改动，已有组件骨架 |
| Phase B 脱敏与开关 | GPT-5.x（强推理） | 涉及 PII 与序列化边界，判断成本高 |

---

## AC（可执行验收）

- **AC-1**（FR-1）：`cd enterprise/apps/gateway && go build ./... && go test ./internal/server/... ./internal/metering/...` 全绿；
  新增 `internal/metering/trace_reporter_test.go` 断言 `DurationMS>0` / `ErrorMessage` 能落库
  （用 sqlite 或现有 test handle；若无可用 handle，退化为对 `TraceSpanRecord` 构造的单测）。
- **AC-2**（FR-2）：新增 `internal/server/trace_span_test.go`，构造上游 500 场景，
  断言产生一条 `Status == "error"` 且 `ErrorMessage` 非空、且不含 `Authorization` 字样的 span。
- **AC-3**（FR-3）：`internal/server/trace_context_test.go` 增加用例：
  `X-AgenticX-Trace-Stage: dr.lane.expand` → `identity.TraceStage == "dr.lane.expand"`；
  传入 `"a b<script>"` → 返回 `""`；传入 70 字符 → 截断到 64。
- **AC-4**（FR-4）：`enterprise/apps/web-portal/src/app/api/chat/completions/route.trace.test.ts`
  增加断言 `headers.get("x-agenticx-trace-stage") === "chat.answer"`；
  `lib/deep-research/orchestrator.trace-step.test.ts` 增加断言各阶段 stage 值正确。
- **AC-5**（FR-5）：新增 `app/api/chat/deep-research/resume/route.trace.test.ts`，
  断言 resume 调 Gateway 时带上与请求同一个 `x-agenticx-trace-id`。
- **AC-6**（FR-6）：`enterprise/apps/admin-console/src/lib/__tests__/trace-timeline.test.ts`
  增加用例：span 带 `metadata.stage = "dr.lane.expand"`、`durationMs = 1234`、`status = "error"`
  → 生成的节点 `label` 含 `dr.lane.expand`、`durationMs === 1234`、`status === "error"`。
- **AC-7**：`pnpm -C enterprise/apps/admin-console exec tsc --noEmit` 与
  `pnpm -C enterprise/apps/web-portal exec tsc --noEmit` 通过。
- **AC-8**（人工）：本地 `bash enterprise/scripts/start-dev-with-infra.sh` 起栈，
  发一轮深度调研，在 admin `/traces/<trace_id>` 看到 model 节点带阶段名、
  耗时条长度有差异、失败步骤显示红色。
- **AC-9**：`git status` 中不含 `enterprise/packages/db-schema/drizzle*` 的新增文件
  （本 plan 不产生 migration）。
