# Portal 日志「按会话」视图 + 会话级运行时过程

Planned-with: Opus 5（Cursor）

## Suggested-Impl-Model

| 子任务 | 推荐模型 | 理由 |
| --- | --- | --- |
| FR-1 索引迁移（双方言 + parity 测试计数） | Composer 2.5 / Kimi Code 档 | 纯样板，照抄 0044/0018 的形状即可 |
| FR-2 ~ FR-4 聚合查询 + API + 会话对话读取 | Codex 中档（后端实施） | 跨 PG/MySQL 方言 SQL，需要谨慎但不涉及架构决策 |
| FR-5 ~ FR-7 admin UI（视图切换、抽屉、会话对话面板） | Codex 中档；若对视觉密度不满意再用 Opus 档收口 | 以复用既有组件为主，不做新视觉体系 |

最终 `Impl-Model` 由实际使用者填写，不要照抄本表。

---

## 背景与证据

当前 Portal 日志按「一次请求 = 一条 trace = 一行日志」记录。用户在前台一个普通对话里问了两轮，用 `session_id` 过滤后会看到两行日志（两个 trace）。用户希望列表能按会话收敛成一行，并且「运行时过程」页能看到该会话的**全部轮次**对话，而不只是当前 trace 的一轮。

现状证据：

- 写入侧每次请求一条 finish 日志，`enterprise/apps/web-portal/src/lib/observability/with-request-log.ts` 的 `withRequestLog` 在请求结束时 log 一次（`mode` / `run_id` 已于 2026-08-11 的 `portal-log-conversation-mode-taxonomy` plan 落地）。
- 读侧 `enterprise/apps/admin-console/src/lib/portal-logs-query.ts` 的 `queryPortalLogs()` 是平铺分页查询，无任何聚合。
- 过程页右侧对话来自 `enterprise/apps/admin-console/src/lib/trace-conversation-io.ts` 的 `getTraceConversationTurn()`，它先按 `metadata.trace_id` 找到 assistant 消息，再用 `pickTurnMessages()` 只回溯到最近一条 user 消息 —— 所以天然只有一轮。
- `portal_request_logs` 目前**没有** `(tenant_id, session_id, log_time)` 索引，见 `enterprise/packages/db-schema/src/schema/portal-request-logs.ts` 第 29–48 行的索引定义，聚合查询会走 `(tenant_id, log_time)` 后再过滤，数据量大时代价高。

设计取向（已与用户对齐）：

1. **不改写入路径**。可观测性数据保持一 trace 一行，否则丢掉单轮耗时 / token / 失败点。聚合只发生在读时。
2. **不默认聚合**。列表默认仍是「按请求」，新增「按会话」视图开关；排障主场景仍是单轮。
3. `deep_research` 不并入会话聚合行，它已有 `run_id` 维度，按请求视图查看。

---

## In scope

- `portal_request_logs` 增加 `(tenant_id, session_id, log_time)` 索引（PG + MySQL）。
- admin-console 新增会话级聚合查询与 API。
- admin-console Portal 日志页新增「按请求 / 按会话」视图切换，会话行可展开查看该会话的各轮请求。
- 新增按 `session_id` 读取整段会话消息的 API 与面板，接进过程页。

## Out of scope（no-scope-creep 边界）

- 不修改 `enterprise/apps/web-portal/**` 任何写日志逻辑，不新增字段、不改 `mode` / `run_id` 语义。
- 不新建任何汇总表 / 物化视图 / 定时聚合任务。
- 不改 `deep_research` 的 run 维度展示。
- 不动 `enterprise/apps/admin-console/src/components/trace-timeline-tree.tsx` 已有的「点击节点才展开右侧详情」交互（该交互已于 2026-08-11 落地，保持不变）。
- 不做导出、不做图表、不做跨租户查询。

---

## FR-1 会话维度索引（双方言迁移）

**落点**

