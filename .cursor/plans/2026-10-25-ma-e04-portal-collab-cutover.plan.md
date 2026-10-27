# MA-E04 协作房间云端智能体切到托管运行时

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W2 · MA-E04）
Depends-on:
- MA-E03 `.cursor/plans/pending/2026-10-25-ma-e03-agent-runtime-service.plan.md`（agent-runtime :8092；`X-AgenticX-On-Behalf-Of` 代表用户建会话，要求服务 PAT 含 `ma:sessions:on_behalf`；nginx / compose / start-dev 里的 `MA_RUNTIME_*` 环境变量）
- MA-A04 `.cursor/plans/pending/2026-10-25-ma-a04-managed-host.plan.md`（会话面 API 形状：`POST /ma/v1/sessions`、`POST .../events`、`GET .../events/stream`，错误体 `{"error":{"code","message","details"}}`）
- MA-00 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md`（事件类型与 `stop_reason` 枚举）

> 风险等级：中。**上游未实现声明**：MA-E03 / MA-A04 尚未合入，本文引用的接口路径、请求体、错误码按其 plan 书写，**以实际实现为准，实施前核对**（`rg "ma/v1/sessions" agenticx/managed/host`；`rg "ON_BEHALF_OF_HEADER" enterprise/apps/agent-runtime`）。本子规划只改 web-portal，不依赖 E03 的 Python 代码即可完成并通过全部单测（全部 mock `fetch`）。

---

## 0. 一句话目标

在 `MA_RUNTIME_ENABLED=1` 时，协作房间里被 @ 的**云端**智能体不再由门户 TS 小循环 `runCloudAgentLoop` 生成回复，而是：门户用服务 PAT 代表发言用户在 agent-runtime 新建一个托管会话 → 把房间上下文拼成一条 `user.message` 发进去 → 读 SSE 直到会话空闲 → 把最终 `agent.message` 按与现在完全相同的方式写回房间。开关关闭、Agent 不符合条件、或托管会话没建起来时，走现有代码路径，行为与现在逐字一致。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §3.2 第一行 | 门户 `runCloudAgentLoop`（`MAX_TOOL_ROUNDS = 6`，只能调网关 MCP，无沙箱、无版本、无权限策略）由 agent-runtime 取代；`agent-reply.ts` 加开关切换，TS loop 保留为回退，稳定一个波次后删除（删除另起子规划） | §5.3；不删任何现有函数 |
| §7 W2 门 | 门户协作房间 @ 该 Agent，开关开启时由 agent-runtime 在云端执行；开关关闭时回到 TS loop，行为与现在一致 | §6 FR-1 / FR-9 |
| §4 决策 4 | 门户经 agent-runtime 公共 API（PAT） | 服务 PAT `MA_RUNTIME_SERVICE_TOKEN` |
| §4 决策 9 | 个人模式 / 现有路径不变 | 默认关闭 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 |
|---|---|---|
| `enterprise/apps/web-portal/src/lib/collab-room/agent-reply.ts` | 11–31 | `AgentReplyDeps`：`listMessages`、`appendMessage`、`requestReply`、`getAccessToken`、`gatewayUrl`、`fetchImpl?`、`loadMcpServers?`、`enqueueAgentTask?`、`hasOnlineWorker?` |
| 同上 | 33–48 | `CONTENT_LIMIT = 4000`、`clipContent`；文案 `modelDenied(name)` = `智能体「${name}」使用的模型对你不可用，请联系管理员`；`unavailable(name)` = `智能体「${name}」暂时不可用，请稍后再试` |
| 同上 | 59–78 | `buildCloudAgentPrompt`：系统提示 + 房间说明 `你是协作房间里的智能体「${agent.displayName}」，房间里有多个成员，回复简洁并指明回应对象`；历史按 seq 排序取最后 30 条；本 Agent 自己的消息作 assistant，其他人作 `${name}：${content}` |
| 同上 | 143–168 | `resolveAgentReplyDeps(overrides)`：测试注入存储时不加载 `./index`（动态 import 的既有先例与注释） |
| 同上 | 170–172 | `hasMcpCapability(capabilityIds)`：任一 id 以 `mcp:` 开头 |
| 同上 | 182–268 | `triggerCloudAgentReply`：拉 30 条历史 → 取用户 access token（无则 `unavailable` 通知）→ 用用户 JWT 调网关（403/401 → `modelDenied`，其他错误 → `unavailable`）→ 有 MCP 能力走 `runCloudAgentLoop`，否则单轮 `requestReply` → `appendMessage({senderType:"agent", senderId, senderName, content, model: agent.model, metadata:{agent_slug, runtime:"cloud", reply_to, tool_steps?}})` |
| 同上 | 270–291 | `dispatchAgentMention`：`switch (agent.runtime)`：`cloud` → `triggerCloudAgentReply`；`desktop_worker` → `enqueueDesktopWorkerTask`（旧 Worker 队列）；`default` 分支 `never` 穷尽检查 |
| `enterprise/apps/web-portal/src/lib/collab-room/agent-executor.ts` | 11、68–120 | `MAX_TOOL_ROUNDS = 6`；`runCloudAgentLoop` 只支持网关 MCP 与知识库检索工具 |
| `enterprise/apps/web-portal/src/lib/collab-room/agent-knowledge.ts` | 5–9 | `knowledgeSearchUrl(agent)`：读 `agent.metadata.knowledgeSearchUrl` |
| `enterprise/apps/web-portal/src/app/api/rooms/[roomId]/messages/route.ts` | 31–69、106–151 | `POST` 写入人类消息后 **await** `replyToAgentMentions` → `dispatchAgentMention`（回复在同一请求内同步完成；异常只记日志） |
| `enterprise/apps/web-portal/src/lib/collab-room/__tests__/agent-reply.test.ts` | 1–289 | 5 个现有用例，全部通过 overrides 注入；未设置任何 `MA_*` 环境变量 |
| `enterprise/apps/web-portal/src/lib/admin-providers-reader.ts` | 164–200 | `listAvailableModelsForUser(userId, email?, deptId?)` 返回 `PortalModelOption[]`，`id` 形如 `${providerId}/${modelName}`（与 Agent `model` 格式一致） |
| `enterprise/apps/web-portal/src/lib/observability/logger.ts` | 108 | `log(level, fields)` |
| `enterprise/packages/auth/src/types.ts` | 15–23 | `AuthContext = { userId, tenantId, deptId?, email, scopes, mustChangePassword, sessionId }` |
| `enterprise/apps/gateway/internal/server/server.go` | 1537–1559 | 网关对 PAT 请求一律按 PAT 属主记身份（E03 D4）→ 托管路径下网关**不会**再替用户把关「模型对你不可用」 |

### 1.3 为什么要有「条件」和「前置校验」

1. **MCP / 知识库**：现有 TS loop 能调网关托管 MCP（`capabilityIds` 中的 `mcp:*`）和 `metadata.knowledgeSearchUrl` 知识检索。E01 回填出的 manifest 把这些放在 `metadata.legacy_capability_ids`，**托管运行时在 MA-A06 之前不连接 MCP**（MA-A01 §3 Out of scope）。如果把这类 Agent 切过去，它们会静默丢掉工具。→ 只有「无 `mcp:` 能力且无知识库地址」的云端 Agent 走托管路径（`isManagedEligible`）。
2. **模型可见性**：现在用户 JWT 调网关，网关会对用户不可见的模型返回 403，门户显示 `modelDenied`。托管路径下网关看到的是服务账号 → 门户必须自己先查 `listAvailableModelsForUser`，不可见则照旧显示 `modelDenied`，不建会话。
3. **审批 / 自定义工具**：房间没有审批 UI。会话进入 `requires_action` 时，门户发 `user.interrupt` 收尾并给出明确通知，不挂起。

---

## 2. In scope / Out of scope

### 2.1 In scope（只能创建或修改这些文件；路径相对 `enterprise/apps/web-portal/`）

- 新建 `src/lib/collab-room/ma-runtime-client.ts`
- 新建 `src/lib/collab-room/ma-agent-reply.ts`
- 修改 `src/lib/collab-room/agent-reply.ts`（§5.3 列出的 4 处，其他行不动）
- 新建 `src/lib/collab-room/__tests__/ma-runtime-client.test.ts`
- 新建 `src/lib/collab-room/__tests__/ma-agent-reply.test.ts`
- 修改 `src/lib/collab-room/__tests__/agent-reply.test.ts`：只追加 `beforeEach` / `afterEach` 环境隔离与 4 个新用例；**现有 5 个用例一字不改**

### 2.2 Out of scope

- `agent-executor.ts`、`meta-reply.ts`、`agent-knowledge.ts`、`agent-mcp-servers.ts`、`agent-mentions.ts`、`worker-tasks/**`、`app/api/rooms/**` 一律不改。
- `desktop_worker` 运行方式的 Agent：**继续走旧的 `enqueueAgentTask` 队列**（`enterprise_agent_tasks`），不切到 MA 的 desktop_worker 环境——agent-runtime 的 Worker 面在 E03 默认关闭（E03 D11），桌面接入属 MA-D01 / W3。
- 删除 `runCloudAgentLoop`（另起子规划）。
- 房间内审批、自定义工具、流式逐字展示到房间、托管会话复用（每次 @ 新建会话）。
- 部署文件（`MA_RUNTIME_*` 的 compose / start-dev / bootstrap 接线已在 E03 完成）。

---

## 3. 环境变量（门户进程读取）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MA_RUNTIME_ENABLED` | `0` | 只有恰为 `"1"` 时启用托管路径 |
| `MA_RUNTIME_URL` | `http://127.0.0.1:8092` | agent-runtime 根地址（compose 内为 `http://agent-runtime:8092`）；去掉尾部 `/` |
| `MA_RUNTIME_SERVICE_TOKEN` / `MA_RUNTIME_SERVICE_TOKEN_FILE` | — | 服务 PAT（scope 含 `ma:sessions:read`、`ma:sessions:write`、`ma:sessions:on_behalf`、`ma:agents:read`）；`_FILE` 优先；去空白后须以 `agx-pat-` 开头，否则视为未配置 |
| `MA_RUNTIME_REPLY_TIMEOUT_MS` | `180000` | 单次回复最长等待；非整数回退默认；夹到 `5000..1800000` |

配置不完整（启用但没有合法 token）→ 等同关闭，并且每个进程只 `log("warn", { event: "room.agent_reply.ma_config_invalid", reason })` 一次。

---

## 4. 协议细节（门户 ↔ agent-runtime）

所有请求头：`Authorization: Bearer <service PAT>`、`content-type: application/json`（GET 不带）。

| 步骤 | 请求 | 成功 | 失败处理 |
|---|---|---|---|
| 建会话 | `POST {base}/ma/v1/sessions`，额外头 `X-AgenticX-On-Behalf-Of: <session.userId>`，body `{"agent_id": agent.id, "source": "portal", "title": "协作房间 " + roomId}` | 201，JSON 为会话记录，取 `id`（ULID）与 `agent_version` | 任何失败（网络、非 2xx、JSON 不合法）→ **回退 TS loop** |
| 发消息 | `POST {base}/ma/v1/sessions/{id}/events`，body `{"events":[{"type":"user.message","content":[{"type":"text","text": <§5.2 文本>}]}]}` | 200，`{"events":[{...,"seq":N}]}`，取 `events[0].seq` 为 `userSeq` | 任何失败 → **回退 TS loop**（此时房间里还没有任何回复，不会重复） |
| 读事件 | `GET {base}/ma/v1/sessions/{id}/events/stream?after_seq={cursor}`，头 `accept: text/event-stream` | `text/event-stream`；每帧 `id: <seq>`、`event: <type>`、`data: <wire JSON>`；`: ping` 注释行忽略 | 连接中断 → 以已收到的最大 seq 为 `cursor` 重连，最多重连 2 次；仍失败 → `unavailable` 通知（不回退） |
| 中断 | `POST .../events`，body `{"events":[{"type":"user.interrupt"}]}` | 200 | 失败只记日志 |

`userSeq` 之后才计入本次回复：`cursor` 初值 = `userSeq`。会话是本次新建的，不存在别的回合。

---

## 5. 精确落点

### 5.1 新建 `src/lib/collab-room/ma-runtime-client.ts`

```ts
import { readFileSync } from "node:fs";

export const MA_ON_BEHALF_OF_HEADER = "X-AgenticX-On-Behalf-Of";
export const DEFAULT_MA_RUNTIME_URL = "http://127.0.0.1:8092";
export const DEFAULT_REPLY_TIMEOUT_MS = 180_000;
const MIN_REPLY_TIMEOUT_MS = 5_000;
const MAX_REPLY_TIMEOUT_MS = 1_800_000;

export type MaRuntimeConfig = { baseUrl: string; serviceToken: string; replyTimeoutMs: number };

/** 托管运行时返回的 wire 事件（MA-00 ServerEvent / ClientEvent 的 JSON 形状，至少含 id/seq/type/created_at）。 */
export type MaWireEvent = { id: string; seq: number; type: string; created_at?: string } & Record<string, unknown>;

