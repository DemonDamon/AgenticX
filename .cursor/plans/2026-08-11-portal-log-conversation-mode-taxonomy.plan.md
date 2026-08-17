# Portal 日志按「对话形态」分类（普通对话 / 深度调研）

Planned-with: Opus 5
Suggested-Impl-Model: 见下方子任务表

> **For implementers:** 仅凭本 plan 即可落地；勿依赖对话上下文。所有落点均给出文件路径 + 锚点代码。

**Goal:** 后台 Portal 日志的一级分类从「HTTP 路由」改为「对话形态」：一次深度调研的所有请求统一标记 `deep_research`（并带 `run_id`），普通对话标记 `chat`，联网搜索标记 `web_search`。同一次深度调研在列表中默认只呈现一条主记录，空壳 ack 不再占位。

**Architecture:** 分类必须在**写日志时**决定并落列，不能在后台按 `route` 反推——因为深度调研的入口路由同样是 `chat.completions`（`enableDeepResearch` 只体现在 body flag），事后无法区分。

**Tech Stack:** Next.js (web-portal BFF / admin-console) + drizzle (PG + MySQL 双方言) + vitest。

---

## 根因与证据链（写进 plan，勿依赖对话记忆）

1. `enterprise/apps/web-portal/src/lib/observability/with-request-log.ts` 目前只按 `route` 记日志，无「对话形态」维度。
2. 深度调研首轮走的是 `chat.completions`：见 `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` L111 `enableDeepResearch = parsed.agenticx_deep_research === true;`，L165 `if (enableDeepResearch && parsedBody) { return runDeepResearchTurn(...) }`。因此后台看到的 `route=chat.completions` **既可能是普通对话也可能是深度调研**。
3. `deep_research.resume` 存在大量「空壳 ack」：`resume/route.ts` 的 `alreadyContinued()`（L74-L80）与各类 400 早退，只返回 JSON、不跑模型；实测该行 `模型步骤: 0 / Token: 0 / 耗时 10ms`，`session_id: null`，过程页提示「未找到关联的聊天消息」。
4. `resume/route.ts` L93 `logCtx.setUser({ userId, tenantId })` **未传 sessionId**，而 `sessionId` 在 L269 / L436 才解析出来（`run?.sessionId || clientSessionId`），故日志行 `session_id` 恒为 null。
5. `portal_request_logs` 现有列见 `enterprise/packages/db-schema/src/schema/portal-request-logs.ts` 与 `src/mysql-schema/portal-request-logs.ts`：无 `mode` / `run_id`。
6. 后台一级筛选目前是路由：`enterprise/apps/admin-console/src/app/portal-logs/page.tsx` L48-L54 `ROUTE_FILTER_OPTIONS`。

> 存量历史数据已于 2026-08-10 清空（`portal_request_logs` / `chat_*` / `enterprise_deep_research_runs` 等 truncate），因此**不需要数据回填脚本**；仅需对 `mode IS NULL` 的遗留行做兼容显示。

---

## In scope

- `portal_request_logs` 新增 `mode` / `run_id` 两列（PG + MySQL 双方言迁移 + parity 测试更新）
- `RequestLogCtx` 新增 `setMode()` / `setRun()`，并把 `mode` / `run_id` 落列
- 四条路由接线：`chat.completions`、`deep_research.resume`、`deep_research.runs`、`deep_research.stream`
- `resume` 补 `sessionId`；无副作用 ack 不写 info 级 finish
- admin-console：一级筛选改「会话类型」，列表加类型徽标，详情/过程页展示 `run_id`
- i18n（zh / en）

## Out of scope / no-scope-creep

- 不改 Gateway（Go）任何代码；`agent_token_traces` 的 stage/latency 已在 `2026-08-10-model-step-stage-latency-io.plan.md` 落地，本 plan 不动
- 不改 Deep Research 编排逻辑（`lib/deep-research/orchestrator.ts` 等）
- 不做「多行合并成一行」的聚合查询视图（靠抑制空壳 + `run_id` 关联即可，不引入 GROUP BY 分页）
- 不改 Desktop / `agenticx/` Python 侧
- 不写历史数据回填脚本
- 不调整 `PORTAL_LOG_DB_SINK` / `PORTAL_LOG_LEVEL` 语义

