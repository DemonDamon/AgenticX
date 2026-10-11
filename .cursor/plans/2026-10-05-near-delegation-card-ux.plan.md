---
name: Near 委派运行卡片 UX 修正：归属与标识
overview: 委派运行（dlg-*）在桌面端被绑定到分身会话并以「子智能体」名义展示，用户会误读为"分身又派生了一层子智能体"；本计划把委派卡片归属修正到发起委派的 Meta 会话工作区（与后端 run 账本及冷启动水合一致），并在卡片上增加「委派」徽标与 spawn 子智能体区分。
todos:
  - id: subagent-kind-model
    content: SubAgent 模型增加 kind/avatarSessionId 字段与纯函数映射器（测试先行）
    status: completed
  - id: delegation-card-attribution
    content: SSE 热路径委派卡片绑定发起方会话，终态事件不再覆盖 sessionId
    status: completed
  - id: delegation-badge-i18n
    content: SubAgentCard 增加「委派」徽标与 zh/en i18n
    status: completed
  - id: delegation-card-regression
    content: Vitest/tsc/build 回归与 CDP 真机冒烟验证
    status: completed
isProject: true
---

# Near 委派运行卡片 UX 修正实施计划

## 目标

消除"委派任务在分身会话工作区显示为一张名为分身自己的子智能体卡片"造成的层级误读，让 UI 归属与后端运行账本的归属模型一致：**委派运行挂在发起方（Meta 会话）名下，分身会话工作区的「子智能体」分区只显示分身自己 spawn 的 sa-\* 运行**。

## 根因与证据链

1. 后端账本归属本来是"发起方"：`delegate_to_avatar` 把委派 run 登记在 `from_session`（Meta 会话）名下的 SubAgentRunStore（`agenticx/runtime/meta_tools.py:3585-3589、3642、3652-3676`，`kind="delegate"`）；`resolver.list_resolved_runs` 也按 owner 归属返回。
2. 桌面端热路径却绑定分身会话：`desktop/src/components/ChatPane.tsx:12519-12527` `addSubAgent` 时 `sessionId: avatarSessionId || requestSessionId`；`12608-12610`（paused）、`12640-12642`（completed）、`12659-12661`（error）还会用 `avatar_session_id` 反复覆盖 `sessionId`。Lite 路径 `desktop/src/components/ChatView.tsx:1967、2029、2045` 同源。
3. 工作区按 pane 会话过滤：`ChatPane.tsx:3942-3946` `paneSubAgents` 只显示 `sessionId === pane.sessionId` 的条目，于是委派卡片只出现在自动弹出的分身 pane 工作区，且卡片名 = 分身名 → 用户实测误读为"阮和鸣又创建了一个同名 subagent"（2026-10-05 用户反馈，dlg-e1715910）。
4. 冷热路径不一致：冷启动水合 `desktop/src/utils/subagent-hydrate.ts:107、127-151` 按被查询 session（发起方）绑定 —— 重启后委派卡片出现在 Meta 工作区，运行中却在分身工作区。
5. 卡片无类型标识：`SubAgent` 类型（`desktop/src/store.ts:521-539`）没有 kind/isDelegation 字段；WorkPanel「子智能体」分区（`desktop/src/components/work-panel/WorkPanel.tsx:3168-3189`）对 delegate/subagent 无视觉区分，仅 `currentAction` 文案（"委派执行中"）有差。

## 产品决策

- 委派卡片归属发起委派的 Meta 会话工作区（与后端 run 归属、冷启动水合一致）；分身会话工作区「子智能体」分区只显示分身自己 spawn 的 sa-\* 运行。
- 卡片增加「委派」徽标（`kind="delegate"`）区分 spawn 子智能体；不新增工作区分区，避免概念堆叠。
- 「对话」按钮改用新增的 `avatarSessionId` 字段跳转分身 pane，导航能力不回退；委派开始时自动弹出分身 pane 的行为保持不变（`ChatPane.tsx:12550-12566` 不动）。
- 分身 pane 的对话流本身就是委派执行过程，进度展示不依赖工作区卡片。