export class MaRuntimeError extends Error {
  readonly status: number;          // HTTP status；网络错误为 0
  readonly code: string | null;     // error.code（若响应体可解析）
  constructor(message: string, status: number, code: string | null) { super(message); this.name = "MaRuntimeError"; this.status = status; this.code = code; }
}

/** 读取 §3 的环境变量；未启用或配置不完整返回 null（配置不完整时每进程只告警一次）。 */
export function resolveMaRuntimeConfig(env: NodeJS.ProcessEnv = process.env): MaRuntimeConfig | null;

export async function createMaSession(
  config: MaRuntimeConfig,
  input: { agentId: string; onBehalfOf: string; title: string },
  fetchImpl: typeof fetch,
): Promise<{ id: string; agentVersion: number }>;

export async function postMaEvents(
  config: MaRuntimeConfig,
  sessionId: string,
  events: Array<Record<string, unknown>>,
  fetchImpl: typeof fetch,
): Promise<MaWireEvent[]>;

/** 逐条产出 SSE 数据帧解析出的 wire 事件；ping 与无 data 的帧不产出。signal 触发时抛 AbortError。 */
export function streamMaEvents(
  config: MaRuntimeConfig,
  sessionId: string,
  opts: { afterSeq: number; signal: AbortSignal },
  fetchImpl: typeof fetch,
): AsyncGenerator<MaWireEvent>;