## Suggested-Impl 子任务表

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| FR-1 schema + 双方言迁移 + parity 测试 | Composer 2.5 | 有 `0017/0043` 现成模板，纯样板 |
| FR-2/FR-3 观测层管道（ctx → logger → sink） | Codex 中档 | 跨 3 文件、类型贯通，需谨慎不漏字段 |
| FR-4 四条路由接线 | Codex 中档 | 涉及早退分支判断，易漏 |
| FR-5/FR-6 admin 查询 + UI 筛选/徽标 | Composer 2.5 | 明确落点的表单与列渲染 |
| FR-7 i18n | Composer 2.5 | 纯文案 |

---

## FR / AC

### FR-1: `portal_request_logs` 新增 `mode` / `run_id`

**落点 1** `enterprise/packages/db-schema/src/schema/portal-request-logs.ts`

after（在 L16 `route` 之后插入两列，L25 起的索引块追加两个索引）:

```ts
    route: varchar("route", { length: 128 }),
    /** 对话形态：chat | deep_research | web_search；写日志时决定，勿按 route 反推。 */
    mode: varchar("mode", { length: 32 }),
    /** 深度调研 run_id（ULID）；同一次调研的多条请求日志共享。 */
    runId: varchar("run_id", { length: 64 }),
```

```ts
    tenantModeTimeIdx: index("portal_request_logs_tenant_mode_time_idx").on(
      table.tenantId,
      table.mode,
      table.logTime,
    ),
    tenantRunIdx: index("portal_request_logs_tenant_run_idx").on(table.tenantId, table.runId),
```

**落点 2** `enterprise/packages/db-schema/src/mysql-schema/portal-request-logs.ts` — 同样两列两索引（`varchar` 写法一致）。

**落点 3** 新建 `enterprise/packages/db-schema/drizzle/0051_portal_request_logs_mode.sql`（参照 `drizzle/0050_deep_research_runs_trace_id.sql` 风格）:

```sql
ALTER TABLE "portal_request_logs" ADD COLUMN IF NOT EXISTS "mode" varchar(32);
--> statement-breakpoint
ALTER TABLE "portal_request_logs" ADD COLUMN IF NOT EXISTS "run_id" varchar(64);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_mode_time_idx"
  ON "portal_request_logs" ("tenant_id", "mode", "log_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_run_idx"
  ON "portal_request_logs" ("tenant_id", "run_id");
```

**落点 4** 新建 `enterprise/packages/db-schema/drizzle-mysql/0025_portal_request_logs_mode.sql`（参照 `drizzle-mysql/0024_deep_research_runs_trace_id.sql`）:

