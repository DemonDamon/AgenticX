# MA-E04b 协作房间桌面执行智能体切到托管运行时（由 Near Worker 领取）

> **主规划裁决（2026-10-25，优先于正文）**：默认值确认：桌面任务超时 10 分钟、15 秒无人领取显示「排队中」提示，均按正文。

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W3 · MA-E04b）
Depends-on:
- MA-E04 `.cursor/plans/2026-10-25-ma-e04-portal-collab-cutover.plan.md`（**已实现**：`ma-runtime-client.ts`、`ma-agent-reply.ts`、`agent-reply.ts` 中的托管分支；本文复用其导出）
- MA-E03 `.cursor/plans/2026-10-25-ma-e03-agent-runtime-service.plan.md`（**已实现**：`MA_RUNTIME_DESKTOP_WORKER_ENABLED=1` 时才注册 `desktop_worker` 执行器与 `/ma/v1/work/*`）
- MA-D01 `.cursor/plans/2026-10-25-ma-d01-near-worker-v2.plan.md`（**实施中**：`DesktopAccessMiddleware` 领取授权——环境 `worker_keys` ∩ 用户分配键、Agent `worker_keys`、`claimed_by_user_id` 租约；Near `protocol: dual` + `ma_environment_mode: auto`。本文只调用 agent-runtime 公共 API，不改任何 D01 文件；D01 的行为**以实际实现为准，实施前核对**：`rg -n "class DesktopAccessMiddleware|POLL_RE|_check_desktop_create" enterprise/apps/agent-runtime/ma_agent_runtime/desktop_access.py`）

> 风险等级：中。只改 web-portal（单栈 TS）。全部单测 mock `fetch`，不依赖 agent-runtime 进程。
> 本文关闭 master §7 W3 门中「门户里对一个 `desktop_worker` 环境的 Agent 发起任务，任务在员工本机工作区执行，门户实时看到流式事件」这一步（master §12「W3 实施顺序」一行登记的缺口）。

---

## 0. 一句话目标