/** 纯函数，导出供测试：把字节流解析成 {id, event, data} 帧。 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ id: string | null; event: string; data: string }>;
```

实现要点：
- `resolveMaRuntimeConfig`：`env.MA_RUNTIME_ENABLED?.trim() !== "1"` → `null`（不告警）。token：`MA_RUNTIME_SERVICE_TOKEN_FILE` 非空则 `readFileSync(path, "utf8").trim()`（读失败视为空）；否则 `MA_RUNTIME_SERVICE_TOKEN?.trim()`；不以 `agx-pat-` 开头 → 告警一次后 `null`。告警用模块级 `let warned = false`，并导出 `__resetMaRuntimeConfigWarningForTests()`。
- 每个请求用 `fetchImpl(url, { method, headers, body, signal })`；非 2xx：尝试 `await res.json()` 取 `error.code` 与 `error.message`，抛 `MaRuntimeError(message || \`agent runtime status ${status}\`, status, code)`；`fetchImpl` 自身抛错 → `MaRuntimeError(String(err), 0, null)`。**错误消息里不得拼接 token。**
- `createMaSession` 校验响应 `id` 为 26 位字符串、`agent_version` 为正整数，否则 `MaRuntimeError("invalid session response", res.status, null)`。
- `postMaEvents` 返回 `body.events`（数组，否则抛 `MaRuntimeError("invalid events response", ...)`）。
- `streamMaEvents`：`res.body` 为空 → 抛 `MaRuntimeError("empty stream", res.status, null)`；对 `parseSseStream` 的每帧 `JSON.parse(frame.data)`，解析失败跳过；结果须有数字 `seq` 与字符串 `type` 才产出（预览帧没有 `seq`，被跳过）。
- `parseSseStream`：`TextDecoder` 流式解码；缓冲按 `\n` 切行，行尾 `\r` 去掉；空行分发帧（有 data 行才分发）；`:` 开头行忽略；`id:` / `event:` / `data:` 取冒号后内容并去掉**一个**前导空格；多行 data 用 `\n` 连接；`event` 缺省 `"message"`；`id` 只对当前帧有效。

### 5.2 新建 `src/lib/collab-room/ma-agent-reply.ts`

```ts
import type { AuthContext } from "@agenticx/auth";
import type { EnterpriseAgent } from "@agenticx/iam-core";
import { knowledgeSearchUrl } from "./agent-knowledge";
import {
  createMaSession, postMaEvents, streamMaEvents, MaRuntimeError,
  type MaRuntimeConfig, type MaWireEvent,
} from "./ma-runtime-client";
import type { CollabRoomContext, CollabRoomMessage, CollabRoomStore, CollabSenderType } from "./types";

export const MA_CONTEXT_MESSAGE_LIMIT = 30;
export const MA_CONTENT_LIMIT = 4000;
export const MA_STREAM_RECONNECTS = 2;

export const maNotices = {
  modelDenied: (name: string) => `智能体「${name}」使用的模型对你不可用，请联系管理员`,
  unavailable: (name: string) => `智能体「${name}」暂时不可用，请稍后再试`,
  timeout: (name: string) => `智能体「${name}」处理超时，请稍后再试`,
  needsConfirmation: (name: string) => `智能体「${name}」需要人工确认才能继续，协作房间暂不支持确认，本次回复已中止`,
  policyBlocked: (name: string) => `智能体「${name}」的请求触发合规拦截`,
  budgetExceeded: (name: string) => `智能体「${name}」本次用量已达上限，请联系管理员`,
} as const;

export type ManagedToolStep = { tool: string; server: string; ok: boolean; durationMs: number };

export type ManagedReplyDeps = {
  config: MaRuntimeConfig;
  fetchImpl: typeof fetch;
  appendMessage: CollabRoomStore["appendMessage"];
  listAvailableModels: (session: AuthContext) => Promise<string[]>;
};

export type ManagedReplyOutcome = { kind: "handled" } | { kind: "fallback"; reason: string };

/** 托管路径只接管：cloud 运行方式、无 mcp: 能力、无知识库检索地址的 Agent。 */
export function isManagedEligible(agent: Pick<EnterpriseAgent, "runtime" | "capabilityIds" | "metadata">): boolean;