```sql
ALTER TABLE `portal_request_logs` ADD COLUMN `mode` varchar(32);
--> statement-breakpoint
ALTER TABLE `portal_request_logs` ADD COLUMN `run_id` varchar(64);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_mode_time_idx` ON `portal_request_logs` (`tenant_id`, `mode`, `log_time`);
--> statement-breakpoint
CREATE INDEX `portal_request_logs_tenant_run_idx` ON `portal_request_logs` (`tenant_id`, `run_id`);
```

**落点 5** journal：`drizzle/meta/_journal.json` 追加 `{ "idx": 50, "version": "7", "when": 1787299200000, "tag": "0051_portal_request_logs_mode", "breakpoints": true }`；`drizzle-mysql/meta/_journal.json` 追加 `{ "idx": 25, "version": "5", "when": 1787299200001, "tag": "0025_portal_request_logs_mode", "breakpoints": true }`。

**落点 6** `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts`：`sqlFiles.sort()` 数组追加 `"0025_portal_request_logs_mode.sql"`；journal 断言追加 `expect.objectContaining({ idx: 25, tag: "0025_portal_request_logs_mode" })`；PG 迁移清单对应追加 `0051_portal_request_logs_mode`。**注意**：`pgTables.size` 仍为 51、baseline `CREATE TABLE` 仍为 42，不要改这两个数字。

- **AC-1:** `pnpm --filter @agenticx/db-schema test` 全绿（含 parity 与迁移清单）。
- **AC-2:** `pnpm -C enterprise db:migrate`（MySQL dev 库）后，`SHOW COLUMNS FROM portal_request_logs` 含 `mode` / `run_id`。

### FR-2: 观测管道透传 `mode` / `run_id`

**落点 1** `enterprise/apps/web-portal/src/lib/observability/with-request-log.ts`

before（L20-L23）:

```ts
export type RequestLogCtx = {
  traceId: string;
  setUser(user: RequestLogUser): void;
};
```

after:

```ts
export type ConversationMode = "chat" | "deep_research" | "web_search";

