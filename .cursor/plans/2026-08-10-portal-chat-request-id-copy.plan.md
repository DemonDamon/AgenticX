# Portal 聊天成功回复的请求 ID 透出与一键复制

Planned-with: Claude Opus 5 (thinking)

## 背景与根因

`.cursor/plans/2026-08-10-enterprise-trace-observability.plan.md` 落地后，浏览器 → Portal → Gateway 已经打通同一条 `trace_id`（26 位 Crockford Base32 ULID，头名 `x-agenticx-trace-id`），admin-console 也有了 `/portal-logs` 页面按 `trace_id` 查询。但用户实际排障时发现：**只有报错的气泡能看到请求 ID，成功的回答什么都看不到**，于是"回答不对/回答很慢"这类没有报错的问题依旧无从追起。

根因不在 UI，在数据链路。证据链：

1. `enterprise/packages/sdk-ts/src/chat/http.ts:105-114`：`sendMessage()` 返回 `{ requestId, traceId }`，其中 `requestId` 是 `crypto.randomUUID()` 生成的**纯前端内存句柄**（L17-22 `makeRequestId`），只用于 `sendMessage`/`stream`/`cancel` 三者配对，**永不发给服务端、不落库**；真正的跨服务关联键是 `traceId`（L107 `newTraceId()`，L137 作为 `x-agenticx-trace-id` 请求头发出）。
2. `enterprise/features/chat/src/store.ts:1855`：`const { requestId } = await client.sendMessage(request);` —— **`traceId` 被解构丢弃**。三条发送路径（`sendMessage` L1855、`editUserMessageAndResend` L2110、`regenerateAssistantResponse` L2331）全部如此。
3. 唯一残留：出错时 `chunk.traceId` 被 `appendRequestId()`（`http.ts:36-41`）拼成 `\n请求 ID: <tid>` 塞进错误文案。这就是"只有报错能看到 ID"的由来。
4. `enterprise/packages/core-api/src/chat.ts:171-189` 的 `ChatMessage` 没有任何字段承载 trace_id，落库链路（`stripToAppendPayload` → `sanitizeInboundMessages` → `serializeMessageMetadata`）也就无从谈起。

关键有利条件（决定本方案不需要动服务端）：

- `enterprise/apps/web-portal/src/lib/observability/with-request-log.ts:20-21`：`const incoming = request?.headers.get("x-agenticx-trace-id")?.trim() ?? ""; const traceId = isTraceId(incoming) ? incoming : newTraceId();` —— **合法入站 trace_id 会被原样采信**。因此前端自己生成的那个 ULID 就是最终写进 `portal_request_logs.trace_id` 和网关审计的那个，**无需服务端回传、无需读响应头**。
- `enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts:67-104`：消息的扩展字段走 `metadata` JSON 列（PG jsonb / MySQL JSON），**新增字段不需要任何 DB 迁移**。
- `enterprise/apps/admin-console/src/app/api/portal-logs/query/route.ts:19-28,58` 与 `src/lib/portal-logs-query.ts:11,123,151`：后端**已支持 `session_id` 过滤**，只是 `/portal-logs` 页面没有对应输入框。

## In scope / Out of scope

**In scope**
- `ChatMessage` 增加 `trace_id` 字段，并在三条发送路径把 SDK 返回的 traceId 写到助手消息上。
- 该字段通过既有 history 链路持久化到 `chat_messages.metadata`，刷新/切会话/重开后仍在。
- `MessageList` 助手消息操作栏新增「复制请求 ID」按钮（有 trace_id 才渲染）。
- Portal 聊天顶栏新增「复制会话 ID」按钮。
- admin-console `/portal-logs` 页面新增 `session_id` 过滤输入框（后端已就绪，仅补 UI + i18n）。

