# 协作房间 04 · 实时增量推送

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 子 plan 03（API 可用）
**交付:** `GET /api/rooms/:roomId/events` SSE 流，按 `seq` 增量、可断线续传

---

## 设计取舍（先读，避免做大）

上游参照系用「Redis pub/sub + 连接登记表」做跨实例扇出（见 master 的 M4）。本波次**不引入 Redis 硬依赖**，理由：

1. 当前 portal 的实时能力就是「按需轮询 + SSE 包装」（`app/api/chat/deep-research/runs/[runId]/stream/route.ts:111-139`），本子 plan 沿用同一骨架，风险最低。
2. 房间消息已有单调 `seq`（子 plan 01/02），**数据库轮询 + seq 游标就能保证不丢不重**，这是比 pub/sub 更强的正确性保证（pub/sub 丢包反而需要额外补偿）。
3. Redis 的价值在**降低延迟与数据库压力**，不是正确性。属于扩容项。

因此：**本子 plan 用 1 秒轮询 DB 的 SSE**，并在代码注释与本文件「扩容路径」一节把 Redis 升级方案写清，供后续需要时执行。

---

## In scope

- 新建 SSE 路由 `/api/rooms/:roomId/events`
- 事件协议定义（`room_message` / `room_ping` / `room_closed`）
- 首帧发送「当前游标」以便客户端对齐
- 单测：鉴权、游标推进、abort 处理

## Out of scope

- Redis / WebSocket / 长连接网关（写方案，不实施）
- 前端订阅逻辑（子 plan 05 消费本接口）
- presence（谁在线）、已读状态、正在输入
- 修改子 plan 03 的任何路由

---

## FR

- **FR-04-1**：非活跃成员访问该 SSE 返回 403（不是空流）。
- **FR-04-2**：连接建立后先发一条 `room_cursor` 事件，携带当前 `last_seq`。
- **FR-04-3**：客户端可用 query `?after_seq=N` 指定起点；服务端只推 `seq > N` 的消息，按 `seq` 升序。
- **FR-04-4**：无新消息时每 15 秒发一次 `room_ping` 保活。
- **FR-04-5**：客户端断开（`request.signal.aborted`）时循环退出，不泄漏 interval / 不再写 controller。
- **FR-04-6**：单个连接最长存活 `maxDuration`（设 300 秒）后正常结束，由客户端重连并带上最后 `seq`。

---

## 落点清单

新建：

```
enterprise/apps/web-portal/src/app/api/rooms/[roomId]/events/route.ts
enterprise/apps/web-portal/src/app/api/rooms/[roomId]/events/route.test.ts
enterprise/apps/web-portal/src/lib/collab-room/events.ts        # 事件序列化 + 类型
enterprise/apps/web-portal/src/lib/collab-room/events.test.ts
```

不修改任何既有文件。

---

## 事件协议（`lib/collab-room/events.ts`）

SSE 用**命名事件**，不要复用 deep-research 那套 `chat.completion.chunk` 形状（那是给聊天补全用的，语义不同）。

```ts
import type { CollabRoomMessage } from "./types";

export type CollabRoomEvent =
  | { type: "room_cursor"; last_seq: number }
  | { type: "room_message"; message: CollabRoomMessage }
  | { type: "room_ping"; at: string }
  | { type: "room_closed"; reason: "timeout" | "gone" };

/** SSE 帧：event: <name> + data: <json>，末尾空行。 */
export function formatCollabRoomEventSse(event: CollabRoomEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
```

`events.test.ts` 覆盖：每种事件的帧格式、`data` 可被 `JSON.parse` 还原、帧以 `\n\n` 结尾。

---

## 路由实现（骨架照 deep-research stream，逐点对照）

参考文件：`app/api/chat/deep-research/runs/[runId]/stream/route.ts`。要照搬的三处结构：

1. **L11-12 的 runtime 声明**：`export const runtime = "nodejs";` + `export const maxDuration = 300;`（房间用 300，不用 1500）
2. **L76-84 的 `safeEnqueue`**：`closed` 标志 + abort 检查 + try/catch，防止向已关闭的 controller 写入
3. **L111-139 的轮询循环**：`await new Promise(r => setTimeout(r, POLL_MS))` + 每轮重新查询 + 游标推进

