# 05 · 本机派发（Wave 2）

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Master:** `.cursor/plans/pending/2026-09-07-mobile-edge-control-master.plan.md`  
**依赖:** 01–04 全部合并且 Wave 1 总验收绿。**禁止在 01–04 未完成时开工。**

**Goal:** 手机选「我的电脑」发送后，任务在已授权、在线的那台 Near 上执行；助手回复写回**同一条 portal 云会话**，手机能看见进度与结果。

**Architecture:** 会话真相源仍是 portal PG。手机只创建 job + 用户消息。Desktop 出站拉 job，用本机 runtime 跑，再把 assistant 消息经 portal API 追加。不把手机打进 `agx serve`，不改 Gateway 成 Agent 宿主。

**Tech Stack:** 新表 `enterprise_edge_jobs`、Desktop 主进程轮询、portal 发送分支、现有 history 持久化。

---

## 开工门禁（缺一不可）

1. `GET /api/me/edge/computers` 能返回真实 desktop 且 `online`/`controllable` 正确。
2. Desktop 心跳与 grant 开关可用。
3. 03 的 `assertSendableHost` **改为放行电脑宿主**（本 plan Task 4），黄条只用于离线/未授权。
4. 实施者已读 Master 第 1–4 节与第 5 节设计宪法。

---

## In scope

- jobs 表与服务
- portal：电脑宿主发送创建 job；会话展示「电脑执行中」
- Desktop：拉 job、本地执行、回写结果、失败态
- 单测

## Out of scope

- 多电脑负载均衡（一台用户选中的电脑）
- 完整目录 ACL / 沙箱新内核（job 带 `folder_scope=created_tasks` 元数据即可，Desktop 用当前工作区）
- PWA、原生套壳、Work/Code 双 Tab
- 改 `packaging/edge-agent`
- 改 `agenticx/studio/server.py` import 区；若必须加 HTTP，走 Desktop 已连的本地 serve，不改 import 块
- 飞书/微信遥控（已有独立 plan）

---

## 产品规则（写死）

1. 发送瞬间电脑必须 `online && controllable`，否则不落 job，黄条：`这台电脑离线或未授权，请改选云端，或打开 Near 并开启手机控制。`
2. 用户消息仍写入当前 portal `session_id`（现有 history 路径）。
3. 助手消息也写入同一 session。手机靠现有消息刷新/SSE 看见，不要第二套 transcript。
4. Desktop 合盖且未开防休眠导致失败：job `failed`，message `电脑已睡眠或 Near 已退出`。
5. 同一 session 同时只允许 1 个 `queued`/`running` job。第二次发送排队到 portal 现有 pending 队列，或提示「电脑仍在执行上一则」。推荐：阻塞并提示，避免双 runtime。

---

## 数据：`enterprise_edge_jobs`

下一号迁移：实施时看当时 journal 最大值 +1（不要死抄 0051，若 01 之后又有迁移）。表名锁死。

| 列 | 含义 |
|---|---|
| `id` | ULID |
| `tenant_id` / `user_id` | 所有者 |
| `desktop_device_id` | 目标电脑 |
| `session_id` | portal 会话 |
| `user_message_id` | 已落库的用户消息 |
| `status` | `queued` \| `running` \| `succeeded` \| `failed` \| `canceled` |
| `prompt` | 用户可见文本副本（可与消息表重复，避免执行时再拼历史出错） |
| `error_message` | 失败时面向用户的短句，禁止堆栈 |
| `claimed_at` / `finished_at` | |
| `created_at` / `updated_at` | |

索引：`(desktop_device_id, status, created_at)`；`(session_id, created_at)`。

服务函数（放 `iam-core/src/edge-job-service.ts`）：

- `enqueueEdgeJob`：校验 grant+online，否则抛 typed error
- `claimNextJob(desktopDeviceId)`：把最老 queued 改为 running（事务）
- `completeJob` / `failJob`
- `listRunningForSession`

双份 schema + journal + parity，照 01 的流程。

---

## FR / AC

- **FR-05-1** 电脑在线且授权时，发送创建 job，HTTP 聊天补全**不**走云 completions。
  - **AC-05-1** portal 单测：host=computer 时 mock completions 未被调用；`enqueueEdgeJob` 被调用。
- **FR-05-2** 离线/未授权不建 job，黄条为上文锁死句子。
  - **AC-05-2** `assertSendableHost` 扩展为接受 `{ online, controllable }`。
- **FR-05-3** Desktop 20s 心跳之外，另以 ≤2s 拉 `GET /api/desktop/edge/jobs/next`（或同连接长轮询 ≤25s）。claim 后本地执行。
  - **AC-05-3** `desktop/electron/mobile-edge-jobs.test.ts`：claim 状态机。
- **FR-05-4** 成功后 portal session 出现 assistant 消息，手机刷新可见。
  - **AC-05-4** `POST /api/desktop/edge/jobs/:id/complete` 调用现有 history append；测试 mock append。
- **FR-05-5** 失败 job 在会话插入一条系统可见的短错误（用户能看见，不是内部 log）。
- **FR-05-6** 取消：手机点停止 → job `canceled`，Desktop 停本地生成（复用现有 cancel）。

---

### Task 1: jobs 表与服务（TDD）

**Files:**

- `enterprise/packages/db-schema/src/schema/edge-jobs.ts` + mysql 双份
- `enterprise/packages/iam-core/src/edge-job-service.ts` + `.test.ts`
- 迁移 SQL + journal + schema-parity 列表