export type RequestLogCtx = {
  traceId: string;
  setUser(user: RequestLogUser): void;
  /** 对话形态；未调用时按 route 取默认值（见 defaultMode）。 */
  setMode(mode: ConversationMode): void;
  /** 深度调研 run_id；同一 run 的多条请求共享。 */
  setRun(runId: string): void;
  /** 无副作用 ack（如 alreadyContinued / 参数早退）：成功路径不写 info finish。 */
  markNoop(): void;
};
```

实现要点（同文件）：

- 新增 `function defaultMode(route: string): ConversationMode` — `route.startsWith("deep_research")` → `"deep_research"`，否则 `"chat"`。
- 闭包内维护 `let mode: ConversationMode | null = null; let runId = ""; let noop = false;`。
- L53 的 `if (shouldLogSuccessFinish(route))` 改为 `if (shouldLogSuccessFinish(route) && !noop)`。
- finish / error 两处 `log(...)` 的字段对象追加 `mode: mode ?? defaultMode(route)` 与 `run_id: runId || undefined`。

**落点 2** `enterprise/apps/web-portal/src/lib/observability/logger.ts`

- L20-L32 `STRUCTURED_KEYS` 追加 `"mode"`、`"run_id"`（否则会被塞进 `fields` JSON）。
- L10 起的 `LogFields` 类型追加 `mode?: string; run_id?: string;`。
- L126 起的 `enqueueLog({...})` 追加：
  ```ts
    mode: typeof safe.mode === "string" ? safe.mode : undefined,
    run_id: typeof safe.run_id === "string" ? safe.run_id : undefined,
  ```

**落点 3** `enterprise/apps/web-portal/src/lib/observability/db-sink.ts`

- L8 起 `PortalLogRow` 追加 `mode?: string; run_id?: string;`。
- L78 起 `defaultInsertBatch` 的 `values` 映射追加 `mode: row.mode ?? null, runId: row.run_id ?? null,`（PG 与 MySQL 两个 case 共用同一 `values`，无需分别改）。

- **AC-3:** 新增 `with-request-log.test.ts` 用例：`withRequestLog("chat.completions", ...)` 未调用 `setMode` 时 finish 行 `mode === "chat"`；调用 `setMode("deep_research")` 后为 `"deep_research"`。
- **AC-4:** 新增用例：`ctx.markNoop()` 后成功路径**不产生** `*.finish` 行，但抛错时仍产生 `*.error` 行（level `error`）。
- **AC-5:** `db-sink.test.ts` 增加断言：`enqueueLog` 携带 `mode`/`run_id` 时 `insertBatch` 收到的行含这两个字段。

### FR-3: 保留既有轮询抑制语义

`with-request-log.ts` L14 `POLLING_ROUTES` 与 `shouldLogSuccessFinish` 保持不变（`deep_research.runs` 成功不写 finish）。**不要**因为新增 `markNoop` 而删除它。

- **AC-6:** 既有用例「skips deep_research.runs success finish but still logs chat.completions」仍绿。

### FR-4: 四条路由接线

**落点 1** `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`

在 L149（`} catch { // body 不是 JSON 时维持原样转发 }` 之后、L151 `const gatewayHeaders` 之前）插入：

```ts
  logCtx.setMode(
    enableDeepResearch ? "deep_research" : enableWebSearch ? "web_search" : "chat",
  );
```

**落点 2** `enterprise/apps/web-portal/src/app/api/chat/deep-research/resume/route.ts`

- L93 `logCtx.setUser({ userId, tenantId })` 之后补 `logCtx.setMode("deep_research");`
- L120 `if (!runId)` 早退之前补 `logCtx.setRun(runId);`（`runId` 于 L119 解析）；该早退分支及其它 400 分支返回前调用 `logCtx.markNoop()`
- `alreadyContinued(runId)`（L74-L80）的所有调用点：返回前调用 `logCtx.markNoop()`（该函数本身在 `withRequestLog` 闭包外，不要给它加参数；在调用侧写 `logCtx.markNoop(); return alreadyContinued(runId);`）
- L269 与 L436 解析出 `sessionId` 后补 `logCtx.setUser({ sessionId });`

**落点 3** `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/route.ts` — L144 `logCtx.setUser(...)` 旁补 `logCtx.setMode("deep_research");`

**落点 4** `enterprise/apps/web-portal/src/app/api/chat/deep-research/runs/[runId]/stream/route.ts` — L53 `logCtx.setUser(...)` 旁补 `logCtx.setMode("deep_research"); logCtx.setRun(params.runId);`（`runId` 取该路由已解析的路径参数变量名，勿臆造）

- **AC-7:** 手工验证：前台发一条**普通**对话 → `portal_request_logs` 新行 `mode='chat'`；开深度研究发一条 → 新行 `mode='deep_research'` 且 `run_id` 非空。
- **AC-8:** 手工验证：一次完整深度调研（含澄清 → 继续）在 `level='info'` 下**只产生 1~2 行**，且不再出现 `模型步骤 0 / 10ms / session_id null` 的空壳 `deep_research.resume.finish`。
- **AC-9:** `resume` 真正续跑（非 ack）的行 `session_id` 非 null。

### FR-5: admin 查询层支持 `mode` / `run_id`

**落点 1** `enterprise/apps/admin-console/src/lib/portal-logs-query.ts`

- L7 `PortalLogQueryInput` 追加 `mode?: string; run_id?: string;`
- L21 `PortalLogItem` 追加 `mode: string | null; run_id: string | null;`
- L60 `mapRow` 入参与返回同步追加 `mode` / `runId → run_id`
- 新增兼容遗留 NULL 的条件构造（PG / MySQL 两个 case 共用）：

```ts
function modeCondition(
  table: typeof pgPortalRequestLogs | typeof mysqlPortalRequestLogs,
  mode: string | undefined,
): SQL | undefined {
  if (!mode) return undefined;
  // 遗留行 mode 为 NULL 时按 route 兜底，避免历史数据在筛选下彻底消失。
  if (mode === "deep_research") {
    return or(
      eq(table.mode, "deep_research"),
      and(isNull(table.mode), like(table.route, "deep_research%")),
    );
  }
  if (mode === "chat") {
    return or(
      eq(table.mode, "chat"),
      and(isNull(table.mode), eq(table.route, "chat.completions")),
    );
  }
  return eq(table.mode, mode);
}
```

（`or` / `isNull` / `like` 需加入 L1 的 `drizzle-orm` import）

- 两个 case 内在 `route` 条件旁追加 `const md = modeCondition(table, input.mode); if (md) conditions.push(md);` 与 `if (input.run_id) conditions.push(eq(table.runId, input.run_id));`

**落点 2** `enterprise/apps/admin-console/src/app/api/portal-logs/query/route.ts`

- L19-L28 的 `fields` 常量数组追加 `"mode"`、`"run_id"`；`parsed` 初始对象同步补两个 `undefined`
- L54 `queryPortalLogs({...})` 追加 `mode: parsed.mode, run_id: parsed.run_id,`

- **AC-10:** 新增/更新该 route 的既有测试（`src/app/api/audit/query/__tests__/` 同风格）：传 `mode: "deep_research"` 不报 400，并透传到 `queryPortalLogs`。

### FR-6: admin UI 一级分类改为「会话类型」

**落点** `enterprise/apps/admin-console/src/app/portal-logs/page.tsx`

- L48-L56：保留 `ROUTE_FILTER_OPTIONS`（降级为高级筛选），新增：

```ts
const MODE_FILTER_OPTIONS = ["", "chat", "deep_research", "web_search"] as const;
type ModeFilter = (typeof MODE_FILTER_OPTIONS)[number];
```

- 新增 `const [mode, setMode] = useState<ModeFilter>("")`，并加入 L90 `load` 的 body 与 L128 依赖数组
- 筛选区（L251 的「路由」Select **之前**）插入「会话类型」Select：全部 / 普通对话 / 深度调研 / 联网搜索
- 列表列（L134 `columns`）在 `event` 之后插入 `mode` 列，用 `Badge` 渲染：`deep_research` → `variant="default"` 文案「深度调研」；`web_search` → `variant="secondary"` 文案「联网搜索」；`chat`/空 → `variant="secondary"` 文案「普通对话」
- 详情 Sheet 增加 `run_id` 行（有值才显示），文案 key `detail.runId`

- **AC-11:** 后台选「深度调研」只出深研链路记录；选「普通对话」不出深研记录（含首轮 `chat.completions`）。
- **AC-12:** 列表每行可见类型徽标；`pnpm -C enterprise/apps/admin-console typecheck` 与 `build` 绿。

### FR-7: i18n

`enterprise/apps/admin-console/messages/zh.json` 的 `pages.ops.portalLogs`（L1043 起）追加：

```json
"filterMode": "会话类型",
"modeAll": "全部",
"modeChat": "普通对话",
"modeDeepResearch": "深度调研",
"modeWebSearch": "联网搜索",
"columns": { "mode": "类型" },
"detail": { "runId": "调研任务 ID" }
```

（`columns` / `detail` 为**合并进已有对象**，勿整块覆盖）；`messages/en.json` 同结构英文：`Conversation type` / `All` / `Chat` / `Deep research` / `Web search` / `Type` / `Research run ID`。

- **AC-13:** 两个 locale 文件 key 集合一致，页面无 `MISSING_MESSAGE` 警告。

---

## 验收顺序（实施者自测清单）

1. `pnpm --filter @agenticx/db-schema test`
2. `pnpm -C enterprise db:migrate`
3. `pnpm --filter @agenticx/app-web-portal exec vitest run src/lib/observability`
4. `pnpm -C enterprise/apps/admin-console typecheck && pnpm -C enterprise/apps/admin-console build`
5. 起 `bash enterprise/scripts/start-dev-with-infra.sh --skip-infra --db=mysql --ui=stream --webpack`，分别发一条普通对话与一次深度调研，按 AC-7 / AC-8 / AC-11 核对后台

## 风险与回滚

- **风险 1**：`markNoop()` 漏加在某个早退分支 → 仍出现空壳行。缓解：AC-8 手工核对；不影响正确性，仅噪音。
- **风险 2**：`STRUCTURED_KEYS` 忘了加 `mode`/`run_id` → 值被写进 `fields` JSON 而非新列，后台筛选恒空。缓解：AC-5 断言。
- **回滚**：两个迁移均为 `ADD COLUMN` + `CREATE INDEX`，可通过 `DROP INDEX` + `DROP COLUMN` 回退；应用层回滚 = 还原 `with-request-log.ts` / `logger.ts` / `db-sink.ts` 三文件即可，列留空不影响旧查询。