/** 纯函数：§5.2.1 的 user.message 文本。 */
export function buildRoomContextText(agent: Pick<EnterpriseAgent, "id" | "displayName">, history: CollabRoomMessage[], trigger: CollabRoomMessage): string;

/** 纯函数：从本次回复的事件序列提取结果（§5.2.2）。 */
export function summarizeManagedEvents(events: MaWireEvent[]): {
  finalText: string; steps: ManagedToolStep[]; stopType: string | null; requiresAction: boolean;
};

export async function runManagedAgentReply(params: {
  ctx: CollabRoomContext;
  roomId: string;
  session: AuthContext;
  agent: EnterpriseAgent;
  trigger: CollabRoomMessage;
  history: CollabRoomMessage[];
  deps: ManagedReplyDeps;
}): Promise<ManagedReplyOutcome>;
```

`isManagedEligible`：`agent.runtime === "cloud" && !agent.capabilityIds.some((id) => id.trim().startsWith("mcp:")) && !knowledgeSearchUrl(agent)`。

#### 5.2.1 `buildRoomContextText`（逐字格式）

```text
[协作房间]
你是协作房间里的智能体「{displayName}」，房间里有多个成员，回复简洁并指明回应对象。
[最近消息]
{line_1}
...
{line_n}
[需要你回复的消息]
{triggerName}：{clip(trigger.content)}
```

- 历史：`history` 先去掉 `id === trigger.id` 的那条，按 `seq` 升序，取最后 `MA_CONTEXT_MESSAGE_LIMIT`（30）条。
- 每条：`sender_type === "agent" && sender_id === agent.id` → `你（{displayName}）：{clip(content)}`；否则 `{name}：{clip(content)}`，`name = sender_name?.trim() || sender_id`。
- 历史为空时 `[最近消息]` 下一行写 `（无）`。
- `clip`：超过 4000 字符截断并加 `…`（与 `agent-reply.ts` 的 `clipContent` 同规则，本文件内私有实现一份）。
- `triggerName` 同 `name` 规则。各段以 `\n` 连接，末尾无换行。

#### 5.2.2 `summarizeManagedEvents`

输入为本次回复收到的事件（seq 升序，均 > userSeq）。

- `finalText`：最后一条 `type === "agent.message"` 的 `content` 中 `type === "text"` 块的 `text` 用 `"\n"` 连接后 `trim()`；无则 `""`。
- `steps`：遍历；`agent.tool_use` / `agent.mcp_tool_use` 记录 `{id, tool: name, server: type === "agent.mcp_tool_use" ? String(mcp_server) : "builtin", startedAt: Date.parse(created_at)}`；遇到 `agent.tool_result`（按 `tool_use_id`）或 `agent.mcp_tool_result`（按 `mcp_tool_use_id`）找到对应记录，产出 `{tool, server, ok: is_error !== true, durationMs: max(0, Date.parse(result.created_at) - startedAt)}`（任一时间不可解析则 `durationMs: 0`）。没有结果的 tool use 不产出。键集合恰为 `durationMs/ok/server/tool`（与现有 `tool_steps` 一致），**不包含任何工具输入或输出文本**。
- `requiresAction`：存在任一 `session.status_idle` 且 `stop_reason.type === "requires_action"`。
- `stopType`：最后一条 `session.status_idle` 的 `stop_reason.type`；无则 `null`。

#### 5.2.3 `runManagedAgentReply` 算法

```text
name = agent.displayName
# 1) model visibility (gateway no longer checks it for us)
try: visible = await deps.listAvailableModels(session)
catch: return { kind: "fallback", reason: "model_check_failed" }
if (!visible.includes(agent.model)): append notice maNotices.modelDenied(name); return handled