```ts
export const runtime = "nodejs";
export const maxDuration = 300;

const POLL_MS = 1_000;
const PING_EVERY_MS = 15_000;

type Params = Promise<{ roomId: string }>;

export async function GET(request: Request, segmentData: { params: Params }) {
  const session = await getSessionFromCookies();
  if (!session) return collabRoomUnauthorized();

  const { roomId } = await segmentData.params;
  if (!isValidUlid(roomId)) return chatHistoryBadRequest("invalid room id");

  const ctx = toCollabRoomContext(session);
  const afterSeqParam = new URL(request.url).searchParams.get("after_seq");
  let cursor = afterSeqParam == null ? 0 : Number(afterSeqParam);
  if (!Number.isInteger(cursor) || cursor < 0) {
    return chatHistoryBadRequest("invalid after_seq");
  }

  // 鉴权必须在建流之前：非成员应拿到 403，而不是一个空的 200 流。
  let room: CollabRoom;
  try {
    room = await getRoom(ctx, roomId);
  } catch (error) {
    return collabRoomErrorResponse(error);
  }

  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed || abortSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      safeEnqueue(formatCollabRoomEventSse({ type: "room_cursor", last_seq: room.last_seq }));

      const startedAt = Date.now();
      let lastPingAt = Date.now();
      try {
        while (!closed && !abortSignal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (closed || abortSignal.aborted) break;

          let batch: CollabRoomMessage[];
          try {
            batch = await listMessages(ctx, roomId, { afterSeq: cursor, limit: 200 });
          } catch (error) {
            // 成员被移出后 store 会抛 Forbidden：正常收流，不当异常。
            safeEnqueue(formatCollabRoomEventSse({ type: "room_closed", reason: "gone" }));
            break;
          }
          for (const message of batch) {
            safeEnqueue(formatCollabRoomEventSse({ type: "room_message", message }));
            cursor = Math.max(cursor, message.seq);
          }
          if (batch.length === 0 && Date.now() - lastPingAt >= PING_EVERY_MS) {
            safeEnqueue(formatCollabRoomEventSse({ type: "room_ping", at: new Date().toISOString() }));
            lastPingAt = Date.now();
          }
          if (Date.now() - startedAt >= (maxDuration - 10) * 1000) {
            safeEnqueue(formatCollabRoomEventSse({ type: "room_closed", reason: "timeout" }));
            break;
          }
        }
        try { controller.close(); } catch { /* ignore */ }
      } catch (error) {
        try { controller.error(error); } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

**要点**：
- 成员被移出后，`listMessages` 会抛 `CollabRoomForbiddenError`（子 plan 02 的 FR-02-2）。此处必须把它当成「优雅收流 + `room_closed`」，而不是 500。这是「离开即失效」在实时链路上的体现。
- `cursor` 用 `Math.max` 推进，不要用 `batch[batch.length-1].seq` 直接赋值（空批次会越界）。

---

## 单测（`events/route.test.ts`）

mock `lib/session` 与 `lib/collab-room`。因为返回的是流，测试里读前几帧即可（用 `response.body!.getReader()` 读 1–3 个 chunk 后 `cancel()`）。

| 用例 | 断言 |
|---|---|
| `returns 401 without session` | status 401 |
| `returns 403 for non-member before opening a stream` | status 403，`content-type` 不是 `text/event-stream` |
| `returns 400 for invalid room id` | status 400 |
| `returns 400 for negative after_seq` | status 400 |
| `first frame is room_cursor with current last_seq` | 首帧解析出 `{type:"room_cursor", last_seq: 5}` |
| `pushes only messages with seq greater than cursor` | store 收到 `afterSeq` = 请求值；推出的帧 seq 递增 |
| `emits room_closed gone when membership is revoked mid-stream` | 第二轮 `listMessages` 抛 Forbidden → 帧为 `room_closed`/`gone`，且流正常结束（非 error） |
| `stops polling after client abort` | 用 `AbortController` abort 后，store 调用次数不再增长 |

---

## AC

- **AC-04-1**：`pnpm -C enterprise/apps/web-portal test` 全绿，含上表 8 个用例。
- **AC-04-2**：`pnpm -C enterprise typecheck` 通过。
- **AC-04-3**：真库联调：账号 A、B 都是成员，B 打开 `curl -N '.../api/rooms/{id}/events'`，A 发一条消息，B 在 **≤2s** 内收到 `event: room_message`。
- **AC-04-4**：A 把 B 移出后，B 的既有流在 ≤2s 内收到 `room_closed` 并结束，不出现 500。
- **AC-04-5**：`git diff --name-only` 只含本子 plan 落点清单的 4 个新文件。

---

## 扩容路径（本波次不实施，仅记录）

单实例足够时无需动。出现下列任一情况再升级：

| 触发条件 | 升级动作 |
|---|---|
| portal 多副本部署 | 轮询仍正确（每个副本各自查 DB），无需改造；只是 DB 查询量随连接数线性增长 |
| 房间数 × 在线人数导致 DB 压力明显 | 引入 Redis pub/sub：写入 `appendMessage` 后 publish `room:<id>`；SSE 侧订阅并把轮询间隔放大到 10s 作为兜底 |
| 需要 <200ms 延迟 | 同上，且把 `POLL_MS` 提到 5–10s，只靠 pub/sub 推送 |

**升级时不要删掉轮询兜底**——pub/sub 丢包时 `seq` 游标 + 轮询是唯一的自愈手段。
