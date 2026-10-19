# 项目协作 P3：本机副本、离线发送与断线续拉

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-19-project-collaboration-space.plan.md`
Depends-on: P0（`client_msg_id` 幂等）、P2（`CollabRoomConversation`、项目详情）

## 目标

项目与群的数据以云端为准，桌面端本机留一份副本：

- 断网时能打开已同步过的项目和群，看到历史消息。
- 断网时能继续发消息，消息标「待发送」；联网后按顺序自动补发，云端不会出现重复。
- 断线重连后从本机最后一条的序号继续拉，不重拉整段历史。

## 现状（已核实）

- 桌面主进程没有 SQLite 依赖（Electron 34 内置 Node 20，无 `node:sqlite`；仓库也未引入 `better-sqlite3`）。本期**用 JSON 文件**做本机副本，不引入原生模块。
- 发送：IPC `collab-room-send`（`desktop/electron/main.ts` L8018–8105 区域）→ `collab-room-client.ts` 的 `sendMessage(deps, roomId, content)`，POST `/api/desktop/rooms/:id/messages`。
- 历史：IPC `collab-room-messages` → `listMessages(deps, roomId, {afterSeq, limit})`。
- 订阅：IPC `collab-room-watch` → `streamRoomEvents`，事件 `room_cursor{last_seq}`、`room_message{message}`、`room_ping`、`room_closed{reason}`；退避 1/2/5 秒，最多 5 次；推送 `collab-room-event {roomId, event}`。
- 后端（P0）：POST messages 接受 `client_msg_id`，同一 `(room_id, client_msg_id)` 重复提交返回原消息。
- 渲染层：`desktop/src/components/collab/CollabRoomConversation.tsx`（P2 拆出）负责历史加载、订阅与发送。

## 改动

### 1. 本机副本存储（新文件 `desktop/electron/collab-cache.ts`）

目录 `~/.agenticx/collab-cache/`：

| 文件 | 内容 |
|---|---|
| `projects.json` | 最近一次 `listProjects` 结果 + `fetched_at` |
| `projects/<project_id>.json` | 最近一次 `getProject` 结果 + `fetched_at` |
| `rooms/<room_id>.jsonl` | 每行一条已确认消息（服务端返回的完整消息对象），按 `seq` 升序；同一 `seq` 不重复写 |
| `outbox.jsonl` | 每行一条待发送：`{client_msg_id, room_id, content, created_at, attempts, last_error}` |

导出函数：

```ts
export function readProjectsCache(): { projects: unknown[]; fetched_at: number } | null;
export function writeProjectsCache(projects: unknown[]): void;
export function readProjectCache(projectId: string): unknown | null;
export function writeProjectCache(projectId: string, detail: unknown): void;
export function readRoomMessages(roomId: string, limit?: number): CachedRoomMessage[]; // 末尾 limit 条，默认 500
export function appendRoomMessages(roomId: string, messages: CachedRoomMessage[]): void; // 按 seq 去重后追加；超过 2000 条时保留最新 2000 条重写文件
export function maxCachedSeq(roomId: string): number;   // 无缓存返回 0
export function enqueueOutbox(item: OutboxItem): void;
export function listOutbox(roomId?: string): OutboxItem[];
export function removeOutbox(clientMsgId: string): void;
export function markOutboxFailed(clientMsgId: string, error: string): void; // attempts+1
```

所有写操作先写 `.tmp` 再 `rename`；`roomId`、`projectId` 只允许 `[0-9A-Za-z]{26}`（ULID），否则抛错，防止路径穿越。

### 2. 发送改为「先入队再发」

`main.ts` 的 `collab-room-send` 处理改为：

1. 入参新增 `clientMsgId?: string`；为空时主进程用 `crypto.randomUUID()` 生成。
2. `enqueueOutbox({client_msg_id, room_id, content, created_at: Date.now(), attempts: 0})`。
3. 立即调用 `sendMessage(deps, roomId, content, clientMsgId)`（`collab-room-client.ts` 的 `sendMessage` 增加第 4 个参数，写入请求体 `client_msg_id`）。
4. 成功：`removeOutbox`、`appendRoomMessages(roomId, [message])`，返回 `{ok:true, data:{message}}`。
5. 失败（网络错误、超时、5xx）：`markOutboxFailed`，返回 `{ok:true, data:{pending:true, client_msg_id}}`。
6. 失败（4xx，如 403 / 400）：`removeOutbox`，返回 `{ok:false, error}`（不重试，内容本身有问题）。

### 3. 自动补发

`collab-cache.ts` 旁新增 `desktop/electron/collab-outbox-flusher.ts`：

- `startOutboxFlusher(getDeps)`：每 10 秒、以及收到 `room_cursor` 事件时（说明连接恢复）触发一次 `flush()`。
- `flush()`：按 `created_at` 升序逐条发送（同一时刻只有一个 flush 在跑）；成功则移出队列并写入房间缓存，同时向渲染层推 `collab-room-event {roomId, event:{type:"outbox_sent", client_msg_id, message}}`；网络类失败立即停止本轮（保持顺序）；4xx 移出队列并推 `{type:"outbox_failed", client_msg_id, error}`。
- `app.whenReady()` 后调用 `startOutboxFlusher`；企业未登录时 `flush()` 直接返回。

### 4. 读取与续拉

- `collab-room-messages`：先返回 `readRoomMessages(roomId)` 作为 `cached`，再向服务端请求 `afterSeq = maxCachedSeq(roomId)`，新消息 `appendRoomMessages` 后一并返回；返回体 `{ok:true, data:{messages, from_cache: boolean}}`，`messages` 为合并后的完整列表（缓存 + 新增，按 `seq` 升序）。服务端不可达时返回缓存并 `from_cache:true`。
- `collab-room-watch`：订阅的 `after_seq` 使用 `maxCachedSeq(roomId)`；每收到 `room_message` 先 `appendRoomMessages` 再推给渲染层。
- `collab-project-list` / `collab-project-get`：成功时写缓存；失败（网络类）时返回缓存并带 `from_cache:true`；无缓存才返回错误。
- 新增 IPC `collab-outbox-list {roomId}` → `listOutbox(roomId)`，供渲染层显示待发送消息。

### 5. 渲染层

`CollabRoomConversation.tsx`：

- 发送时先生成 `clientMsgId = crypto.randomUUID()`，立即在列表末尾插入一条本地消息（`status:"pending"`，显示「待发送」灰色小字与转圈）；调用 `collabRoomSend(roomId, text, clientMsgId)`。
  - 返回 `message`：用服务端消息替换本地消息（按 `client_msg_id` 匹配）。
  - 返回 `pending`：保持「待发送」。
  - 返回错误：标为「发送失败」，旁边「重试」按钮（重新调用发送，沿用同一 `clientMsgId`）。
- 监听 `outbox_sent` / `outbox_failed` 事件更新对应本地消息。
- 打开群时调用 `collabOutboxList(roomId)`，把仍在队列里的消息以「待发送」显示在末尾。
- 收到服务端 `room_message` 时，若其 `client_msg_id` 与某条本地消息相同，替换而不是新增（防止补发成功后出现两条）。
- `data.from_cache === true` 时，项目详情顶栏同步状态显示灰点「离线，已缓存」。

## In scope / Out of scope

- In：上述缓存、队列、补发、续拉、界面状态。
- Out：消息编辑与撤回的冲突处理；附件离线上传；本机 AI 会话的上云；缓存加密。
- no-scope-creep：不改服务端接口；不改非云房间的本机会话存储。

## 验收

- AC-1：`desktop/tests/collab-cache.test.ts`（用临时目录覆盖 home）：
  - `appendRoomMessages` 同一 `seq` 写两次只保留一条；超过 2000 条只留最新 2000；`maxCachedSeq` 正确。
  - 非法 `roomId`（含 `../`）抛错。
  - outbox 入队、标失败、移除。
- AC-2：`desktop/tests/collab-outbox-flusher.test.ts`（mock `sendMessage`）：
  - 三条待发送按入队顺序发出。
  - 第 2 条网络失败时本轮停止，第 3 条未发；下一轮从第 2 条继续。
  - 4xx 的那条被移出并发出 `outbox_failed`。
- AC-3：`CollabRoomConversation` 测试：本地 pending 消息在收到同 `client_msg_id` 的 `room_message` 后被替换，列表里只有一条。
- AC-4：`npx tsc -p electron/tsconfig.json`、`npx tsc --noEmit -p tsconfig.json`、`npm test` 通过。
- AC-5（手工，Opus 验收）：打开项目主群 → 关闭网络 → 发 3 条（显示「待发送」，顶栏「离线，已缓存」）→ 重启应用仍能看到历史与 3 条待发送 → 恢复网络 → 3 条依次变为已发送；另一账号看到恰好 3 条且顺序一致。
