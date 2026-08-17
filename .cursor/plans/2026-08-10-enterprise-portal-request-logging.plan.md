# 子规划 B：web-portal 结构化日志与「截图可反查」错误文案

Planned-with: Claude Opus 5 (thinking)
Suggested-Impl-Model: Composer 2.5 或 Kimi Code（便宜档；单栈 TS、以新增文件与机械替换为主，无跨栈风险）
Parent-Plan: `.cursor/plans/pending/2026-08-10-enterprise-trace-observability.plan.md`

## 一句话目标

让 web-portal 的服务端把每次请求写成一行 JSON 结构化日志（含 trace_id / user_id / session_id / 耗时 / 结果），并让前端所有报错文案末尾带上 `请求 ID: <trace_id>`，使用户随手截的图就是一张可反查的工单。

## 根因与证据链

1. **portal 服务端目前没有任何请求级日志。** `enterprise/apps/web-portal/` 下不存在 `middleware.ts`、不存在 `instrumentation.ts`；`src/` 内只有 6 个文件散落 `console.error`（`src/lib/session.ts`、`src/lib/auth-runtime.ts`、`src/lib/chat-history-http.ts`、`src/lib/sso-runtime.ts`、`src/app/api/auth/sso/oidc/callback/route.ts`、`src/app/api/auth/sso/saml/callback/route.ts`），全为无结构自由文本，无法按用户或时间检索。
2. **前端错误文案不含任何标识。** `enterprise/packages/sdk-ts/src/chat/http.ts` L35-53 的 `normalizeTransportErrorMessage` 把 `Failed to fetch` 映射为一段纯中文提示，用户截图后运维拿不到任何可查项。三处流式错误分支（`enterprise/features/chat/src/store.ts` L1867-1869、L2117-2119、L2334-2336）统一走 `toComplianceMessage(chunk.error.code, chunk.error.message)` 后写入 `errorMessage`，这是唯一收口点。
3. **portal 进程内的故障根本不进网关审计。** 深度调研把 Node 事件环打满、SSE 中途断流这类问题发生在 portal 内部，网关侧无记录，所以**必须有 portal 自己的日志**才能定位。

## In scope

- 新建 `enterprise/apps/web-portal/src/lib/observability/` 下的 logger 与 request 包装
- 改造 `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts` 与 deep-research 相关 route 的错误路径，改用结构化 logger
- `enterprise/packages/sdk-ts/src/chat/http.ts`：错误文案追加请求 ID
- `enterprise/features/chat/src/store.ts`：`toComplianceMessage` 收口处追加请求 ID

## Out of scope（严禁改动）

- `desktop/`、`agenticx/`、`enterprise/apps/gateway/`、`enterprise/apps/admin-console/`
- 不引入 pino / winston / OpenTelemetry 等日志库（零新依赖，用 `console.log(JSON.stringify(...))`）
- 不改任何业务逻辑分支、不改错误码、不改深度调研编排
- 不做日志采集/轮转/上报（本轮只保证 stdout 一行一 JSON，交给部署侧收集）

---

## FR-1：结构化 logger

**落点：** 新建 `enterprise/apps/web-portal/src/lib/observability/logger.ts`

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  event: string;                 // 稳定事件名，如 "chat.completions.gateway_unreachable"
  trace_id?: string;
  user_id?: string;
  tenant_id?: string;
  session_id?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  error_name?: string;
  error_message?: string;
  error_stack?: string;
  [key: string]: unknown;
};