当 `MA_RUNTIME_ENABLED=1` **且** `MA_RUNTIME_DESKTOP_ROUTING=1` 时，协作房间里被 @ 的 `runtime=desktop_worker` 智能体不再写入旧任务表 `enterprise_agent_tasks`，而是：门户用服务 PAT 代表发言用户在 agent-runtime 新建托管会话（不传 `environment_id`，由 agent-runtime 取 Agent 的默认环境）→ 发一条 `user.message` → agent-runtime 生成 Work Item → 员工 Near（D01 的 `dual` 模式）领取并在本机执行 → 门户读 SSE 直到会话空闲 → 把最终 `agent.message` 写回房间。建会话或发消息失败时回退旧任务队列，行为与现在逐字一致。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §4 决策 2 | `desktop_worker`：Worker 领取 Work Item 后在本机跑完整 `AgentRuntime`，事件批量回传；agent-runtime 只做状态、持久化、排队与分发 | 门户只走会话面公共 API（§4） |
| §4 决策 4 | 门户经 agent-runtime 公共 API（服务 PAT） | 复用 E04 `MaRuntimeConfig.serviceToken` |
| §6.4 | 桌面 Worker 时序：调用方 `POST /sessions`（环境 desktop_worker）→ `POST /events user.message` → WorkItem queued → Worker poll/ack/inbox/ingest → 调用方 SSE | §5.2 算法与之一一对应 |
| §7 W3 门 | 「门户里对一个 desktop_worker 环境的 Agent 发起任务…门户实时看到流式事件」；「未登录企业时 Near 行为与现在一致」 | FR-1..FR-9；本文不改 Near |
| §12「W3 实施顺序」行 | MA-E04b 在 D01 之后实施，是 W3 门前置 | Depends-on |
| §12「已知限制：托管会话在网关按服务 PAT 计量」 | 对 desktop_worker 不适用：模型调用由员工设备 PAT 发出（D01 §11 风险 5） | §10 风险 2 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 |
|---|---|---|
| `enterprise/apps/web-portal/src/lib/collab-room/agent-reply.ts` | 1–12 | import 区；第 10–12 行为 E04 追加的 `log`、`isManagedEligible/runManagedAgentReply`、`resolveMaRuntimeConfig/MaRuntimeConfig` |
| 同上 | 14–37 | `AgentReplyDeps`；第 34–36 行 E04 追加 `maRuntime?`、`listAvailableModels?` |
| 同上 | 54 | `const DESKTOP_QUEUE_NOTICE = "当前没有在线的桌面执行端，任务已排队";` |
| 同上 | 86–109 | `buildDesktopTaskInput`（旧队列输入：最近 30 条 + `instruction: trigger.content`） |
| 同上 | 111–133 | `enqueueDesktopWorkerTask`：`listMessages(limit 30)` → `enqueueAgentTask` → 无在线 Worker 时写 `DESKTOP_QUEUE_NOTICE` |
| 同上 | 149–176 | `resolveAgentReplyDeps`：第 173 行 `maRuntime: overrides?.maRuntime !== undefined ? overrides.maRuntime : resolveMaRuntimeConfig()` |
| 同上 | 303–324 | `dispatchAgentMention`：`switch (agent.runtime)`，`case "desktop_worker": await enqueueDesktopWorkerTask(...)`，`default` 为 `never` 穷尽 |
| `enterprise/apps/web-portal/src/lib/collab-room/ma-runtime-client.ts` | 11 | `export type MaRuntimeConfig = { baseUrl; serviceToken; replyTimeoutMs }`（**本文不改此类型**，E04 测试用 `toEqual` 断言它恰为 3 键） |
| 同上 | 63–69、72–84 | `runtimeReplyTimeout(env)` 夹取写法；`resolveMaRuntimeConfig(env)` |
| 同上 | 100–121、132–134 | 私有 `maFetch`、`throwForStatus`、`authHeader`（新增函数复用） |
| 同上 | 148–178 | `createMaSession(config, {agentId, onBehalfOf, title}, fetchImpl)`：body `{agent_id, source:"portal", title}`，**不传** `environment_id` |
| 同上 | 180–209 | `postMaEvents(config, sessionId, events, fetchImpl)` |
| 同上 | 275 起 | `streamMaEvents(config, sessionId, {afterSeq, signal}, fetchImpl)`（只产出带 `seq` 的帧） |
| `enterprise/apps/web-portal/src/lib/collab-room/ma-agent-reply.ts` | 19–26 | `maNotices`（`unavailable` / `timeout` / `needsConfirmation` / `policyBlocked` / `budgetExceeded` / `modelDenied`） |
| 同上 | 61、116 | 导出纯函数 `buildRoomContextText`、`summarizeManagedEvents` |
| 同上 | 171 | 私有 `statusOf(error)`（`MaRuntimeError.status`，否则 0）——本文在新文件内私有实现同名函数 |
| 同上 | 229–374 | `runManagedAgentReply`：建会话 → 发消息 → SSE 循环（重连 2 次、超时中断）→ 写回 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/control_plane.py` | 214–215 | `desktop_worker` Agent 无默认环境时 `default_environment_id` 置 `"unset"` → `get_environment` 返回 None |
| `agenticx/managed/host/service.py` | 125–133 | 建会话：环境 = `req.environment_id or agent.default_environment_id or "local"`；环境缺失 → 404 `environment_not_found`；类型未注册执行器 → 400 `invalid_request`（`environment type "desktop_worker" is not available on this host`） |
| `agenticx/managed/host/remote_executor.py` | 29–39、49–61 | `submit_message` 只建 Work Item；`interrupt` 不做事（Worker 从 inbox 看到）；`close()`（归档时调用）把活动 Work Item 置 `stopped`（`session archived`） |
| `enterprise/apps/agent-runtime/ma_agent_runtime/config.py` | 204 | `desktop_worker_enabled = MA_RUNTIME_DESKTOP_WORKER_ENABLED == "1"`（缺省 0 → 建 desktop_worker 会话返回 400） |
| `enterprise/apps/web-portal/src/app/api/desktop/worker/tasks/[taskId]/complete/route.ts` | 33–43 | 旧路径写回 metadata：`{runtime:"desktop_worker", reply_to, worker_user_id, worker_device, tool_steps?}` |
| `enterprise/apps/web-portal/src/lib/collab-room/__tests__/agent-reply.test.ts` | 157–510 | 9 个现有用例（含 E04 的 4 个）；第 487 行 `desktop worker agents still enqueue legacy tasks` 在 `maRuntime` 已配置时断言走旧队列 |

### 1.3 为什么要两个开关、为什么不在门户里解析环境

1. **两个开关**：`MA_RUNTIME_ENABLED` 已在线上用于 cloud Agent（E04）。桌面切换依赖员工 Near 升级到 D01 的 `dual` 协议；若 Near 仍是 `legacy`，MA Work Item 无人领取。必须能单独打开 / 关闭桌面切换。
2. **不传 `environment_id`**：门户房间路由拿到的是 `getAgent()`（`EnterpriseAgent`，无 `defaultEnvironmentId`，见 `app/api/rooms/[roomId]/messages/route.ts:44`）。agent-runtime 建会话时自己取 Agent 默认环境；Agent 未配默认环境 → 404，Worker 面未开 → 400——两者都是「建会话失败」，按 §4 回退旧队列，语义正确且无需门户读库。
3. **不做模型可见性前置校验**：桌面执行的模型调用用领取者的设备 PAT 过网关（D01 D8），网关按执行者校验；旧队列路径同样不校验请求人。保持一致。

---

## 2. In scope / Out of scope

### 2.1 In scope（只能创建或修改这些文件；路径相对 `enterprise/apps/web-portal/`）

- 修改 `src/lib/collab-room/ma-runtime-client.ts`：**只追加** `MaDesktopRoutingConfig` 类型、`resolveMaDesktopRoutingConfig(env)`、`archiveMaSession(...)` 三个导出及其常量（§5.1）；现有函数与类型一字不改
- 新建 `src/lib/collab-room/ma-desktop-reply.ts`（§5.2）
- 修改 `src/lib/collab-room/agent-reply.ts`（§5.3 列出的 4 处，其他行不动）
- 新建 `src/lib/collab-room/__tests__/ma-desktop-reply.test.ts`
- 修改 `src/lib/collab-room/__tests__/ma-runtime-client.test.ts`：只追加 2 个 `describe`（§6 FR-1、FR-2）
- 修改 `src/lib/collab-room/__tests__/agent-reply.test.ts`：只追加 3 个用例；**现有 9 个用例一字不改**

### 2.2 Out of scope

- `ma-agent-reply.ts`（E04 的 cloud 路径）、`agent-executor.ts`、`worker-tasks/**`、`app/api/**`、`app/api/desktop/worker/**`（旧 Worker 接口保留）一律不改。
- agent-runtime、`agenticx/**`、Near、admin-console、nginx、部署文件全部不改。
- 房间内审批、自定义工具结果回传、逐字流式显示到房间、Work Item 自动转派、跨 @ 复用会话。
- 删除旧任务队列（稳定一个波次后另起子规划）。

---

## 3. 环境变量（门户进程读取）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MA_RUNTIME_ENABLED` | `0` | E04 既有；为 `"1"` 且服务 token 合法时 `resolveMaRuntimeConfig` 非 null |
| `MA_RUNTIME_DESKTOP_ROUTING` | `0` | **新增**。只有恰为 `"1"` 时启用桌面切换；且要求 `resolveMaRuntimeConfig()` 非 null（否则视为关闭，不告警） |
| `MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS` | `600000` | **新增**。单次桌面回复最长等待；非整数回退默认；夹到 `5000..1800000` |
| `MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS` | `15000` | **新增**。发消息后多久仍未看到 `session.status_running` 就在房间写一次排队通知；非整数回退默认；夹到 `1000..120000` |

上线顺序（写入 §8 回滚与 README 不在本文范围，只在 PR 描述里说明）：先让目标员工 Near 升级并打开 D01「承接托管智能体任务」开关（`protocol: dual`），agent-runtime 设 `MA_RUNTIME_DESKTOP_WORKER_ENABLED=1`、`MA_RUNTIME_DESKTOP_PAT_ENABLED=1`，最后门户设 `MA_RUNTIME_DESKTOP_ROUTING=1`。

---

## 4. 协议细节（门户 ↔ agent-runtime）

请求头同 E04（`Authorization: Bearer <service PAT>`；`content-type: application/json`；只有建会话带 `X-AgenticX-On-Behalf-Of: <session.userId>`）。

| 步骤 | 请求 | 成功 | 失败处理 |
|---|---|---|---|
| 建会话 | `createMaSession(config, {agentId: agent.id, onBehalfOf: session.userId, title: "协作房间 " + roomId})`（body 恰为 `{agent_id, source:"portal", title}`） | 201 → `{id, agentVersion}` | 任何失败 → **回退旧队列**（`reason: create_failed:<status>`）。典型：404 `environment_not_found`（Agent 无默认环境）、400 `invalid_request`（Worker 面未开）、403（服务 PAT 缺 scope） |
| 发消息 | `postMaEvents(config, id, [{type:"user.message", content:[{type:"text", text: buildRoomContextText(agent, history, trigger)}]}])` | 200 → `userSeq = events[0].seq` | 任何失败 → 先 `archiveMaSession`（失败只记日志）再**回退旧队列**（`reason: post_failed:<status>`）。此时 Work Item 尚未创建（`handle_client_batch` 落库成功后才 `submit_message`），归档只为不留空会话 |
| 读事件 | `streamMaEvents(config, id, {afterSeq: cursor, signal})` | 同 E04 | 断流以最大 seq 重连，最多 2 次；仍失败 → `unavailable` 通知（不回退） |
| 中断 | `postMaEvents(..., [{type:"user.interrupt"}])` | 200 | 失败只记日志。Worker 经 inbox 收到中断并以 `end_turn` 收尾 |
| 归档 | **新增** `POST {base}/ma/v1/sessions/{id}/archive`（无 body；`content-type` 不带） | 200 | 失败只记日志。归档触发 `RemoteWorkerExecutor.close()` 把 queued Work Item 置 `stopped`，防止过期任务稍后被员工电脑领取 |

**何时中断、何时归档（超时分支）**：超时时若本次回复已收到过 `session.status_running`（Worker 已开跑）→ 发 `user.interrupt`；否则（无人领取）→ 归档。归档要求会话 `idle`——未开跑的桌面会话一定是 `idle`（`idle -> running` 只在 Worker ingest `session.status_running` 时发生，见 `remote_executor.py` 文档字符串）。

---

## 5. 精确落点

### 5.1 `src/lib/collab-room/ma-runtime-client.ts`（只追加，放在文件末尾 `parseSseStream` 之后）

```ts
export const DEFAULT_DESKTOP_REPLY_TIMEOUT_MS = 600_000;
export const DEFAULT_DESKTOP_CLAIM_NOTICE_MS = 15_000;
const MIN_DESKTOP_CLAIM_NOTICE_MS = 1_000;
const MAX_DESKTOP_CLAIM_NOTICE_MS = 120_000;

export type MaDesktopRoutingConfig = { replyTimeoutMs: number; claimNoticeMs: number };

/** 桌面切换开关。base 为 resolveMaRuntimeConfig 的结果；base 为 null 或开关不为 "1" 时返回 null（不告警）。 */
export function resolveMaDesktopRoutingConfig(
  base: MaRuntimeConfig | null,
  env: MaEnv = process.env,
): MaDesktopRoutingConfig | null;

