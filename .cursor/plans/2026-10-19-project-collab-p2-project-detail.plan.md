# 项目协作 P2：项目详情、群树、单聊、拉小群与合回主群

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-19-project-collaboration-space.plan.md`
Depends-on: P0（项目 / 子群 / 单聊 / 合回接口）、P1（`ProjectCollabView`、`activeProjectId`、`openProject`）

## 目标

在桌面端打开一个项目后，能看到主群、小群树和单聊；能在群里聊天（含 @Meta）；能邀请成员、点人单聊、从任一群拉小群；能把小群或单聊按「全部 / 选中 / 摘要」合回父群或主群，合回内容在目标群以卡片显示，并且 Meta 回答时能读到。

## 现状（已核实）

- 云房间面板：`desktop/src/components/CollabRoomPanel.tsx`（`export function CollabRoomPanel({open, onClose, variant})` L74）。房间列表、成员 3 秒轮询（`MEMBER_POLL_MS` L23）、历史 `collabRoomMessages`（L184）、事件订阅 `collabRoomWatch`（L219）+ `onCollabRoomEvent`、发送 `collabRoomSend(roomId, text)`（L352）、斜杠命令 `fetchVisibleCommands`，全部写在一个组件里；解析函数 `asRoom / asMember / asMessage`（L33–58）；类型 `RoomSummary` 在 `desktop/src/utils/collab-room-view.ts` L12。
- 主进程客户端：`desktop/electron/collab-room-client.ts`；IPC `collab-room-list / -get / -messages / -send / -watch / -unwatch`（`main.ts` L8018–8105），`watch` 带 1/2/5 秒退避重连并向渲染层推 `collab-room-event {roomId, event}`。
- 后端（P0 交付）：`/api/desktop/projects`、`/api/desktop/projects/:id`、`/members`、`/direct`、`/api/desktop/rooms/:id/sub-rooms`、`/merge`、`/merge/:seq/approve`；合回消息 `sender_type="system"`、`metadata.kind="merge_back"`；单聊合回请求 `metadata.kind="merge_request"`。
- Meta 回复：`enterprise/apps/web-portal/src/lib/collab-room/meta-reply.ts` 的 `requestMetaReply(prompt, deps)` 与 `triggerMetaReply` 里构造网关地址、模型与令牌的写法。
- 企业用户列表：`enterprise/packages/iam-core/src/repos/users.ts` L242 `listAdminUsers(tenantId, filter)`（按 MySQL / PG 分派；`ListUsersFilter` 的关键字与分页字段名以该文件定义为准）。
- 聊天里转发卡片的现成样式：`desktop/src/components/messages/ImBubble.tsx` L1044–1063（`forwardedHistory` 卡片：备注 + 前 2 条 + 「…」）。

## 改动

### A. 企业端补两个接口（`enterprise/apps/web-portal/src/app/api/desktop/`）

鉴权、校验与返回体同 P0。

| 文件 | 方法 | 说明 |
|---|---|---|
| `directory/users/route.ts` | GET `?q=&limit=` | 调 `listAdminUsers(identity.tenantId, {关键字: q, 每页: min(limit,20)})`；只返回 `status` 非 `disabled` 的用户；返回 `{users: {id, display_name, email, dept_name}[]}`；`q` 为空时返回本部门前 20 人 |
| `rooms/[roomId]/summarize/route.ts` | POST `{message_ids?: string[]}` | 调用者须是该群活跃成员；取指定消息（为空则取全部，最多最近 200 条），用 `requestMetaReply` 生成摘要草稿，系统提示为「把下面的群聊整理成：结论、决定、待办（含负责人）三部分，简洁、不编造」；**只返回 `{summary}`，不写入任何群**；模型不可用时返回 503 `{error:{code:"50301", message:"智能体暂时不可用"}}` |

单测写在 `app/api/desktop/directory/__tests__/`、`app/api/desktop/rooms/__tests__/summarize.test.ts`，写法同现有路由测试。

### B. 主进程客户端与 IPC

`desktop/electron/collab-room-client.ts` 新增（同风格、15 秒超时，`summarize` 用 60 秒）：

| 函数 | 接口 |
|---|---|
| `getProject(deps, projectId)` | GET `/api/desktop/projects/:id` → `{project, rooms}` |
| `addProjectMember(deps, projectId, {user_id, display_name})` | POST `/members` |
| `openDirectRoom(deps, projectId, {peer_user_id, peer_display_name})` | POST `/direct` |
| `createSubRoom(deps, parentRoomId, {title, member_user_ids, agent_ids?, seed_message_ids?})` | POST `/rooms/:id/sub-rooms` |
| `mergeBack(deps, roomId, {target_room_id, mode, message_ids?, summary_text?})` | POST `/rooms/:id/merge` |
| `approveMerge(deps, roomId, seq)` | POST `/rooms/:id/merge/:seq/approve` |
| `summarizeRoom(deps, roomId, {message_ids?})` | POST `/rooms/:id/summarize` |
| `searchDirectoryUsers(deps, q)` | GET `/directory/users?q=` |

`main.ts` 注册 IPC：`collab-project-get`、`collab-project-add-member`、`collab-project-open-direct`、`collab-room-create-sub`、`collab-room-merge`、`collab-room-approve-merge`、`collab-room-summarize`、`collab-directory-search`；preload 暴露同名驼峰方法；`global.d.ts` 补类型。未登录统一返回 `{ok:false, error:"enterprise-login-required"}`。

### C. 拆出可复用的房间会话组件

把 `CollabRoomPanel.tsx` 里「单个房间」的部分（历史加载、事件订阅、成员轮询、消息列表、输入框、发送、斜杠命令）原样搬到新文件 `desktop/src/components/collab/CollabRoomConversation.tsx`：

```ts
type Props = {
  roomId: string;
  selectable?: boolean;                       // 开启多选（合回 / 带入小群）
  selectedIds?: Set<string>;
  onToggleSelect?: (messageId: string) => void;
  renderMessageExtra?: (message: RoomMessage) => ReactNode; // 合回卡片、合回请求按钮
  headerTrailing?: ReactNode;                 // 顶栏右侧按钮位
};
```

`CollabRoomPanel` 改为：左侧房间列表不变，右侧渲染 `<CollabRoomConversation roomId={activeRoomId} />`。**外观与行为必须与改动前一致**（这是纯搬移，不是重写）。`RoomMessage` 类型补 `metadata?: Record<string, unknown> | null` 与 `client_msg_id?: string | null`，`asMessage` 一并解析。

### D. 项目详情 `desktop/src/components/projects/ProjectDetailView.tsx`

`ProjectCollabView` 在 `activeProjectId` 不为空时渲染它（替换 P1 的占位）。布局三栏：

| 区域 | 内容 |
|---|---|
| 顶栏 | 面包屑「项目 / <项目名> / <当前群名>」（点「项目」回首页 `openProject(null)`）；右侧：搜索（本期只过滤当前群消息文本）、同步状态点（`connecting` 灰「连接中」、`live` 绿「协作中」、`reconnecting` 黄「重连中」，取自会话组件的流状态）、刷新、成员按钮 `头像 · N` |
| 左栏群列表 | 「主群」置顶；其下按 `parent_room_id` 缩进显示小群树；「单聊」分组列出 `direct` 群（显示对方名字）；选中态用背景层级，不用粗边框 |
| 中栏 | `<CollabRoomConversation roomId={selectedRoomId} …/>` |
| 右栏 | 沿用现有 `WorkPanel` 不在本期范围；本期中栏占满 |

成员弹层（点成员按钮，`createPortal` 到 `document.body`）：

- 标题「项目成员 · N」；列表显示头像、名字、角色（所有者 / 协作者）；真人行悬停出现「单聊」按钮（自己那一行不出现），点击 `collabProjectOpenDirect` 后在左栏选中该单聊。
- 底部「邀请成员」：输入框 + 防抖 300ms 调 `collabDirectorySearch`，点结果 `collabProjectAddMember`，成功后刷新 `collabProjectGet`。仅所有者 / 管理员可见此区域。
- 弹层底部一行说明：「项目内的对话会被企业记录」。

### E. 拉小群

- 入口：中栏顶栏「拉小群」按钮（`headerTrailing`）；多选模式下底部操作条「带着选中消息拉小群」。
- 弹窗 `CreateSubRoomDialog.tsx`：群名（必填，≤ 20 字）、成员多选（只列当前群的成员，默认勾选自己且不可取消）、专家多选（当前群里的数字专家）、若从多选进入显示「将带入 N 条消息」。
- 提交 `collabRoomCreateSub`，成功后刷新项目并选中新群。

### F. 合回

入口：小群或单聊顶栏「合回」按钮；多选模式底部操作条「合回选中」。弹窗 `MergeBackDialog.tsx`：

| 控件 | 规则 |
|---|---|
| 目标 | 下拉：直接父群（默认）与主群；单聊只有主群 |
| 方式 | 单选：全部 / 选中的 N 条（仅在有选中时可选）/ 摘要 |
| 摘要 | 选「摘要」后出现多行文本框 + 「生成摘要」按钮（调 `collabRoomSummarize`，生成中显示进行中，失败在框下显示错误），用户可修改；文本为空时确认置灰 |
| 底部 | 「取消」紧靠「确认合回」左侧 |

结果：

- 小群：成功后提示「已合回到 <目标群名>」，贴近弹窗触发位置显示。
- 单聊：接口返回 `pending` 时提示「已发给对方确认」；单聊里出现一条合回请求消息，**对方**看到「同意合回」按钮（通过 `renderMessageExtra` 渲染，`metadata.kind==="merge_request"` 且 `requested_by` 不是自己），点击调 `collabRoomApproveMerge`。

合回卡片（目标群里 `metadata.kind==="merge_back"` 的消息，用 `renderMessageExtra` 替代普通正文显示）：

- 标题「合回自「<source_title>」」+ 方式标签（全部 / 选中 / 摘要）+ 参与者 + 条数。
- 正文：摘要显示全文；全部 / 选中显示前 3 条 +「展开全部」，展开后显示完整 `content`。
- 「查看原群」链接：在左栏选中 `source_room_id`。
- 视觉与 `ImBubble` 的转发卡片一致（同样的边框、底色、字号）。

### G. 文案

新增到 `desktop/locales/{zh,en}/projects.json`：面包屑、`members.title`（项目成员）、`members.invite`（邀请成员）、`members.direct`（单聊）、`members.recordedNotice`（项目内的对话会被企业记录）、`rooms.main`（主群）、`rooms.direct`（单聊）、`sub.create`（拉小群）、`sub.withSelected`（带着选中消息拉小群）、`sub.seedCount`（将带入 {{count}} 条消息）、`merge.action`（合回）、`merge.selected`（合回选中）、`merge.target`、`merge.mode.all`（全部）、`merge.mode.selected`（选中的 {{count}} 条）、`merge.mode.summary`（摘要）、`merge.generate`（生成摘要）、`merge.confirm`（确认合回）、`merge.done`（已合回到 {{name}}）、`merge.pending`（已发给对方确认）、`merge.approve`（同意合回）、`merge.cardTitle`（合回自「{{name}}」）、`merge.viewSource`（查看原群）、`status.connecting / live / reconnecting`（连接中 / 协作中 / 重连中）。英文按同义直译。

## In scope / Out of scope

- In：A–G。
- Out：离线缓存与待发送队列（P3）；项目内任务（本机 AI 会话）与项目的关联；邀请链接；成员移除与角色变更界面；右侧工作台。
- no-scope-creep：`CollabRoomPanel` 只做「把单房间部分搬到子组件」这一处改动，其余不动；不改 P0 接口语义。

## 验收

- AC-1：`desktop/tests/collab-room-client.test.ts` 为 B 的每个新函数各加一条请求路径与方法断言、一条错误映射断言。
- AC-2：`desktop/src/components/collab/CollabRoomConversation.test.tsx`：给定 `merge_back` 消息时渲染合回卡片标题与「查看原群」；给定对方发起的 `merge_request` 时渲染「同意合回」，自己发起时不渲染。
- AC-3：`desktop/src/components/projects/MergeBackDialog.test.tsx`：无选中时「选中的 N 条」不可选；摘要为空时确认置灰；单聊目标只有主群。
- AC-4：为群树抽纯函数 `buildRoomTree(rooms)`（放 `desktop/src/utils/collab-project-tree.ts`），单测：主群在首位，小群按 `parent_room_id` 嵌套，`direct` 单独成组。
- AC-5：P0、本期企业端新路由测试与 `pnpm -C enterprise/apps/web-portal typecheck` 通过；桌面端 `npx tsc --noEmit -p tsconfig.json`、`npx tsc -p electron/tsconfig.json`、`npm test` 通过。
- AC-6（手工，Opus 验收）：两个账号 A、B 进入同一项目；A 拉小群（A、B、一位专家）聊 3 条后「摘要合回」主群；主群出现摘要卡片；A 在主群发「@Meta 刚才小群的结论是什么」，Meta 的回答复述了摘要要点。B 在单聊发起「合回全部」，A 点「同意合回」后主群出现卡片。
