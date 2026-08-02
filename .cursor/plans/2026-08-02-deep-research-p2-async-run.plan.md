# P2 · 深度调研异步化：run 持久化 + 后台执行 + 断线恢复

Planned-with: claude-opus-5-thinking-medium
Suggested-Impl-Model: `gpt-5.6-terra-medium`（双数据库迁移 + 后台任务生命周期 + 断线恢复幂等，典型跨栈高风险收口）
Parent-Plan: `.cursor/plans/2026-08-02-deep-research-kimi-parity.plan.md`
Depends-On: P0、P1 **必须先合入**

---

## 0. 一句话

P0/P1 之后单次 run 会跑到 10 分钟以上，而现在整个 run 挂在一次 HTTP 请求的
`ReadableStream` 上——**关标签页 = 任务丢失**。P2 把 run 从 HTTP 生命周期里摘出来，
持久化到数据库，支持关页、刷新、换设备后回来继续看。

## 1. 根因与证据链

### 证据 1：run 的全部状态都在闭包里
`enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts` 整个流程写在
`new ReadableStream({ start(controller) { ... } })` 的闭包内，
`registry` / `citationsByQuestion` / `plan` 全是局部变量。
客户端断开 → `deps.signal` abort → 所有中间结果**直接蒸发**，一分钟前抓的 40 篇正文全丢。

### 证据 2：已有的持久化只覆盖 artifact，不覆盖 run 本身
`artifact-store.ts` 会把车道备忘写进 `enterprise_chat_artifacts`（`MAX_ARTIFACTS_PER_RUN = 40`），
但**没有任何地方记录 run 的状态、事件序列、进度**。
重连时无从知道「这个 run 到哪一步了」。

### 证据 3：clarify 的跨进程恢复已有先例，可借鉴但不可照搬
`run-wait.ts` 用「内存 waiter + `enterprise/.runtime/deep-research-clarify/*.json` 文件」双路
解决了 HMR 下的等待恢复。这个模式证明了跨 isolate 恢复的必要性，
但**文件路径方案不能用于 run 持久化**——多实例部署下不共享，且 `.runtime` 内容属于运维实现细节，
按用户既有规范不得出现在面向用户的界面里。run 状态必须进 PG/MySQL。

---

## 2. In scope / Out of scope

### In scope
- 新建 PG schema `enterprise/packages/db-schema/src/schema/deep-research-runs.ts`
- 新建 MySQL schema `enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts`
- 新建迁移 `drizzle/0040_enterprise_deep_research_runs.sql` 与
  `drizzle-mysql/0012_enterprise_deep_research_runs.sql`
- 新建 `enterprise/apps/web-portal/src/lib/deep-research/run-store.ts`
- 新建路由 `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts`（列表）
  与 `.../runs/[runId]/stream/route.ts`（重连续看）
- 改 `orchestrator.ts`：事件双写（SSE + run-store）、后台执行不随请求中断
- 前端：`enterprise/features/chat` 增加「进行中的调研」入口与重连逻辑
- 相应单测

### Out of scope（**违反即回退**）
- 不引入消息队列 / Redis / BullMQ 等新基础设施；后台执行用 Node 进程内任务 + DB 状态。
- 不改 `run-wait.ts` 的 clarify 等待机制（它已经能工作，P2 只在其之上叠 run 持久化）。
- 不改 `artifact-store.ts`。
- 不改 P0 的 `page-fetch.ts` / `report-writer.ts`、P1 的三个新模块。
- 不做跨实例任务调度（单实例内可恢复即可；多实例场景在 plan 的「已知限制」里如实写明）。
- 不做邮件 / IM 通知，完成通知只做**站内**（会话列表标记 + 浏览器 Notification 可选）。

---

## 3. FR-1：数据库表

### 3.1 PG schema
**新建** `enterprise/packages/db-schema/src/schema/deep-research-runs.ts`，
风格严格对齐 `src/schema/chat-artifacts.ts`：