/** POST /ma/v1/sessions/:id/archive。非 2xx 抛 MaRuntimeError（同 postMaEvents 的错误映射）。 */
export async function archiveMaSession(config: MaRuntimeConfig, sessionId: string, fetchImpl: typeof fetch): Promise<void>;
```

实现要点：
- `resolveMaDesktopRoutingConfig`：`if (!base || env.MA_RUNTIME_DESKTOP_ROUTING?.trim() !== "1") return null;` 两个毫秒值用与 `runtimeReplyTimeout` 相同的解析写法（`/^-?\d+$/` 校验 → `Number` → 夹取）；`replyTimeoutMs` 夹到 `MIN_REPLY_TIMEOUT_MS..MAX_REPLY_TIMEOUT_MS`（文件内既有常量 5000 / 1800000），`claimNoticeMs` 夹到 1000..120000。`MaEnv` 为文件内既有类型（实施前 `rg -n "type MaEnv" ma-runtime-client.ts` 核对名称）。
- `archiveMaSession`：`maFetch(\`${config.baseUrl}/ma/v1/sessions/${encodeURIComponent(sessionId)}/archive\`, { method: "POST", headers: authHeader(config.serviceToken) }, fetchImpl)`；`!res.ok` → `await throwForStatus(res)`；成功不读 body。

### 5.2 新建 `src/lib/collab-room/ma-desktop-reply.ts`

```ts
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { log } from "../observability/logger";
import { buildRoomContextText, maNotices, summarizeManagedEvents } from "./ma-agent-reply";
import {
  archiveMaSession, createMaSession, MaRuntimeError, postMaEvents, streamMaEvents,
  type MaDesktopRoutingConfig, type MaRuntimeConfig, type MaWireEvent,
} from "./ma-runtime-client";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";

export const MA_DESKTOP_STREAM_RECONNECTS = 2;

export const maDesktopNotices = {
  queued: "当前没有在线的桌面执行端，任务已排队",
  unclaimed: (name: string) => `智能体「${name}」没有桌面执行端接单，本次任务已取消`,
} as const;

export type ManagedDesktopReplyDeps = {
  config: MaRuntimeConfig;
  desktop: MaDesktopRoutingConfig;
  fetchImpl: typeof fetch;
  appendMessage: CollabRoomStore["appendMessage"];
};

export type ManagedDesktopReplyOutcome = { kind: "handled" } | { kind: "fallback"; reason: string };

export function isManagedDesktopEligible(agent: Pick<EnterpriseAgent, "runtime">): boolean; // agent.runtime === "desktop_worker"

export async function runManagedDesktopReply(params: {
  ctx: CollabRoomContext;
  roomId: string;
  session: AuthContext;
  agent: EnterpriseAgent;
  trigger: CollabRoomMessage;
  history: CollabRoomMessage[];
  deps: ManagedDesktopReplyDeps;
}): Promise<ManagedDesktopReplyOutcome>;
```

`maDesktopNotices.queued` 的文本必须与 `agent-reply.ts` 的 `DESKTOP_QUEUE_NOTICE` **逐字相同**（FR-6 断言）。

#### 5.2.1 `runManagedDesktopReply` 算法（伪代码，逐条实现）

```text
name = agent.displayName
# 1) create + post; failures fall back to the legacy queue
try: created = await createMaSession(config, {agentId: agent.id, onBehalfOf: session.userId, title: `协作房间 ${roomId}`}, fetchImpl)
catch (e): return fallback(`create_failed:${statusOf(e)}`)
try: stored = await postMaEvents(config, created.id, [userMessage(buildRoomContextText(agent, history, trigger))], fetchImpl)
catch (e):
  await archiveMaSession(config, created.id, fetchImpl).catch(logArchiveFailed)
  return fallback(`post_failed:${statusOf(e)}`)
userSeq = stored[0]?.seq ?? 0

# 2) consume events; from here on never fall back
controller = new AbortController(); timeout = setTimeout(() => controller.abort(), desktop.replyTimeoutMs)
sawRunning = false; noticePosted = false
noticeTimer = setTimeout(() => {
  if (!sawRunning && !noticePosted) { noticePosted = true; void appendNotice(maDesktopNotices.queued).catch(logNoticeFailed) }
}, desktop.claimNoticeMs)
collected = []; cursor = userSeq; interrupted = false; reconnects = 0; done = false
try:
  while (!done):
    try:
      for await (ev of streamMaEvents(config, created.id, {afterSeq: cursor, signal: controller.signal}, fetchImpl)):
        if (ev.seq <= cursor) continue
        cursor = ev.seq; collected.push(ev)
        if (ev.type === "session.status_running") { sawRunning = true; continue }
        if (ev.type !== "session.status_idle") continue
        if (ev.stop_reason?.type === "requires_action"):
          if (!interrupted) { interrupted = true; await postMaEvents(..., [{type:"user.interrupt"}]).catch(logInterruptFailed) }
          continue
        done = true; break
      if (!done) throw new MaRuntimeError("stream ended early", 0, null)
    catch (e):
      if (controller.signal.aborted) throw e
      if (++reconnects > MA_DESKTOP_STREAM_RECONNECTS): append notice maNotices.unavailable(name); return handled
catch (e) when controller.signal.aborted:
  if (sawRunning): await postMaEvents(..., [{type:"user.interrupt"}]).catch(logInterruptFailed); append notice maNotices.timeout(name)
  else:            await archiveMaSession(config, created.id, fetchImpl).catch(logArchiveFailed); append notice maDesktopNotices.unclaimed(name)
  return handled
finally: clearTimeout(timeout); clearTimeout(noticeTimer)

# 3) post the outcome (same rules as E04 §5.2.3 step 4)
s = summarizeManagedEvents(collected)
if (s.requiresAction): append notice maNotices.needsConfirmation(name); return handled
if (s.finalText): append agent message (below); return handled
notice = s.stopType === "policy_blocked" ? maNotices.policyBlocked : s.stopType === "budget_exceeded" ? maNotices.budgetExceeded : maNotices.unavailable
append notice notice(name); return handled
```

`statusOf(e)`：`e instanceof MaRuntimeError ? e.status : 0`（本文件私有）。`userMessage(text)` = `{ type: "user.message", content: [{ type: "text", text }] }`。注意：`for await` 内 `requires_action` 的 `await postMaEvents` 与 E04 相同（中断后 Worker 回传 `end_turn`，循环继续直到该 idle）。

写回房间（与旧桌面路径的 `runtime` 值一致，只是 metadata 键不同，旧路径的 `worker_user_id` / `worker_device` 事件里拿不到，不写）：

```ts
await deps.appendMessage(ctx, roomId, {
  senderType: "agent",
  senderId: agent.id,
  senderName: agent.displayName,
  content: s.finalText,
  model: agent.model,
  metadata: {
    agent_slug: agent.slug,
    runtime: "desktop_worker",
    reply_to: trigger.id,
    ma_session_id: created.id,
    agent_version: created.agentVersion,
    ...(s.steps.length > 0 ? { tool_steps: s.steps } : {}),
  },
});
```

系统通知统一 `appendMessage(ctx, roomId, { senderType: "system" as CollabSenderType, senderId: "system", senderName: "系统", content })`（本文件私有 `appendNotice`）。

日志事件名（字段只含 `room_id`、`agent_id`、`ma_session_id`、`reason` / `status`，**不含**消息内容与 token）：`room.agent_reply.ma_desktop_fallback`、`room.agent_reply.ma_desktop_archive_failed`、`room.agent_reply.ma_desktop_interrupt_failed`、`room.agent_reply.ma_desktop_notice_failed`、`room.agent_reply.ma_desktop_stream_failed`。

### 5.3 修改 `src/lib/collab-room/agent-reply.ts`（4 处，其他行不动）

1. **import 区**：第 12 行 `import { resolveMaRuntimeConfig, type MaRuntimeConfig } from "./ma-runtime-client";` **改为**（同一行扩展，不新增行以外的改动）：

```ts
import {
  resolveMaDesktopRoutingConfig,
  resolveMaRuntimeConfig,
  type MaDesktopRoutingConfig,
  type MaRuntimeConfig,
} from "./ma-runtime-client";
import { isManagedDesktopEligible, runManagedDesktopReply } from "./ma-desktop-reply";
```

2. **`AgentReplyDeps`**：第 36 行 `listAvailableModels?: ...;` 之后追加：

```ts
  /** null 表示桌面切换关闭；undefined 时由 resolveAgentReplyDeps 从环境变量解析。 */
  maDesktop?: MaDesktopRoutingConfig | null;
```

3. **`resolveAgentReplyDeps` 返回对象**：把第 173 行的 `maRuntime` 计算提到 `return` 之前的局部变量，并追加 `maDesktop`。Before：

```ts
  return {
    ...
    maRuntime: overrides?.maRuntime !== undefined ? overrides.maRuntime : resolveMaRuntimeConfig(),
    listAvailableModels: overrides?.listAvailableModels ?? defaultListAvailableModels,
  };
```

After：

```ts
  const maRuntime = overrides?.maRuntime !== undefined ? overrides.maRuntime : resolveMaRuntimeConfig();
  return {
    ...
    maRuntime,
    listAvailableModels: overrides?.listAvailableModels ?? defaultListAvailableModels,
    maDesktop: overrides?.maDesktop !== undefined ? overrides.maDesktop : resolveMaDesktopRoutingConfig(maRuntime),
  };
```

（`...` 表示其余键保持原样、原顺序。）

4. **`enqueueDesktopWorkerTask`**：在第 119 行 `const history = await deps.listMessages(ctx, roomId, { limit: 30 });` 之后、第 120 行 `const queued = ...` 之前插入：

```ts
  if (deps.maRuntime && deps.maDesktop && isManagedDesktopEligible(agent)) {
    const outcome = await runManagedDesktopReply({
      ctx,
      roomId,
      session,
      agent,
      trigger: triggerMessage,
      history,
      deps: {
        config: deps.maRuntime,
        desktop: deps.maDesktop,
        fetchImpl: deps.fetchImpl ?? fetch,
        appendMessage: deps.appendMessage,
      },
    });
    if (outcome.kind === "handled") return;
    log("warn", { event: "room.agent_reply.ma_desktop_fallback", room_id: roomId, agent_id: agent.id, reason: outcome.reason });
  }
```

Before：所有 `desktop_worker` Agent 一律写 `enterprise_agent_tasks`。After：两开关都开时先走托管；`handled` 直接返回；`fallback` 继续执行原有队列代码（后续行完全不变，`DESKTOP_QUEUE_NOTICE` 行为不变）。`dispatchAgentMention` 的 `switch` 不改。

---

## 6. FR / NFR / AC

所有用例：vitest，`fetch` 全部 mock，不访问网络与数据库。测试辅助 `sseBody` / `runtimeFetch` 按 E04 §5.4 的写法在 `ma-desktop-reply.test.ts` 内各自定义一份（不新建共享模块）；`runtimeFetch` 额外分派 `POST /ma/v1/sessions/:id/archive` → `archive` 回调（缺省 200 `{}`）。

测试 Agent 夹具：`{ id: "01AGENT00DDDDDDDDDDDDDDDDD", slug: "desk-bot", displayName: "桌面助手", runtime: "desktop_worker", model: "demo/desk-model", capabilityIds: [], metadata: {} , ...其余字段同 E04 测试夹具 }`；`roomId = "room-1"`；trigger 发送人 `Alice`。

标准桌面成功序列（`SID = "01SESSION0DDDDDDDDDDDDDDDD"`、`userSeq = 1`、建会话响应 `agent_version: 2`）：seq2 `session.status_running`；seq3 `span.model_request_start`；seq4 `agent.tool_use{id:"01TOOLUSE0DDDDDDDDDDDDDDDD", name:"file_write", input:{path:"hello.txt"}, created_at:"2026-10-25T00:00:00.000Z"}`；seq5 `agent.tool_result{tool_use_id:"01TOOLUSE0DDDDDDDDDDDDDDDD", content:[{type:"text",text:"secret-output"}], is_error:false, created_at:"2026-10-25T00:00:02.000Z"}`；seq6 `span.model_request_end`；seq7 `agent.message{content:[{type:"text",text:"桌面回复"}]}`；seq8 `session.usage`；seq9 `session.status_idle{stop_reason:{type:"end_turn",event_ids:[]}}`。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 开关解析 | `ma-runtime-client.test.ts::resolveMaDesktopRoutingConfig`：`(null, {MA_RUNTIME_DESKTOP_ROUTING:"1"})` → `null`；`(base, {})` → `null`；`(base, {MA_RUNTIME_DESKTOP_ROUTING:"1"})` → `{replyTimeoutMs:600000, claimNoticeMs:15000}`；`MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS:"10"` → 5000、`"99999999"` → 1800000、`"x"` → 600000；`MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS:"1"` → 1000、`"999999"` → 120000 |
| FR-2 | 归档请求形状 | `ma-runtime-client.test.ts::archiveMaSession`：URL `http://rt/ma/v1/sessions/SID/archive`、方法 POST、头 `authorization: Bearer agx-pat-x`、无 `X-AgenticX-On-Behalf-Of`、无 body；409 `{"error":{"code":"invalid_request","message":"session is running"}}` → 抛 `MaRuntimeError{status:409, code:"invalid_request"}`，`String(err)` 不含 `agx-pat-x` |
| FR-3 | 资格 | `ma-desktop-reply.test.ts::isManagedDesktopEligible`：`desktop_worker` → true；`cloud` → false |
| FR-4 | 成功写回 | `ma-desktop-reply.test.ts::posts the worker reply with desktop metadata`：标准序列 → `{kind:"handled"}`；`appendMessage` 恰 1 次，`objectContaining({senderType:"agent", senderId: agent.id, content:"桌面回复", model: agent.model, metadata:{agent_slug:"desk-bot", runtime:"desktop_worker", reply_to: trigger.id, ma_session_id: SID, agent_version: 2, tool_steps:[{tool:"file_write", server:"builtin", ok:true, durationMs:2000}]}})`；`JSON.stringify(metadata)` 不含 `secret-output`；建会话请求 body 恰为 `{agent_id, source:"portal", title:"协作房间 room-1"}`（**无** `environment_id`）；archive 未被调用 |
| FR-5 | 建会话 / 发消息失败回退 | `falls back when the runtime has no desktop environment`：create 返回 404 `environment_not_found` → `{kind:"fallback", reason:"create_failed:404"}`，`appendMessage` 未调用，archive 未调用；create 返回 400 → `reason:"create_failed:400"`；`archives and falls back when posting fails`：post 返回 409 → archive 恰调用 1 次（URL 含 SID）且 `reason:"post_failed:409"`；archive 本身返回 500 时仍返回同一 fallback（不抛） |
| FR-6 | 排队通知 | `posts one queued notice when nobody claims in time`：`claimNoticeMs:30`、`replyTimeoutMs:2000`；流先挂起 100ms 不给任何事件，再推标准序列 → 房间依次写入 1 条系统通知（内容 === `"当前没有在线的桌面执行端，任务已排队"`）和 1 条 agent 消息；`does not post the queued notice once running is seen`：`claimNoticeMs:50`，流立即给 seq2 `status_running` 后挂起 100ms 再给剩余 → 无系统通知 |
| FR-7 | 超时：未领取 → 归档 | `archives unclaimed sessions on timeout`：`replyTimeoutMs:50`、`claimNoticeMs:1000`，流 `hang:true` → archive 恰 1 次；无 `user.interrupt` 请求；系统通知 `智能体「桌面助手」没有桌面执行端接单，本次任务已取消`；用例 < 2 秒 |
| FR-8 | 超时：已开跑 → 中断 | `interrupts running sessions on timeout`：流给 seq2 `status_running` 后挂起，`replyTimeoutMs:80` → 收到一次 body `{events:[{type:"user.interrupt"}]}`；archive 未调用；通知 `智能体「桌面助手」处理超时，请稍后再试` |
| FR-9 | requires_action 与无文本收尾 | `interrupts when the worker asks for confirmation`：同 E04 FR-9 的事件编排 → 一次 interrupt、1 条 `needsConfirmation` 通知、无 agent 消息；`maps stop reasons without text`：参数化 `retries_exhausted`（Worker 心跳丢失，事件前加 `session.error{error:{type:"worker_lost"}}`）→ `暂时不可用`；`budget_exceeded` → `本次用量已达上限`；`policy_blocked` → `触发合规拦截` |
| FR-10 | 断线重连 | `reconnects from the last seen seq`：第一次流只给 seq2–4 后关闭；第二次请求 URL 含 `after_seq=4`，给 seq5–9 → 写回 `桌面回复`；三次都提前关闭 → `暂时不可用` |
| FR-11 | 分派：开关开 | `agent-reply.test.ts::routes desktop worker agents to the managed runtime when desktop routing is on`：overrides `maRuntime:{baseUrl:"http://rt", serviceToken:"agx-pat-svc", replyTimeoutMs:5000}`、`maDesktop:{replyTimeoutMs:5000, claimNoticeMs:1000}`、`fetchImpl: runtimeFetch(标准序列)`、`enqueueAgentTask: vi.fn()` → `enqueueAgentTask` 未调用；`append` 收到 agent 消息 `metadata.runtime === "desktop_worker"`、`metadata.ma_session_id === SID` | gitleaks:allow
| FR-12 | 分派：回退旧队列 | `agent-reply.test.ts::falls back to the legacy desktop queue when the runtime rejects the session`：create 返回 400 → `enqueueAgentTask` 恰 1 次（参数含 `agentId`、`triggerMessageId`）；`hasOnlineWorker` 返回 false 时仍写 `DESKTOP_QUEUE_NOTICE`（与现有用例同文） |
| FR-13 | 分派：桌面开关关 | `agent-reply.test.ts::keeps desktop worker agents on the legacy queue when desktop routing is off`：`maRuntime` 已配置、`maDesktop: null` → `http://rt` 未被调用，`enqueueAgentTask` 恰 1 次。另：现有第 487 行用例（未传 `maDesktop`，`beforeEach` 已 `vi.stubEnv("MA_RUNTIME_ENABLED","0")`）不改一字仍通过 |
| NFR-1 | 类型 | `pnpm --filter @agenticx/app-web-portal typecheck` 无错；新代码不对 `stop_reason.type` 写 `switch`（用 if 链） |
| NFR-2 | 不泄露 | FR-2 的 `String(err)` 断言；FR-4 metadata 不含工具输出；日志字段只含 id / 原因 / 状态码 |
| NFR-3 | 范围 | `git diff --name-only -- enterprise/apps/web-portal` 只出现 §2.1 的 6 个文件 |

---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX/enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/app-web-portal test -- src/lib/collab-room
pnpm --filter @agenticx/app-web-portal typecheck
git status --porcelain -- apps/web-portal
```

**W3 门联调（需 E01/E02/E03/A04/A05/D01 已合入，PG 容器在 55432）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
# 1) .env.local：MA_RUNTIME_ENABLED='1'、MA_RUNTIME_DESKTOP_ROUTING='1'
MA_RUNTIME_DESKTOP_WORKER_ENABLED=1 MA_RUNTIME_DESKTOP_PAT_ENABLED=1 \
  bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 2) admin-console：建 desktop_worker 环境「研发桌面」（执行名单含员工 A），Agent「桌面助手」运行方式=员工桌面执行、
#    默认环境=「研发桌面」，发布
# 3) 员工 A 的 Near：登录企业，设置 → 企业 Worker 打开「承接托管智能体任务」（protocol: dual），所属环境出现「研发桌面」
#    （本地开发需在 ~/.agenticx/config.yaml 配 enterprise.worker.ma_base_url / gateway_url，见 D01 §8）
# 4) 员工 B 在门户协作房间 @桌面助手「在工作目录写 hello.txt 并回复完成」
# 期望：A 的 Near「运行中的任务」出现该会话；房间出现智能体回复，metadata.runtime=desktop_worker、ma_session_id 存在；
#       A 机器上 ~/.agenticx/sessions/<ma_session_id>/work/hello.txt 存在；
#       curl --noproxy '*' -s http://127.0.0.1:8092/ma/v1/sessions/<ma_session_id> -H "Authorization: Bearer $(cat .local-secrets/ma_portal_service.pat)"
#       → source=portal、created_by_user_id=B、status=idle、stop_reason.type=end_turn
# 5) A 关闭接单开关后 B 再 @：15 秒后房间出现「当前没有在线的桌面执行端，任务已排队」；10 分钟后出现「没有桌面执行端接单，本次任务已取消」，
#    会话 status=archived（可把 MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS 临时设 20000 加速）
# 6) 门户 MA_RUNTIME_DESKTOP_ROUTING='0' 重启：同一操作写 enterprise_agent_tasks（旧路径），回复 metadata 无 ma_session_id
```

---

## 8. 回滚

- 开关：`MA_RUNTIME_DESKTOP_ROUTING` 缺省 / `0`（或 `MA_RUNTIME_ENABLED` 关闭）→ `deps.maDesktop === null` → `enqueueDesktopWorkerTask` 在插入的 `if` 处直接跳过，后续与改动前完全一致。
- 运行中故障：建会话 / 发消息失败自动回退旧队列；回复阶段故障只发系统通知。
- 代码回滚：删除 `ma-desktop-reply.ts` 与其测试，`git checkout` `agent-reply.ts`、`ma-runtime-client.ts` 与两个被追加的测试文件。

## 9. 不变量

1. `MA_RUNTIME_DESKTOP_ROUTING` 关闭时：`enterprise_agent_tasks` 写入参数、`hasOnlineWorker` 调用、`DESKTOP_QUEUE_NOTICE` 文案与时机与改动前逐字一致（现有 9 个用例不改即通过）。
2. cloud Agent 的 E04 托管分支与网关回退路径一行不动。
3. `MaRuntimeConfig` 类型与 `resolveMaRuntimeConfig` 返回值不变（E04 的 `toEqual` 断言继续通过）。
4. 旧 Worker 接口 `/api/desktop/worker/*` 与其写回 metadata 不变。
5. 门户永不把服务 PAT 写进日志、错误消息或房间消息；`tool_steps` 不含工具输入 / 输出文本。

## 10. 风险与待确认

1. **员工 Near 未升级到 `dual`**：任务无人领取 → 15 秒后排队通知 → 超时归档并通知「已取消」。上线顺序见 §3；这是开关单独存在的理由。
2. **计量归属**：桌面执行的模型调用在网关记为**领取者**（设备 PAT 属主），`ma_session_usage.user_id` 记为**发起人**（`created_by_user_id`）。两者不同是预期行为（与旧队列一致），MA-E10 的「用户 × Agent」配额按发起人计（见 E10）。
3. **请求时长**：`POST /api/rooms/:id/messages` 同步等待（与 E04 一致），桌面任务默认最长 10 分钟；反代 60 秒读超时会先断开前端连接，但服务端继续写回房间，前端轮询可见。
4. **Agent 默认环境误配为 cloud 类型**：agent-runtime 会在云端执行而不是员工电脑。属管理员配置问题，本文不在门户侧校验环境类型（门户读不到环境）。
5. **待确认**：超时默认 10 分钟、排队通知 15 秒是否合适（Q1）。

## 11. 需要在 master §12 登记的事项

- 门户新增环境变量 `MA_RUNTIME_DESKTOP_ROUTING` / `MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS` / `MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS`；桌面会话超时且未被领取时由门户**归档**会话以取消排队中的 Work Item（不新增协议字段）。
