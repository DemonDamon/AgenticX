# C3-02 · Electron 主进程房间桥（IPC + PAT 出网 + SSE 消费）

Planned-with: claude-opus-5
Suggested-Impl-Model: 强推理档（如 GPT-5.x）

**父规划：** `.cursor/plans/2026-08-29-collab-room-c3-master.plan.md`
**前置：** 子 plan 01 已实施（portal 侧 `/api/desktop/rooms/*` 可用）。

**Goal:** 渲染进程能读写云房间，但一次出网请求都不由渲染进程直接发。主进程持 PAT、走 `proxyAwareFetch`、消费 SSE，把解析好的事件推给渲染进程。

---

## 一、为什么必须由主进程代理

1. **PAT 不能进渲染进程。** `~/.agenticx/config.yaml` 的 `enterprise.token` 是长期凭据，渲染进程拿到就等于暴露在页面上下文里。既有的 `enterprise-sync-capabilities`（`desktop/electron/main.ts:6839`）也是这个形状：主进程读 token、主进程出网。
2. **代理与网络行为必须与 `agx serve` 对齐。** Electron 主进程的 `globalThis.fetch` 是 Chromium 的 `net.fetch`，不读 `HTTPS_PROXY`。仓库已封 `proxyAwareFetch`（`desktop/electron/proxy-fetch.ts:63`，内部用 undici + `ProxyAgent`）。**所有对门户的请求必须用 `proxyAwareFetch`，禁止裸 `fetch`。**
3. **CORS。** portal 没给 `/api/desktop/*` 配跨源响应头，渲染进程直连必然被拦。不要为此去改 portal 加 CORS。

---

## 二、可直接信任的现状

| 件 | 精确位置 | 形状 |
|---|---|---|
| 企业配置 | `desktop/electron/main.ts` `type AgxConfig` 的 `enterprise?` 字段（约 L323–330） | `{ enabled?, base_url?, token?, capabilities?, managed_mcp_servers?, managed_skills? }` |
| 判断是否已配企业 PAT | `desktop/electron/enterprise-capabilities-sync.ts:36` | `hasEnterprisePat(cfg)`；已在 `main.ts:62` import |
| 配置读写 | `desktop/electron/main.ts` 的 `loadAgxConfig()` / `saveAgxConfig(cfg)` | 同文件内既有函数 |
| 代理感知 fetch | `desktop/electron/proxy-fetch.ts:63` | `proxyAwareFetch(input, init?)`；`main.ts:57` 已 import |
| PAT 出网范例（照抄 header 与超时姿势） | `desktop/electron/main.ts:2014-2033` `scheduleEnterpriseCapabilitySync()` | `proxyAwareFetch(\`${portal}/api/desktop/bootstrap\`, { headers: { Authorization: \`Bearer ${token}\` }, signal: AbortSignal.timeout(15_000) })`；`portal` 取 `cfg.enterprise?.base_url` 并 `.replace(/\/+$/, "")` |
| IPC 注册区 | `desktop/electron/main.ts:6839` | `ipcMain.handle("enterprise-sync-capabilities", ...)`，新 handler 紧邻其后注册 |
| preload 暴露 | `desktop/electron/preload.ts:67-68` | `enterpriseSyncCapabilities: async () => ipcRenderer.invoke("enterprise-sync-capabilities")` |
| 渲染进程类型 | `desktop/src/global.d.ts:485-499` | `interface Window { agenticxDesktop: { ... } }`，`enterpriseSyncCapabilities` 在 L489 |
| 主进程模块单测范例 | `desktop/tests/enterprise-capabilities-sync.test.ts` | `npm -C desktop test` 跑 `vitest run src tests` |

---

## 三、落点清单

```
desktop/electron/collab-room-client.ts        (新增：纯函数 + fetch 注入，可单测)
desktop/tests/collab-room-client.test.ts      (新增)
desktop/electron/main.ts                      (改：仅新增 import 与 IPC handler 块)
desktop/electron/preload.ts                   (改：仅新增 collabRoom* 方法)
desktop/src/global.d.ts                       (改：仅新增 collabRoom* 类型声明)
```