- `enterprise/packages/db-schema/src/schema/portal-request-logs.ts`：在 `(table) => ({ ... })` 的索引对象里，`tenantRunIdx` 之后追加：

```ts
    tenantSessionTimeIdx: index("portal_request_logs_tenant_session_time_idx").on(
      table.tenantId,
      table.sessionId,
      table.logTime,
    ),
```

- `enterprise/packages/db-schema/src/mysql-schema/portal-request-logs.ts`：同名索引，写法对齐该文件里已有的 `tenantModeTimeIdx`（MySQL 索引名长度上限 64，`portal_request_logs_tenant_session_time_idx` 为 43 字符，安全）。
- 新增 `enterprise/packages/db-schema/drizzle/0052_portal_request_logs_session_idx.sql`：
  `CREATE INDEX IF NOT EXISTS "portal_request_logs_tenant_session_time_idx" ON "portal_request_logs" ("tenant_id","session_id","log_time");`
- 新增 `enterprise/packages/db-schema/drizzle-mysql/0026_portal_request_logs_session_idx.sql`：MySQL 无 `CREATE INDEX IF NOT EXISTS`，照抄 `drizzle-mysql/0025_portal_request_logs_mode.sql` 里已用的写法（存在性判断 / 幂等处理保持一致，不要自创新风格）。
- 两个 `meta/_journal.json` 追加条目：PG `idx: 51, tag: "0052_portal_request_logs_session_idx"`（接在 idx 50 后）；MySQL `idx: 26, tag: "0026_portal_request_logs_session_idx"`（接在 idx 25 后）。

**AC-1**

- `enterprise/packages/db-schema/src/__tests__/migration-inventory.test.ts`：PG journal 断言为 52，sqlFiles 断言为 54（含两个既有 orphan）。
- `enterprise/packages/db-schema/src/__tests__/schema-parity.test.ts`：MySQL `sqlFiles.sort()` 期望数组加入 `"0026_portal_request_logs_session_idx.sql"`，journal 断言加入 `expect.objectContaining({ idx: 26, tag: "0026_portal_request_logs_session_idx" })`；PG 侧对应为 `0052_...`。
- `pnpm --filter @agenticx/db-schema test` 全绿；本机跑一次 `pnpm --filter @agenticx/db-schema db:migrate` 确认迁移可执行且重复执行不报错。

---

## FR-2 会话聚合查询

**落点**：`enterprise/apps/admin-console/src/lib/portal-logs-query.ts` 先做一处最小改动 —— 把私有的 `buildConditions` 导出为 `export function buildPortalLogConditions(...)`（保留原签名与实现，仅改可见性与命名，文件内调用点同步改名）。不要顺手重构该文件其它内容。

新建 `enterprise/apps/admin-console/src/lib/portal-logs-session-query.ts`：

```ts
export type PortalSessionRollup = {
  session_id: string;
  turns: number;          // count(distinct trace_id)
  first_time: string;     // min(log_time) ISO
  last_time: string;      // max(log_time) ISO
  total_duration_ms: number | null; // sum(duration_ms)，null 不计
  error_count: number;    // sum(level = 'error')
  modes: string[];        // 去重后的 mode 列表（NULL 归为 "chat"）
  user_id: string | null; // 该会话内出现的任一 user_id（取 max 即可）
};

export type PortalSessionRollupResult = {
  total: number;              // count(distinct session_id)
  items: PortalSessionRollup[];
  ungrouped_count: number;    // session_id 为 NULL 的日志条数
};

export async function queryPortalLogSessions(
  input: PortalLogQueryInput,
): Promise<PortalSessionRollupResult>;
```

实现要点：