# 2) create session + post the message; any failure here falls back
try: created = await createMaSession(config, { agentId: agent.id, onBehalfOf: session.userId, title: `协作房间 ${roomId}` }, fetchImpl)
catch (e): return { kind: "fallback", reason: `create_failed:${statusOf(e)}` }
try: stored = await postMaEvents(config, created.id, [userMessage(buildRoomContextText(agent, history, trigger))], fetchImpl)
catch (e): return { kind: "fallback", reason: `post_failed:${statusOf(e)}` }
userSeq = stored[0]?.seq ?? 0

# 3) consume events until a terminal idle; from here on never fall back
controller = new AbortController(); timer = setTimeout(() => controller.abort(), config.replyTimeoutMs)
collected = []; cursor = userSeq; interrupted = false; reconnects = 0; done = false
try:
  while (!done):
    try:
      for await (ev of streamMaEvents(config, created.id, { afterSeq: cursor, signal: controller.signal }, fetchImpl)):
        if (ev.seq <= cursor) continue
        cursor = ev.seq; collected.push(ev)
        if (ev.type !== "session.status_idle") continue
        stop = ev.stop_reason?.type
        if (stop === "requires_action"):
          if (!interrupted): interrupted = true; await postMaEvents(config, created.id, [{ type: "user.interrupt" }], fetchImpl).catch(log)
          continue
        done = true; break
      if (!done) throw new MaRuntimeError("stream ended early", 0, null)
    catch (e):
      if (controller.signal.aborted) throw e            # timeout -> handled below
      if (++reconnects > MA_STREAM_RECONNECTS): append notice unavailable(name); return handled
finally: clearTimeout(timer)
on timeout (AbortError / aborted signal):
  await postMaEvents(..., [{ type: "user.interrupt" }]).catch(log)
  append notice maNotices.timeout(name); return handled

# 4) post the outcome
s = summarizeManagedEvents(collected)
if (s.requiresAction): append notice needsConfirmation(name); return handled
if (s.finalText):
  append agent message (below); return handled
notice = s.stopType === "policy_blocked" ? policyBlocked : s.stopType === "budget_exceeded" ? budgetExceeded : unavailable
append notice notice(name); return handled
```

写回房间（**与现有 cloud 路径同一形状**，只是 metadata 多两键）：

```ts
await deps.appendMessage(ctx, roomId, {
  senderType: "agent",
  senderId: agent.id,
  senderName: agent.displayName,
  content: s.finalText,
  model: agent.model,
  metadata: {
    agent_slug: agent.slug,
    runtime: "cloud",
    reply_to: trigger.id,
    ma_session_id: created.id,
    agent_version: created.agentVersion,
    ...(s.steps.length > 0 ? { tool_steps: s.steps } : {}),
  },
});
```

系统通知统一用 `appendMessage(ctx, roomId, { senderType: "system" as CollabSenderType, senderId: "system", senderName: "系统", content })`（与 `agent-reply.ts` 的 `appendSystemNotice` 同形状，本文件内私有实现一份）。

日志：`log` 从 `../observability/logger` 导入；回退、中断失败、重连失败分别记 `room.agent_reply.ma_fallback` / `room.agent_reply.ma_interrupt_failed` / `room.agent_reply.ma_stream_failed`，字段只含 `room_id`、`agent_id`、`ma_session_id`、`reason` / `status`，**不含**消息内容与 token。

### 5.3 修改 `src/lib/collab-room/agent-reply.ts`（4 处，其他行不动）

1. **import 区**（第 1–9 行之后追加 3 行）：

```ts
import { log } from "../observability/logger";
import { isManagedEligible, runManagedAgentReply } from "./ma-agent-reply";
import { resolveMaRuntimeConfig, type MaRuntimeConfig } from "./ma-runtime-client";
```

2. **`AgentReplyDeps`**（第 30 行 `hasOnlineWorker?` 之后追加两个可选字段）：

```ts
  /** null 表示托管运行时关闭；undefined 时由 resolveAgentReplyDeps 从环境变量解析。 */
  maRuntime?: MaRuntimeConfig | null;
  listAvailableModels?: (session: AuthContext) => Promise<string[]>;
```

3. **`resolveAgentReplyDeps` 返回对象**（第 166 行 `hasOnlineWorker: overrides?.hasOnlineWorker,` 之后追加）：

```ts
    maRuntime: overrides?.maRuntime !== undefined ? overrides.maRuntime : resolveMaRuntimeConfig(),
    listAvailableModels: overrides?.listAvailableModels ?? defaultListAvailableModels,
