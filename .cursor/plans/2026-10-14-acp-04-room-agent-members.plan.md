# acp-04 房间 Agent 成员与云端回复

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`
Depends: acp-01（`enterprise_agents` 表与 iam-core 仓库 `listAgentsVisibleToKeys` / `getAgent`）

## 目标

员工在门户协作房间里把管理员登记的 Agent 加为成员，消息里 `@<slug>` 或 `@<显示名>` 点名后，该 Agent 用自己的模型与系统提示词回复，消息显示为 Agent 发言。`runtime=desktop_worker` 的 Agent 在本计划里先给出明确系统提示，acp-06 接入任务队列。

## 根因与证据

- 成员类型已含 `"agent"`（`enterprise/apps/web-portal/src/lib/collab-room/types.ts`），但 `CollabRoomStore` 只有 `addHumanMember`，`SqlStore.createRoom` 只写 human 与 meta（`src/lib/collab-room/sql-store.ts` 约 249 行起）。
- `@meta` 回复链路：`POST /api/rooms/[roomId]/messages`（`src/app/api/rooms/[roomId]/messages/route.ts`）→ `mentionsMeta` → `triggerMetaReply`（`src/lib/collab-room/meta-reply.ts`）。模型 id 形如 `<providerId>/<model>`，调用时拆成 `x-agenticx-provider` 头 + `model` 字段（meta-reply.ts 约 152–171 行），用当前用户的 access token 调网关 `GATEWAY_COMPLETIONS_URL`。
- 可见范围解析：`resolveAssignmentKeysForUser(tenantId, userId, email, deptId)`（`@agenticx/iam-core`）。

## 改动

### 1. 门户读取可用 Agent

新建 `enterprise/apps/web-portal/src/app/api/me/agents/route.ts`：`GET`，cookie 会话（照 `src/app/api/me/skills` 的会话校验写法），`resolveAssignmentKeysForUser` → `listAgentsVisibleToKeys`，只返回 `id, slug, displayName, description, runtime, model`（不返回 systemPrompt）。

### 2. 存储层

- `CollabRoomStore` 接口新增：

```ts
addAgentMember(
  ctx: CollabRoomContext,
  roomId: string,
  input: { agentId: string; displayName: string },
): Promise<CollabRoomMember>;
```

- 所有实现该接口的类都要实现（`rg -n "implements CollabRoomStore" src/lib/collab-room` 找全，含内存实现）。语义：要求调用者是在房成员（复用 `requireActiveMember`）；插入 `member_type='agent'`、`member_id=agentId`、`room_role='member'`；已存在且 `left_at` 非空则恢复；已在房则原样返回。
- `src/lib/collab-room/index.ts` 导出同名函数，风格与 `addHumanMember` 一致。

### 3. 成员接口

`src/app/api/rooms/[roomId]/members/route.ts` 的 `POST`：body 若含 `agent_id`（字符串）走新分支，否则保持原有真人分支逻辑不变。新分支：

1. `getAgent(tenantId, agent_id)`，不存在 → 400 `agent not found`。
2. `status !== "active"` → 400 `agent disabled`。
3. 当前用户的分配键与 `agent.assignmentKeys` 无交集 → 403 `agent not visible`。
4. `addAgentMember(ctx, roomId, { agentId, displayName: agent.displayName })`。

### 4. 点名解析

新建 `src/lib/collab-room/agent-mentions.ts`：

```ts
export function findMentionedAgents(
  content: string,
  members: CollabRoomMember[],
): CollabRoomMember[];
```

- 只看 `member_type === "agent"` 且 `left_at` 为空的成员。
- 命中规则：`@` 前是行首或空白/中英文标点（同 `mentionsMeta` 的前导集合），后接该成员的 slug 或 display_name，再后面是行尾、空白或标点。slug 需要从 Agent 记录拿，所以函数签名第三个参数可选 `slugById: Map<string, string>`。
- 去重，按在正文里首次出现的顺序返回，最多 3 个。
- `@meta` 不在这里处理。

### 5. Agent 回复

新建 `src/lib/collab-room/agent-reply.ts`：

```ts
export async function dispatchAgentMention(
  ctx: CollabRoomContext,
  roomId: string,
  session: AuthContext,
  agent: EnterpriseAgent,
  triggerMessage: CollabRoomMessage,
  overrides?: Partial<AgentReplyDeps>,
): Promise<void>;
```

按 `agent.runtime` 做穷尽 `switch`（`default` 分支 `const _never: never = agent.runtime`）：

- `cloud` → `triggerCloudAgentReply(...)`：
  - prompt：system = `agent.systemPrompt` + 一段固定房间说明（「你是协作房间里的智能体「{displayName}」，房间里有多个成员，回复简洁并指明回应对象」）；最近 30 条消息里 `sender_type==="agent" && sender_id===agent.id` 记为 assistant，其余记为 user 并带 `名字：` 前缀；内容截断规则照 `buildMetaPrompt`。
  - 模型：`agent.model` 拆 `providerId/model`；请求头照 meta-reply 的整套头，`x-agenticx-trace-stage` 用 `room.agent`，另加 `x-agenticx-agent-id: agent.id`。
  - 成功：`appendMessage` `senderType: "agent"`、`senderId: agent.id`、`senderName: agent.displayName`、`model: agent.model`、`metadata: { agent_slug, runtime: "cloud", reply_to: triggerMessage.id }`。
  - 网关 401/403：系统消息「智能体「{name}」使用的模型对你不可用，请联系管理员」；其它失败：「智能体「{name}」暂时不可用，请稍后再试」。
  - 网络调用函数复用 `requestMetaReply`（它本身与 meta 无关）；如需改名，保留原导出名不破坏现有引用。
- `desktop_worker` → 追加系统消息「智能体「{name}」需要员工桌面执行，桌面执行通道尚未接入」。acp-06 会替换这一分支。

### 6. 消息接口接线

`src/app/api/rooms/[roomId]/messages/route.ts` 的 `POST`：在现有 `mentionsMeta` 处理之后，`listMembers` → 读出这些 agent 成员的 Agent 记录拿 slug（`getAgent`，失败的跳过）→ `findMentionedAgents` → 逐个 `await dispatchAgentMention(...)`，每个都单独 `catch` 记日志 `room.agent_reply.failed`。不改 GET。

### 7. 界面

- `src/components/rooms/RoomMembersPanel.tsx`：成员列表里 agent 成员显示 `Bot` 图标与「智能体」标记；新增「添加智能体」区块，数据来自 `/api/me/agents`，过滤掉已在房的，点击后 `POST members { agent_id }`，失败把接口 message 就近显示在该区块。
- `src/components/rooms/RoomChatView.tsx`：`sender_type === "agent"` 的消息显示 Agent 名称 + 「智能体」标记，与真人消息视觉区分；系统消息保持现有样式。输入框占位提示加一句「@ 名称 点名智能体」。
- 文案走门户现有 i18n 文件（`apps/web-portal/messages/{zh,en}.json`，按现有 rooms 文案的 key 结构添加）。

## AC

1. `src/lib/collab-room/__tests__/agent-mentions.test.ts`：slug 命中、中文显示名命中、`email@x` 不误命中、已离房不命中、去重与上限 3、顺序。
2. `src/lib/collab-room/__tests__/agent-reply.test.ts`：mock fetch，断言 system prompt 含 agent 提示词、请求头含 `x-agenticx-agent-id` 与拆分后的 provider、成功写入 `sender_type=agent`；403 写对应系统消息；`desktop_worker` 写系统消息。
3. `src/app/api/rooms/[roomId]/members/route.test.ts` 补用例：agent 不存在 400、停用 400、不可见 403、成功 200；真人分支既有用例不变。
4. `src/app/api/me/agents/route.test.ts`：只返回可见 Agent，且不含 `systemPrompt`。
5. `pnpm -C enterprise --filter @agenticx/app-web-portal typecheck` 与 `test` 通过。
6. 端到端（浏览器，`http://localhost:3000`，种子管理员登录）：建房 → 添加 acp-01 中登记的云端 Agent（slug `report-bot`）→ 发送「@report-bot 用一句话介绍你自己」→ 房间出现带「智能体」标记、名字为该 Agent 显示名的回复；数据库 `enterprise_collab_room_members` 有 `member_type='agent'` 行，`enterprise_collab_room_messages` 有 `sender_type='agent'` 行。

## Out of scope

工具调用（acp-05）；桌面执行（acp-06/07）；PAT 版 `/api/desktop/rooms/**` 的 agent 支持；@ 自动补全下拉；流式回复。