```typescript
import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Portal deep-research run lifecycle (async execution + reconnect). */
export const enterpriseDeepResearchRuns = pgTable(
  "enterprise_deep_research_runs",
  {
    runId: varchar("run_id", { length: 26 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    sessionId: varchar("session_id", { length: 26 }).notNull(),
    /** running | awaiting_clarify | completed | failed | cancelled */
    status: varchar("status", { length: 32 }).default("running").notNull(),
    /** recon | clarify | plan | lanes | reflect | synthesize | done */
    phase: varchar("phase", { length: 32 }).default("recon").notNull(),
    topic: text("topic").notNull(),
    /** 有序 DeepResearchEvent[]，重连时全量重放。 */
    events: jsonb("events").$type<unknown[]>().default([]).notNull(),
    /** 已产出的报告 Markdown（增量追加），完成前可为部分内容。 */
    reportMarkdown: text("report_markdown").default("").notNull(),
    /** 序列化的 Citation[]，用于 sources 段重放。 */
    citations: jsonb("citations").$type<unknown[]>().default([]).notNull(),
    errorMessage: text("error_message"),
    eventSeq: integer("event_seq").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index("enterprise_deep_research_runs_session_idx").on(
      table.tenantId,
      table.sessionId,
      table.createdAt,
    ),
    statusIdx: index("enterprise_deep_research_runs_status_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
  }),
);
```

在 `enterprise/packages/db-schema/src/schema/index.ts` 追加导出**一行**
（`export * from "./deep-research-runs";`，**不要整段重写 index.ts**）。

### 3.2 MySQL schema
**新建** `enterprise/packages/db-schema/src/mysql-schema/deep-research-runs.ts`，
字段名与语义**逐一对应**，类型按 MySQL 侧既有 `mysql-schema/chat-artifacts.ts` 的写法映射
（`jsonb` → `json`，`timestamp withTimezone` → 该文件既有的 timestamp 写法）。
同样在 `src/mysql-schema/index.ts` 追加一行导出。

### 3.3 迁移
- `enterprise/packages/db-schema/drizzle/0040_enterprise_deep_research_runs.sql`
- `enterprise/packages/db-schema/drizzle-mysql/0012_enterprise_deep_research_runs.sql`

均使用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`（MySQL 侧按其既有迁移文件的
索引写法处理，MySQL 不支持 `CREATE INDEX IF NOT EXISTS`，参照 `drizzle-mysql/0011_*.sql` 的做法）。
同步更新 `drizzle/meta` 与 `drizzle-mysql/meta`（用 drizzle-kit 生成，勿手改 journal）。

### AC-1
- `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts` 通过
  （该测试校验 PG 与 MySQL schema 字段一致，新表必须同时存在）。
- `pnpm -C enterprise db:migrate` 在干净库上成功，重复执行幂等不报错。

---

## 4. FR-2：`run-store.ts`

**新建** `enterprise/apps/web-portal/src/lib/deep-research/run-store.ts`，
三态实现（PG / MySQL / 内存回落）**照搬 `artifact-store.ts` 的组织方式**：
同样从 `@agenticx/iam-core` 取 `getIamDb` / `createMysqlDb` / `resolveDatabaseConfig`，
同样导出 `createRunStore()` 工厂。

### 契约
```typescript
export const MAX_EVENTS_PER_RUN = 400;
/** 事件批量落库间隔，避免每条事件一次 UPDATE。 */
export const RUN_FLUSH_INTERVAL_MS = 1_500;

export type DeepResearchRunStatus =
  | "running" | "awaiting_clarify" | "completed" | "failed" | "cancelled";

export type RunRecord = {
  runId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  status: DeepResearchRunStatus;
  phase: string;
  topic: string;
  events: DeepResearchEvent[];
  reportMarkdown: string;
  citations: Citation[];
  errorMessage?: string;
  eventSeq: number;
  createdAt: string;
  updatedAt: string;
};