**对 `main.ts` 的改动纪律：** 该文件超长且敏感。只允许 (a) 在既有 import 区**新增一行** import，(b) 在 `ipcMain.handle("enterprise-sync-capabilities", ...)`（L6839）**之后**整块追加新 handler。**禁止**用「整段替换」方式覆盖相邻代码——仓库有过在无关改动中误删一行 import 导致启动即崩的事故。改完对照 `git diff desktop/electron/main.ts`，逐行确认只有新增。

---

## 四、FR

### FR-02-1 · 新模块 `desktop/electron/collab-room-client.ts`

导出一个可注入依赖的客户端，便于单测（不 import electron、不读磁盘）：

```ts
export type CollabRoomClientDeps = {
  baseUrl: string;                 // 已去尾斜杠的门户地址
  token: string;                   // agx-pat-*
  fetchImpl?: typeof fetch;        // 默认由 main.ts 传入 proxyAwareFetch
};

export type CollabRoomEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
```

必须导出的函数：

- `normalizePortalBase(raw: unknown): string` —— trim + 去尾部 `/`；空值返回 `""`
- `listRooms(deps): Promise<CollabRoomEnvelope<{ rooms: unknown[] }>>` → `GET {base}/api/desktop/rooms`
- `getRoom(deps, roomId): Promise<CollabRoomEnvelope<{ room: unknown; members: unknown[] }>>` → `GET {base}/api/desktop/rooms/{roomId}`
- `listMessages(deps, roomId, opts: { afterSeq?: number; limit?: number }): Promise<CollabRoomEnvelope<{ messages: unknown[] }>>`
- `sendMessage(deps, roomId, content: string): Promise<CollabRoomEnvelope<{ message: unknown }>>` → `POST .../messages`，body `{ content }`
- `parseSseChunk(buffer: string): { events: Array<{ type: string; data: unknown }>; rest: string }` —— 按空行切帧，解析 `event:` 与 `data:` 两行；**不完整的尾帧留在 `rest` 里**，下一次拼接继续解析
- `streamRoomEvents(deps, roomId, handlers, signal): Promise<void>` —— 消费 `GET .../events?after_seq=`，逐块喂给 `parseSseChunk`，把每个事件交给 `handlers.onEvent`；流结束或出错时交给 `handlers.onClosed(reason)`

统一规则：

- 所有请求带 `Authorization: Bearer ${deps.token}`、`accept: application/json`（SSE 那条用 `accept: text/event-stream`）
- 非 2xx → `{ ok: false, error }`，`error` 用**面向用户的中文短句**，按状态码映射：401 → `"企业登录已失效，请重新登录"`；403 → `"你已被移出该房间"`；404 → `"房间不存在"`；其它 → `"云房间服务暂时不可用"`。**禁止**把 URL、门户地址、表名、PAT 拼进 `error`
- 非 SSE 请求超时 `AbortSignal.timeout(15_000)`

### FR-02-2 · 主进程 IPC

在 `desktop/electron/main.ts` 的 L6839 之后追加。先加一个内部小函数解析当前企业配置：

```ts
// 返回 null 表示「未配置企业账号」，调用方据此给渲染进程明确空态，而不是抛错。
function resolveCollabRoomDeps(): { baseUrl: string; token: string } | null {
  const cfg = loadAgxConfig();
  if (!hasEnterprisePat(cfg)) return null;
  const baseUrl = normalizePortalBase(cfg.enterprise?.base_url);
  const token = String(cfg.enterprise?.token ?? "").trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}
```

handler 清单（全部返回 `{ ok, data? , error? }`，`ok: false` 时 `error` 是中文短句）：

| channel | 入参 | 行为 |
|---|---|---|
| `collab-room-list` | 无 | 未配置企业 → `{ ok: false, error: "未登录企业账号，无法加载云房间" }`；否则转 `listRooms` |
| `collab-room-get` | `roomId: string` | 转 `getRoom` |
| `collab-room-messages` | `roomId: string, opts?: { afterSeq?: number; limit?: number }` | 转 `listMessages` |
| `collab-room-send` | `roomId: string, content: string` | 转 `sendMessage` |
| `collab-room-watch` | `roomId: string` | 启动该 `roomId` 的事件流；**同一 roomId 重复调用先停旧流再起新流**；返回 `{ ok: true }` |
| `collab-room-unwatch` | `roomId: string` | 停止该流 |

