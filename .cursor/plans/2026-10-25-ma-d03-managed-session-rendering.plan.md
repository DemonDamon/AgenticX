# MA-D03 托管会话渲染适配：事件适配器、主进程 SSE 续流、审批收件箱接入

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W3 · MA-D03）
Depends-on:
- MA-00 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md`（已实现：事件类型与字段见 `agenticx/managed/protocol.py:98-322`）
- MA-A04 `.cursor/plans/2026-10-25-ma-a04-managed-host.plan.md`（实施中：SSE 帧格式、`event_deltas[]`、`Last-Event-ID`）
- MA-D01 `.cursor/plans/pending/2026-10-25-ma-d01-near-worker-v2.plan.md`（未实施：agent-runtime 接受设备 PAT，仅联调需要；单测不依赖）
- **被依赖**：MA-D02 使用本文产出的 IPC、hook 与 `ManagedTranscript`（与 master §9「D03 依赖 D02」相反，理由见 §2 D1；实施顺序 D01 → D03 → D02）

> 风险等级：中。本文只改 Desktop（渲染进程 + Electron 主进程），不改 Python、不改企业侧。
>
> **上游未实现声明**：A04 的 SSE 细节（`format_sse`、预览帧 `event_start` / `event_delta`、`event_deltas[]` 参数名、ping 帧）以 A04 plan §5.1 / §5.7 书写，**以实际实现为准，实施前核对** `agenticx/managed/sse.py` 与 `agenticx/managed/host/routes.py`。

---

## 0. 一句话目标

在 Near 里把一个托管会话（agent-runtime 上的 MA Session）渲染成与本机对话一致的体验：MA 事件经纯函数适配器映射为现有 `Message`（用户 / 助手气泡、`ToolCallCard`、`ReasoningBlock`）；SSE 在 **Electron 主进程**用 `proxyAwareFetch` 消费并带 `Last-Event-ID` 自动续流，设备 PAT 永不进入渲染进程；`requires_action` 同时出现在会话内的内联确认卡与顶栏「待审批收件箱」，处理结果以 `user.tool_confirmation` 事件回传。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 本文落点 |
|---|---|---|
| §1.3 可回放事件流 | 以持久化 `seq` + `Last-Event-ID` 直接续流 | §5.2 主进程流 |
| §1.3 人在回路的桌面体验 | 托管会话复用审批收件箱、子智能体透明等体验 | §5.6 ApprovalInbox |
| §6.1 | 事件类型表；`agent.thinking` 渲染为 ReasoningBlock | §4 映射表 |
| §6.1 | `requires_action` 期间 `user.message` 被拒（409 `session_requires_action`） | §5.5 hook 提示 |
| §6.3 | `GET /events`（`after_seq`、`limit≤500`）；`GET /events/stream`（`Last-Event-ID` / `after_seq`，15 秒 `: ping`，`event_deltas[]=agent.message`） | §5.2、§5.5 |
| §4 决策 9 | 个人模式不变 | 本文不碰 `ChatPane.tsx` / `ChatView.tsx` |
| §1.4 | 托管模式不提供会话级 sticky allow | 内联确认卡不显示「本会话不再询问」 |

### 1.2 现状代码证据（实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `desktop/src/store.ts` | 84 | `MsgRole = "user" \| "assistant" \| "tool"` | 适配器输出这三种 |
| 同上 | 290 | `ToolCallStatus = "pending" \| "running" \| "done" \| "error" \| "cancelled"` | 工具状态映射 |
| 同上 | 316–397 | `Message` 字段：`id, role, content, timestamp, ownerSessionId, agentId, avatarName, toolCallId, toolName, toolArgs, toolStatus, toolResultPreview, toolStreamLines, toolGroupId, reasoning, inlineConfirm, systemNotice, noticeKind, roundsRound, roundsMax, budgetSource, metadata` | 适配器只用已有字段，不扩展 `Message` 类型 |
| 同上 | 480–486 | `PendingConfirm = {requestId, question, agentId, sessionId, context?}` | 内联确认卡数据 |
| `desktop/src/components/ChatPane.tsx` | 11924–12065 | 本机 SSE `tool_call`：工具行 `content = JSON.stringify(args)`（>80 000 截断加 `\n… (truncated)`），`toolName`、`toolArgs`、`toolStatus:"running"`、`toolGroupId`（连续工具共享） | 适配器沿用同一形状，`ToolCallCard` 无需改 |
| 同上 | 12204–12218 | 本机 `tool_result`：patch `{content: <原始结果文本>, toolStatus, toolResultPreview: <空白折叠后前 160 字符>, toolStreamLines: []}`；`is_error === true` → `"error"` | 同上 |
| 同上 | 7790–7840 | 本机会话「重连」在渲染进程 `fetch` 本机 Studio SSE，`parseSseFrame` 解析 | 托管会话不走这条（远端主机 + 设备 PAT），见 D2 |
| `desktop/src/utils/session-reattach.ts` | 17–36 | `parseSseFrame(frame)` 只取单行 `data:` | A04 的 data 是单行 JSON；主进程另写完整解析器（支持多行 data、注释 ping） |
| `desktop/src/components/messages/MessageRenderer.tsx` | 85–165 | `MessageRenderer({message, onResolveInlineConfirm, assistantName, assistantAvatarUrl, sessionId, sessionBusy, ...})` | `ManagedTranscript` 直接复用 |
| `desktop/src/utils/confirm-remember.ts` | 3–9 | `shouldOfferSessionRemember(context)`：context 无 `tool` 键 → false | 托管确认卡 context 不放 `tool` 键 → 不出现「本会话不再询问」 |
| `desktop/src/components/messages/ReasoningBlock.tsx` | 56 | `ReasoningBlock({text, streaming, seconds})`；Message.`reasoning` 由气泡渲染 | `agent.thinking` → 下一条助手消息的 `reasoning` |
| `desktop/src/components/sidebar/SessionGeneratingDots.tsx` | 5–28 | 动态粒子点阵（生成中） | 运行中且无预览文本时显示，避免静态 ⏳ |
| `desktop/src/components/ApprovalInbox.tsx` | 9–21、102–135、176–215、217–278 | 只轮询本机 `GET /api/approvals/pending`，决策 `POST /api/confirm` | 追加「托管会话」来源，决策改走 MA 事件 |
| `desktop/electron/proxy-fetch.ts` | 1–40 | `proxyAwareFetch`：主进程读 `HTTPS_PROXY` 等，undici `ProxyAgent` | AGENTS.md：主进程访问远端必须用它 |
| `desktop/electron/main.ts` | 75、146、2320–2335 | 已导入 `proxyAwareFetch`、`hasEnterprisePat`；`loadAgxConfig()` 读 `cfg.enterprise.{token,base_url}` | 主进程能拿到设备 PAT 与门户地址 |
| `desktop/electron/main.ts` | 8984–9117 | 企业 IPC 命名风格：`load-enterprise-account`、`enterprise-login-start`，推送 `enterprise-account-changed` | 新 IPC 用 `ma-*` 前缀 |
| `desktop/electron/preload.ts` | 1167–1205 | `loadEnterpriseAccount`、`onEnterpriseAccountChanged(cb) => () => void` 的写法 | 照抄 |
| `desktop/src/global.d.ts` | 1112–1135 | 对应类型声明 | 照抄 |
| `agenticx/managed/protocol.py` | 157–322 | 客户端 / 服务端事件字段（见 §4） | 适配器类型 |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 本文产出**可独立测试的积木**（适配器、主进程客户端与 IPC、`useManagedSession` hook、`ManagedTranscript` 组件、收件箱接入），会话创建与窗格入口由 MA-D02 负责并调用本文积木 | 适配器只依赖 MA-00 契约，先落地可用 fixture 全量单测；D02 依赖本文比反过来少一次返工 |
| D2 | **SSE 与会话面 REST 在 Electron 主进程消费**，渲染进程经 IPC 收帧 | ① 设备 PAT 不进渲染进程（渲染进程可被 XSS / 扩展内容触达）；② 远端主机跨域：agent-runtime 无 CORS 白名单（E03 未配置），渲染进程 `fetch` 远端会被拦；③ AGENTS.md：主进程 `globalThis.fetch` 不走 `HTTPS_PROXY`，必须用 `proxyAwareFetch` |
| D3 | 不走本机 Python 代理 | 需要改 `server.py` 注册新路由（敏感文件），且 Python 侧 `trust_env=False` 的惯例会丢掉企业代理 |
| D4 | 托管会话的消息**不写入**窗格 `messages`（zustand 持久化）与本机 `messages.json`；每次挂载从服务端分页拉历史再接实时流 | 服务端是唯一事实来源；避免 localStorage 膨胀和与个人会话混淆（个人模式不变） |
| D5 | 适配器是纯函数 reducer，按 `seq` 去重（`seq <= lastSeq` 丢弃），预览帧不占 seq | master 决策 6；回放 + 实时重叠时不重不漏 |
| D6 | `requires_action` 两处可处理：会话内工具行的 `inlineConfirm` 与收件箱；任一处提交后两处同时消失（以服务端随后到达的 `session.status_running` / 新 `status_idle` 为准，提交时乐观移除） | 乐观 UI；收件箱是全局入口 |
| D7 | 自定义工具（`agent.custom_tool_use`）在 Near 中**不提供执行入口**：工具行显示「等待业务系统处理」，用户可中断 | Near 不是自定义工具的调用方；master 约定由调用方执行 |
| D8 | 断线重连退避 1 s → 2 s → 5 s → 10 s（封顶），收到任一帧后重置；45 秒无字节（服务端 15 秒 ping）视为假死主动重连；401 / 403 / 404 不重连 | 合盖 / 网络切换后自动续上 |

---

## 3. In scope / Out of scope

### 3.1 In scope

- 新建 `desktop/src/utils/ma-event-adapter.ts`
- 新建 `desktop/src/utils/ma-event-adapter.test.ts`
- 新建 `desktop/src/utils/ma-types.ts`（MA wire 类型，渲染与主进程共用的纯类型；主进程侧复制同名类型到 `ma-sse.ts`，不跨目录 import）
- 新建 `desktop/electron/ma-sse.ts`（SSE 增量解析器，纯函数）
- 新建 `desktop/electron/ma-session-client.ts`（端点解析、REST、流管理）
- 新建 `desktop/tests/ma-sse.test.ts`
- 新建 `desktop/tests/ma-session-client.test.ts`
- 修改 `desktop/electron/main.ts`：注册 5 个 IPC（§5.3），只追加
- 修改 `desktop/electron/preload.ts`：追加 7 个桥接方法
- 修改 `desktop/src/global.d.ts`：追加类型
- 新建 `desktop/src/hooks/useManagedSession.ts`
- 新建 `desktop/src/hooks/useManagedSession.test.tsx`
- 新建 `desktop/src/components/managed/ManagedTranscript.tsx`
- 新建 `desktop/src/components/managed/ManagedTranscript.test.tsx`
- 修改 `desktop/src/store.ts`：追加 `managedApprovals` 切片（不改既有字段）
- 修改 `desktop/src/components/ApprovalInbox.tsx`
- 修改 `desktop/src/components/ApprovalInbox.test.tsx`（追加用例）
- 修改 `desktop/locales/zh/sidebar.json`、`desktop/locales/en/sidebar.json`（`approvals` 节，现有于 zh 第 73 行，追加新键）；`desktop/locales/zh/chat.json`、`desktop/locales/en/chat.json`（新增 `managed` 节）

### 3.2 Out of scope

- `ChatPane.tsx`、`ChatView.tsx`、`PaneManager.tsx`（窗格分支由 MA-D02 做）、`usePaneNavigation.ts`。
- 会话创建、归档、企业 Agent 列表（MA-D02）。
- Python、agent-runtime、web-portal、admin-console。
- 多线程事件（`session.thread_*`，MA-A08）、后台任务事件（`session.task_*`，MA-A09）：适配器遇到未知类型静默忽略。
- 托管会话消息的本地搜索、收藏、转发、多选（后续）。

---

## 4. 映射表（适配器的完整规格）

输入为 MA wire 事件（服务端 `StoredEvent.to_wire()`：含 `id`、`seq`、`type`、`created_at`、`processed_at`、`thread_id` 与类型字段）。`thread_id` 非 null 的事件全部忽略（W3 只渲染主线程）。

| 事件 | 输出 / 状态变化 |
|---|---|
| `user.message` | 追加 `{id:"ma-"+id, role:"user", content: blocksToText(content), timestamp: ts(created_at), ownerSessionId: sessionId}` |
| `agent.thinking` | `pendingReasoning += (pendingReasoning ? "\n" : "") + textOf(content)`，不出行 |
| `agent.message` | 追加 `{id:"ma-"+id, role:"assistant", content: blocksToText(content), reasoning: pendingReasoning \|\| undefined, avatarName: opts.assistantName, agentId:"ma", timestamp, ownerSessionId}`；清空 `pendingReasoning` 与 `liveText` |
| `agent.tool_use` | 若 `pendingReasoning` 非空，先追加 `{id:"ma-"+id+"-r", role:"assistant", content:"", reasoning: pendingReasoning, ...}` 并清空；再追加工具行 `{id:"ma-"+id, role:"tool", content: argsJson(input), toolCallId: id, toolName: name, toolArgs: input, toolStatus:"running", toolGroupId, metadata:{maEvaluatedPolicy: evaluated_policy}, timestamp, ownerSessionId}`；记录 `toolIndex[id]` |
| `agent.mcp_tool_use` | 同上，`toolName = mcp_server + "/" + name`，`metadata.maMcpServer = mcp_server` |
| `agent.custom_tool_use` | 同上（`toolName = name`），`toolStatus:"pending"`，`metadata.maCustomTool = true` |
| `agent.tool_result` | 按 `tool_use_id` 找行；patch `{content: resultText, toolStatus: resultStatus, toolResultPreview: preview(resultText), toolStreamLines: []}`；找不到行则忽略 |
| `agent.mcp_tool_result` | 同上，按 `mcp_tool_use_id` |
| `user.custom_tool_result` | 按 `custom_tool_use_id` 找行，patch 同上（`resultText = blocksToText(content)`，`is_error` 生效） |
| `user.tool_confirmation` | 记 `resolved[tool_use_id] = true`；对应工具行去掉 `inlineConfirm`；`result === "deny"` 时 `toolStatus:"cancelled"` |
| `user.interrupt` | 记 `interrupted = true`（用于把运行中的工具行在下一个 `status_idle` 时标 `cancelled`） |
| `session.status_running` | `status = "running"`；`stopReason = null`；`interrupted = false` |
| `session.status_idle` | `status = stop_reason.type === "requires_action" ? "requires_action" : "idle"`；`stopReason = stop_reason`；`liveText = ""`；若 `pendingReasoning` 非空，按 `agent.tool_use` 的规则落一条只有推理的助手行；对 `requires_action`：对 `event_ids` 中每个未 `resolved` 的 id，若对应行是 `agent.tool_use` / `agent.mcp_tool_use`，给该行加 `inlineConfirm`（见下）并 `toolStatus:"pending"`；若 `interrupted` 为真，把所有 `running` / `pending` 工具行改为 `cancelled`；按停止原因追加提示行（见下） |
| `session.status_terminated` | `status = "terminated"`；追加系统提示「会话已结束」 |
| `session.error` | 追加 `{id:"ma-"+id, role:"assistant", content: "⚠️ " + error.message, systemNotice: true, metadata:{maErrorType: error.type, retry: error.retry_status.type}}`；`retry_status.type === "retrying"` 时文本前缀改为「正在重试：」 |
| `session.usage` | `usage = usage`（不出行） |
| `span.model_request_start` / `span.model_request_end` | 忽略（不出行） |
| 预览帧 `event_start`（`event.type === "agent.message"`） | `liveText = ""` |
| 预览帧 `event_delta`（`event_type === "agent.message"`） | `liveText += content_delta` |
| 其它类型 | 忽略 |

**停止原因提示行**（`session.status_idle` 时追加，`id = "ma-"+id+"-stop"`；`end_turn` 与 `requires_action` 不追加）：

| `stop_reason.type` | 行 |
|---|---|
| `max_tool_rounds` | `{role:"tool", content:"", noticeKind:"rounds_exhausted"}`（复用现有截断卡；`roundsRound` / `roundsMax` 不填） |
| `budget_exceeded` | `{role:"tool", content:"", noticeKind:"budget_exceeded", budgetSource:"managed"}` |
| `retries_exhausted` | 系统提示「本轮执行失败，已停止重试」 |
| `refusal` | 系统提示「模型拒绝了本次请求」 |
| `policy_blocked` | 系统提示「本轮内容触发企业合规策略，已停止」 |

（系统提示行形状同 `session.error` 行，`metadata.maStopReason = type`。`noticeKind` 两种卡片若渲染依赖缺失字段导致异常，实施时改为系统提示行并在测试中断言，二选一须在 PR 说明。）

**内联确认**：`inlineConfirm = {requestId: toolUseEventId, question: \`允许执行「${toolName}」？\`, agentId: "ma", sessionId, context: {maManaged: true, toolName}}`。context **不含** `tool` 键 → `shouldOfferSessionRemember` 返回 false → 不出现「本会话不再询问」。

**辅助函数**：
- `blocksToText(blocks)`：`text` 块取 `text`；`image` 块 → `[图片]`；`document` 块 → source 为 `text` 时 `[文档：${title ?? "未命名"}]\n${text}`，否则 `[文档：${title ?? "未命名"}]`；以 `"\n\n"` 连接。
- `argsJson(input)`：`JSON.stringify(input)`，长度 > 80 000 时截断并追加 `"\n… (truncated)"`（与 ChatPane 一致）。
- `resultText`：`blocksToText(content)`；长度 > 80 000 同样截断。
- `resultStatus`：`is_error === true` → `"error"`；文本以 `CANCELLED:` 开头 → `"cancelled"`；以 `ERROR:` 开头 → `"error"`；否则 `"done"`。
- `preview(text)`：`text.replace(/\s+/g, " ").trim().slice(0, 160)`。
- `toolGroupId`：若上一行是 `role:"tool"` 且有 `toolGroupId` 则沿用，否则 `"ma-group-"+id`（确定性，便于测试）。
- `ts(iso)`：`Date.parse(iso)`，NaN → `undefined`。

---

## 5. 精确落点

### 5.1 `desktop/src/utils/ma-types.ts`（新建）

```ts
/** Managed-agent wire event (server StoredEvent.to_wire or client event echoed back). */
export type MaContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: Record<string, unknown> }
  | { type: "document"; source: { type: "text"; text: string } | { type: "file"; file_id: string }; title?: string | null };

export type MaStopReason = {
  type: "end_turn" | "requires_action" | "retries_exhausted" | "refusal" | "max_tool_rounds" | "budget_exceeded" | "policy_blocked";
  event_ids?: string[];
};

export type MaWireEvent = {
  id: string;
  seq: number;
  type: string;
  created_at?: string;
  thread_id?: string | null;
  [key: string]: unknown;
};

export type MaPreviewFrame =
  | { type: "event_start"; event: { type: string; [key: string]: unknown } }
  | { type: "event_delta"; event_type: "agent.message" | "agent.thinking"; content_delta: string };

export type MaSessionStatus = "idle" | "running" | "requires_action" | "terminated";

export type MaUsage = {
  input_tokens: number; output_tokens: number; cache_read_input_tokens: number; tool_calls: number; runtime_ms: number;
};

export type MaClientEvent =
  | { type: "user.message"; content: MaContentBlock[] }
  | { type: "user.interrupt" }
  | { type: "user.tool_confirmation"; tool_use_id: string; result: "allow" | "deny"; deny_message?: string };

export type MaApiError = { ok: false; status: number; code: string; message: string };
```

### 5.2 `desktop/src/utils/ma-event-adapter.ts`（新建）

```ts
import type { Message } from "../store";
import type { MaPreviewFrame, MaSessionStatus, MaStopReason, MaUsage, MaWireEvent } from "./ma-types";

export type MaTranscript = {
  sessionId: string;
  lastSeq: number;
  status: MaSessionStatus;
  stopReason: MaStopReason | null;
  rows: Message[];
  toolIndex: Record<string, number>;
  resolved: Record<string, true>;
  pendingReasoning: string;
  liveText: string;
  interrupted: boolean;
  usage: MaUsage | null;
};

export type MaAdapterOptions = { assistantName: string };

export type MaPendingApproval = {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  inputPreview: string;          // argsJson(input) first 200 chars
  createdAt: number | undefined;
};

export function createMaTranscript(sessionId: string): MaTranscript;
/** Applies events in order; skips seq <= lastSeq and thread events. Returns a NEW object (immutable update). */
export function applyMaEvents(t: MaTranscript, events: readonly MaWireEvent[], opts: MaAdapterOptions): MaTranscript;
export function applyMaPreview(t: MaTranscript, frame: MaPreviewFrame): MaTranscript;
/** Optimistically marks a tool use as resolved (removes inlineConfirm, sets running / cancelled). */
export function markMaApprovalResolved(t: MaTranscript, toolUseId: string, result: "allow" | "deny"): MaTranscript;
export function pendingMaApprovals(t: MaTranscript): MaPendingApproval[];
/** Drops optimistic user rows once the server echoed the same text (FIFO, exact trimmed text match). */
export function reconcilePendingUserRows(pending: readonly Message[], rows: readonly Message[]): Message[];
export const MA_TOOL_TEXT_LIMIT = 80_000;
```

规则：
- 不可变更新：`rows` 用新数组；被 patch 的行用新对象（React 依赖引用变化）。
- `pendingMaApprovals`：`status === "requires_action"` 时，返回 `stopReason.event_ids` 中未 `resolved`、且对应行为 `agent.tool_use` / `agent.mcp_tool_use` 的项；其它状态返回 `[]`。
- `reconcilePendingUserRows`：对 `rows` 中每个 `role:"user"` 行，按顺序消费 `pending` 中第一个 `content.trim()` 相等的行；返回剩余 `pending`。

### 5.3 主进程：`desktop/electron/ma-sse.ts`（新建，纯函数）

```ts
export type SseMessage = { id: string | null; event: string; data: string };

/** Incremental parser. Feed decoded text; returns complete messages and the unconsumed remainder.
 *  - lines split on \n (strip trailing \r)
 *  - ':' prefix -> comment (ping), ignored
 *  - 'id:' / 'event:' / 'data:' fields (one optional space after colon); multiple data lines joined with \n
 *  - blank line dispatches if any data line was seen; event defaults to 'message'; id does not carry over */
export function parseSseChunk(buffer: string): { messages: SseMessage[]; rest: string };
```

### 5.4 主进程：`desktop/electron/ma-session-client.ts`（新建）

```ts
import { proxyAwareFetch } from "./proxy-fetch";
import { parseSseChunk } from "./ma-sse";

export type MaEndpoint = { baseUrl: string; token: string };
export type MaFetch = typeof proxyAwareFetch;
export const MA_STREAM_BACKOFF_MS = [1000, 2000, 5000, 10000] as const;
export const MA_STREAM_IDLE_TIMEOUT_MS = 45_000;
export const MA_REST_TIMEOUT_MS = 30_000;

/** cfg.enterprise.enabled === true && token startsWith "agx-pat-" && base present.
 *  baseUrl = cfg.enterprise.worker.ma_base_url (non-empty string) || cfg.enterprise.base_url; trailing "/" stripped. */
export function resolveMaEndpoint(cfg: unknown): MaEndpoint | null;

export type MaRestResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; code: string; message: string };

export async function maRequest<T>(endpoint: MaEndpoint, method: "GET" | "POST", path: string,
  init?: { body?: unknown; query?: Record<string, string | number | string[]> }, fetchImpl?: MaFetch): Promise<MaRestResult<T>>;

export type MaStreamSink = {
  frame(payload: { streamId: string; id: number | null; event: string; data: unknown }): void;
  state(payload: { streamId: string; state: "open" | "reconnecting" | "closed" | "error"; code?: string; message?: string }): void;
};

export class MaStreamRegistry {
  constructor(opts?: { fetchImpl?: MaFetch; sleep?: (ms: number) => Promise<void>; now?: () => number });
  open(streamId: string, endpoint: MaEndpoint, sessionId: string, afterSeq: number, sink: MaStreamSink, ownerId: number): void;
  close(streamId: string): void;
  closeOwner(ownerId: number): void;     // webContents.id
  size(): number;
}
```

**`maRequest` 规则**：
- URL：`${baseUrl}/ma/v1${path}`；query 数组按 `key=a&key=b` 展开（`types`）。
- Header：`Authorization: Bearer <token>`、`Accept: application/json`，有 body 时 `Content-Type: application/json`；`signal: AbortSignal.timeout(MA_REST_TIMEOUT_MS)`。
- 2xx → `{ok:true, status, data: await resp.json()}`；非 2xx → 尝试解析 `{error:{code,message}}`，否则 `code:"http_<status>"`、`message: "请求失败（<status>）"`；网络异常 → `{ok:false, status:0, code:"network_error", message:"无法连接企业服务"}`。**返回值与日志中不得出现 token**。

**`MaStreamRegistry.open` 算法**：

```text
ctrl = new AbortController(); registry[streamId] = {ctrl, ownerId}
lastSeq = afterSeq; attempt = 0
loop until ctrl.signal.aborted:
  headers = {Authorization, Accept: "text/event-stream"}; if lastSeq > 0: headers["Last-Event-ID"] = String(lastSeq)
  url = `${base}/ma/v1/sessions/${encodeURIComponent(sid)}/events/stream?event_deltas[]=agent.message`
  try:
    resp = await fetchImpl(url, {headers, signal: ctrl.signal})
    if resp.status in (401, 403, 404): sink.state({state:"error", code from body or "http_<status>", message}); break
    if !resp.ok || !resp.body: throw new Error(`http_${resp.status}`)
    sink.state({state:"open"}); gotFrame = false
    reader = resp.body.getReader(); decoder = new TextDecoder(); buffer = ""
    idle watchdog: setTimeout reset on every chunk; on fire -> ctrl-for-this-attempt abort (not the stream ctrl)
    read loop: buffer += decode(chunk); {messages, rest} = parseSseChunk(buffer); buffer = rest
       for m in messages: data = JSON.parse(m.data) (parse error -> skip)
           id = m.id && /^\d+$/.test(m.id) ? Number(m.id) : null; if id != null: lastSeq = Math.max(lastSeq, id)
           sink.frame({streamId, id, event: m.event, data}); gotFrame = true
    (stream ended normally) -> fallthrough to reconnect
  catch (err): if ctrl.signal.aborted: break
  if gotFrame: attempt = 0
  sink.state({state:"reconnecting"}); await sleep(MA_STREAM_BACKOFF_MS[min(attempt, 3)]); attempt += 1
finally: delete registry[streamId]; sink.state({state:"closed"}) unless the last state sent was "error"
```

每次尝试用独立的 `attemptCtrl`（链接到 `ctrl.signal`），空闲超时只中止当前尝试；`close(streamId)` 中止总 `ctrl`。

### 5.5 主进程 IPC（`desktop/electron/main.ts`，在企业登录 IPC 段 :9117 之后追加）

顶部 import 区追加：`import { MaStreamRegistry, maRequest, resolveMaEndpoint } from "./ma-session-client";`；模块级 `const maStreams = new MaStreamRegistry();`。

| IPC（`ipcMain.handle`） | 入参 | 行为 | 返回 |
|---|---|---|---|
| `ma-get-session` | `{ sessionId: string }` | `ep = resolveMaEndpoint(loadAgxConfig())`；null → `{ok:false,status:0,code:"enterprise_login_required",message:"请先登录企业账号"}`；否则 `maRequest(ep,"GET",\`/sessions/${id}\`)` | `MaRestResult<SessionRecord>` |
| `ma-list-events` | `{ sessionId, afterSeq?: number, limit?: number }` | `GET /sessions/:id/events?after_seq=&limit=`（limit 缺省 500，夹 1–500） | `MaRestResult<{data, has_more, next_after_seq}>` |
| `ma-post-events` | `{ sessionId, events: MaClientEvent[] }` | 校验 `events` 为 1–10 项数组，否则 `{ok:false,status:400,code:"invalid_request"}`；`POST /sessions/:id/events` body `{events}` | `MaRestResult<unknown>` |
| `ma-stream-open` | `{ streamId: string, sessionId: string, afterSeq: number }` | `streamId` 须匹配 `/^[A-Za-z0-9_-]{8,64}$/`；同 id 已存在先 `close`；`maStreams.open(..., sink, event.sender.id)`，sink 用 `event.sender.send("ma-stream-frame", p)` / `send("ma-stream-state", p)`（发送前检查 `!event.sender.isDestroyed()`）；首次为该 sender 注册 `event.sender.once("destroyed", () => maStreams.closeOwner(id))` | `{ ok: true }` 或 `{ ok:false, code }` |
| `ma-stream-close` | `{ streamId }` | `maStreams.close(streamId)` | `{ ok: true }` |

`sessionId` 一律 `encodeURIComponent`，并要求匹配 `/^[A-Za-z0-9]{26}$/`（ULID），否则返回 `{ok:false,status:400,code:"invalid_request"}`。

**修改 `main.ts` 后必须重新编译进 `dist-electron/` 并完全退出（⌘Q / Ctrl+C 重启 `npm run dev`）**，仅刷新渲染进程不会加载新 IPC。

### 5.6 `preload.ts` / `global.d.ts`

`preload.ts`（企业段之后追加）：

```ts
  maGetSession: (sessionId: string) => ipcRenderer.invoke("ma-get-session", { sessionId }),
  maListEvents: (sessionId: string, afterSeq?: number, limit?: number) =>
    ipcRenderer.invoke("ma-list-events", { sessionId, afterSeq, limit }),
  maPostEvents: (sessionId: string, events: unknown[]) => ipcRenderer.invoke("ma-post-events", { sessionId, events }),
  maStreamOpen: (streamId: string, sessionId: string, afterSeq: number) =>
    ipcRenderer.invoke("ma-stream-open", { streamId, sessionId, afterSeq }),
  maStreamClose: (streamId: string) => ipcRenderer.invoke("ma-stream-close", { streamId }),
  onMaStreamFrame: (cb: (p: { streamId: string; id: number | null; event: string; data: unknown }) => void) => {
    const handler = (_e: unknown, p: { streamId: string; id: number | null; event: string; data: unknown }) => cb(p);
    ipcRenderer.on("ma-stream-frame", handler as never);
    return () => ipcRenderer.removeListener("ma-stream-frame", handler as never);
  },
  onMaStreamState: (cb: (p: { streamId: string; state: string; code?: string; message?: string }) => void) => { /* same pattern, channel "ma-stream-state" */ },
```

`global.d.ts`：在 `agenticxDesktop` 接口中追加对应签名，返回类型用 §5.1 的 `MaRestResult`（在 `global.d.ts` 内联声明同形类型，避免从 `src/utils` import）。

### 5.7 `desktop/src/store.ts`：`managedApprovals` 切片（只追加）

```ts
export type ManagedApprovalItem = MaPendingApproval & { agentName: string };
// state
managedApprovals: Record<string, ManagedApprovalItem[]>;          // key = MA session id
// actions
setManagedApprovals: (sessionId: string, items: ManagedApprovalItem[]) => void;   // [] deletes the key
removeManagedApproval: (sessionId: string, toolUseId: string) => void;
```

初值 `{}`；**不进入持久化**（`store.ts` 当前不使用 zustand `persist` / `partialize`；窗格快照另由工作区快照逻辑序列化 `panes`，本切片不在 `panes` 内，天然不落盘）。

### 5.8 `desktop/src/hooks/useManagedSession.ts`（新建）

```ts
export type ManagedSessionView = {
  ready: boolean;                       // history loaded
  error: { code: string; message: string } | null;
  connection: "connecting" | "open" | "reconnecting" | "closed" | "error";
  transcript: MaTranscript;
  messages: Message[];                  // transcript.rows + optimistic user rows
  sendMessage(text: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  interrupt(): Promise<void>;
  resolveApproval(toolUseId: string, allow: boolean): Promise<{ ok: boolean; code?: string }>;
};

export function useManagedSession(sessionId: string | null, opts: { assistantName: string }): ManagedSessionView;
```

流程：
1. `sessionId` 为空 → 返回空 transcript、`ready=false`、不开流。
2. 挂载 / sessionId 变化：`transcript = createMaTranscript(sid)`；循环 `maListEvents(sid, cursor, 500)` 直到 `has_more === false`，每页 `applyMaEvents`；失败 → `error` 并停止（`code === "enterprise_login_required"` 时 `message` 为「请先登录企业账号」）。
3. 历史完成后 `streamId = "ma-" + crypto.randomUUID().replace(/-/g,"").slice(0,24)`；`maStreamOpen(streamId, sid, transcript.lastSeq)`；订阅 `onMaStreamFrame` / `onMaStreamState`，只处理本 `streamId`：
   - `event === "event_start"` / `"event_delta"` → `applyMaPreview`；
   - 其它且 `data` 为对象且含数字 `seq` → `applyMaEvents(t, [data])`。
   - 帧应用用 `requestAnimationFrame` 合批（同一帧内多条事件一次 `setState`）。
4. 每次 transcript 变化：`setManagedApprovals(sid, pendingMaApprovals(t).map(x => ({...x, agentName: opts.assistantName})))`；卸载时 `setManagedApprovals(sid, [])` 并 `maStreamClose(streamId)`、取消订阅。
5. `sendMessage(text)`：trim 为空 → `{ok:false,code:"empty"}`；先加乐观行 `{id:"ma-pending-"+uuid, role:"user", content:text, ownerSessionId:sid}`；`maPostEvents(sid,[{type:"user.message",content:[{type:"text",text}]}])`；失败则移除乐观行并返回错误（`session_requires_action` → message「请先处理待审批的工具调用」）。
6. `interrupt()`：`maPostEvents(sid,[{type:"user.interrupt"}])`，失败忽略（记录 `console.warn`，不含 token）。
7. `resolveApproval(id, allow)`：先 `markMaApprovalResolved` + `removeManagedApproval`（乐观）；`maPostEvents(sid,[{type:"user.tool_confirmation",tool_use_id:id,result: allow?"allow":"deny"}])`；失败且 code ∉ {`resolution_conflict`,`resolution_not_found`,`duplicate_resolution`} → 回滚（把行恢复为 pending，重新 `setManagedApprovals`）并返回 `{ok:false, code}`；上述三种 code 视为已被别处处理，不回滚。
8. `messages = [...transcript.rows, ...reconcilePendingUserRows(pending, transcript.rows)]`。

### 5.9 `desktop/src/components/managed/ManagedTranscript.tsx`（新建）

```tsx
type Props = {
  view: ManagedSessionView;
  sessionId: string;
  assistantName: string;
  assistantAvatarUrl?: string;
  userName?: string;
  userAvatarUrl?: string;
};
export function ManagedTranscript(props: Props): JSX.Element;
```

- 外层滚动容器：流式输出时**不强制锁底**——仅当用户距底部 < 80 px 时随新内容滚到底（AGENTS.md：用户须能随时上滚）。
- 逐条 `MessageRenderer`：`message`、`assistantName`、`assistantAvatarUrl`、`userName`、`userAvatarUrl`、`sessionId`、`sessionBusy={transcript.status === "running"}`、`onResolveInlineConfirm={(c, approved) => view.resolveApproval(c.requestId, approved)}`（忽略第三个 `remember` 参数）。其它可选回调不传（复制等动作是否常驻由 `MessageRenderer` 自身决定，不在本文扩展）。
- 运行中：`liveText` 非空 → 末尾渲染 `MessageRenderer` 的合成行 `{id:"ma-live", role:"assistant", content: liveText, avatarName: assistantName}`；为空 → 渲染一行 `SessionGeneratingDots`（与助手头像对齐，文案 `managed.thinking`「正在处理…」）。
- `view.error` → 居中错误条（主题 token，`text-amber-500` 图标），含「重试」按钮（重新挂载：改变内部 key）。
- `connection === "reconnecting"` → 顶部细条「连接中断，正在重连…」（`managed.reconnecting`），`open` 后消失。
- 不渲染输入框（属于 MA-D02 的 `ManagedChatPane`）。

### 5.10 `desktop/src/components/ApprovalInbox.tsx`

1. 读取 `const managed = useAppStore((s) => s.managedApprovals);`，展开为 `managedItems: ManagedApprovalItem[]`（`Object.values(managed).flat()`）。
2. 角标数字 = `items.length + managedItems.length`；空态判断同理。
3. 面板列表：先渲染 `managedItems`（卡片结构与现有一致）：来源文字 `t("approvals.sourceManaged", { name: item.agentName })`「企业智能体 · {{name}}」；剩余时间位置改显示 `t("approvals.waiting")`「等待处理」；正文 `t("approvals.managedQuestion", { tool: item.toolName })`「允许执行「{{tool}}」？」；第二行 `item.inputPreview`（`line-clamp-2`，等宽字体）。
4. 拒绝 / 批准按钮调用 `decideManaged(item, approved)`：
   - 乐观：`removeManagedApproval(item.sessionId, item.toolUseId)`；
   - `window.agenticxDesktop.maPostEvents(item.sessionId, [{type:"user.tool_confirmation", tool_use_id:item.toolUseId, result: approved ? "allow" : "deny"}])`；
   - 失败且 code 不是 `resolution_conflict` / `resolution_not_found` / `duplicate_resolution` → 把 item 写回（`setManagedApprovals(sid, [...current, item])`）并在卡片下显示 `t("approvals.failed")` + code。
   - 注意：hook 侧 transcript 的内联卡由随后到达的 `session.status_running` 自动收敛；hook 自身也监听 store 变化无需额外同步（transcript 中对应行保持 pending 直到服务端事件到达是可接受的；为避免两处不一致，hook 在 `managedApprovals` 中检测到某 toolUseId 被移除时调用 `markMaApprovalResolved`——在 hook 里用 `useAppStore.subscribe` 实现，并写入测试）。
5. 本机 parked 审批（`/api/approvals/pending`、`/api/confirm`）的轮询与决策代码**不改**。

### 5.11 文案

`desktop/locales/zh/sidebar.json`（`approvals` 节追加；en 同步）：

| 键 | 中文 |
|---|---|
| `approvals.sourceManaged` | 企业智能体 · {{name}} |
| `approvals.waiting` | 等待处理 |
| `approvals.managedQuestion` | 允许执行「{{tool}}」？ |

聊天命名空间（`managed` 节；en 同步）：

| 键 | 中文 |
|---|---|
| `managed.thinking` | 正在处理… |
| `managed.reconnecting` | 连接中断，正在重连… |
| `managed.loadFailed` | 加载会话失败：{{message}} |
| `managed.retry` | 重试 |
| `managed.customToolPending` | 等待业务系统处理 |
| `managed.stop.retries` / `stop.refusal` / `stop.policy` | 本轮执行失败，已停止重试 / 模型拒绝了本次请求 / 本轮内容触发企业合规策略，已停止 |
| `managed.terminated` | 会话已结束 |
| `managed.requiresActionBlocked` | 请先处理待审批的工具调用 |

适配器是纯函数，不直接依赖 i18n：提示行文本经 `opts` 注入（`MaAdapterOptions` 增加 `labels: { retries; refusal; policy; terminated; customToolPending; confirmQuestion(tool) }`，hook 用 `i18n.t` 构造）。测试里传固定中文。

---

## 6. Before / After

| 场景 | Before | After |
|---|---|---|
| 托管会话在 Near 中的呈现 | 无 | 与本机对话同款气泡 / 工具卡 / 推理块 |
| 断线 | — | 主进程按 `Last-Event-ID` 自动续流，不丢不重 |
| `always_ask` 工具 | — | 会话内联确认 + 收件箱「企业智能体」条目；处理结果回传 `user.tool_confirmation` |
| 收件箱 | 仅本机 parked 审批 | 本机 + 托管合并显示，本机路径行为不变 |
| 设备 PAT | 仅主进程用于企业门户 | 仍只在主进程；渲染进程只拿到事件数据 |

---

## 7. FR / NFR / AC

fixture：在 `ma-event-adapter.test.ts` 顶部内联一组事件（ULID 用固定 26 位字符串，seq 1..N）。

| ID | 需求 | AC（文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 基本映射 | `ma-event-adapter.test.ts::maps user and agent messages`：`user.message`(seq1) + `agent.thinking`(2) + `agent.message`(3) → 2 行；第 2 行 `role:"assistant"`、`reasoning` 等于 thinking 文本、`avatarName` 为 opts.assistantName；`lastSeq === 3` |
| FR-2 | 去重 | `skips events at or below lastSeq`：同一批应用两次 → 行数不变；乱序 `[seq3, seq2]` → seq2 被丢弃 |
| FR-3 | 工具行 | `maps tool_use and tool_result like ChatPane`：`agent.tool_use{name:"bash_exec",input:{command:"ls"},evaluated_policy:"always_allow"}` → `role:"tool"`、`content === '{"command":"ls"}'`、`toolCallId === 事件 id`、`toolStatus === "running"`；随后 `agent.tool_result{tool_use_id, content:[{type:"text",text:"a\n b"}]}` → 同一行 `content === "a\n b"`、`toolStatus === "done"`、`toolResultPreview === "a b"`、`toolStreamLines` 为 `[]`；`is_error:true` → `"error"`；文本 `CANCELLED: x` → `"cancelled"` |
| FR-4 | 连续工具共享组 | `consecutive tools share toolGroupId`：两个 tool_use 连续 → `toolGroupId` 相同；中间插 agent.message → 第三个工具新组 |
| FR-5 | MCP 与自定义 | `maps mcp and custom tool uses`：`agent.mcp_tool_use{mcp_server:"github",name:"get_issue"}` → `toolName === "github/get_issue"`；`agent.custom_tool_use` → `toolStatus === "pending"`、`metadata.maCustomTool === true`；`user.custom_tool_result` 回填该行 |
| FR-6 | requires_action | `requires_action adds inline confirm and pending approvals`：tool_use(always_ask) + `status_idle{stop_reason:{type:"requires_action",event_ids:[id]}}` → `status === "requires_action"`；该行 `inlineConfirm.requestId === id`、`context.maManaged === true`、`"tool" in context === false`；`pendingMaApprovals` 长度 1；随后 `user.tool_confirmation{result:"allow"}` + `status_running` → `inlineConfirm` 消失、`pendingMaApprovals` 为空 |
| FR-7 | 拒绝与中断 | `deny marks cancelled and interrupt cancels running tools`：deny 确认 → 行 `cancelled`；另一用例：tool_use(running) + `user.interrupt` + `status_idle(end_turn)` → 该行 `cancelled` |
| FR-8 | 停止原因 | `appends stop notices`：`max_tool_rounds` → 末行 `noticeKind === "rounds_exhausted"`；`budget_exceeded` → `noticeKind === "budget_exceeded"`；`policy_blocked` → `systemNotice === true` 且文本为 labels.policy；`end_turn` 不追加 |
| FR-9 | 错误与推理落行 | `session.error renders a system notice`（`retry_status.type:"retrying"` 前缀「正在重试：」）；`dangling thinking flushes at idle`：thinking + status_idle(end_turn) → 一条 `content:""`、有 `reasoning` 的助手行 |
| FR-10 | 预览帧 | `preview frames build liveText and reset on message`：`event_start` + 两个 `event_delta("He","llo")` → `liveText === "Hello"`；随后 `agent.message` → `liveText === ""` |
| FR-11 | 线程事件忽略 | `ignores events with thread_id`：`thread_id:"X"` 的 agent.message → 无新行，但 `lastSeq` 仍前进 |
| FR-12 | 乐观行收敛 | `reconcilePendingUserRows drops echoed rows FIFO`：pending `["a","a","b"]`，rows 有一条 user `"a"` → 剩 `["a","b"]` |
| FR-13 | 不可变更新 | `returns new objects`：`applyMaEvents` 后原 transcript 的 `rows` 引用与长度不变；被 patch 的行是新对象 |
| FR-14 | SSE 解析 | `desktop/tests/ma-sse.test.ts`：`parses id/event/data and ignores ping`（`'id: 3\nevent: agent.message\ndata: {"a":1}\n\n: ping\n\n'` → 1 条，`id === "3"`）；`keeps partial frame in rest`；`joins multiple data lines`；`handles CRLF`；`no id carry-over` |
| FR-15 | 端点解析 | `desktop/tests/ma-session-client.test.ts::resolveMaEndpoint`：未登录 / token 非 `agx-pat-` / 无 base → null；`worker.ma_base_url` 优先于 `base_url`；去尾 `/` |
| FR-16 | REST 错误映射且不泄露 token | `maRequest maps errors`：假 fetch 返回 409 `{error:{code:"session_requires_action",message:"x"}}` → `{ok:false,status:409,code:"session_requires_action"}`；500 非 JSON → `code:"http_500"`；抛错 → `code:"network_error"`；`JSON.stringify(result)` 不含 token 字符串；断言请求头 `Authorization === "Bearer agx-pat-t"`、query `types` 数组展开 |
| FR-17 | 续流 | `stream resumes with Last-Event-ID`：假 fetch 第 1 次返回含 `id: 5`、`id: 6` 两帧后结束的流，第 2 次断言请求头 `Last-Event-ID === "6"`；sink 依次收到 state `open`、两帧、`reconnecting`、`open`；注入 `sleep` 记录退避 `1000` |
| FR-18 | 不重连的错误 | `stops on 401/403/404`：假 fetch 返回 401 → sink 收到 `state:"error"`，fetch 只被调用 1 次 |
| FR-19 | 退避与重置 | `backoff grows and resets after frames`：连续 5 次网络错误 → sleep 序列 `[1000,2000,5000,10000,10000]`；之后一次成功收到帧再断 → 下一次退避回到 1000 |
| FR-20 | 空闲假死 | `idle watchdog reconnects`（注入 `MA_STREAM_IDLE_TIMEOUT_MS` 替身或可配置参数为 50ms）：流 50ms 无数据 → 当前尝试被中止并重连 |
| FR-21 | 关闭 | `close aborts and owner cleanup`：`open` 两个不同 owner 的流，`closeOwner(1)` 后 `size() === 1`；`close(id)` 后 sink 收到 `closed` |
| FR-22 | hook 历史 + 实时 | `desktop/src/hooks/useManagedSession.test.tsx`（`renderHook`，mock `window.agenticxDesktop.ma*` 与 `onMaStream*`）：`loads paged history then opens stream at lastSeq`（第 1 页 `has_more:true`，第 2 页 false → `maStreamOpen` 的 afterSeq 等于第 2 页末 seq）；推送一帧 → `messages` 增加 |
| FR-23 | hook 发送与 409 | `sendMessage shows optimistic row and rolls back on 409`：`maPostEvents` 返回 `{ok:false,status:409,code:"session_requires_action"}` → 返回值 `ok:false`、乐观行被移除 |
| FR-24 | hook 审批 | `resolveApproval is optimistic and keeps removal on resolution_conflict`：返回 `resolution_conflict` → 不回滚；返回 `internal_error` → 回滚，`managedApprovals[sid]` 再次含该项 |
| FR-25 | hook 卸载清理 | `unmount closes stream and clears approvals`：卸载后 `maStreamClose` 被调用、`managedApprovals[sid]` 不存在 |
| FR-26 | 收件箱合并 | `desktop/src/components/ApprovalInbox.test.tsx`（追加）：`shows managed approvals with agent name`（store 预置 1 项 → 角标 1、面板含「企业智能体 · 报告助手」与「允许执行「bash_exec」？」）；`approving a managed item posts tool_confirmation`（断言 `maPostEvents` 参数）；`failed managed decision restores the item`；既有用例全部不改仍通过 |
| FR-27 | 渲染与滚动 | `desktop/src/components/managed/ManagedTranscript.test.tsx`：`renders rows via MessageRenderer`；`shows generating dots while running without liveText`；`inline confirm calls resolveApproval`（点击批准 → `view.resolveApproval(id, true)`）；`does not offer session remember`（确认卡不含「本会话」字样） |
| NFR-1 | 个人模式不变 | `git diff --quiet -- desktop/src/components/ChatPane.tsx desktop/src/components/ChatView.tsx`；`npm -C desktop test` 全量通过 |
| NFR-2 | 类型与构建 | `npm -C desktop run build` 通过（含主进程 `tsc`） |
| NFR-3 | 凭证 | `rg -n "token" desktop/src/hooks/useManagedSession.ts desktop/src/components/managed` 无设备 PAT 相关读取；主进程日志不打印 token（代码审查项） |

---

## 8. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
npm -C desktop test -- src/utils/ma-event-adapter.test.ts tests/ma-sse.test.ts tests/ma-session-client.test.ts \
  src/hooks/useManagedSession.test.tsx src/components/managed src/components/ApprovalInbox.test.tsx \
  src/i18n/message-parity.test.ts
npm -C desktop test
npm -C desktop run build
git diff --quiet -- desktop/src/components/ChatPane.tsx desktop/src/components/ChatView.tsx && echo "chat panes untouched"
```

改了 `desktop/electron/main.ts` / `preload.ts`：**必须完全退出 Near（⌘Q）或 Ctrl+C 重启 `npm run dev`**，否则新 IPC 不生效。

**联调（需 A04 / E03 / D01 已合入，agent-runtime 开 `MA_RUNTIME_DESKTOP_PAT_ENABLED=1`）**：MA-D02 合入前可在 DevTools 控制台验证 IPC：

```js
const sid = "<用服务 PAT 代表自己建的会话 id>";
await window.agenticxDesktop.maListEvents(sid, 0, 500);
const off = window.agenticxDesktop.onMaStreamFrame((p) => console.log(p.id, p.event));
await window.agenticxDesktop.maStreamOpen("dbg00000001", sid, 0);
// 另开终端向该会话发 user.message，控制台应按 seq 打印事件；断开网卡 10 秒再恢复，seq 继续不重不漏
```

---

## 9. 回滚

本文无运行时开关：所有新代码只在 MA-D02 打开托管窗格时被调用；收件箱只在 `managedApprovals` 非空时多显示条目。回滚 = 删除 §3.1 新建文件并 `git checkout` 修改文件（`main.ts` / `preload.ts` / `global.d.ts` / `store.ts` / `ApprovalInbox.tsx` / 文案）。

---

## 10. 不变量

1. `ChatPane.tsx`、`ChatView.tsx` 零改动；本机会话 SSE、`messages.json`、`/api/confirm` 行为不变。
2. 收件箱对本机 parked 审批的轮询频率、请求与决策路径不变。
3. 设备 PAT 只存在于主进程；IPC 返回值与推送帧不含 token。
4. 托管会话事件不写入窗格持久化与本机磁盘。
5. 未登录企业时，`ma-*` IPC 返回 `enterprise_login_required`，不发出任何网络请求。

---

## 11. 风险

1. **A04 预览帧格式**：若实际实现的 `event_start` / `event_delta` 字段名与 A04 plan 不同，FR-10 需按实际调整；不影响持久化事件渲染。
2. **`noticeKind` 卡片依赖字段**：`rounds_exhausted` / `budget_exceeded` 卡若强依赖本机字段（如 `roundsMax`），按 §4 备注降级为系统提示行。
3. **收件箱只覆盖已打开的托管窗格**：窗格关闭后流断开，待审批项从收件箱消失（服务端仍是 requires_action，重新打开窗格即恢复）。全局后台订阅列入后续。
4. 长会话首次加载需分页拉完全部历史（每页 500）；超长会话首屏变慢，后续可改为只拉尾部 + 上滚加载。

---

## 12. 待确认问题

- **Q1**：依赖方向调整为 D03 → D02（master §9 写的是 D03 依赖 D02），是否接受并在 master §12 登记？
- **Q2**：托管会话里的消息操作（复制 / 引用 / 收藏 / 多选 / 重试）本文不接（MessageRenderer 未传回调即不显示）。AGENTS.md 要求这些按钮常驻——是否需要在 D02 / 后续子规划中补齐，或首版只提供复制？