export function log(level: LogLevel, fields: LogFields): void;
```

**实现要求：**

- 输出恰好一行：`console.log(JSON.stringify({ ts: new Date().toISOString(), level, ...redact(fields) }))`；`error` 级别用 `console.error`。
- **脱敏 `redact()` 是硬要求**：丢弃或哈希以下 key（大小写不敏感包含匹配）：`messages`、`content`、`prompt`、`authorization`、`cookie`、`token`、`api_key`、`apikey`、`password`、`secret`、`refresh`。命中则替换为 `"[redacted]"`。
- `error_message` 截断到 500 字符，`error_stack` 截断到 2000 字符。
- 环境变量 `PORTAL_LOG_LEVEL`（默认 `info`）控制最低输出级别，顺序 debug<info<warn<error。

**AC-1：** 新建 `logger.test.ts`，断言：(a) 输出可被 `JSON.parse`；(b) 传入 `{ authorization: "Bearer x", messages: [...] }` 时输出中不含 `Bearer` 与消息正文；(c) `PORTAL_LOG_LEVEL=warn` 时 `log("info", ...)` 不产生输出；(d) 超长 stack 被截断到 2000 字符。

---

## FR-2：请求级日志包装

**落点：** 新建 `enterprise/apps/web-portal/src/lib/observability/with-request-log.ts`

导出 `withRequestLog(route: string, handler: (ctx: RequestLogCtx) => Promise<Response>)`，其中 `RequestLogCtx` 至少含 `{ traceId: string; setUser(u: {userId?:string; tenantId?:string; sessionId?:string}): void }`。行为：

- 进入时记录 `event: "<route>.start"`（debug 级）
- 正常返回时记录 `event: "<route>.finish"`，含 `status`、`duration_ms`
- handler 抛异常时记录 `event: "<route>.error"`（error 级，含 `error_name/message/stack`），然后**原样重抛**（不吞异常、不改变响应语义）
- 无论成败，都在返回的 Response 上确保存在 `x-agenticx-trace-id` 响应头

**trace_id 来源：** 复用子规划 A 的 `newTraceId` / `isTraceId`（`@agenticx/sdk-ts`）。**若子规划 A 尚未合入**，则本子规划先落 `enterprise/packages/sdk-ts/src/trace/trace-id.ts`（内容以子规划 A 的 FR-1 为准），两边最终共用同一实现，禁止各写一份。

**AC-2：** 新建 `with-request-log.test.ts`，断言：(a) 成功路径产出 start+finish 两条日志且 finish 含 `duration_ms >= 0`；(b) handler 抛错时产出 error 日志并且异常向外抛出；(c) 两种路径返回的 Response 都带 `x-agenticx-trace-id`。

---

## FR-3：接入关键路由

**落点（只改这些，其余路由本轮不动）：**

| 文件 | 改法 |
|---|---|
| `src/app/api/chat/completions/route.ts` | 用 `withRequestLog("chat.completions", ...)` 包住 `POST` 主体；在鉴权成功后调 `ctx.setUser({ userId: session.userId, tenantId: session.tenantId, sessionId: chatSessionId })`；网关不可用 catch（L230-241）改为先 `log("error", { event: "chat.completions.gateway_unreachable", trace_id, error_message: detail })` 再返回原 503 响应；`!upstream.ok`（L243-251）记 `warn` 级 `event: "chat.completions.gateway_status"` 含 `status` |
| `src/app/api/chat/deep-research/runs/route.ts` | 包 `withRequestLog("deep_research.runs")` |
| `src/app/api/chat/deep-research/runs/[runId]/stream/route.ts` | 包 `withRequestLog("deep_research.stream")`；流中断/异常结束时记 error 日志，附 `run_id` |
| `src/app/api/chat/deep-research/resume/route.ts` | 包 `withRequestLog("deep_research.resume")` |

**严禁：** 不改这些路由的状态码、错误码、响应体结构（除子规划 A 已约定的 `error.trace_id` 字段外）。

**AC-3：** 本地 `bash enterprise/scripts/start-dev-with-infra.sh` 后：
- 发一条对话 → portal 终端出现 `{"ts":...,"level":"info","event":"chat.completions.finish",...}` 且含 `trace_id`/`user_id`/`duration_ms`
- `kill` 掉 :8088 网关后再发 → 出现 `chat.completions.gateway_unreachable` 的 error 行，含 `trace_id`
- 用 `grep '"trace_id":"<TID>"'` 能在日志中一次捞出该请求全部行

---

## FR-4：错误文案带请求 ID（用户截图即工单）

**落点 1：** `enterprise/packages/sdk-ts/src/chat/http.ts`

`normalizeTransportErrorMessage`（L35-53）增加第二参数 `traceId?: string`；返回值末尾追加 `\n请求 ID: <traceId>`（traceId 为空则不追加）。调用处 L324-326 传入 `pending.traceId`。同时结构化错误分支（L142-151、L217-230）在 `message` 末尾同样追加。

**落点 2：** `enterprise/features/chat/src/store.ts`

`toComplianceMessage(code, message)` 是三处流式错误的唯一收口（L1867、L2117、L2334）。给它增加可选第三参数 `traceId?: string`，返回文案末尾追加 `\n请求 ID: <traceId>`；三处调用改为 `toComplianceMessage(chunk.error.code, chunk.error.message, chunk.traceId)`（`chunk.traceId` 由子规划 A 的 FR-2 提供；若 A 未合入，本项可先接 `undefined` 占位并在 A 合入后补齐——但**不得**为此在 store 里另生成一个 ID，否则前后端 ID 对不上）。

**文案格式（严格照抄，便于运维正则提取）：** 换行 + `请求 ID: ` + 26 位 ULID，无句号、无括号。

**AC-4：**
- 扩展 `enterprise/features/chat/src/store.update-depth-error.test.ts` 同目录新增用例：模拟 `chunk.error` 且 `chunk.traceId="01J..."`，断言 `state.errorMessage` 以 `请求 ID: 01J...` 结尾
- 手工验收：`kill` 网关后在浏览器发消息，界面提示末行显示 `请求 ID: <26位>`，且该 ID 能在 portal 日志中 grep 到

---

## 整体验收

- `pnpm -C enterprise typecheck && pnpm -C enterprise build` 绿
- `pnpm -C enterprise test`（或各包 test 脚本）绿
- 人工检查：新日志中**不含**任何 prompt / 回复正文 / Authorization / Cookie 片段（随机抽 20 行 grep `Bearer`、`sk-`、`messages` 均无命中）

## 回滚方案

纯增量：删掉 `src/lib/observability/` 与路由包装、还原两处文案拼接即可，无数据库与协议变更。