export type RunStore = {
  create(input: {
    runId: string; tenantId: string; userId: string; sessionId: string; topic: string;
  }): Promise<RunRecord>;
  /** 追加事件并可选更新 status/phase；超过 MAX_EVENTS_PER_RUN 时丢弃最旧的 lane_progress。 */
  appendEvents(runId: string, events: DeepResearchEvent[], patch?: {
    status?: DeepResearchRunStatus; phase?: string;
  }): Promise<void>;
  appendReport(runId: string, chunk: string): Promise<void>;
  setCitations(runId: string, citations: Citation[]): Promise<void>;
  finish(runId: string, status: "completed" | "failed" | "cancelled", errorMessage?: string): Promise<void>;
  get(tenantId: string, userId: string, runId: string): Promise<RunRecord | null>;
  listActive(tenantId: string, userId: string, sessionId?: string): Promise<RunRecord[]>;
};
```

### 事件裁剪策略（`MAX_EVENTS_PER_RUN` 溢出时）
按优先级**保留**：`run_started`、`phase`、`clarify`、`reflection`、`research_stats`、
`lane_started`、`lane_done`、`artifact`、`narrative`。
优先丢弃最旧的 `lane_progress`（纯进度噪声，重放时不影响可读性）。
仍超限则丢最旧的 `narrative`。**永不丢 `run_started` 与 `clarify`。**

### 批量落库
提供 `createRunWriter(store, runId)` 返回 `{ push(event), pushReport(chunk), flush(), finish(...) }`，
内部按 `RUN_FLUSH_INTERVAL_MS` 合并写入，`finish` 前强制 `flush`。
**目的**：一次 run 有几百个事件，逐条 UPDATE 会打爆 PG。

### AC-2
`run-store.test.ts`（用内存实现跑，不依赖真库）：
- `create` → `appendEvents` → `get` 能读回有序事件。
- 事件数超 `MAX_EVENTS_PER_RUN` 时 `lane_progress` 被优先丢弃，`run_started` 与 `clarify` 仍在。
- `appendReport` 多次调用为**追加**而非覆盖。
- `finish("failed", msg)` 后 `status` 与 `errorMessage` 正确，且再 `appendEvents` 不改变终态。
- `listActive` 只返回 `running` / `awaiting_clarify`。
- `createRunWriter` 在 flush 间隔内多次 push 只触发一次底层写入（用 spy 断言）。

---

## 5. FR-3：orchestrator 后台化

**改** `orchestrator.ts`。核心是把「执行」与「传输」解耦。

### 5.1 事件双写
现有 `enqueueEvent(evt)` 只往 SSE controller 写。改为同时 `writer.push(evt)`；
`enqueueDelta(text)` 同时 `writer.pushReport(text)`。

**实现要点**：`enqueueEvent` / `enqueueDelta` 是闭包内的两个小函数，
只在其函数体内各加一行调用，**不要重排周边代码**。

### 5.2 客户端断开不终止 run（本期最关键的行为变更）
现状：`deps.signal`（来自 HTTP 请求）abort 会让整个 run 抛 `AbortError` 终止。

改为**双信号**：
```typescript
// 请求级信号：只用于停止向 controller 写数据。
const transportSignal = deps.signal;
// run 级信号：只有用户显式取消（调用 cancel 接口）才 abort。
const runController = new AbortController();
```
- 所有传给 `executeSearch` / `fetchPages` / `callGateway*` 的 signal 一律换成 `runController.signal`。
- 向 controller 写数据前判断 `transportClosed`，已关闭则**只写 store，不写 SSE**：
  ```typescript
  let transportClosed = false;
  transportSignal?.addEventListener("abort", () => { transportClosed = true; }, { once: true });
  ```
  `enqueueEvent` / `enqueueDelta` 里 `if (!transportClosed) controller.enqueue(...)`，
  并对 `controller.enqueue` 加 try/catch（流已关闭时 enqueue 会抛）。
- **不要**再对 `deps.signal.aborted` 做 `throw new DOMException("Aborted")`；
  现有代码中所有这类检查（如 `orchestrator.ts:736` 附近）改为检查 `runController.signal.aborted`。

### 5.3 run 生命周期
- 流程开始：`await store.create({...})`，发 `run_started` 事件。
- clarify 进入等待时：`appendEvents(..., { status: "awaiting_clarify" })`；resume 后改回 `running`。
- 每次 `phase` 事件同时 patch `phase` 字段。
- 全部完成：`writer.flush()` → `store.setCitations(...)` → `store.finish(runId, "completed")`。
- 顶层 catch：`store.finish(runId, "failed", message)`，**即使 SSE 已断也要执行**。

### 5.4 依赖注入
`DeepResearchDeps`（`orchestrator.ts:72-91`）新增：
```typescript
  runStore?: RunStore;