```

并在 `defaultLoadMcpServers`（第 174–180 行）之后新增：

```ts
async function defaultListAvailableModels(session: AuthContext): Promise<string[]> {
  // 延迟加载：该模块会读运行时配置表；测试注入 listAvailableModels 时不触达数据库（同 defaultLoadMcpServers）。
  const { listAvailableModelsForUser } = await import("../admin-providers-reader");
  const options = await listAvailableModelsForUser(session.userId, session.email, session.deptId ?? null);
  return options.map((option) => option.id);
}
```

4. **`triggerCloudAgentReply`**：在第 190 行 `const history = await deps.listMessages(ctx, roomId, { limit: 30 });` 之后、第 191 行 `const accessToken = ...` 之前插入：

```ts
  if (deps.maRuntime && isManagedEligible(agent)) {
    const outcome = await runManagedAgentReply({
      ctx,
      roomId,
      session,
      agent,
      trigger: triggerMessage,
      history,
      deps: {
        config: deps.maRuntime,
        fetchImpl: deps.fetchImpl ?? fetch,
        appendMessage: deps.appendMessage,
        listAvailableModels: deps.listAvailableModels ?? defaultListAvailableModels,
      },
    });
    if (outcome.kind === "handled") return;
    log("warn", { event: "room.agent_reply.ma_fallback", room_id: roomId, agent_id: agent.id, reason: outcome.reason });
  }
```

Before：所有 cloud Agent 一律走网关（单轮或 `runCloudAgentLoop`）。After：仅当 `maRuntime` 非 null 且 Agent 符合条件时先尝试托管；`handled` 直接返回；`fallback` 继续执行原有代码（后续行完全不变）。`dispatchAgentMention` 的 `switch` 不改（`desktop_worker` 仍走旧队列）。

### 5.4 测试辅助（写在测试文件内）

`ma-agent-reply.test.ts` 与 `agent-reply.test.ts` 共用的写法（各自文件内定义，不新建共享模块）：

```ts
function sseBody(events: Array<Record<string, unknown>>, opts?: { hang?: boolean }): ReadableStream<Uint8Array> {
  // 每条事件编码为 `id: <seq>\nevent: <type>\ndata: <json>\n\n`，开头插一条 `: ping\n\n`；hang=true 时不关闭流，
  // 但在 signal abort 时以 AbortError 结束（通过 new ReadableStream({ pull, cancel }) 实现）。
}

