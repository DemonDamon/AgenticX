# C3-03 · Near 桌面端「云房间」界面

Planned-with: claude-opus-5
Suggested-Impl-Model: Composer 2.5 / Fast 档

**父规划：** `.cursor/plans/2026-08-29-collab-room-c3-master.plan.md`
**前置：** 子 plan 01（portal PAT 接口）与 02（主进程 IPC 桥）已实施。

**Goal:** 桌面端多一个「云房间」入口，点开就是 portal 里那间房：同一份历史、同一条 `seq`、发言两边互见。

---

## 一、形态选择：独立覆盖面板，不动 pane 状态机

桌面端有两种可选落法：

| 方案 | 代价 |
|---|---|
| 新增一种 pane kind，接进 `PaneManager` / `ChatPane` | 要碰多窗格状态机、session 绑定、侧栏 tab 枚举（`SidePanelTab`）、localStorage 快照迁移。回归面极大 |
| **独立覆盖面板（本子 plan 采用）** | 自成一体，一个 store 开关 + 一个组件；不碰 pane、不碰 session、不碰历史面板 |

仓库已有现成范例照抄：`TokenDashboardPanel`。

- store 开关：`desktop/src/store.ts:2554-2561` 的 `openTokenDashboard` / `closeTokenDashboard`
- 挂载点：`desktop/src/App.tsx:2512` `<TokenDashboardPanel open={tokenDashboardOpen} onClose={() => closeTokenDashboard()} />`
- 订阅：`desktop/src/App.tsx:333-334`
- 顶栏按钮：`desktop/src/components/Topbar.tsx:120-128`（`agx-topbar-btn agx-topbar-btn--icon-only` + lucide 图标 + `title` / `aria-label`）

**云房间与本机会话是两套东西（M5），所以它不进「历史会话」面板、不进分身侧栏的会话列表、不创建任何本机 session。**

---

## 二、落点清单

```
desktop/src/components/CollabRoomPanel.tsx        (新增：覆盖面板，列表 + 房间聊天)
desktop/src/utils/collab-room-view.ts             (新增：纯函数，可单测)
desktop/src/utils/collab-room-view.test.ts        (新增)
desktop/src/store.ts                              (改：仅新增 collabRooms 开关与两个 action)
desktop/src/App.tsx                               (改：仅新增 import、两行订阅、一处挂载)
desktop/src/components/Topbar.tsx                 (改：仅新增一个图标按钮)
```

**改动纪律：** 三个既有文件都只允许追加，禁止重排既有代码。`store.ts` 与 `App.tsx` 体量大，改完用 `git diff --numstat` 确认删除行数为 0（除非是被追加逗号的那一行）。

---

## 三、FR

### FR-03-1 · store 开关

`desktop/src/store.ts`：

- 在 state 里加 `collabRooms: { open: boolean }`，初值 `{ open: false }`（放在 `tokenDashboard` 初值附近）
- 接口声明处（`openTokenDashboard` 声明的 L852 附近）加 `openCollabRooms: () => void;` / `closeCollabRooms: () => void;`
- 实现照抄 L2554-2561 的形状

### FR-03-2 · 顶栏入口

`desktop/src/components/Topbar.tsx`：在 Token 看板按钮（L120-128）**之后**追加一个按钮：

- 图标：lucide `Users`
- `title` / `aria-label`：`"云房间"`
- `onClick`：`() => openCollabRooms()`
- className 与相邻按钮完全一致（`agx-topbar-btn agx-topbar-btn--icon-only`）

不要在分身侧栏另开入口；一个入口就够，避免两处状态。

### FR-03-3 · 纯函数模块 `desktop/src/utils/collab-room-view.ts`

把可测逻辑从组件里挪出来（组件层无 RTL，沿用仓库既有做法：逻辑进 utils + 单测）：

- `firstScreenAfterSeq(lastSeq: number, want = 100): number` → `Math.max(0, lastSeq - want)`
  这是父 plan 与子 plan 01 FR-01-4 约定的「取最后 N 条」姿势：先拿 `room.last_seq`，再用它算 `after_seq`。**不要**在桌面端实现倒序分页。