`enqueueEdgeJob` 必须再查 grant+`isDeviceOnline`，不要信客户端。

---

### Task 2: Desktop job API

**Files:**

- `enterprise/apps/web-portal/src/app/api/desktop/edge/jobs/next/route.ts` GET
- `enterprise/apps/web-portal/src/app/api/desktop/edge/jobs/[jobId]/complete/route.ts` POST
- `enterprise/apps/web-portal/src/app/api/desktop/edge/jobs/[jobId]/fail/route.ts` POST
- `enterprise/apps/web-portal/src/app/api/desktop/edge/jobs/__tests__/route.test.ts`

鉴权：`resolveDesktopIdentity`。只能 claim **自己 userId + 已登记 desktop_device_id** 的 job。

complete body：

```ts
{ assistantText: string, artifacts?: Array<{ name: string; content: string }> }
```

在 handler 内把 assistant 写入该 `session_id` 的聊天历史。**先读** 03 之后仍存在的 history 写入入口（大概率 `createPortalChatHistoryClient` / `enterprise/features/chat` persist），对准再写，禁止再发明第三套 messages 表。

`assistantText` 最长先截 200k 字符，避免一次打爆。

---

### Task 3: Desktop 执行器

**Files:**

- Create: `desktop/electron/mobile-edge-jobs.ts`
- Modify: `desktop/electron/main.ts` 仅在 heartbeat 启动处同时 `startEdgeJobLoop()`，logout/quit 停止
- 不要改 `ChatPane.tsx` 发送热路径，除非必须把「来自 job 的 user 文本」丢进现成 runtime

执行策略（锁死，禁止改成 spawn 第二个 Python)：

1. 用 Desktop 当前已在跑的本地 `agx serve`（`get-api-base` + desktop token）。
2. `POST {local}/api/chat` 或现有内部等价调用，session 用 **job 里的 portal session id 若本地不存在则新建本地映射文件** `~/.agenticx/edge-job-sessions.json`：`{ [portalSessionId]: localSessionId }`。
3. 流式可先不转给手机（Wave 2 允许结束后一次性回写）。若现成 SSE 容易转，可每 2s POST progress；**不是必须**。
4. 完成后 `complete`；抛错 `fail` 用短中文。

映射文件不要存 PAT。

单测只测：无 job 时 loop 不调 chat；claim 失败不崩溃。

---

### Task 4: 改 portal 发送拦截

**Files:**

- Modify: `enterprise/apps/web-portal/src/lib/execution-host.ts`
  - `assertSendableHost(host, computer?: { online: boolean; controllable: boolean })`
  - `cloud` → ok
  - `computer` 且 computer 缺失/离线/不可控 → 离线文案
  - `computer` 且 online+controllable → **ok**（删除 Wave 1 的「通道尚未开通」作为发送门）
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx` 的发送
  - host 为 computer 时走新函数 `sendViaDesktopEdge(...)`：先按现有路径写入 user 消息，再 `POST /api/me/edge/jobs`（本 Task 建 Cookie 路由）
  - **禁止**再打 `/api/chat/completions` 云补全
- Create: `enterprise/apps/web-portal/src/app/api/me/edge/jobs/route.ts` POST
- 消息列表：该 session 有 running job 时，在 InputArea 上方用已有 muted 状态条：`电脑执行中` + 三点动画（类现有 SessionGeneratingDots），不要 ⏳ 字符画

Wave 1 黄条文案保留给离线/未授权，不要删 i18n key，改语义即可。

---

### Task 5: 停止与冲突

- 手机点停止：`POST /api/me/edge/jobs/:id/cancel` → status canceled；Desktop loop 看到 canceled 则 abort 本地 fetch。
- 若已有 running job，再发送 computer：不 enqueue，黄条 `电脑仍在执行上一则消息`。

---

### Task 6: 设计（轻）

读 emil + apple skill。状态条：

- 不新增主色
- 三点动画 160ms，`prefers-reduced-motion` 静态「电脑执行中」
- 完成时状态条消失，不放烟花

---

### Task 7: 自测与手测

```bash
pnpm --filter @agenticx/iam-core exec vitest run src/edge-job-service.test.ts
pnpm --filter @agenticx/web-portal exec vitest run src/app/api/desktop/edge/jobs/__tests__/route.test.ts src/lib/execution-host.test.ts
```

手测（必须）：

1. Desktop 登录企业账号、开授权、开唤醒。
2. 手机同一账号，选该电脑，发「只回复 pong」。
3. 桌面开始跑；手机出现「电脑执行中」；结束后手机看到 pong。
4. 关 Desktop 再发：黄条离线，无新 job。
5. admin 吊销后再发：黄条未授权。

---

## 风险

| 风险 | 处理 |
|---|---|
| 本地 session 与 portal session 分叉 | 映射文件 + 只回写 portal，不以本地历史覆盖云 |
| 工具要本机文件 | 这正是本 Wave 的意义；失败要把工具错误压成短句 |
| `server.py` 诱惑 | 不要为了省事改 import 区；Desktop 已能打本地 serve |
| 范围膨胀成云 IDE | 直接停，回到 Master 非目标 |

---

## no-scope-creep

只为派发生效改发送分支与 Desktop loop。禁止重做聊天 UI。禁止借机重构 SettingsPanel。