function runtimeFetch(routes: {
  create?: () => Response;
  post?: (body: { events: Array<{ type: string }> }) => Response;
  stream?: (url: URL, init?: RequestInit) => Response;
}): typeof fetch & { calls: Array<{ url: string; init?: RequestInit }> };
// 按 URL 分派：POST /ma/v1/sessions -> create；POST /ma/v1/sessions/:id/events -> post；
// GET /ma/v1/sessions/:id/events/stream -> stream；其他 URL（网关）-> 404，并都记录到 calls。
```

标准成功事件序列（`SID = "01SESSION0AAAAAAAAAAAAAAAA"`，`userSeq = 1`，时间以 `2026-10-25T00:00:00.000Z` 为基准）：

| seq | type | 关键字段 |
|---|---|---|
| 2 | `session.status_running` | — |
| 3 | `span.model_request_start` | `model: "demo/reply-model"` |
| 4 | `agent.tool_use` | `id: "01TOOLUSE0AAAAAAAAAAAAAAAA"`、`name: "bash_exec"`、`input: {command: "echo secret-output"}`、`evaluated_policy: "always_allow"`、`created_at: ...00.000Z` |
| 5 | `agent.tool_result` | `tool_use_id: "01TOOLUSE0AAAAAAAAAAAAAAAA"`、`content: [{type:"text", text:"secret-output"}]`、`is_error: false`、`created_at: ...01.500Z` |
| 6 | `span.model_request_end` | `model_usage: {...}` |
| 7 | `agent.message` | `content: [{type:"text", text:"托管回复"}]` |
| 8 | `session.usage` | `usage: {...}` |
| 9 | `session.status_idle` | `stop_reason: {type: "end_turn", event_ids: []}` |

---

## 6. FR / NFR / AC

所有用例：vitest，`fetch` 全部 mock，不访问网络与数据库。

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 配置解析 | `ma-runtime-client.test.ts::resolveMaRuntimeConfig`：`{}` → `null`；`{MA_RUNTIME_ENABLED:"1", MA_RUNTIME_SERVICE_TOKEN:"agx-pat-x"}` → `{baseUrl:"http://127.0.0.1:8092", serviceToken:"agx-pat-x", replyTimeoutMs:180000}`；`MA_RUNTIME_URL:"http://rt:8092/"` → baseUrl 无尾斜杠；`_FILE` 指向临时文件（内容 `agx-pat-f\n`）优先于 `MA_RUNTIME_SERVICE_TOKEN`；token `"abc"` → `null` 且 `log` 被调用一次（第二次调用不再告警）；`MA_RUNTIME_REPLY_TIMEOUT_MS:"10"` → `5000`、`"99999999"` → `1800000`、`"x"` → `180000` | gitleaks:allow
| FR-2 | SSE 解析 | `ma-runtime-client.test.ts::parseSseStream`：三段 chunk `": ping\n\n"`、`"id: 3\nevent: agent.message\ndata: {\"a\""`、`":1}\n\n"` → 恰产出 1 帧，`id === "3"`、`event === "agent.message"`、`JSON.parse(data)` 等于 `{a:1}`；同样内容改用 `\r\n` 换行结果相同；`"data: x\ndata: y\n\n"` → `data === "x\ny"`；无 `event:` 行时 `event === "message"`；只有注释行的帧不产出 |
| FR-3 | 客户端请求形状 | `ma-runtime-client.test.ts::createMaSession sends service token and on-behalf-of`：`fetchImpl` 收到 URL `http://rt/ma/v1/sessions`、方法 POST、头 `authorization: Bearer agx-pat-x`、`X-AgenticX-On-Behalf-Of: <userId>`、body `{agent_id, source:"portal", title}`；201 响应 → 返回 `{id, agentVersion}`。`maps error body to MaRuntimeError`：404 `{"error":{"code":"agent_version_not_found","message":"agent version not found"}}` → `status === 404`、`code === "agent_version_not_found"`；`String(err)` 不含 `agx-pat-x`。`streamMaEvents builds after_seq query and skips frames without seq`：URL 含 `?after_seq=5`；一个无 `seq` 的 `event_delta` 帧不被产出 |
| FR-4 | 资格判定 | `ma-agent-reply.test.ts::isManagedEligible`：cloud + 无能力 → true；`capabilityIds:["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"]` → false；`metadata:{knowledgeSearchUrl:"https://kb.example.com/search"}` → false；`runtime:"desktop_worker"` → false |
| FR-5 | 房间上下文文本 | `ma-agent-reply.test.ts::buildRoomContextText`：历史 `[agent 自己 seq1 "上一句", trigger seq2]` → 文本恰为 `"[协作房间]\n你是协作房间里的智能体「验收助手」，房间里有多个成员，回复简洁并指明回应对象。\n[最近消息]\n你（验收助手）：上一句\n[需要你回复的消息]\nAlice：@report-bot 介绍你自己"`；只有 trigger 时 `[最近消息]` 下为 `（无）`；35 条历史只保留最后 30 条；4001 字符内容被截为 4000 + `…` |
| FR-6 | 成功路径写回房间 | `ma-agent-reply.test.ts::posts the final agent message with managed metadata`：标准事件序列 → 返回 `{kind:"handled"}`；`appendMessage` 恰调用 1 次，参数 `objectContaining({senderType:"agent", senderId: agent.id, senderName: agent.displayName, content:"托管回复", model: agent.model, metadata:{agent_slug:"report-bot", runtime:"cloud", reply_to: trigger.id, ma_session_id: SID, agent_version: 2, tool_steps:[{tool:"bash_exec", server:"builtin", ok:true, durationMs:1500}]}})`；`JSON.stringify(metadata)` 不含 `secret-output`；发给运行时的 `user.message` 文本包含 `[需要你回复的消息]` |
| FR-7 | 模型可见性前置校验 | `ma-agent-reply.test.ts::denies models the user cannot see without calling the runtime`：`listAvailableModels` 返回 `["other/model"]` → 写入系统通知 `智能体「验收助手」使用的模型对你不可用，请联系管理员`；`fetchImpl` 未被调用；返回 handled。`falls back when the model check throws` → `{kind:"fallback", reason:"model_check_failed"}` |
| FR-8 | 建会话 / 发消息失败回退 | `ma-agent-reply.test.ts::falls back when the session cannot be created`：create 返回 404 → `{kind:"fallback", reason:"create_failed:404"}`，`appendMessage` 未调用；fetch 抛 TypeError → `reason:"create_failed:0"`；`falls back when posting the message fails`：post 返回 409 → `reason:"post_failed:409"` |
| FR-9 | requires_action 收尾 | `ma-agent-reply.test.ts::interrupts sessions that require action`：流先给 `agent.tool_use`（seq4）+ `session.status_idle{requires_action, event_ids:[...]}`（seq5），在收到 interrupt 的 post 之后再给 `agent.tool_result{is_error:true}`（seq6）+ `session.status_idle{end_turn}`（seq7）（用同一个 ReadableStream 在 `post` 回调里推入后续帧）→ 运行时收到一次 body `{events:[{type:"user.interrupt"}]}`；房间只写入 1 条系统通知 `…需要人工确认才能继续，协作房间暂不支持确认，本次回复已中止`，无 agent 消息 |
| FR-10 | 超时 | `ma-agent-reply.test.ts::times out, interrupts and notices`：`replyTimeoutMs: 50`，流 `hang:true` → 返回 handled；收到一次 `user.interrupt`；系统通知 `智能体「验收助手」处理超时，请稍后再试`；用 `vi.useFakeTimers` 或真实 50ms 均可，用例总时长 < 2 秒 |
| FR-11 | 断线重连 | `ma-agent-reply.test.ts::reconnects from the last seen seq`：第一次 stream 只给 seq2–4 然后正常关闭（未见 idle）；第二次 stream 的请求 URL 含 `after_seq=4`，给 seq5–9 → 最终写回 `托管回复`。`gives up after two reconnects`：三次都在 idle 前关闭 → 通知 `暂时不可用`，返回 handled |
| FR-12 | 无文本收尾的通知 | `ma-agent-reply.test.ts::maps stop reasons without text to notices`：参数化 `policy_blocked` → `…的请求触发合规拦截`；`budget_exceeded` → `…本次用量已达上限，请联系管理员`；`retries_exhausted` → `…暂时不可用，请稍后再试`。`max_tool_rounds` 且有 agent.message → 写回 agent 消息而非通知 |
| FR-13 | 开关关闭行为不变 | `agent-reply.test.ts`：文件顶部 describe 内追加 `beforeEach(() => { vi.stubEnv("MA_RUNTIME_ENABLED", "0"); })` 与 `afterEach(() => { vi.unstubAllEnvs(); })`；**现有 5 个用例不改一字且全部通过** |
| FR-14 | 开关开启时接管 | `agent-reply.test.ts::routes eligible cloud agents to the managed runtime`：overrides 传 `maRuntime: {baseUrl:"http://rt", serviceToken:"agx-pat-svc", replyTimeoutMs: 5000}`、`listAvailableModels: async () => ["demo/reply-model"]`、`fetchImpl: runtimeFetch(...)`（标准序列）→ `fetchImpl.calls` 中没有任何 `gateway.test` URL；`append` 收到 agent 消息，`metadata.ma_session_id === SID` | gitleaks:allow
| FR-15 | 回退走原路径 | `agent-reply.test.ts::falls back to the gateway loop when the runtime rejects the agent`：create 返回 404，网关 URL 返回 `{choices:[{message:{content:"我是验收助手"}}]}` → `append` 收到 `content:"我是验收助手"` 且 `metadata` 恰为 `{agent_slug:"report-bot", runtime:"cloud", reply_to: trigger.id}`（与现有第 1 个用例一致） |
| FR-16 | 不合格 Agent 不走托管 | `agent-reply.test.ts::keeps MCP-bound agents on the gateway loop`：`capabilityIds:["mcp:01ARZ3NDEKTSV4RRFFQ69G5FAV"]` + `maRuntime` 已配置 → `fetchImpl.calls` 中没有任何 `http://rt` URL。`desktop worker agents still enqueue legacy tasks`：`runtime:"desktop_worker"` + `maRuntime` 已配置 → `enqueueAgentTask` 调用 1 次，`http://rt` 未被调用 |
| NFR-1 | 类型与穷尽检查 | `pnpm -C enterprise --filter @agenticx/app-web-portal typecheck` 无错；新增代码中若对 `stop_reason.type` 用 `switch`，`default` 分支写 `const _exhaustive: never = ...`（或改用 if 链，不用 switch） |
| NFR-2 | 不泄露 | FR-3 `String(err)` 断言；FR-6 metadata 不含工具输出；日志字段只含 id 与原因 |
| NFR-3 | 范围 | `git diff --name-only -- enterprise/apps/web-portal` 只出现 §2.1 列出的 6 个文件 |
---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX/enterprise
pnpm --filter @agenticx/app-web-portal test -- src/lib/collab-room
pnpm --filter @agenticx/app-web-portal typecheck
git status --porcelain -- apps/web-portal
```

**本地联调（需 MA-E01/E02/E03/A04 已合入）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
# 1) .env.local 里设 MA_RUNTIME_ENABLED='1'（bootstrap 已写入 MA_RUNTIME_URL 与 *_TOKEN_FILE）
bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 2) admin-console /admin/agents：建一个 cloud Agent（无 MCP、无知识库），发布；确认当前用户能看到其模型
# 3) web-portal 协作房间里把它拉进房间并 @ 它
# 期望：房间出现智能体回复；消息 metadata.ma_session_id 存在；
#       curl --noproxy '*' -s "http://127.0.0.1:8092/ma/v1/sessions/<ma_session_id>" -H "Authorization: Bearer $(cat .local-secrets/ma_portal_service.pat)"
#       返回 status=idle、stop_reason.type=end_turn、created_by_user_id=当前用户
# 4) 把 MA_RUNTIME_ENABLED 改回 '0' 并重启门户：同一操作走原网关路径，回复 metadata 无 ma_session_id
```