## In scope

- `desktop/src/store.ts`（SubAgent 类型）
- `desktop/src/utils/subagent-entry-mapper.ts`（新增纯函数 + 测试）
- `desktop/src/components/ChatPane.tsx`（SSE started/paused/completed/error 四处接入）
- `desktop/src/components/ChatView.tsx`（lite 路径同规则接入）
- `desktop/src/components/SubAgentCard.tsx`（徽标渲染）
- `desktop/locales/{zh,en}/workspace.json`（徽标文案）

## Out of scope

- 后端 SubAgentRunStore / resolver / SSE payload 结构（已带 `delegation` 与 `avatar_session_id` 字段，无需改动）
- 自动弹出分身 pane 的交互逻辑
- SpawnsColumn、run drawer、subagent-cluster-inline 等其它消费方的大改（仅做兼容性确认）
- 委派会话隔离与终态传播（已由 2026-09-09 计划完成）

## FR-1：SubAgent 模型增加 kind/avatarSessionId 与纯函数映射器

### 精确落点

- `desktop/src/store.ts:521-539` SubAgent 类型
- 新增 `desktop/src/utils/subagent-entry-mapper.ts`

### Before / After

Before：SSE 各处手写 `addSubAgent` 字段，delegation 语义只存在于局部变量 `isDelegation`，不入库、无单测。

After：

- `SubAgent` 增加 `kind?: "delegate" | "subagent"` 与 `avatarSessionId?: string`。
- 映射器提供两个纯函数（全部可单测）：
  - `mapStartedEvent(payload, requestSessionId)`：`delegation=true` 时返回 `{ sessionId: requestSessionId, avatarSessionId: payload.avatar_session_id, kind: "delegate" }`；否则 `{ sessionId: requestSessionId, kind: "subagent" }`。
  - `mapTerminalSessionPatch(payload)`：只返回 `{ avatarSessionId }`，不触碰 `sessionId`。

### AC-1

- `desktop/src/utils/subagent-entry-mapper.test.ts`：
  - 委派 started 事件 → `sessionId=发起方会话`、`avatarSessionId=分身会话`、`kind="delegate"`、`currentAction="委派执行中"`。
  - 普通 started 事件（无 `avatar_session_id`）→ `sessionId=发起方会话`、`kind="subagent"`。
  - paused/completed/error 的 patch 不含 `sessionId` 键，不会覆盖归属。

## FR-2：热路径归属修正

### 精确落点

- `ChatPane.tsx:12519-12527`（started：`sessionId` 改用 `requestSessionId`，`avatar_session_id` 只进 `avatarSessionId`）
- `ChatPane.tsx:12608-12610、12640-12642、12659-12661`（终态：移除 `sessionId` 覆盖）
- `ChatView.tsx:1960-1968、2029、2045`（lite 路径同规则）
- `App.tsx:1271-1337` syncSubAgents（确认 poll 添加/更新不再改绑；按 owner 过滤天然一致，仅审计不改）

### Before / After

Before：`sessionId = avatarSessionId || requestSessionId`；终态事件持续用 `avatar_session_id` 覆盖 `sessionId`。

After：

- started 一律 `sessionId = requestSessionId`（事件所属的发起方会话）；`avatar_session_id` 只进 `avatarSessionId` 字段。
- 终态事件的 patch 不再包含 `sessionId`。
- 新增防误绑规则：started 处理入口处，若 `isDelegation && avatarSessionId === requestSessionId`（事件到达在分身会话自身的流上），跳过跟踪 —— 委派卡片归发起方会话，分身 pane 不重复登记。`addSubAgent` 的去重（`store.ts:3180-3182`）继续作为竞态兜底。

### AC-2

