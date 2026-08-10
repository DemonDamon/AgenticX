# 子规划 C：Admin 审计按 trace_id / session_id 反查与 Trace 钻取

Planned-with: Claude Opus 5 (thinking)
Suggested-Impl-Model: Codex 系列（代码专精中档；后端查询 + 中等复杂度前端表单与详情面板，无高风险跨栈改动）
Parent-Plan: `.cursor/plans/pending/2026-08-10-enterprise-trace-observability.plan.md`
Depends-On: `2026-08-10-enterprise-trace-id-propagation.plan.md`（必须先合入，本子规划依赖 `gateway_audit_events.trace_id` 列存在）

## 一句话目标

运维把用户截图里的 `请求 ID` 粘进 admin-console 审计页，一次命中该请求的审计事件；点开详情能直接看到该 trace 在 `agent_token_traces` 里的逐 step token / 耗时 / 错误。

## 根因与证据链

1. **审计查询入参没有 trace_id / session_id。** `enterprise/packages/core-api/src/audit.ts` L76-88 的 `AuditQueryInput` 只有 `tenant_id / user_id / department_id / provider / model / policy_hit / cross_border / start / end / limit / offset`。
2. **PG store 因此也无法过滤。** `enterprise/features/audit/src/services/pg-store.ts` 的 `query()`（L113-159）与 `exportCsv()`（L196-230）逐项 `conditions.push(...)`，没有 trace/session 分支。
3. **API 路由不透传。** `enterprise/apps/admin-console/src/app/api/audit/query/route.ts` L18-30 逐字段白名单映射，未包含这两个字段。
4. **UI 只有三个高级过滤项。** `enterprise/apps/admin-console/src/app/audit/page.tsx` L341-367 只有用户 ID / 模型 / 策略命中三个输入框。
5. **Trace 数据已经在库里但入口是孤岛。** `enterprise/apps/admin-console/src/app/api/agent-traces/route.ts` 支持 `GET ?trace_id=`（需 `metering:read` scope），但审计详情页没有任何跳转过去的入口。

## In scope

- `enterprise/packages/core-api/src/audit.ts`：`AuditQueryInput` 与 `AuditEvent` 增字段
- `enterprise/features/audit/src/services/pg-store.ts`（以及 `mysql-store.ts`、`local-store.ts` 对齐）
- `enterprise/apps/admin-console/src/app/api/audit/query/route.ts` 与同目录 export 路由
- `enterprise/apps/admin-console/src/app/audit/page.tsx` 及其 i18n（`messages/zh.json`、`messages/en.json` 的 `pages.ops.audit.*`）

## Out of scope（严禁改动）

- `desktop/`、`agenticx/`、`enterprise/apps/web-portal/`、`enterprise/apps/gateway/`
- RBAC scope 定义与 `visibilityPredicates`（`pg-store.ts` L11-20）的可见域逻辑——**不得放宽任何权限**
- checksum 链校验逻辑与导出硬上限 `EXPORT_ROW_HARD_CAP`
- 审计页现有的搜索框、链校验 badge、导出按钮行为

---

## FR-1：查询入参与事件类型扩展

**落点：** `enterprise/packages/core-api/src/audit.ts`

1. `AuditEvent`（`session_id` 在 L38）后新增 `trace_id?: string;`
2. `AuditQueryInput`（L76-88）新增 `trace_id?: string;` 与 `session_id?: string;`

**AC-1：** `pnpm -C enterprise typecheck` 绿（会连带暴露所有需要补齐的 store 实现点）。

---

## FR-2：PG store 支持过滤与回显

**落点：** `enterprise/features/audit/src/services/pg-store.ts`

1. 行映射函数（L38-46 附近，`session_id: row.sessionId ?? undefined,` 之后）新增 `trace_id: row.traceId ?? undefined,`
2. `query()` 在 `input.user_id` 分支（L124-126）之后新增：

```ts
    if (input.trace_id) {
      conditions.push(eq(gatewayAuditEvents.traceId, input.trace_id));
    }
    if (input.session_id) {
      conditions.push(eq(gatewayAuditEvents.sessionId, input.session_id));
    }
```

3. `exportCsv()` 在 L207-208 同风格补两行（单行 if 写法，与周边保持一致）。
4. `exportCsv` 的表头数组（L246-250 附近）在 `"user_id"` 后加 `"trace_id"`，并在行拼装处（L278-282 附近）对应位置加 `ev.trace_id ?? ""`。**表头与行必须同步改，顺序一致**，否则导出 CSV 列错位。
5. `mysql-store.ts` 与 `local-store.ts` 做等价改造，保证 `AuditStore` 接口在三种实现下行为一致（local-store 用内存过滤即可）。

**AC-2：** 新建 `enterprise/features/audit/src/services/pg-store.trace-filter.test.ts`（若该目录无 DB 测试基建，则改测 `local-store`）：断言 (a) 传 `trace_id` 只返回该 trace 的事件；(b) 传 `session_id` 只返回该 session 的事件；(c) 两者同传取交集；(d) 都不传时行为与改造前一致（回归保护）。

---

## FR-3：API 路由透传 + 输入校验