**Out of scope（明确不做，防止 scope creep）**
- 不改 `enterprise/apps/gateway`（Go 网关）任何代码。
- 不改 `withRequestLog` / `/api/chat/completions` / 深度研究编排的 trace 传播逻辑——已验证工作正常。
- 不改错误路径现有的 `appendRequestId` 文案行为（`http.ts:36-41` 保持原样）。
- 不做 `portal_request_logs` 的 schema / 迁移 / 保留期变更。
- 不重构 `MessageList.tsx` 的操作栏内联结构（它确实该抽组件，但那是另一件事）。
- 不给 admin `/portal-logs` 加 `user_id` / `event` / `route` 过滤（后端也支持，但本次只补 `session_id`，因为它是 FR-4 复制出来的东西的落点）。

## 需求

### FR-1 `ChatMessage` 承载 trace_id（类型层）

`enterprise/packages/core-api/src/chat.ts`，在 `export type ChatMessage = {` 块（L171-189）内、`model?: string;`（L181）**之后**插入一行：

```ts
  /**
   * 本轮请求的 x-agenticx-trace-id（26 位 ULID）。
   * 用于把这条助手回复关联到 admin-console 的 Portal 日志 / 网关审计。
   * 仅助手消息有值；历史消息在该字段引入前写入的为 undefined。
   */
  trace_id?: string;
```

不改动该 type 里任何既有字段。

### FR-2 三条发送路径捕获 traceId 并写入助手消息

`enterprise/features/chat/src/store.ts`。三处均为同一模式，**只改这三处，其余流式处理逻辑一行不动**。

改动点与锚点：

| 序号 | 行号（改前） | 所在方法 | 目标消息变量 |
|---|---|---|---|
| a | 1855-1856 | `sendMessage` | `assistantMessage.id` |
| b | 2110-2111 | `editUserMessageAndResend` | `replacementAssistant.id` |
| c | 2331-2332 | `regenerateAssistantResponse` | `replacementAssistant.id` |

before（以 a 为例，b/c 结构完全相同）：

```ts
      const { requestId } = await client.sendMessage(request);
      setSessionStream(set, sessionId, { status: "streaming", activeRequestId: requestId });
```

after：

```ts
      const { requestId, traceId } = await client.sendMessage(request);
      setSessionStream(set, sessionId, { status: "streaming", activeRequestId: requestId });
      // trace_id 是跨服务关联键（requestId 只是前端内存句柄，不出浏览器）。
      // 挂到助手消息上，供气泡「复制请求 ID」与落库后的排障检索。
      if (traceId) {
        set((prev) => ({
          messages: prev.messages.map((message) =>
            message.id === assistantMessage.id ? { ...message, trace_id: traceId } : message,
          ),
        }));
      }
```

b/c 处把 `assistantMessage.id` 换成 `replacementAssistant.id`。

**为什么改 state 就够（不用另外传给 persist）**：`sendMessage` 的 `finally` 块（L1960-1974）是从 `get().messages.find((m) => m.id === assistantMessage.id)` 重新取消息对象再交给 `persistAppendMessages`，所以只要 state 里有 `trace_id`，落库自然带上。b/c 的持久化同理（分别在 L2204-2221、L2425-2442 区域从 `get()` 取）。

### FR-3 trace_id 走完持久化链路（无需 DB 迁移）

按下列顺序改 4 个文件，每处只加不改：

**3.1** `enterprise/features/chat/src/history-outbox.ts`
- `export type HistoryAppendPayload = {`（L41-51）内、`model?: string;`（L45）之后加：
  ```ts
  /** 本轮 x-agenticx-trace-id，供事后排障关联 Portal 日志。 */
  trace_id?: string;
  ```
- `stripToAppendPayload()`（L194-232）中，`if (message.model) payload.model = message.model;`（L204）**之后**加：
  ```ts
  if (message.trace_id) payload.trace_id = message.trace_id;
  ```
  注意：`computePayloadHash`（L183-188）对 payload 做规范化 JSON 哈希，新增字段会改变哈希值——这是预期行为（新旧 payload 本就不同），outbox 幂等语义不受影响。

**3.2** `enterprise/apps/web-portal/src/lib/chat-message-sanitize.ts`
- 文件顶部（L1-7 的 import 块之后）新增：
  ```ts
  import { isTraceId } from "@agenticx/sdk-ts";
  ```
  （web-portal 已依赖 `@agenticx/sdk-ts`，见 `src/lib/observability/with-request-log.ts:1` 同样的导入方式。）