- 复用 `buildPortalLogConditions(table, input, start, end)` 得到基础 where，再追加 `isNotNull(table.sessionId)`。
- `GROUP BY session_id`，`ORDER BY max(log_time) DESC`，`limit/offset` 沿用 `queryPortalLogs` 的 clamp 逻辑（`clampLimit` 上限 500、`clampOffset`）。
- `total` 用 `count(distinct session_id)` 单独一次查询（不要 `rows.length`）。
- `ungrouped_count` 用同一 where + `isNull(table.sessionId)` 的 `count()`。
- `modes` 方言差异必须显式处理：PG 用 `sql<string>\`string_agg(distinct coalesce(${table.mode}, 'chat'), ',')\``，MySQL 用 `sql<string>\`GROUP_CONCAT(DISTINCT COALESCE(${table.mode}, 'chat'))\``；读出后 `split(",")` 去空。
- `error_count` 两方言都可用 `sql<number>\`sum(case when ${table.level} = 'error' then 1 else 0 end)\``。
- 与 `queryPortalLogs` 一致地走 `resolveDatabaseConfig()` 的 `switch`，`default` 分支保留 `const exhaustive: never = config` 穷尽检查（对齐仓库 typescript-exhaustive-switch 规则）。
- 强制时间窗口兜底：当 `input.start` 与 `input.end` 都为空时，默认只聚合最近 7 天（`new Date(Date.now() - 7 * 864e5)`），避免全表 GROUP BY。该默认值定义为文件内常量 `DEFAULT_SESSION_WINDOW_DAYS = 7`。

**AC-2**：新建 `enterprise/apps/admin-console/src/lib/__tests__/portal-logs-session-query.test.ts`，mock `resolveDatabaseConfig` / `getIamDb`（参照 `src/lib/__tests__/trace-conversation-io.test.ts` 现有的 mock 写法），断言：

1. 无 start/end 时 where 里带上 7 天窗口条件；
2. `mode=deep_research` 的过滤条件仍经过 `modeCondition`（即 legacy NULL 兜底不丢）；
3. `modes` 字符串 `"chat,web_search"` 被解析为 `["chat", "web_search"]`；
4. `session_id` 为 NULL 的行不进 `items`，只体现在 `ungrouped_count`。

---

## FR-3 会话聚合 API

**落点**：新建 `enterprise/apps/admin-console/src/app/api/portal-logs/sessions/route.ts`，POST，完全照抄 `enterprise/apps/admin-console/src/app/api/portal-logs/query/route.ts` 的骨架：

- 同样的 `requireAdminSomeScope(["audit:read:all", "audit:manage"])` 守卫；
- 同样的 `fields` 白名单解析（`user_id` / `session_id` / `level` / `event` / `route` / `mode` / `run_id` / `start` / `end`；**去掉 `trace_id`**，按 trace 过滤在会话视图无意义）；
- `limit` 走 `normalizePortalLogLimit`，`offset` 同现有写法；
- 调用 `queryPortalLogSessions`，成功返回 `{ code: "00000", message: "ok", data }`，异常返回 `{ code: "50002" }` + 500。

**AC-3**：新建 `enterprise/apps/admin-console/src/app/api/portal-logs/sessions/__tests__/route.test.ts`（参照同目录 `../../query/__tests__/route.test.ts` 的 mock 方式），断言：无权限时 403；`mode` / `session_id` / 时间范围被原样转发给 `queryPortalLogSessions`；非法 JSON body 返回 400 且 code 为 `40001`。

---

## FR-4 会话级对话读取

**落点**：`enterprise/apps/admin-console/src/lib/trace-conversation-io.ts` **追加**（不要改动已有的 `getTraceConversationTurn` / `pickTurnMessages` / `mapRow` / `clipText` / `splitReasoning`）：

```ts
export type SessionConversation = {
  session_id: string;
  messages: TraceConversationMessage[]; // 时间正序
  has_more: boolean;                    // 还有更早的消息
  next_before?: string;                 // 游标：本页最早一条的 created_at ISO
  empty: boolean;
};

export const SESSION_CONVERSATION_PAGE_SIZE = 40;

export async function getSessionConversation(
  tenantId: string,
  sessionId: string,
  options?: { expand?: boolean; before?: string },
): Promise<SessionConversation>;
```