- `upsertBySeq(list: RoomMessage[], incoming: RoomMessage): RoomMessage[]` → 按 `id` 去重覆盖后按 `seq` 升序排序
- `nextCursor(list: RoomMessage[]): number` → 列表里最大 `seq`；空列表返回 0
- `bubbleKind(message: RoomMessage, currentUserId: string): "self" | "other" | "meta" | "system"` → `system` / `meta` 优先，其次 `sender_id === currentUserId` 为 `self`
- `visibleContent(content: string): string` → 剥掉 `<think>…</think>`（`/<think>[\s\S]*?<\/think>/gi`），剥完为空则回退原文 trim。**必须有**：房间里 Meta 的回复可能带思考块，C1 的浏览器端已经这么处理（`enterprise/apps/web-portal/src/components/rooms/RoomChatView.tsx` 的 `visibleMessageContent`），两端展示口径要一致
- `statusLabel(status: "connecting" | "live" | "retrying" | "revoked" | "error"): string` → 分别返回 `"连接中"` / `"实时"` / `"重连中"` / `"你已被移出该房间"` / `"云房间服务暂时不可用"`

### FR-03-4 · 面板组件 `desktop/src/components/CollabRoomPanel.tsx`

props：`{ open: boolean; onClose: () => void }`。`open === false` 时返回 `null`（不预挂载、不预拉数据）。

打开时的加载顺序：

1. `window.agenticxDesktop.collabRoomList()`
   - `ok: false` → 面板内联展示 `error`（中文短句，来自主进程），并给一个「重试」按钮。未登录企业账号时 `error` 就是「未登录企业账号，无法加载云房间」，这时**不显示重试**，改显示一行引导「请先在设置里完成企业登录」（不写具体路径、不写地址）
   - `ok: true` 且 `rooms` 为空 → 空态「还没有云房间。请在企业门户里创建或让同事把你加进来。」（C3 桌面端不做建房，见 Out of scope）
2. 用户点某个房间 → `collabRoomGet(roomId)` 拿 `{ room, members }`
3. 用 `firstScreenAfterSeq(room.last_seq)` 调 `collabRoomMessages(roomId, { afterSeq, limit: 200 })` 拿首屏
4. `collabRoomWatch(roomId)` 开始订阅；`onCollabRoomEvent` 里按 `payload.roomId === 当前房间` 过滤后处理：
   - `room_message` → `upsertBySeq`
   - `room_closed` + `reason === "gone"` → 状态置 `revoked`，正文区替换为「你已被移出该房间」+「返回房间列表」按钮，并从本地房间列表移除该房间
   - `room_closed` + `reason === "retry"` → 状态置 `retrying`（主进程会自动重连，前端不要自己再起一套重连）
   - `room_ping` / `room_cursor` → 只更新连接状态，不进消息列表

布局与交互：

- 左列房间列表（约 240px，`shrink-0`），右列聊天区 `flex-1 min-w-0 min-h-0`；成员**只读**展示在聊天区顶部（如「3 名成员」+ 名字，点不动）
- 消息气泡：自己右对齐用主题主色，他人左对齐，Meta 用带边框的浅底，system 居中小字；正文一律走 `visibleContent()`
- 输入区：`Enter` 发送，发送中禁用输入并把 placeholder 换成「发送中…」；乐观插入一条 `id` 为 `temp-*` 的消息，成功后用服务端返回的 `message` 按 `id` 替换，失败则移除乐观消息并在输入区下方显示错误
- 关闭面板或切换房间时必须 `collabRoomUnwatch(上一个 roomId)`，并调用 `onCollabRoomEvent` 返回的取消订阅函数（组件卸载时同样要调）
- 所有文案硬编码中文；破坏性操作本子 plan 没有，所以不需要确认弹窗
- 主题：只用既有主题 token（`bg-surface-*` / `text-text-*` / `border-border-*` 等，参照 `TokenDashboardPanel` 与 `SessionHistoryPanel` 的用法），**禁止**硬编码十六进制颜色

`currentUserId` 的来源：用 `collabRoomGet(roomId)` 返回的 `data.viewer_user_id`（子 plan 01 FR-01-3 已规定 portal 侧返回该字段，02 原样透传）。桌面端没有 portal 会话，不能自行推断自己的 `users.id`，也**不要**去猜「members 里哪个是我」。

若实施时发现 01/02 未返回该字段，先回去补齐 01/02，不要在 UI 层用启发式绕过。

---

## 四、单测 `desktop/src/utils/collab-room-view.test.ts`

| 用例 | 断言 |
|---|---|
| `firstScreenAfterSeq keeps the last N messages` | `(350, 100)` → `250`；`(30, 100)` → `0`；`(0, 100)` → `0` |
| `upsertBySeq replaces by id and sorts by seq` | 先插 seq 3 再插 seq 1，结果顺序 `[1, 3]`；同 `id` 再插入不产生重复项 |
| `upsertBySeq replaces an optimistic message by id` | 先插 `id: "temp-1"`，再插同 `id` 的服务端版本 → 长度仍为 1 |
| `nextCursor returns the max seq` | `[{seq:2},{seq:5}]` → 5；`[]` → 0 |
| `bubbleKind marks my own messages as self` | `sender_id === currentUserId` → `"self"` |
| `bubbleKind marks meta and system first` | `sender_type: "meta"` 即使 `sender_id === currentUserId` 也返回 `"meta"`；`system` 同理 |
| `visibleContent strips think blocks` | `"<think>推理</think>\n对外"` → `"对外"` |
| `visibleContent falls back when everything is a think block` | `"<think>只有推理</think>"` → 原文 trim，不返回空串 |
| `statusLabel maps revoked to a removal notice` | `"revoked"` → `"你已被移出该房间"` |