- 归属行为以 AC-4 真机冒烟为准（ChatPane/ChatView 集成点不在单测可达范围）。
- 回归确认三项操作在新绑定下仍可用（均按 `agent_id` + 会话走 API，后端 cancel 有 `find_manager_for_agent` 全局兜底，`meta_tools.py:2929-2945` 的委派取消按 `from_session` 匹配）：
  - 中断（onCancelSubAgent）/ 重试（onRetrySubAgent）/ 模型切换（onModelChangeSubAgent）
  - 「对话」跳转分身 pane（改用 `subAgent.avatarSessionId || subAgent.sessionId`）
  - `desktop/src/utils/subagent-status-reconcile.ts` 相关路径不被新字段破坏

## FR-3：「委派」徽标与 i18n

### 精确落点

- `desktop/src/components/SubAgentCard.tsx`（卡片头部徽标，复用现有 pill/badge 样式）
- `desktop/locales/zh/workspace.json`、`desktop/locales/en/workspace.json`（`work.delegationBadge`：委派 / Delegated）

### AC-3

- `kind="delegate"` 的卡片显示「委派」徽标；普通 subagent 不显示。
- zh/en 文案齐备，无硬编码字符串。

## TDD 实施顺序

1. 写 `subagent-entry-mapper.test.ts`（红）→ 实现映射器（绿）。
2. ChatPane / ChatView 四处 SSE 分支接入映射器与防误绑规则。
3. SubAgentCard 徽标 + zh/en i18n。
4. 回归：相关 vitest 套件、`tsc --noEmit`、`npm run build`。
5. CDP 真机冒烟（dev 实例）：委派一个任务 → 委派卡片出现在 Meta 会话工作区且带「委派」徽标；分身 pane 工作区「子智能体」分区为空（除非分身 spawn 了 sa-\*）；「对话」仍能跳回分身 pane；中断/重试可用。

## 验证命令

```bash
cd desktop && npx vitest run src/utils/subagent-entry-mapper.test.ts src/utils/subagent-summary-message.test.ts src/utils/subagent-status-reconcile.test.ts
cd desktop && npx tsc --noEmit
cd desktop && npm run build
```

## 风险与回滚

- `sessionId` 归属变更影响取消/重试/模型切换/「对话」跳转的会话解析 → 实施时按 AC-2 逐一回归；发现依赖 `subAgent.sessionId=分身会话` 的逻辑一律改读 `avatarSessionId`。
- 双流竞态（同一委派事件同时到达 Meta 流与分身流）→ 防误绑规则 + `addSubAgent` 去重双保险。
- 回滚：恢复 ChatPane/ChatView 的 `sessionId` 赋值即可；模型新字段与映射器向后兼容，无需数据迁移。

## 实施验证记录

（2026-10-05 实施完成）

- TDD：`subagent-entry-mapper.test.ts` 先红后绿，7 用例覆盖委派/普通 started、防误绑、终态 patch 不覆盖 sessionId。
- 实施范围与计划一致，另按代码审计补充了三处计划外落点：
  - `App.tsx` syncSubAgents 轮询路径补齐 `kind`/`avatarSessionId` 映射（FR-2 AC-2 审计项）。
  - `badge-vm.ts` SubAgentRunRecord 增加 `avatar_session_id` 字段声明。
  - ChatPane/ChatView 的 `openDelegatedAvatarSession` 改用 `avatarSessionId ?? sessionId` 解析跳转目标（「对话」按钮）。
- 回归：
  - `vitest run`（desktop 全量）：8 failed / 2055 passed，failed 数与基线一致（存量 CSS/断言失败，与本次无关）。
  - `tsc --noEmit`：220 行输出与基线（stash 后对比）完全一致，零新增错误。
  - `npm run build`：通过（33.9s）。
- 待办：CDP 真机冒烟（dev 实例上委派一个任务，确认卡片出现在 Meta 工作区并带「委派」徽标）留待下次 Near dev 实例运行时执行。