实现要点：

- 查询 `chat_messages`：`tenantId = tid AND sessionId = sid`，`before` 有值时追加 `lt(createdAt, new Date(before))`；`orderBy(desc(createdAt))`，`limit(PAGE_SIZE + 1)`。
- 多取的第 41 条只用于判定 `has_more`，返回前丢弃；随后 `reverse()` 成时间正序。
- 每条消息复用现有 `mapRow(row, expand)`，即 `expand` 时 32k 字符上限、否则 4k 预览，assistant 的 `<think>` 仍走 `splitReasoning`。
- PG / MySQL 双分支写法对齐 `getTraceConversationTurn` 已有结构，`default` 分支保留 `never` 穷尽检查。

新建 API `enterprise/apps/admin-console/src/app/api/sessions/[sessionId]/conversation/route.ts`：GET，守卫与返回信封对齐 `enterprise/apps/admin-console/src/app/api/traces/[traceId]/conversation/route.ts`（照抄其 scope 与 code 约定），支持 query 参数 `expand=1` 与 `before=<ISO>`。

**AC-4**：在 `enterprise/apps/admin-console/src/lib/__tests__/trace-conversation-io.test.ts` 追加用例（不要改动已有用例）：

1. 41 条消息时返回 40 条且 `has_more === true`、`next_before` 等于返回的第一条（最早那条）的 `created_at`；
2. 返回顺序为时间正序；
3. `expand: true` 时长文本按 32k 截断、默认按 4k 截断；
4. 会话无消息时 `empty === true` 且 `messages` 为空数组。

---

## FR-5 列表视图切换（按请求 / 按会话）

**落点**：`enterprise/apps/admin-console/src/app/portal-logs/page.tsx`（`PortalLogsPageContent`）

- 在 `const [route, setRoute] = useState<RouteFilter>("")` 附近新增 `const [groupBy, setGroupBy] = useState<"request" | "session">("request")`，**默认 `"request"`**。
- 筛选卡片（`<Card><CardContent className="flex flex-wrap items-end gap-3 pt-4">`，约当前第 243 行起）里，在「会话类型」`filterMode` 下拉**之前**插入一个 `w-[160px]` 的 `Select`，选项：`t("groupByRequest")` / `t("groupBySession")`。
- `load` 回调按 `groupBy` 走不同端点：`"request"` 保持现有 `/api/portal-logs/query` 与现有 state 不变；`"session"` 打 `/api/portal-logs/sessions`，结果写入新 state `sessionItems: PortalSessionRollup[]` / `sessionTotal` / `ungroupedCount`。`groupBy` 需要加进 `load` 的 `useCallback` 依赖数组。
- 会话视图下 `trace_id` 输入框禁用（`disabled`）并保持原值，避免用户以为在按 trace 聚合。
- 新增 `sessionColumns: ColumnDef<PortalSessionRollup>[]`：会话 ID（等宽字体，可复制，复用页面里已有的 `Copy` 图标交互写法）、轮次、`modes` 徽标组（复用现有 `modeBadgeVariant` / `modeLabel`）、总耗时、错误数（>0 时 `destructive` 徽标）、最后活跃时间、用户。
- `ungrouped_count > 0` 时在表格上方渲染一行 `text-xs text-muted-foreground` 提示 `t("ungroupedHint", { count })`，文案指引切回请求视图查看，**不要**把无会话日志混进聚合行。

**AC-5**：手动验收 —— 默认进入页面仍是按请求视图、行为与今天一致；切到按会话后，同一个两轮普通对话只出现 1 行且轮次显示 2；切回按请求恢复 2 行。

---

## FR-6 会话行展开：该会话的各轮请求

**落点**：同一文件的 `Sheet` 区域（页面已有 `selected: PortalLogItem | null` 驱动的详情抽屉）。