- `sanitizeInboundMessages()` 中，`const model = typeof row.model === "string" ? row.model : undefined;`（L297）之后加：
  ```ts
  // 只接受合法 26 位 ULID，拒绝伪造/超长输入；非法值静默丢弃而非抛错，
  // 避免旧客户端或脏数据把整批消息的落库打挂。
  const traceIdRaw = typeof row.trace_id === "string" ? row.trace_id.trim() : "";
  const traceId = isTraceId(traceIdRaw) ? traceIdRaw : undefined;
  ```
- 同函数 `out.push({ ... })`（L298-310）内，`model,`（L308）之后加 `trace_id: traceId,`。

**3.3** `enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts`
- `type MessageMetadata = {`（L67-71）加 `trace_id?: string;`
- `serializeMessageMetadata()`（L86-104）中，`if (message.deep_research) { ... }` 块（L94-99）**之后**、`return` 之前加：
  ```ts
  if (message.trace_id) {
    metadata.trace_id = message.trace_id;
  }
  ```
- `mapMessage()`（L106-121）返回对象中，`model: row.model == null ? undefined : String(row.model),`（L118）之后加：
  ```ts
  trace_id: metadata?.trace_id,
  ```

**3.4** 若 `enterprise/apps/web-portal/src/lib/chat-history/` 下存在内存版 store（无 PG 时的开发回退），确认它是否直接存 `ChatMessage` 对象：是则无需改动；若它也做了字段白名单拷贝，按 3.3 同样补 `trace_id`。**不要**为此重构内存 store。

### FR-4 助手气泡「复制请求 ID」按钮

`enterprise/features/chat/src/components/molecules/MessageList.tsx`。

**4.1 新增内联图标**（该文件的图标都是内联 SVG，见 L40-56 的 `IconCopy` / `IconLink`）。在 `IconCopy`（L41-47）之后插入：

```tsx
function IconHash({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>
    </svg>
  );
}
```

**4.2 新增独立的复制反馈 state 与 handler。** 现有 `handleCopy`（L511-516）用的是 `copiedId`，按 `message.id` 判定；trace_id 按钮若复用会和正文复制互相串（同一 message.id 两个按钮同时变对勾）。因此在 `copiedId` 的 `useState` 声明旁新增：

```tsx
const [copiedTraceMessageId, setCopiedTraceMessageId] = React.useState<string | null>(null);
```

并在 `handleCopy`（L511-516）之后新增：

```tsx
const handleCopyTraceId = (traceId: string, messageId: string) => {
  void navigator.clipboard.writeText(traceId).then(
    () => {
      setCopiedTraceMessageId(messageId);
      window.setTimeout(() => setCopiedTraceMessageId(null), 1600);
    },
    () => {
      // 剪贴板被浏览器策略拒绝时静默失败，不打断阅读。
    },
  );
};
```

**4.3 插入按钮。** 位置：`isAssistant && (` 块（L1189 起）内，点踩 Tooltip 的 `</Tooltip>`（L1222）**之后**、`{hasCitationSources && citationSources ? (`（L1223）**之前**。已在 `isAssistant` 分支内，故只需判 trace_id 是否存在：

```tsx
{message.trace_id ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          handleCopyTraceId(message.trace_id!, message.id);
        }}
      >
        {copiedTraceMessageId === message.id ? (
          <IconCheck className="h-3.5 w-3.5 text-success" />
        ) : (
          <IconHash className="h-3.5 w-3.5" />
        )}
      </Button>
    </TooltipTrigger>
    <TooltipContent>复制请求 ID</TooltipContent>
  </Tooltip>
) : null}
```

约束：
- 操作栏整体在流式中本就隐藏（`hideMessageActions`，L720-721），无需额外处理"生成中不显示"。
- 该文件的 Tooltip 文案目前是硬编码中文（如 L1064「复制」、L1164「重新生成」），**保持一致用硬编码中文**，不为这一个按钮引入 i18n。
- 不给 `MessageListProps`（L142-175）新增回调 prop——复制在组件内自闭环，避免所有调用方（`MachiChatView.tsx:1111`、`ChatWorkspace.tsx:99`）都要改。

