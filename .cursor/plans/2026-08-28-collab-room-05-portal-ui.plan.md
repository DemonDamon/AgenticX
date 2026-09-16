# 协作房间 05 · 前台页面

Planned-with: claude-opus-5
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

**Master:** `.cursor/plans/2026-08-28-collab-room-master.plan.md`
**依赖:** 子 plan 03（API）；子 plan 04 可选（有则用 SSE，无则轮询）
**交付:** web-portal 新增 `/rooms` 页面：房间列表 + 房间对话 + 成员管理

---

## In scope

- 新路由 `/rooms`（列表）与 `/rooms/[roomId]`（房间内）
- 自带轻量状态（`useState` + `useEffect`），**不接入** `enterprise/features/chat` 的个人聊天 store
- 消息实时：优先订阅子 plan 04 的 SSE；失败回落 2 秒轮询 `?after_seq=`
- 成员面板：显示成员、添加成员（按 user id）、移出、离开房间

## Out of scope

- **修改 `enterprise/features/chat/src/**` 任何文件**（个人聊天 store 与组件）
- 把房间塞进现有「我的会话」侧栏列表
- 附件上传、@ 提及选择器、Markdown 富渲染优化（先用与个人聊天一致的现成渲染组件；若不能零改动复用则退化为纯文本 + 换行）
- 移动端专项适配（响应式够用即可）
- admin-console

---

## FR

- **FR-05-1**：未登录访问 `/rooms` 重定向到 `/auth`；`password_change_required` 重定向到 `/auth/change-password`。
- **FR-05-2**：列表显示调用者所在房间（标题、成员数、最后消息时间），可新建房间。
- **FR-05-3**：房间页显示历史消息，按 `seq` 升序；不同发送者（自己 / 他人 / Meta）视觉可区分。
- **FR-05-4**：发送消息后本地乐观插入，服务端返回后以服务端 `seq`/`id` 对齐；失败时保留输入内容并提示。
- **FR-05-5**：他人发送的消息在 ≤2s 内出现，无需手动刷新。
- **FR-05-6**：被移出房间后页面给出明确提示并可返回列表，不停在报错白屏。
- **FR-05-7**：所有面向用户文案为中文，且不含表名、路径、错误码原文。

---

## 落点清单（全部新建）

```
enterprise/apps/web-portal/src/app/rooms/page.tsx                 # 服务端鉴权 + 渲染列表 shell
enterprise/apps/web-portal/src/app/rooms/[roomId]/page.tsx        # 服务端鉴权 + 渲染房间 shell
enterprise/apps/web-portal/src/components/rooms/RoomListView.tsx  # "use client"
enterprise/apps/web-portal/src/components/rooms/RoomChatView.tsx  # "use client"
enterprise/apps/web-portal/src/components/rooms/RoomMembersPanel.tsx
enterprise/apps/web-portal/src/components/rooms/useRoomStream.ts  # SSE + 轮询回落 hook
enterprise/apps/web-portal/src/components/rooms/useRoomStream.test.ts
```

---

## 服务端页面骨架（照 `app/workspace/page.tsx:1-15`）

```tsx
import { redirect } from "next/navigation";
import { getWorkspaceSessionFromCookies } from "../../lib/session";
import { RoomListView } from "../../components/rooms/RoomListView";

export default async function RoomsPage() {
  const result = await getWorkspaceSessionFromCookies();
  if (result.status === "unauthenticated") redirect("/auth");
  if (result.status === "password_change_required") redirect("/auth/change-password");

  return <RoomListView currentUserEmail={result.session.email} />;
}
```

`/rooms/[roomId]/page.tsx` 同结构，动态段是 Promise：

```tsx
export default async function RoomPage(segmentData: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await segmentData.params;
  // …同样的鉴权三行…
  return <RoomChatView roomId={roomId} currentUserId={result.session.userId} />;
}
```

> `getWorkspaceSessionFromCookies()` 的返回形状（`status` 判别联合 + `session`）见 `app/workspace/page.tsx:6-14`。不要换成 `getSessionFromCookies()`，那个不带 `status` 分流。

---

## 实时 hook（`useRoomStream.ts`）

契约：

```ts
export type UseRoomStreamResult = {
  messages: CollabRoomMessage[];
  status: "connecting" | "live" | "polling" | "revoked" | "error";
  /** 乐观插入；返回服务端确认后的消息。 */
  send: (content: string) => Promise<void>;
};

export function useRoomStream(roomId: string): UseRoomStreamResult;
```

行为：

1. 挂载时 `GET /api/rooms/:roomId/messages` 拉全量（或最近 200 条），记录 `cursor = max(seq)`。
2. 用 `EventSource` 订阅 `/api/rooms/:roomId/events?after_seq=${cursor}`：
   - `room_message` → 按 `seq` 去重后追加（**必须去重**：乐观插入 + SSE 回推会重复）
   - `room_ping` → 仅更新心跳时间
   - `room_closed` reason `gone` → `status = "revoked"`，停止重连
   - `room_closed` reason `timeout` → 用最新 cursor 重新建连
   - `onerror` → 关闭 EventSource，切 `status = "polling"`，启动 2s 轮询