- 新增 `selectedSession: PortalSessionRollup | null`。点击会话行时打开抽屉，抽屉内**复用现有 `/api/portal-logs/query`**（`session_id` 传该会话、`limit: 100`），列出该会话的各轮请求：时间、mode、状态、耗时、trace_id。
- 每行提供「查看过程」按钮，点击后把该 `trace_id` 交给现有 `TraceTimelineInline`（页面已 import）渲染，交互与今天按请求视图点开日志时一致。
- 不新增后端接口。

**AC-6**：点会话行 → 抽屉列出 2 条请求 → 点其中一条 → 出现过程时间轴，且时间轴默认不展开右侧详情（保持 FR 之外的既有行为）。

---

## FR-7 过程页展示整段会话对话

**落点**

- 抽取共享渲染：把 `enterprise/apps/admin-console/src/components/trace-conversation-panel.tsx` 里渲染单条消息的 JSX（角色徽标 / 字数 / reasoning 折叠 / 附件名）提取为同目录新文件 `conversation-message-list.tsx` 导出的 `ConversationMessageList`，`TraceConversationPanel` 改为调用它。**行为与视觉必须保持不变**，仅做提取。
- 新建 `enterprise/apps/admin-console/src/components/session-conversation-panel.tsx`：`SessionConversationPanel({ sessionId, labels })`，调用 FR-4 的新 API，底部提供「加载更早」按钮走 `before` 游标续拉。
- `enterprise/apps/admin-console/src/components/trace-timeline-tree.tsx` 的 `TraceExplorer`：右侧详情区在 `TraceConversationPanel` 之上增加一个二选一切换（`t("conversation.scopeTurn")` / `t("conversation.scopeSession")`），**默认「本轮」**，切到「整个会话」时渲染 `SessionConversationPanel`。会话 ID 来自 `TraceConversationPanel` 已返回的 `session_id`（把它通过回调上抛给 `TraceExplorer`，或由 `TraceExplorer` 自己取一次 trace conversation 拿 `session_id`；实现者二选一，但不要额外新增后端接口）。当 `session_id` 为 null 时该切换禁用。

**AC-7**：两轮对话的任一 trace，过程页右侧切到「整个会话」后能看到全部 2 轮（4 条消息）；默认仍只显示本轮。

---

## FR-8 i18n

**落点**：`enterprise/apps/admin-console/messages/zh.json` 与 `messages/en.json`，`pages.ops.portalLogs` 下新增 `groupByLabel` / `groupByRequest`（按请求）/ `groupBySession`（按会话）/ `ungroupedHint` / `columns.turns` / `columns.errorCount` / `columns.lastActive` / `columns.sessionId`；`pages.ops.traceRuntime.conversation` 下新增 `scopeTurn`（本轮）/ `scopeSession`（整个会话）/ `loadEarlier`（加载更早）/ `noSession`（该请求未关联会话）。

**AC-8**：两个语言文件 key 结构完全对称（可用 `node -e` 比对两份 JSON 的 key 路径集合）；页面无 `MISSING_MESSAGE` 告警。

---

## 验收总览

```bash
pnpm --filter @agenticx/db-schema test
pnpm --filter @agenticx/db-schema db:migrate
cd enterprise/apps/admin-console && npx tsc --noEmit -p tsconfig.json
cd enterprise/apps/admin-console && npx vitest run
```

以上全绿，并完成 FR-5 / FR-6 / FR-7 的手动验收后方可提交。

## 风险与已知取舍

- **7 天默认窗口**会让「按会话」视图默认看不到更早的数据，需要用户显式选时间范围。这是为避免全表 GROUP BY 的有意取舍，UI 提示文案要写清楚。
- **无会话日志**（`session_id` 为 NULL，多为早期数据或 resume 早退分支）不进聚合，只给计数提示。
- MySQL `GROUP_CONCAT` 默认 1024 字节上限，`modes` 只有 3 种取值不会溢出；若未来 mode 取值变多需要复查。
