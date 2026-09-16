# 协作房间 06 · 房间内 Meta 回复

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 子 plan 03（API）；建议 04/05 已完成以便直接看到效果
**交付:** 房间内 @Meta 触发一次**无工具**模型回复，落库为房间消息，对全体成员可见

---

## 范围声明（务必先读）

这是「证明智能体能作为房间成员发言」的最小一刀，**不是** Agent Runtime。

**明确不做：**

- 工具循环 / ReAct / 多轮自主执行
- 多分身路由（`@某个分身`）
- 把 Python `agenticx` runtime 接进来
- 流式逐字输出到房间（本波次一次性落一条完整消息）
- 深度研究、联网搜索
- 修改 `app/api/chat/completions/route.ts` 或 `lib/deep-research/**`、`lib/web-search/**`

多分身与工具循环属于上位 plan `.cursor/plans/pending/2026-08-13-cloud-project-room.plan.md` 的 Phase C2，另立子 plan。

---

## FR

- **FR-06-1**：房间消息内容中出现 `@Meta`（大小写不敏感，也接受 `@meta`）时，服务端在该条用户消息落库**之后**触发一次 Meta 回复。
- **FR-06-2**：Meta 回复以 `sender_type = "meta"`、`sender_id = "meta"`、`sender_name = "Meta"` 落库为房间消息，因此自动获得 `seq`，并经子 plan 04 的 SSE 推给所有成员。
- **FR-06-3**：Meta 的上下文是该房间最近 N 条消息（N = 30），带上发送者显示名，让它能分清是谁在说话。
- **FR-06-4**：模型不可用 / 网关报错时，落一条 `sender_type = "system"` 的提示消息，**不吞错、不 500 整个发言请求**（用户的消息必须已经成功发出）。
- **FR-06-5**：同一条用户消息只触发一次 Meta 回复（幂等，防重复触发）。
- **FR-06-6**：Meta 回复不写入任何个人 `chat_sessions` / `chat_messages`。

---

## 落点清单

新建：

```
enterprise/apps/web-portal/src/lib/collab-room/meta-reply.ts
enterprise/apps/web-portal/src/lib/collab-room/meta-reply.test.ts
```

修改（仅一处，精确追加）：

```
enterprise/apps/web-portal/src/app/api/rooms/[roomId]/messages/route.ts   # POST 末尾追加触发
```

---

## 网关调用方式（照现有约定，不要自创）

`app/api/chat/completions/route.ts` 已确立三件事，直接沿用：

1. **地址**（L37-38）：
   ```ts
   const GATEWAY_COMPLETIONS_URL =
     process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";
   ```
2. **请求头**（L196-208）：`authorization: Bearer <accessToken>` + `x-tenant-id` / `x-user-id` / `x-dept-id` / `x-user-email` / `x-session-id`。房间场景把 `x-agenticx-trace-stage` 设为 `"room.meta"`。
3. **网关不可用时的文案风格**（L303）：给出可操作提示，但**面向终端用户的房间消息里不要写 `127.0.0.1:8088` 这种运维细节**——房间里只说「智能体暂时不可用，请稍后再试」，详细原因走 `log()`。

模型选择：复用 `lib/admin-providers-reader` 的 `listAvailableModelsForUser(userId, email, deptId)` 取第一个可用模型（该函数已在 completions 路由 L152 使用）。取不到则按 FR-06-4 落 system 提示。

---

## `meta-reply.ts` 契约

```ts
export type MetaReplyDeps = {
  gatewayUrl: string;
  headers: Record<string, string>;
  model: string;
  signal?: AbortSignal;
};

/** 房间里是否点名了 Meta。大小写不敏感；要求 @ 紧邻 meta。 */
export function mentionsMeta(content: string): boolean {
  return /(^|[\s，,。.:：;；!！?？(（])@meta\b/i.test(content);
}

/**
 * 取最近 limit 条房间消息，转成一次补全请求的 messages。
 * 每条前缀发送者显示名，让模型能分清多个真人。
 */
export function buildMetaPrompt(
  history: CollabRoomMessage[],
  limit = 30,
): Array<{ role: "system" | "user" | "assistant"; content: string }>;

/** 单次无工具补全。失败抛错，由调用方转成 system 消息。 */
export async function requestMetaReply(
  prompt: Array<{ role: string; content: string }>,
  deps: MetaReplyDeps,
): Promise<string>;
```

`buildMetaPrompt` 细节：

- 首条 system：说明「你是这个协作房间里的助手 Meta，房间里有多个真人成员，回复要简洁、指明你在回应谁」。
- 历史映射：`sender_type === "meta"` → `role: "assistant"`；其余（human / agent / system）→ `role: "user"`，内容格式 `"<sender_name>：<content>"`。
- 只取最后 `limit` 条，按 `seq` 升序。
- 单条内容超 4000 字符时截断并加 `…`（避免上下文超限）。

`requestMetaReply`：`stream: false` 的 POST；解析 `choices[0].message.content`；非 2xx 或缺字段则 throw 带状态码的 Error。

---

## 路由改动（唯一修改点，精确追加）

在 `app/api/rooms/[roomId]/messages/route.ts` 的 `POST` 里，**成功 append 用户消息之后、返回响应之前**追加：

```ts
    const created = await appendMessage(ctx, roomId, {
      senderType: "human",
      senderId: session.userId,
      senderName: session.email ?? session.userId,
      content,
    });

    // Meta 触发是尽力而为的副作用：用户消息已经落库，这里失败绝不能让
    // POST 变成 5xx（否则前端会误判「消息没发出去」而重发）。
    if (mentionsMeta(content)) {
      await triggerMetaReply(ctx, roomId, session).catch((error) => {
        log("error", { event: "room.meta_reply.failed", room_id: roomId, error_message: String(error) });
      });
    }

    return NextResponse.json({ code: "00000", message: "ok", data: { message: created } });
```