`collab-room-watch` 的推送与生命周期：

- 主进程维护 `const roomWatchers = new Map<string, AbortController>()`
- 收到事件后用 `event.sender.send("collab-room-event", { roomId, event })` 推给发起方的 `webContents`
- 流异常结束时先推 `{ roomId, event: { type: "room_closed", reason: "retry" } }`，再**自动重连**：退避 `1s → 2s → 5s`，上限 5 次；每次重连用当前已知的最大 `seq` 作 `after_seq`（由 handler 内维护，不信任渲染进程传值）
- 收到 `room_closed`/`gone` 时**不重连**，直接清理 watcher（成员已被移出）
- `app.on("before-quit")` 与对应 `webContents` 的 `destroyed` 事件里 abort 全部 watcher，避免退出后残留请求

### FR-02-3 · preload 暴露

`desktop/electron/preload.ts` 在 L68 之后追加（保持既有风格，不改其它行）：

```ts
collabRoomList: async () => ipcRenderer.invoke("collab-room-list"),
collabRoomGet: async (roomId: string) => ipcRenderer.invoke("collab-room-get", roomId),
collabRoomMessages: async (roomId: string, opts?: { afterSeq?: number; limit?: number }) =>
  ipcRenderer.invoke("collab-room-messages", roomId, opts),
collabRoomSend: async (roomId: string, content: string) =>
  ipcRenderer.invoke("collab-room-send", roomId, content),
collabRoomWatch: async (roomId: string) => ipcRenderer.invoke("collab-room-watch", roomId),
collabRoomUnwatch: async (roomId: string) => ipcRenderer.invoke("collab-room-unwatch", roomId),
onCollabRoomEvent: (cb: (payload: { roomId: string; event: { type: string; [k: string]: unknown } }) => void) => {
  const listener = (_e: unknown, payload: never) => cb(payload);
  ipcRenderer.on("collab-room-event", listener as never);
  return () => ipcRenderer.removeListener("collab-room-event", listener as never);
},
```

`onCollabRoomEvent` 必须返回取消订阅函数（与既有 `onStudioReady` / `onConnectionModeChanged` 的约定一致，见 `desktop/src/global.d.ts:496-497`），否则渲染进程组件卸载后会泄漏监听。

### FR-02-4 · 渲染进程类型声明

`desktop/src/global.d.ts` 在 `interface Window.agenticxDesktop` 内追加与 FR-02-3 一一对应的方法签名。房间数据形状用**桌面端自己的** type，写在同文件或新建 `desktop/src/types/collab-room.ts`，字段照 portal 返回的下划线命名（`room_id` / `sender_type` / `sender_name` / `seq` / `last_seq` / `member_count` / `member_type` / `display_name` / `room_role`）。**禁止**从 `enterprise/` 目录跨仓 import 类型。

---

## 五、单测 `desktop/tests/collab-room-client.test.ts`

只测 `collab-room-client.ts`（不起 Electron）。用注入的 `fetchImpl` 假返回。

| 用例 | 断言 |
|---|---|
| `normalizePortalBase trims and drops trailing slashes` | `"  https://p.example.com//  "` → `"https://p.example.com"`；`undefined` → `""` |
| `listRooms sends the PAT as a bearer token` | 捕获的 init.headers.authorization === `Bearer agx-pat-test` |
| `sendMessage posts only the content field` | 请求 body 解析后只有 `content` 一个 key |
| `maps 401 to a re-login message` | `{ ok: false, error: "企业登录已失效，请重新登录" }` |
| `maps 403 to a removed-from-room message` | `{ ok: false, error: "你已被移出该房间" }` |
| `error messages never leak the portal url or token` | 各状态码下 `error` 不含 `"http"`、不含 `"agx-pat"` |
| `parseSseChunk parses a complete frame` | 输入 `"event: room_message\ndata: {\"seq\":3}\n\n"` → 1 个事件，`type === "room_message"`，`rest === ""` |
| `parseSseChunk keeps an incomplete tail for the next chunk` | 输入被截断在 `data:` 中间 → `events` 为空，`rest` 等于原串 |
| `parseSseChunk handles two frames in one chunk` | 返回 2 个事件，顺序与输入一致 |
| `streamRoomEvents forwards parsed events in order` | 用一个 `ReadableStream` 分 3 块喂入，`onEvent` 按 seq 顺序收到 |
| `streamRoomEvents reports closed when the body ends` | `onClosed` 被调用一次 |