---

## 8. 回滚

- 开关：`MA_RUNTIME_ENABLED` 缺省 / `0` → `resolveMaRuntimeConfig()` 返回 `null` → `triggerCloudAgentReply` 在插入的 `if` 处直接跳过，后续代码与改动前完全一致。
- 运行中故障：建会话或发消息失败自动回退旧路径；回复阶段故障只发系统通知。
- 代码回滚：删除两个新文件与两个新测试文件，`git checkout` `agent-reply.ts` 与 `agent-reply.test.ts`。

---

## 9. 不变量

1. 开关关闭时：网关请求的 URL、请求头、请求体、写回房间的消息字段与 metadata，与改动前逐字一致（现有 5 个用例不改即通过）。
2. `desktop_worker` Agent 的旧任务队列路径不变。
3. 有 `mcp:` 能力或知识库地址的 Agent 永远走 TS loop（直到 MA-A06 之后另行切换）。
4. 写回房间的智能体消息形状（`senderType/senderId/senderName/content/model/metadata.agent_slug/runtime/reply_to/tool_steps`）不变，只追加 `ma_session_id`、`agent_version` 两个 metadata 键。
5. `tool_steps` 永不包含工具输入 / 输出文本。
6. 门户永不把服务 PAT 写进日志、错误消息或房间消息。

## 10. 风险与待确认

1. **配额归属**：托管路径的模型调用在网关按服务账号计量（E03 D4）。用户 / 部门级网关配额对它不生效，直到 MA-E10。上线前需与运营确认可接受。
2. **模型可见性校验用的是 `agent.model`（最新版本投影）**：若管理员把路由固定到旧版本且旧版本模型不同，校验对象与实际执行模型可能不一致。影响面小，记录为已知限制。
3. **请求时长**：`POST /api/rooms/:id/messages` 仍同步等待回复（与现状一致），托管会话含工具时可能更久；上限由 `MA_RUNTIME_REPLY_TIMEOUT_MS`（默认 3 分钟）兜底，nginx `location /` 默认 `proxy_read_timeout` 60 秒可能先断——但回复在服务端继续写回房间，前端轮询可见。是否要把房间回复改成后台任务，留给后续。
4. **每次 @ 新建会话**：托管会话不跨 @ 复用，上下文完全来自房间最近 30 条消息（与现状语义一致）；会话数量随 @ 次数增长，归档策略属后续。