### FR-5 聊天顶栏「复制会话 ID」

`enterprise/apps/web-portal/src/components/MachiChatView.tsx`。顶栏内联在 return 中（L999-1082），`activeSessionId` 已在 L107 从 store 取到。

在 Gateway online Badge（L1036-1040）**之前**插入一个纯图标按钮：

```tsx
{activeSessionId ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(activeSessionId).then(
            () => {
              setCopiedSessionId(true);
              window.setTimeout(() => setCopiedSessionId(false), 1600);
            },
            () => {},
          );
        }}
      >
        {copiedSessionId ? <Check className="h-3.5 w-3.5 text-success" /> : <Hash className="h-3.5 w-3.5" />}
      </Button>
    </TooltipTrigger>
    <TooltipContent>复制会话 ID</TooltipContent>
  </Tooltip>
) : null}
```

配套：
- 组件内新增 `const [copiedSessionId, setCopiedSessionId] = React.useState(false);`（与其它顶栏局部 state 放一起，如 `isEditingTitle` 附近）。
- 图标从 `lucide-react` 导入 `Check` / `Hash`（该文件已从 lucide 导入 `Activity` 等，追加到同一 import 语句即可，勿新开 import 行）。
- `Tooltip` / `TooltipTrigger` / `TooltipContent` / `Button` 该文件已在用（L1041-1062 的 token Badge 就包在 Tooltip 里），无需新增导入。

### FR-6 admin `/portal-logs` 补 session_id 过滤

后端已就绪，**只改前端 + i18n**：

**6.1** `enterprise/apps/admin-console/src/app/portal-logs/page.tsx`
- 在 `const [traceId, setTraceId] = useState(initialTrace);`（L62）之后加：
  ```tsx
  const [sessionId, setSessionId] = useState(searchParams.get("session_id")?.trim() ?? "");
  ```
- `load` 的请求体（L82 附近）中 `trace_id: traceId || undefined,` 之后加 `session_id: sessionId || undefined,`；并把 `sessionId` 加进 `load` 的依赖数组（L110 `[traceId, level, start, end, t]` → `[traceId, sessionId, level, start, end, t]`）。
- 在 trace_id 输入框（L202-207）之后，仿照同样结构加一个 `<Input id="portal-log-session" value={sessionId} onChange={...} placeholder={t("filterSessionIdPlaceholder")} />`，label 用 `t("filterSessionId")`。
- 现有 `useEffect`（L69-72）同步 URL 上的 `trace_id`，照同样写法补 `session_id`。

**6.2** i18n：`enterprise/apps/admin-console/messages/zh.json` 与 `en.json`，在 `pages.ops.portalLogs` 节（zh 的 L1042 起）`filterTraceIdPlaceholder` 之后加两个键：
- zh：`"filterSessionId": "会话 ID"`、`"filterSessionIdPlaceholder": "粘贴会话 ID（session_id）"`
- en：`"filterSessionId": "Session ID"`、`"filterSessionIdPlaceholder": "Paste session_id"`

两个语言文件的键必须一一对应，缺一即视为不达标。

## 验收标准

**AC-1（FR-1/FR-2 类型与内存态）**：`pnpm --filter @agenticx/core-api typecheck` 与 `pnpm --filter @agenticx/feature-chat typecheck` 通过。新增测试 `enterprise/features/chat/src/store.trace-id.test.ts`：stub 一个 `ChatClient`，其 `sendMessage` 返回 `{ requestId: "r1", traceId: "01J0000000000000000000000A" }`、`stream` 产出一个 `{ done: true }`；调用 `sendMessage` 后断言 `useChatStore.getState().messages.find(m => m.role === "assistant")?.trace_id === "01J0000000000000000000000A"`。