3. `send(content)`：先本地插入一条 `seq = Number.MAX_SAFE_INTEGER` 的临时消息（渲染排序时排最后），`POST /api/rooms/:roomId/messages`；成功用返回消息替换临时项；失败移除临时项并 throw 供 UI 提示。
4. 卸载时关闭 EventSource / 清 interval。

去重键用 `message.id`（服务端 ULID），不要用 `seq`（临时消息没有真 seq）。

`useRoomStream.test.ts` 覆盖（用 `vi.stubGlobal("EventSource", FakeEventSource)` + mock `fetch`）：

| 用例 | 断言 |
|---|---|
| `dedupes an optimistic message when the SSE echo arrives` | 最终 messages 里该 id 只出现一次 |
| `falls back to polling when EventSource errors` | status 变 `polling`，且开始周期性 fetch |
| `stops reconnecting when room_closed gone is received` | status 变 `revoked`，无后续 fetch |
| `reconnects with the latest cursor after room_closed timeout` | 新连接 URL 的 `after_seq` = 已收到的最大 seq |
| `keeps input recoverable when send fails` | `send` reject，且临时消息已从列表移除 |

---

## UI 要求（对齐既有偏好，避免返工）

- **中文文案**：「新建房间」「成员」「离开房间」「移出」「发送」「你已被移出该房间」。
- **主操作按钮**用主题层变量，不要硬编码颜色；跟随 `enterprise/packages/ui` 既有原语（`Button` / `Card` / `Input` / `Dialog` / `Avatar`）。**先看 `enterprise/packages/ui/src` 有没有现成组件再自己写。**
- **破坏性操作二次确认**用 `@agenticx/ui` 的 `Dialog`，**禁止 `window.confirm`**。
- **成员数与在线态不要混淆**：本波次没有 presence，成员数就是成员数，不要写「N 人在线」。
- **消息发送者区分**：自己右侧 / 他人左侧 + 显示名；Meta 用与分身不同的标识。
- 空态：无房间时给一句引导 + 新建按钮；不要留白屏。
- 长内容代码块渲染若复用既有 Markdown 组件，需保证 light/dark 都可读；若做不到零改动复用，本波次退化为纯文本（`whitespace-pre-wrap`），不要为此改动 `features/chat`。

---

## 导航入口

在现有前台导航里加一个「协作房间」入口。落点：`enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`（该文件是 `/workspace` 的 shell，导航定义在其中）。

**实施前先读该文件**确认导航项的数据结构，只**追加一项**，不要重排既有项、不要改其样式体系。若该文件里没有可扩展的导航数组（而是硬编码 JSX），则只加一个链接节点，同样不动其他项。

侧栏折叠态下若用 `size="icon"` 按钮，不要再叠 `w-full` + `justify-start`（会导致图标不居中）。

---

## AC

- **AC-05-1**：`pnpm -C enterprise typecheck` 与 `pnpm -C enterprise build` 通过。
- **AC-05-2**：`pnpm -C enterprise/apps/web-portal test` 全绿，含 `useRoomStream.test.ts` 5 个用例。
- **AC-05-3**：真库双账号手测（`bash enterprise/scripts/start-dev-with-infra.sh`）：
  1. A 在 `/rooms` 新建房间 → 列表出现
  2. A 进房发言 → 气泡出现在右侧
  3. A 把 B 加为成员；B 在另一浏览器 profile 登录 → `/rooms` 能看到该房间
  4. A 再发一条 → B 页面 **≤2s** 自动出现，无需刷新
  5. B 发一条 → A 页面同样自动出现
  6. A 移出 B → B 页面提示「你已被移出该房间」，可点返回列表
- **AC-05-4**：`git diff --name-only | grep 'features/chat'` 无输出（FR/Out of scope 兜底）。
- **AC-05-5**：房间页面任何可见文案中不含 `enterprise_collab`、表名、文件路径、`40301` 等原始错误码。
- **AC-05-6**：三态主题（system/亮/暗）下房间页可读，无硬编码深色背景导致亮色主题不可用。

---

## 风险与对策

| 风险 | 对策 |
|---|---|
| 乐观插入 + SSE 回推导致消息重复 | 按 `id` 去重，专门单测 |
| 误改 `features/chat` 造成个人聊天回归 | AC-05-4 |
| EventSource 在 Next dev 下频繁重连刷屏 | `onerror` 后先关闭再回落轮询，不要无限重试 |
| 导航改动波及既有布局 | 只追加一项，不重排不改样式 |
| 复用 UI 原语时改动 `packages/ui` | 本子 plan 不允许修改 `packages/ui`；缺组件就在 `components/rooms/` 内本地实现 |