```
内部 `const store = deps.runStore ?? createRunStore();`

### AC-3
`orchestrator.test.ts`：
- 注入内存 `runStore`，在 lanes 阶段 abort `deps.signal`，断言：
  run **仍继续执行到底**（`executeSearch` 调用次数与未 abort 时一致），
  且 `store.get(runId).status === "completed"`、`reportMarkdown` 非空。
- 断言 abort 之后没有再向 controller enqueue（用 spy 计数）。
- 断言顶层异常时 `store.finish` 被以 `"failed"` 调用且带错误信息。
- 断言 clarify 等待期间 store 中 `status === "awaiting_clarify"`。

---

## 6. FR-4：重连 API

### 6.1 列表
**新建** `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts`
- `GET`，query 支持 `?sessionId=`
- 鉴权沿用同目录其它 chat 路由的既有方式（**照抄邻近路由的鉴权段，不要自创**）
- 返回 `listActive(tenantId, userId, sessionId)` 的精简投影：
  `{ runId, sessionId, status, phase, topic, updatedAt }`（**不返回 events / reportMarkdown**，避免大包）
- `export const runtime = "nodejs";`

### 6.2 重连续看
**新建** `.../runs/[runId]/stream/route.ts`
- `GET`，返回 `text/event-stream`
- 行为：
  1. 校验该 run 属于当前 `tenantId + userId`，否则 404（**不要 403**，避免探测 runId）
  2. 立即重放 `record.events`（逐条 `formatDeepResearchEventSse`）与 `record.reportMarkdown`
     （作为一个 delta 帧）
  3. 若 `status` 已是终态，直接 `data: [DONE]` 并关闭
  4. 否则进入轮询：每 `1_000ms` 重新 `get(runId)`，把 `eventSeq` 之后的新事件与
     `reportMarkdown` 的新增后缀推给客户端，直到终态或客户端断开
- `export const maxDuration = 900;` `export const runtime = "nodejs";`

**幂等要点**：客户端可能重连多次，重放必须基于 `eventSeq` 与 `reportMarkdown.length` 做增量位点，
不能重复推送已发内容（否则报告会出现整段重复——这是用户明确反感的既有问题类型）。

### AC-4
新建路由测试：
- 跨用户访问他人 `runId` 返回 404。
- 终态 run 的 stream 一次性重放全部事件并立刻 `[DONE]`。
- 进行中的 run：先重放历史，store 追加新事件后能在下一轮轮询推出，且**不重复**已推送内容。

---

## 7. FR-5：前端重连与完成提示

### 7.1 会话进入时探测
在聊天会话加载处（`enterprise/features/chat` 的会话初始化逻辑）调用
`GET /api/chat/deep-research/runs?sessionId=...`。若有进行中的 run：
- 在消息区顶部显示一条**可点击的恢复条**：`「深度调研进行中（<phase 中文名>）· 点击继续查看」`
- 点击后连 `.../runs/[runId]/stream`，把事件喂进现有 `buildDeepResearchSegments`
  （**复用现有渲染管线，不要新写一套**）

### 7.2 完成提示
run 转 `completed` 时，在会话内以既有 toast 机制提示「深度调研已完成」。
若页面处于后台且用户已授权，可选发一条浏览器 `Notification`——
**未授权时不得弹权限请求打断用户**，静默跳过。

### 7.3 状态一致性（既有偏好，必须遵守）
- 恢复条上的状态、气泡内的「正在输入」、历史会话面板的标签，三处必须同步；
  不得一边显示生成中、另一边显示「已中断」。
- 未发出首条用户消息的空会话不得预先打「已中断」占位。

### AC-5
- 手工：发起深度调研 → 30 秒后关闭标签页 → 重新打开同一会话 →
  看到恢复条 → 点击后能看到**完整**历史时间线并继续接收后续章节，报告无重复段落。
- 手工：run 完成后再打开会话，不再显示恢复条，报告完整可见。

---

## 8. 已知限制（必须写进 plan，不得对外含糊）

- 后台执行寄生在 Node 进程内。**进程重启 / 部署滚动会中断进行中的 run**，
  该 run 会停在非终态。需要一个启动期兜底：进程启动时把
  `status IN ('running','awaiting_clarify')` 且 `updated_at` 早于 30 分钟的 run 标为 `failed`
  （在 `run-store.ts` 提供 `reapStaleRuns(olderThanMs)`，由现有 bootstrap 流程调用一次）。
- 多实例部署下，重连请求可能落到没有执行该 run 的实例上。此时轮询 DB 仍能读到进度
  （因为执行侧在写 DB），**只读可用**；但取消操作只对本实例有效。真正的跨实例调度不在本期。

---

## 9. 验收命令

```bash
cd enterprise
pnpm -C enterprise db:migrate
pnpm --filter @agenticx/db-schema test
pnpm --filter @agenticx/web-portal test -- src/lib/deep-research src/app/api/chat/deep-research
pnpm --filter @agenticx/web-portal typecheck
```

人工回归前先 `bash enterprise/scripts/start-dev-with-infra.sh`（必须带中间件，
否则 PG 不可达会表现为 `chat history operation failed` 类错误）。