---

## 五、AC

- **AC-03-1**：`npm -C desktop test` 全绿，含上表 9 个用例。
- **AC-03-2**：`npm -C desktop run build` 的 tsc 阶段通过（或 `npx tsc -p desktop/tsconfig.json --noEmit`，按仓库现状选可用的那个）。
- **AC-03-3**：`git diff --numstat desktop/src/store.ts desktop/src/App.tsx desktop/src/components/Topbar.tsx` 的删除行数为 0（或仅为追加逗号所致的 1 行）。
- **AC-03-4**：手测（前置：portal 与 gateway 已起，桌面端已完成企业登录，portal 侧已有一间含该账号的房间）：
  1. 顶栏点「云房间」→ 面板打开，列表出现该房间与成员数
  2. 点进房间 → 历史与浏览器里逐条一致（条数与顺序都对）；Meta 那条**不含** `<think>`
  3. 浏览器发一条 → 桌面端 ≤2s 出现
  4. 桌面端发一条 → 浏览器 ≤2s 出现，且气泡在桌面端是右对齐（`self` 判定对）
  5. 桌面端发 `@Meta 一句话介绍这个房间` → 房间里出现**一条** Meta 回复（不是两条，证明只有 portal 触发）
  6. portal 侧把该账号移出 → 桌面端 ≤2s 显示「你已被移出该房间」，返回列表后该房间消失
- **AC-03-5**：关闭面板后主进程不再持续请求门户（观察 dev 终端无持续日志），证明 `collabRoomUnwatch` 生效。
- **AC-03-6**：整轮结束后：`ls ~/.agenticx/sessions` 无新增承载该房间消息的目录；桌面端「历史会话」面板里**没有**这间房；`chat_messages` 表条数不变。
- **AC-03-7**：把 `~/.agenticx/config.yaml` 的 `enterprise.token` 临时清空并完全重启桌面端 → 「云房间」面板显示「未登录企业账号，无法加载云房间」，不白屏、不报错弹窗。验完记得恢复原值。

---

## 六、In scope / Out of scope

**In scope：** 落点清单里的 6 个文件（3 新增 + 3 处仅追加）。

**Out of scope（实施者不要顺手做）：**

- 建房 / 加成员 / 移出成员 / 离开房间（C3 桌面端只读成员、只做聊天）
- 把云房间接进 `PaneManager` / `ChatPane` / `SidePanelTab` / 多窗格布局
- 改 `desktop/src/components/SessionHistoryPanel.tsx`（云房间不进历史面板，靠不接入实现）
- 把云房间消息写入本机 session / `messages.json` / 记忆 / FTS
- 附件、@ 文件、引用、多选、转发、收藏等既有聊天增强（房间里本波次都不做）
- 房间内工具调用与多分身（C2）
- 改 portal 或主进程接口形状（除「对 02 的补充要求」那一条）

---

## 七、易错点

| 坑 | 规避 |
|---|---|
| 用 `seq` 当去重键 | 去重键是服务端 `id`；乐观消息 `id` 是 `temp-*` |
| 乐观消息排序错位 | 乐观消息 `seq` 给 `Number.MAX_SAFE_INTEGER`，让它排在末尾；`nextCursor` 要忽略它（`>= MAX_SAFE_INTEGER` 不计入） |
| 切房间后收到上一房间的事件 | 事件回调里按 `payload.roomId` 过滤，并在切房前 `collabRoomUnwatch` |
| 组件卸载后监听泄漏 | 必须调用 `onCollabRoomEvent` 返回的取消订阅函数 |
| 前端自己再实现一套重连 | 重连在主进程（02 FR-02-2）；前端只反映 `retrying` 状态 |
| 窄窗口下成员区把对话挤没 | 聊天区 `flex-1 min-w-0 min-h-0`，左列 `shrink-0` 固定宽度（C1 浏览器端踩过同一个坑） |
| Meta 回复露出 `<think>` | 统一走 `visibleContent()` |
| 硬编码颜色 | 只用主题 token |
| 面板文案泄露实现细节 | 不写门户地址、端口、表名、仓库路径 |