**AC-2（FR-3 落库链路）**：
- `enterprise/features/chat` 现有测试全绿（`pnpm --filter @agenticx/feature-chat test`），并新增断言：`stripToAppendPayload({...message, trace_id: "01J0000000000000000000000A"})` 的返回值含 `trace_id`；不带 trace_id 的消息返回值**不含** `trace_id` 键。
- 新增/扩展 `enterprise/apps/web-portal` 下的 sanitize 测试：`sanitizeInboundMessages` 对合法 26 位 ULID 保留 `trace_id`；对 `"not-a-ulid"`、`"'; DROP"`、超长字符串一律得到 `trace_id === undefined` 且**不抛错**。
- `serializeMessageMetadata({...msg, trace_id: "01J..."})` 的 JSON 串里含 `"trace_id"`；`mapMessage` 能从 `metadata` 还原出 `trace_id`。
- `pnpm --filter @agenticx/app-web-portal test` 与 `typecheck` 全绿。

**AC-3（FR-4 气泡按钮）**：手工验收——`bash enterprise/scripts/start-dev-with-infra.sh` 起栈后在 `http://localhost:3000` 发一条消息，回答完成后 hover 助手气泡，操作栏出现井号图标；点击后图标变绿对勾，粘贴得到 26 位大写字母数字串。同一条消息上「复制」（正文）与「复制请求 ID」的对勾状态互不干扰。刷新页面后重新 hover 该消息，按钮**仍在**且复制出同一个 ID（验证 FR-3 落库生效）。历史上更早的旧消息（无 trace_id）**不显示**该按钮。

**AC-4（端到端闭环）**：把 AC-3 复制到的 ID 粘进 `http://localhost:3001/portal-logs` 的「请求 ID」输入框查询，能查到该轮的 `chat.completions.start` / `chat.completions.finish` 记录，且 `status = 200`。这是本需求的核心价值验收——**成功请求也能追**。

**AC-5（FR-5 会话 ID）**：顶栏图标点击后粘贴得到当前会话 ULID；把它粘进 `/portal-logs` 的「会话 ID」输入框，能查到该会话所有轮次的日志（条数 ≥ 该会话的助手回复数）。

**AC-6（FR-6 无回归）**：`pnpm --filter @agenticx/app-admin-console typecheck` 与 `test` 全绿；`/portal-logs` 原有 trace_id 过滤、审计页「查看 Portal 日志」跳转（带 `?trace_id=`）行为不变。

## 风险与注意

- **payload hash 变化**：FR-3.1 让 `computePayloadHash` 的输入多了一个字段。已在库的 outbox 待发条目（`localStorage`）是旧格式，重放时 hash 与新算法不一致——但 hash 只在单次 append 的幂等校验内自洽（客户端算完随请求一起发），不做跨版本比对，因此无兼容问题。**不要**为此加版本号或迁移逻辑。
- **非法 trace_id 静默丢弃而非报错**：见 FR-3.2 注释。若改成抛错，一个脏字段会让整批消息落库失败、用户丢历史，代价远大于收益。
- **`message.trace_id!` 的非空断言**：FR-4.3 中的 `!` 处在 `message.trace_id ?` 的真值分支内，TS 无法收窄到 JSX 回调里，用 `!` 是此处最简写法；若仓库 lint 禁用 `no-non-null-assertion`，改为在 map 回调开头 `const traceId = message.trace_id;` 再判空。
- **不要顺手改 `MessageList.tsx` 的操作栏结构**：该文件已 1400+ 行、操作栏全内联，确实值得抽组件，但那属于独立重构，本次严禁夹带（`no-scope-creep.mdc`）。

## 推荐实施模型（Suggested-Impl-Model）

| 子任务 | 推荐 | 理由 |
|---|---|---|
| FR-1 / FR-3 / FR-6 | Composer 2.5 或代码专精便宜档 | 纯字段接线与 i18n 补键，落点已精确到行，样板活 |
| FR-2 | 代码专精中档（如 Codex 系列） | 三处同构改动但要理解 `finally` 里从 `get()` 取消息的时序，弱模型易改错目标变量 |
| FR-4 / FR-5 | 代码专精中档 | 涉及 React state 与既有 hover 交互，需避免与现有 `copiedId` 串扰 |

整体建议：**单模型跑完更划算**，选代码专精中档一档到底（跨 6 个文件但每处都很轻），不必上顶配。

Suggested-Impl-Model: 代码专精中档（如 Codex 系列）