`triggerMetaReply` 放在 `meta-reply.ts` 里，内部：

1. `listMessages(ctx, roomId, { limit: 30 })` 取上下文
2. `listAvailableModelsForUser(...)` 选模型；取不到 → `appendSystemNotice(ctx, roomId, "智能体暂时不可用（未配置可用模型）")` 并 return
3. `requestMetaReply(...)`
4. 成功 → `appendMessage(ctx, roomId, { senderType: "meta", senderId: "meta", senderName: "Meta", content: reply, model })`
5. 失败 → `appendSystemNotice(ctx, roomId, "智能体暂时不可用，请稍后再试")`

**关于 await**：这里 `await` 了 Meta 回复，意味着 POST 响应会等模型返回（可能数秒）。这是刻意的取舍——Next.js route handler 在响应返回后不保证后台任务继续执行，fire-and-forget 会被静默丢弃。若后续要改成异步，必须先有真正的后台执行器（属于 C2），本波次不要用 `void promise` 假装异步。

> 前端配合：子 plan 05 的 `send()` 在等待期间应保留「发送中」态；若实测体验差，可在 05 里把 `@Meta` 的发送改为「先本地插入用户消息 + 显示 Meta 正在输入」，但**不改本子 plan 的服务端语义**。

### 幂等（FR-06-5）

`appendSystemNotice` 与 Meta 消息都靠 `(room_id, seq)` 天然唯一，不会重复。真正要防的是**同一条用户消息被重试导致两次 Meta 回复**：

- 依赖点：子 plan 02 的 `appendMessage` 无幂等键，因此前端重发会产生两条用户消息、两次 Meta 回复。这是可接受的现状（与人重复发言等价）。
- 本子 plan **不**引入 `operation_id` 机制。若后续需要，参考个人聊天的 `chat_history_operations` 表与 `appendChatMessages` 的 `operationId` / `payloadHash`（`lib/chat-history/types.ts:23-26`），另立子 plan。
- 因此 FR-06-5 的口径是：**单次 POST 内只触发一次**，用单测固定「`mentionsMeta` 为 true 时 `requestMetaReply` 恰好被调用一次」。

---

## 单测（`meta-reply.test.ts`）

| 用例 | 断言 |
|---|---|
| `mentionsMeta matches @Meta case-insensitively` | `"@Meta 帮我看下"`、`"请 @meta 总结"` 为 true |
| `mentionsMeta ignores emails and non-boundary hits` | `"a@metabase.com"`、`"x@metadata"` 为 false |
| `buildMetaPrompt prefixes sender names` | 生成的 user 内容形如 `"Alice：你好"` |
| `buildMetaPrompt maps meta messages to assistant role` | `sender_type:"meta"` → `role:"assistant"` |
| `buildMetaPrompt keeps only the last 30 messages in seq order` | 传 40 条 → 取后 30 且升序 |
| `buildMetaPrompt truncates an oversized message` | 5000 字符内容被截断到 4000 + `…` |
| `requestMetaReply throws on non-2xx gateway response` | mock fetch 返回 500 → reject |
| `requestMetaReply returns the assistant content on success` | 解析 `choices[0].message.content` |
| `triggerMetaReply appends a system notice when no model is available` | 落库消息的 `senderType === "system"`，且未调用 fetch |
| `triggerMetaReply appends a system notice when the gateway fails` | 落 system 消息，内容不含 URL / 端口 |
| `triggerMetaReply calls the gateway exactly once per invocation` | fetch 调用次数 = 1 |

路由侧再加一条（在子 plan 03 的 route 测试文件里追加）：

| 用例 | 断言 |
|---|---|
| `POST messages still returns 200 when meta reply fails` | `triggerMetaReply` reject → 响应仍是 200，且 data.message 是用户那条 |

---

## AC

- **AC-06-1**：`pnpm -C enterprise/apps/web-portal test` 全绿，含上表 11 + 1 个用例。
- **AC-06-2**：`pnpm -C enterprise typecheck` 通过。
- **AC-06-3**：真库联调（需网关在 `:8088` 运行，见 `enterprise/scripts/start-dev-with-infra.sh`）：A、B 同房，A 发 `@Meta 用一句话说明这个房间能做什么` → 房间内出现 `Meta` 的回复气泡，**B 侧也能看到**（经 SSE 或轮询）。
- **AC-06-4**：把 `GATEWAY_COMPLETIONS_URL` 指向一个不存在的端口后重试 → 房间内出现「智能体暂时不可用，请稍后再试」，且 A 自己那条用户消息仍在、POST 返回 200。
- **AC-06-5**：`psql` 查 `chat_messages` 表，确认本次操作没有新增任何行（FR-06-6）。
- **AC-06-6**：`git diff --name-only` 仅含 `lib/collab-room/meta-reply.ts`、其测试、以及 `app/api/rooms/[roomId]/messages/route.ts`（+ 子 plan 03 的 route 测试文件）。

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| 用 `void promise` 做 fire-and-forget 导致回复被静默丢弃 | 本子 plan 明确 `await`；异步化需要真后台执行器 |
| Meta 失败让用户以为消息没发出去 | 失败只落 system 消息，POST 恒 200；专门单测 |
| 把运维细节暴露给终端用户 | system 提示文案固定为中性中文，单测断言不含 URL |
| 顺手接工具循环 | Out of scope 明确；`requestMetaReply` 不接受 tools 参数 |
| 误改 completions 路由 | AC-06-6 的 diff 列表兜底 |
| `@meta` 误命中邮箱 | 正则要求前置边界字符，单测覆盖 |
