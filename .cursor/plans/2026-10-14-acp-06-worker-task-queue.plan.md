# acp-06 企业侧 Worker 任务队列

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`
Depends: acp-01（`enterprise_agents`）、acp-04（`dispatchAgentMention` 的 `desktop_worker` 分支）

## 目标

`runtime=desktop_worker` 的 Agent 被点名时，门户把任务放进队列；被授权的员工 Near 用 PAT 发心跳、认领任务、回写结果，结果以 Agent 身份出现在房间里。本计划只做企业侧与协议，Near 侧实现在 acp-07；验收时用 `curl` 模拟 Worker。

## 设计要点

- 谁能承接：管理员在 Agent 上配置「可承接执行的员工」分配键 `worker_keys`（格式同 `assignment_keys`）。员工的分配键（`resolveAssignmentKeysForUser`）与 `worker_keys` 有交集才算合格 Worker。空数组表示没人能承接。
- 租约：认领后 10 分钟租约；过期未完成的任务回到 `queued`，`attempts+1`，达到 3 次置 `failed` 并在房间写系统消息。
- 排队超过 24 小时未被认领置 `expired`，并写系统消息。
- 降噪：入队时只有在「该 Agent 最近 2 分钟没有任何在线 Worker」时才写一条系统消息「当前没有在线的桌面执行端，任务已排队」；有在线 Worker 时不写。

## 数据模型

PG 迁移 `enterprise/packages/db-schema/drizzle/0054_enterprise_agent_tasks.sql`，MySQL `drizzle-mysql/0028_enterprise_agent_tasks.sql`，同步更新两边 `meta/_journal.json`，以及 `src/schema/` 与 `src/mysql-schema/` 的 drizzle 定义与 index 导出。

1. `enterprise_agents` 增加列 `worker_keys text[] not null default '{}'`（MySQL 写法照 `assignment_keys`）。同步 iam-core `EnterpriseAgent` / `AgentInput` 类型、`validateAgentInput`（数组元素非空字符串）、读写映射。
2. 新表 `enterprise_agent_workers`：

| 列 | 说明 |
| --- | --- |
| `id` ulid 主键 | |
| `tenant_id` ulid | |
| `agent_id` ulid FK `enterprise_agents.id` cascade | |
| `user_id` ulid FK `users.id` cascade | |
| `device_id` varchar(64) | Near 本机生成的稳定 id |
| `device_name` varchar(128) | |
| `last_heartbeat_at` timestamptz not null | |
| 审计列 | |

唯一键 `(agent_id, user_id, device_id)`。

3. 新表 `enterprise_agent_tasks`：

| 列 | 说明 |
| --- | --- |
| `id` ulid 主键 | |
| `tenant_id` ulid | |
| `agent_id` ulid FK cascade | |
| `room_id` ulid FK `enterprise_collab_rooms.id` cascade | |
| `trigger_message_id` varchar(26) | |
| `requested_by` ulid | 发起点名的用户 |
| `status` varchar(16) not null default `queued` | `queued` / `claimed` / `completed` / `failed` / `expired` |
| `input` jsonb not null | `{ "messages": [{ "role": "user"\|"assistant", "name": string, "content": string }], "instruction": string }` |
| `attempts` integer not null default 0 | |
| `claimed_by_user_id` ulid null | |
| `claimed_by_device` varchar(64) null | |
| `claimed_at` / `lease_expires_at` / `completed_at` timestamptz null | |
| `result_message_id` varchar(26) null | |
| `error` text null | ≤ 2000 字 |
| 审计列 | |

索引 `enterprise_agent_tasks_queue_idx (tenant_id, agent_id, status, created_at)`。

## 企业侧代码

### 存储

新建 `enterprise/apps/web-portal/src/lib/worker-tasks/`：`types.ts`、`sql-store.ts`（PG/MySQL 共用，参数占位与 `src/lib/collab-room/sql-store.ts` 同写法）、`index.ts`。函数：

```ts
enqueueAgentTask(input: { tenantId; agentId; roomId; triggerMessageId; requestedBy; input: TaskInput }): Promise<AgentTask>;
hasOnlineWorker(tenantId: string, agentId: string, withinSeconds = 120): Promise<boolean>;
recordHeartbeat(params: { tenantId; userId; deviceId; deviceName; agentIds: string[] }): Promise<void>;
claimNextTask(params: { tenantId; userId; deviceId; agentIds: string[] }): Promise<AgentTask | null>;
completeTask(params: { tenantId; userId; deviceId; taskId; resultMessageId }): Promise<AgentTask>;
failTask(params: { tenantId; userId; deviceId; taskId; error }): Promise<AgentTask>;
sweepExpired(tenantId: string): Promise<AgentTask[]>; // 返回本次被置 failed/expired 的任务，供调用方写系统消息
```

`claimNextTask` 先调用 `sweepExpired`，再用单条语句原子认领：PG `UPDATE … WHERE id = (SELECT id … WHERE status='queued' AND agent_id = ANY($agentIds) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`；MySQL 8 在事务内 `SELECT … FOR UPDATE SKIP LOCKED` 再 `UPDATE`。`complete`/`fail` 必须校验 `status='claimed'` 且 `claimed_by_user_id`、`claimed_by_device` 与调用者一致，否则抛 `WorkerTaskConflictError`（映射 409）。

### 入队接线

`src/lib/collab-room/agent-reply.ts` 的 `desktop_worker` 分支替换为：构造 `TaskInput`（最近 30 条消息，规则与云端 prompt 一致：本 Agent 发言为 assistant，其余 user 带 name；`instruction` = 触发消息正文）→ `enqueueAgentTask` → `hasOnlineWorker` 为 false 时写系统消息「当前没有在线的桌面执行端，任务已排队」。

### Worker 接口（PAT）

全部用 `resolveDesktopIdentity`（`src/lib/desktop-auth.ts`），失败 401。合格 Agent 集合 = 同租户、`status='active'`、`runtime='desktop_worker'`、`worker_keys` 与该员工分配键有交集。

- `POST /api/desktop/worker/heartbeat` body `{ device_id, device_name }` → `recordHeartbeat` → `{ agents: [{ id, slug, displayName, systemPrompt, model }] }`。
- `POST /api/desktop/worker/tasks/claim` body `{ device_id }` → `{ task: { id, agent: {id, slug, displayName, systemPrompt, model}, room_id, input } | null }`。
- `POST /api/desktop/worker/tasks/[taskId]/complete` body `{ device_id, content, tool_steps? }`：`content` 1–16000 字；以 `senderType:"agent"`、`senderId: agent.id`、`senderName: agent.displayName` 写房间消息（直接用 collab-room 存储写，不经过「调用者必须在房」校验——新增一个仅服务端内部用的 `appendAgentMessageAsSystem(tenantId, roomId, …)`，放在 collab-room sql-store 并在 index 导出），`metadata: { runtime: "desktop_worker", reply_to, worker_user_id, worker_device, tool_steps }` → `completeTask`。
- `POST /api/desktop/worker/tasks/[taskId]/fail` body `{ device_id, error }` → `failTask` → 房间系统消息「智能体「{name}」执行失败：{error 前 200 字}」。
- `device_id` 校验 `^[A-Za-z0-9._-]{8,64}$`。
- `sweepExpired` 返回的任务写对应系统消息（failed：「多次领取未完成」；expired：「24 小时内没有桌面执行端领取」）。

### 管理台

`apps/admin-console/src/app/admin/_sections/agents.tsx`：运行方式为「员工桌面执行」时显示「可承接执行的员工」选择（复用可见范围同一选择组件），对应 `worker_keys`；admin API 的 POST/PATCH 透传并校验该字段。

## AC

1. `src/lib/worker-tasks/__tests__/sql-store.test.ts`（照 collab-room 测试的数据库/桩方式）：认领顺序、并发两次认领只成功一个、错设备 complete 409、租约过期回队与 3 次后 failed、24h 过期。
2. `src/app/api/desktop/worker/**/__tests__/*.test.ts`：401；不合格员工 heartbeat 返回空 agents；claim 空队列返回 `task:null`；complete 成功后房间消息写入 `sender_type=agent`。
3. iam-core `validateAgentInput` 补 `worker_keys` 用例。
4. `pnpm -C enterprise --filter @agenticx/db-schema db:migrate`；`pnpm -C enterprise typecheck`；`--filter @agenticx/app-web-portal test`、`--filter @agenticx/app-admin-console test`、`--filter @agenticx/iam-core test` 通过。
5. 端到端（主控执行）：管理台新建 `desktop-coder`（员工桌面执行，可承接员工含测试账号）→ 门户房间加入并 @ 它 → 出现「当前没有在线的桌面执行端，任务已排队」→ 用测试账号 PAT（`config.yaml` 的 `enterprise.token`）`curl` 调 heartbeat、claim（拿到任务）、complete（content 填一句话）→ 房间里出现该 Agent 的回复；再 @ 一次时因 2 分钟内有心跳，不再出现排队提示。

## Out of scope

Near 侧轮询与执行（acp-07）；任务看板 UI；任务验收人；结果附件上传。