---

## 六、AC

- **AC-02-1**：`npm -C desktop test` 全绿，含上表 11 个用例。
- **AC-02-2**：`npx tsc -p desktop/electron/tsconfig.json --noEmit`（或 `npm -C desktop run build` 的 tsc 阶段）通过。
- **AC-02-3**：`git diff desktop/electron/main.ts` **只有新增行，没有删除行**（`git diff --numstat desktop/electron/main.ts` 的删除计数为 0）。这是该文件的硬门槛。
- **AC-02-4**：改完主进程后**完全退出并重启** `npm -C desktop run dev`（⌘Q 或 Ctrl+C 重启；只刷新渲染进程不会加载新 IPC handler）。启动后主进程无异常日志。
- **AC-02-5**：在渲染进程 DevTools 控制台手验（企业账号已登录、`enterprise.base_url` 指向本机 portal）：
  ```js
  await window.agenticxDesktop.collabRoomList()
  ```
  返回 `{ ok: true, data: { rooms: [...] } }`，其中含 portal 侧那间房。
- **AC-02-6**：未配置企业 PAT 时，同一调用返回 `{ ok: false, error: "未登录企业账号，无法加载云房间" }`，主进程不抛未捕获异常。
- **AC-02-7**：`collab-room-watch` 后浏览器侧发一条，DevTools 里 `onCollabRoomEvent` 回调在 ≤2s 内收到 `room_message`；`collab-room-unwatch` 后不再有推送（主进程日志无持续请求）。
- **AC-02-8**：整轮验证后 `ls ~/.agenticx/sessions` 无新增承载云房间消息的目录（M5）。

---

## 七、In scope / Out of scope

**In scope：** 落点清单里的 5 个文件（2 新增 + 3 处仅追加）。

**Out of scope：**

- 任何渲染进程 UI（子 plan 03）
- 改 `remote_server` 语义或复用它承载云房间
- 改本机群聊、`SessionHistoryPanel`、`agenticx/` 下任何 Python 代码
- 把云房间消息写入本机 session / 记忆 / FTS
- 改 portal 侧接口（子 plan 01 已定型）
- 在渲染进程直接 fetch 门户

---

## 八、易错点

| 坑 | 规避 |
|---|---|
| 用裸 `fetch` 打门户 | 必须 `proxyAwareFetch`；Electron 主进程 `globalThis.fetch` 是 Chromium 的，不读 `HTTPS_PROXY` |
| `undici` 版本 | 仓库把 undici 钉在 `^6.x`（7.x 在 Electron 内置 Node 20 上 require 即崩）。本子 plan **不要**动 `desktop/package.json` 的 undici 版本 |
| PAT 传进渲染进程 | 所有出网在主进程；IPC 返回值里不带 token |
| SSE 帧被 chunk 边界切断 | `parseSseChunk` 必须返回 `rest` 并在下一块拼接，单测已覆盖 |
| watcher 泄漏 | Map + AbortController，`before-quit` 与 `webContents` destroyed 时全部 abort |
| 被移出后疯狂重连 | `room_closed`/`gone` 不重连；只有异常断流才退避重连 |
| 整段替换误删 `main.ts` 相邻代码 | AC-02-3 用删除行数为 0 兜底 |
| 只刷新渲染进程验 IPC | 必须完全重启 dev（AC-02-4） |
| 主进程 IPC 报错把原始异常抛给渲染进程 | 统一转成中文短句，日志里也不打 URL / token |