**落点：** `enterprise/apps/admin-console/src/app/api/audit/query/route.ts`

在 L20 的 `user_id` 之后新增两行映射：

```ts
      trace_id: typeof body.trace_id === "string" ? body.trace_id.trim() || undefined : undefined,
      session_id: typeof body.session_id === "string" ? body.session_id.trim() || undefined : undefined,
```

**校验要求：** `trace_id` 若非空但长度 > 128，直接返回 `{ code: "40001", message: "invalid trace_id" }` 400，避免超长输入打到索引上。`session_id` 同样限 128。

同目录的导出路由（`src/app/api/audit/export/route.ts` 或等价文件，按实际文件名）做相同透传，保证「筛选后导出」与列表一致。

**AC-3：** 新建 route 单测，断言：(a) 合法 trace_id 被传入 `queryAudit`；(b) 129 字符输入返回 400；(c) 未登录/无 scope 时仍走原 `requireAdminSomeScope` 拒绝路径（权限回归保护）。

---

## FR-4：审计页新增两个过滤项

**落点：** `enterprise/apps/admin-console/src/app/audit/page.tsx`

1. 新增 state：`const [traceId, setTraceId] = useState("");`、`const [sessionId, setSessionId] = useState("");`（放在 L58 `userId` 旁）
2. 两处请求体构造（L101 与 L136 附近）加入 `trace_id: traceId || undefined, session_id: sessionId || undefined`
3. 两处 `useMemo` 依赖数组（L125、L235）补上新 state
4. 活动筛选 chips（L230 附近）新增两条，`onRemove` 分别清空
5. 高级筛选 Popover（L341-367）在「用户 ID」输入框**之前**插入两个输入框（trace 是最高频入口，放最上面）：
   - `id="flt-trace"`，label `t("filterTraceId")`，placeholder `01JABCDEFGHJKMNPQRSTVWXYZ`
   - `id="flt-session"`，label `t("filterSessionId")`，placeholder `sess_...`
6. 清空按钮（L380-385）补 `setTraceId(""); setSessionId("");`

**i18n：** `messages/zh.json` 的 `pages.ops.audit` 下新增 `"filterTraceId": "请求 ID"`、`"filterSessionId": "会话 ID"`；`filterLabels` 下补对应前缀标签；`messages/en.json` 同步补 `"Request ID"` / `"Session ID"`。**两个语言文件的 key 必须完全一致**，缺任一侧会在运行时抛 missing message。

**AC-4：** 本地起 admin-console，`/audit` 页高级筛选出现「请求 ID」「会话 ID」两个输入框；粘贴一个真实 trace_id 后列表收敛到该次请求；点 chip 上的移除可恢复；中英文切换均无 missing message 警告。

---

## FR-5：详情面板 Trace 钻取

**落点：** `enterprise/apps/admin-console/src/app/audit/page.tsx` 详情区（i18n 命名空间 `pages.ops.audit.detail`，现有字段见 `messages/zh.json` 的 `detail.session` 等）

1. 概览 tab（`tabSummary`）在「Session」一行之后新增「请求 ID」一行，展示 `event.trace_id`，附一键复制按钮（复用页面内已有的复制交互；若没有则用 `navigator.clipboard.writeText` + 一个 `Copy` 图标按钮）。
2. `trace_id` 非空时，该行右侧显示「查看 Trace」按钮，点击后调用 `GET /api/agent-traces?trace_id=<id>`，把返回的 step 列表渲染成一张紧凑表格：`step_no / step_kind / status / model / total_tokens / duration_ms / error_message`。
3. **权限降级要求：** `/api/agent-traces` 需要 `metering:read` scope，而审计页只要求 `audit:read*`。当该接口返回 401/403 时，按钮区改为一行灰色提示「无 metering:read 权限，无法查看 Trace 明细」，**不得**让整个详情面板报错或白屏。返回 404 时提示「该请求未产生 Trace 明细（可能未经过计费上报）」。
4. 表格空态、加载态各给一行文案，不引入新组件库。

**AC-5：**
- 用有 `metering:read` 的管理员账号：点「查看 Trace」能看到 step 列表，step_no 递增
- 用**没有** `metering:read` 的账号：详情面板正常渲染，仅显示权限提示，控制台无未捕获异常
- 对 `trace_id` 为空的历史事件：不显示该行与按钮，页面不报错

---

## 端到端验收（AC-E2E）

前置：子规划 A 已合入并跑过一次真实对话。

1. 从 web-portal 触发一次失败请求，截图里拿到 `请求 ID`
2. admin-console `/audit` → 高级筛选 → 请求 ID 粘贴 → 应用 → 命中 1 条（或该 trace 的多条）
3. 点开详情 → 概览可见请求 ID 与复制按钮 → 点「查看 Trace」看到 step 明细
4. 点导出 CSV → 打开文件确认含 `trace_id` 列且与列表一致
5. `pnpm -C enterprise typecheck && pnpm -C enterprise build` 绿

## 回滚方案

纯查询侧增量，无写路径与迁移变更。回退 commit 即可；数据库列由子规划 A 引入，不在本子规划回滚范围内。
