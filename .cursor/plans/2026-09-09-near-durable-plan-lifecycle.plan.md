---
name: Near durable plan lifecycle
overview: 将现有单轮 Plan intent 升级为项目内 Markdown 驱动的持久计划生命周期：Plan 模式按任务复杂度决定是否产出计划，计划卡片可查看和 Build，实施过程原子回写 Todo 状态并可跨会话恢复与 Git 回溯。
todos:
  - id: plan-artifact-core
    content: 实现受控的项目内 Plan Markdown 创建、读取与原子状态更新
    status: completed
  - id: plan-mode-routing
    content: 将 Plan 模式改为按需规划并开放受控 plan_create/plan_update 工具
    status: completed
  - id: plan-card-ui
    content: 实现 Created Plan 卡片、专属 Markdown 预览与实时 Todo 状态
    status: completed
  - id: plan-build-flow
    content: 实现当前会话 Build，执行态覆盖 Plan 限制且保留用户 Plan 偏好
    status: completed
  - id: plan-regression
    content: 补齐 Python/Vitest 回归并验证完整 Plan → Build → Todo 闭环
    status: completed
isProject: true
---

# Near 持久 Plan 生命周期

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: GPT-5.6 Sol（跨 Python runtime、Desktop SSE/状态与持久化协议，需强推理收口）

> **For implementer:** 仅按本文件实施。保留现有 Multitask/isolate 语义，不改群聊与 automation，不改 Enterprise。`agenticx/studio/server.py` 不在本计划范围内；不得触碰其顶部敏感 import。不得把普通 `todo_write` 与持久 Plan Todo 混成同一存储。

## Goal

把 Near 当前“Plan 开关 + 只读工具过滤”升级为可回溯的完整生命周期：

1. 用户开启 Plan 后，简单问答仍直接回答；只有需要多步实施的请求才创建计划。
2. 计划以 Markdown 落在当前项目 `<workspace>/.agenticx/plans/*.plan.md`，不是聊天气泡里的临时文本。
3. 聊天中显示 Created Plan 卡片，可打开专属 Markdown 预览，也可点击 Build。
4. Build 在当前会话继续实施；Plan 偏好仍保持开启，但本次 Build 请求显式以执行模式运行。
5. 实施器通过受控工具把 Todo 从 `pending → in_progress → completed` 原子回写到同一 Markdown；卡片轮询磁盘并实时更新。
6. Plan 文件随项目进入 Git，后续提交可用 `Plan-Id` / `Plan-File` 回溯。

## 已确认产品决策

- 运行时计划目录：项目内 `.agenticx/plans/`。
- Build 执行位置：当前会话，不新建实施会话。
- Plan 是持久偏好，不再在一次发送成功后自动清除。
- Plan 模式是“允许并优先规划”的策略，不是“每条消息必须产出 Plan”。
- 计划状态以磁盘 Markdown 为单一来源；聊天消息只保存 plan id/path 快照用于定位。

## 根因与现状证据

### 当前 Plan 只是单轮工具过滤

- `agenticx/runtime/plan_mode.py::apply_turn_intent_to_session` 仅把请求中的 `plan_mode` 布尔值挂到 `StudioSession`。
- `filter_tools_for_turn_intent` 删除写工具；`_PLAN_MODE_BLOCK` 要求模型返回自然语言计划并等待确认。
- 没有专用 `plan_create` / `plan_update` 工具，因此 runtime 无法可靠区分“普通回答”和“正式计划”，也无法把计划落盘。
- `desktop/src/utils/turn-intent.ts::consumeTurnIntentAfterAcceptedSend` 当前把 Plan 当成 one-turn intent；这与“Plan 保持开启、按需规划”的目标冲突。

### 当前 UI 没有 Plan Artifact

- `desktop/src/components/composer/ComposerModeMenu.tsx` 与 `TurnIntentChip.tsx` 只负责开关和 chip。
- `ChatPane.tsx` 只向 `/api/chat` 发送 `plan_mode=true`；没有 Build 请求覆盖。
- `MessageRenderer.tsx` 对工具消息统一走 `ToolCallCard`，没有专用 Plan 卡片。
- 已有 `WorkPanel` / `loadAbsoluteFilePreview` 可复用来打开本地 Markdown，不需要新增 Studio 文件读取 API。

### 可复用机制

- `agenticx.utils.atomic_writer.atomic_write_text`：原子写 Markdown。
- `agenticx/cli/agent_tools.py`：Studio 工具 schema、路径根解析和 dispatch 的统一入口。
- `Message.metadata` / `toolName` / `toolArgs`：持久消息可携带 Plan 定位信息。
- `ChatPane.sendChatRef` 已支持 `suppressUserEcho`、`skipUserHistory`、`lockedSessionId`，适合 Build 的隐藏执行指令。
- `window.agenticxDesktop.statLocalPath` 与 `loadAbsoluteFilePreview`：前端读取并轮询项目内 Plan 文件。

## 生命周期

Plan 状态：

- `ready`：计划已创建，等待 Build。
- `building`：用户已点击 Build，至少一个 Todo 为 `in_progress`。
- `completed`：全部非 cancelled Todo 已完成。
- `cancelled`：用户或实施器显式取消。

Todo 状态：

- `pending`
- `in_progress`
- `completed`
- `cancelled`

状态约束：

- 同一计划最多一个 `in_progress` Todo。
- `plan_update(todo_status="in_progress")` 自动把此前的 `in_progress` 退回 `pending`，除非它已经 completed/cancelled。
- 全部有效 Todo completed 后，计划自动转 `completed`。
- Build 开始时先把计划转 `building`，但不由前端直接改文件；隐藏执行指令要求实施器第一步调用 `plan_update(action="start")`。
- 所有更新采用“读取 → 校验 plan_id → 修改 frontmatter → 原子替换”。

## Markdown 数据契约

每个运行时 Plan 使用以下 frontmatter；正文保存模型生成的完整实施说明：

```yaml
---
plan_id: 2026-09-09-feature-slug-a1b2c3d4
name: Feature name
overview: One-line outcome
status: ready
session_id: session-uuid
created_at: 2026-09-09T00:00:00+00:00
updated_at: 2026-09-09T00:00:00+00:00
planned_with: provider/model
todos:
  - id: stable-todo-id
    content: Concrete task
    status: pending
---
```

正文中的 checklist 仅用于阅读；UI 与更新工具只认 frontmatter `todos`，避免正文自由格式导致状态解析漂移。

工具结果必须返回单行 JSON，便于历史消息恢复：

```json
{
  "type": "plan_artifact",
  "action": "created",
  "plan_id": "2026-09-09-feature-slug-a1b2c3d4",
  "path": "/abs/project/.agenticx/plans/2026-09-09-feature-slug-a1b2c3d4.plan.md",
  "name": "Feature name",
  "overview": "One-line outcome",
  "status": "ready",
  "todos": [{"id": "task-1", "content": "Concrete task", "status": "pending"}]
}
```

## In scope

- Meta 单聊的 Plan 模式。
- 当前 pane/session 的 Plan 偏好持久化。
- 当前可写 taskspace 下的 `.agenticx/plans/`。
- `plan_create` 与 `plan_update` 两个受控工具。
- Created Plan 卡片、Todo 状态、View Plan、Build。
- 当前会话 Build；隐藏指令不产生新的用户气泡。
- 历史消息恢复后重新读取磁盘 Plan。
- 中英文 UI 文案。

## Out of scope

- 群聊成员共同编辑 Plan。
- automation 会话创建或 Build Plan。
- 在线协同编辑、评论、审批流。
- 多 Plan 并行 Build、依赖图、甘特图。
- 自动执行 git commit 或 push。
- 修改历史已有自然语言计划并迁移成 Markdown。
- 修改 `agenticx/core/plan_storage.py` 的通用 Planner 存储；它是另一套内存/SQLite 抽象，不作为 Desktop Plan 单一来源。
- 修改 `agenticx/studio/server.py`。
- Enterprise 目录。

---

## FR-1：项目内受控 Plan Artifact

### 精确落点

- 新建 `agenticx/runtime/plan_artifacts.py`
  - `PlanArtifactTodo`
  - `PlanArtifact`
  - `create_plan_artifact(session, arguments)`
  - `update_plan_artifact(session, arguments)`
  - `read_plan_artifact(path)`
  - `_resolve_plan_root(session)`
  - `_validate_plan_path(session, path)`
  - `_render_plan_markdown(plan, body)`
- 修改 `agenticx/cli/agent_tools.py`
  - `STUDIO_TOOLS`：新增 `plan_create` / `plan_update` schema。
  - `_TOOL_REQUIRED_PARAMS` 由 schema 自动收集，无需平行表。
  - `dispatch_tool_async`：分派两个工具。
- 新建 `tests/test_plan_artifacts.py`

### 路径规则

`_resolve_plan_root(session)`：

1. 从 `session.taskspaces` 找 `active_taskspace_id` 对应且 `mount_mode != "reference"` 的 path。
2. 否则找 id=`default` 且可写的 path。
3. 否则使用 `session.workspace_dir`。
4. 解析为绝对路径后追加 `.agenticx/plans`。
5. 创建目录只能发生在 `plan_create`，不能在 read/validation 时隐式创建。

`_validate_plan_path`：

- 只允许 `<resolved writable taskspace>/.agenticx/plans/*.plan.md`。
- 禁止 `..`、symlink escape、其他 session/project 的绝对路径。
- `plan_update` 必须同时校验文件 frontmatter 的 `plan_id` 与参数一致。

### `plan_create` 参数

```python
{
    "name": str,
    "overview": str,
    "todos": [{"id": str, "content": str}],
    "body_markdown": str,
}
```

校验：

- name/overview/body 非空。
- todos 2–20 条；id 匹配 `^[a-z0-9][a-z0-9_-]{0,63}$` 且唯一。
- content 非空，最多 300 字。
- slug 由 name 生成；空 slug 回落 `plan`；文件名增加 8 位随机后缀防冲突。
- `planned_with` 从 `session.provider_name` + `session.model_name` 读取，不猜测。

### `plan_update` 参数

```python
{
    "plan_id": str,
    "plan_path": str,
    "action": "start" | "set_todo" | "cancel",
    "todo_id": str | None,
    "todo_status": "pending" | "in_progress" | "completed" | "cancelled" | None,
    "outcome": str | None,
}
```

### AC

- 创建后文件位于 `<workspace>/.agenticx/plans/`，frontmatter 和正文可重新解析。
- reference taskspace 不会成为 Plan 根。
- 越界 path、plan_id 不匹配、重复 todo id 均明确报错且不改磁盘。
- 更新 Todo 后仅目标字段、`updated_at` 与派生 plan status 变化。
- 原子写失败保留旧文件。

---

## FR-2：Plan 模式按需规划

### 精确落点

- 修改 `agenticx/runtime/plan_mode.py`
  - `TURN_INTENT_ALLOWED_TOOLS` 加入 `plan_create`、`plan_update`。
  - 重写 `_PLAN_MODE_BLOCK`。
  - 保留 mutating tool 拦截及两次违规终止保护。
- 修改 `agenticx/tools/policy.py::PlanModeLayer.read_only_tools`
  - 同步加入两个受控 Plan 工具，避免 policy 与 runtime 名单漂移。
- 修改 `tests/test_plan_mode_runtime.py`

### 新 Prompt 语义

Before：

```text
You are in plan mode. Produce a plan; do not implement the request.
```

After：

```text
Plan mode is a planning preference, not a requirement to create a plan for every message.
For simple questions, explanations, or requests that do not require implementation, answer normally.
For a multi-step implementation/change request:
1. inspect only what is needed with read-only tools;
2. call plan_create exactly once with a self-contained implementation plan;
3. do not implement;
4. tell the user the plan is ready and wait for Build.
Use plan_update only to revise an existing plan artifact.
```

### AC

- Plan 模式工具集中有 `plan_create` / `plan_update`，仍无 `file_write` / `bash_exec` / delegate。
- Prompt 明确简单问答不强制创建 Plan。
- Prompt 明确实施请求必须通过 `plan_create` 落盘，禁止仅输出临时自然语言计划。
- automation/isolate 仍覆盖 Plan。

---

## FR-3：Plan 偏好持久化且支持 Build 执行覆盖

### 精确落点

- 修改 `desktop/src/utils/turn-intent.ts`
  - 删除 `consumeTurnIntentAfterAcceptedSend`。
  - 新增 `resolveRequestTurnIntent(paneIntent, override?)`。
- 修改 `desktop/src/utils/turn-intent.test.ts`
- 修改 `desktop/src/components/ChatPane.tsx`
  - 删除成功发送后自动 `setPaneTurnIntent(..., "default")`。
  - `sendChatRef` options 增加 `turnIntentOverride?: TurnIntent`。
  - 组装 request body 时使用 override，仅影响当次请求。
  - 新增 `buildPlanInCurrentSession(plan)` callback。

### Build 隐藏指令

点击 Build：

```ts
sendChatRef.current(
  [
    "[PLAN_BUILD]",
    `Implement the approved plan at ${plan.path}.`,
    "Read the plan first.",
    "Call plan_update(action=\"start\") before implementation.",
    "Before each todo, mark it in_progress; after verification, mark it completed.",
    "Do not create a replacement plan.",
  ].join("\n"),
  {
    lockedSessionId: pane.sessionId,
    suppressUserEcho: true,
    skipUserHistory: true,
    forceSend: true,
    turnIntentOverride: "default",
  },
)
```

Build 按钮点击后本地卡片可先显示 `starting`，但不得伪造磁盘 `building`；收到 `plan_update(action=start)` 结果或下一次轮询读到 building 后再显示 Building。

### AC

- 普通发送成功后 Plan chip 仍保持。
- Plan 开启时普通请求发送 `plan_mode=true`。
- Build 请求发送 `plan_mode=false`，但 pane.turnIntent 仍为 `plan`。
- Build 不产生新的用户气泡，实施输出仍写入原 session。
- isolateActive 行为不变。

---

## FR-4：Created Plan 卡片与专属预览

### 精确落点

- 新建 `desktop/src/utils/plan-artifact.ts`
  - `PlanArtifactPayload` / `PlanTodo`
  - `parsePlanArtifactToolResult(raw)`
  - `parsePlanMarkdown(text)`
  - `derivePlanProgress(plan)`
- 新建 `desktop/src/utils/plan-artifact.test.ts`
- 新建 `desktop/src/components/messages/PlanArtifactCard.tsx`
- 修改 `desktop/src/components/messages/MessageRenderer.tsx`
  - toolName 为 `plan_create` / `plan_update` 且 payload 可解析时走 `PlanArtifactCard`。
  - 新增 `onBuildPlan` prop 并透传。
- 修改 `desktop/src/components/ChatPane.tsx`
  - 向 MessageRenderer 提供 View/Build callbacks。
- 修改 `desktop/src/i18n/locales/zh/chat.json`
- 修改 `desktop/src/i18n/locales/en/chat.json`

### 卡片结构

- 顶部：`Created Plan` / `Building Plan` / `Completed Plan`。
- 标题：plan name。
- 摘要：overview，最多四行。
- Todo：默认展开，逐行展示 pending/in_progress/completed/cancelled；completed 使用删除线。
- 底部：
  - `View Plan`：调用已有 workspace preview 打开 `.plan.md`。
  - `Build`：ready 时可用。
  - `Building…`：building/starting 时禁用。
  - completed 时显示 `Completed`。
- 文件丢失/解析失败：显示就近错误，Build 禁用，不退回原始 JSON 工具卡。

### 状态刷新

- 首次渲染从 tool result 快照立即显示。
- 随后用 `loadAbsoluteFilePreview(plan.path)` 读取磁盘权威状态。
- ready 状态每 3 秒轮询；starting/building 每 1 秒轮询；completed/cancelled 停止轮询。
- 组件卸载或 path 变化时清理 timer，禁止跨会话更新旧卡。

### 专属预览

- 复用 WorkPanel 的 Markdown 文件预览，不新增弹窗。
- View Plan 传 absolutePath 给 `openWorkspaceFilePreview`。
- Markdown frontmatter 可显示；Todo checklist 由现有 Markdown renderer 渲染。

### AC

- `plan_create` 成功结果渲染 Plan 卡，不显示通用工具 JSON。
- 历史消息重载后仍能通过 path 恢复最新状态。
- completed Todo 有勾选/删除线，当前 in_progress 有明确状态。
- View Plan 打开同一个磁盘文件。
- Build 只在 ready 且文件存在时启用。

---

## FR-5：Todo 实时回写和 Git 回溯

### 精确落点

- `agenticx/runtime/plan_artifacts.py::update_plan_artifact`
- `agenticx/runtime/plan_mode.py::_PLAN_MODE_BLOCK`
- `desktop/src/components/messages/PlanArtifactCard.tsx`
- 测试同 FR-1/FR-4

### 行为

- Build 实施器必须通过 `plan_update` 更新状态，不使用聊天 session 的 `todo_write` 替代。
- `plan_update` 返回完整最新 snapshot，Plan 卡可立即更新；磁盘轮询作为跨刷新/跨会话兜底。
- Plan 正文底部固定生成：

```markdown
## Traceability

- Plan-Id: <plan_id>
- Plan-File: .agenticx/plans/<filename>
```

- 若用户后续要求 commit，提交消息使用这两个值；本功能本身不自动提交。

### AC

- Plan 文件本身包含稳定 Plan-Id / Plan-File。
- Todo 每次更新后刷新页面仍保持。
- 同一 Plan 从 ready 到 building 再到 completed 的历史工具消息不影响磁盘单一来源。
- 不修改 `messages.json` 中旧 plan snapshot；UI 总是优先磁盘最新值。

---

## 测试顺序（TDD）

### Python

1. 新建 `tests/test_plan_artifacts.py`，先写：
   - create path/frontmatter/body
   - active/default workspace selection
   - reference root rejection
   - path escape rejection
   - duplicate todo rejection
   - start/set_todo/auto-complete
   - atomic failure preserves original
2. 运行：

```bash
pytest tests/test_plan_artifacts.py -q --no-cov
```

预期 RED：module/function 不存在。

3. 实现最小 core 和工具 dispatch。
4. 运行：

```bash
pytest tests/test_plan_artifacts.py tests/test_plan_mode_runtime.py -q --no-cov
```

预期 GREEN。

### Desktop

1. 先改 `desktop/src/utils/turn-intent.test.ts`，断言 Plan 不再消费、Build override 为 default。
2. 新建 `desktop/src/utils/plan-artifact.test.ts`，覆盖 tool result/frontmatter/progress/error。
3. 运行：

```bash
cd desktop
npx vitest run src/utils/turn-intent.test.ts src/utils/plan-artifact.test.ts
```

预期 RED 后再实现。

4. 实现 Card 与 ChatPane 接线。
5. 运行：

```bash
cd desktop
npx vitest run src/utils/turn-intent.test.ts src/utils/plan-artifact.test.ts
npm run typecheck
```

### 回归

```bash
pytest tests/test_plan_artifacts.py tests/test_plan_mode_runtime.py tests/test_agent_runtime.py -q --no-cov
cd desktop && npx vitest run src/utils/turn-intent.test.ts src/utils/plan-artifact.test.ts src/utils/session-artifacts.test.ts
```

若修改 `agenticx/studio/server.py`（按计划不应修改），必须额外做 `agx serve` 冷启动及核心 API 200 smoke；正常实施不得为了省事把 API 塞进 server.py。

## No-scope-creep 边界

- 不顺手重构 14k 行 `ChatPane.tsx`；只增加 options、Build callback 和 renderer prop。
- 不重构通用 ToolCallCard。
- 不把 `.cursor/plans` 用作 Near 用户运行时目录；产品运行时统一 `.agenticx/plans`。
- 不自动 git add/commit/push 用户项目。
- 不让 `plan_create` 获得任意文件写权限。
- 不把 Plan 状态仅存在 Zustand/localStorage；磁盘 Markdown 必须是权威源。
- 不实现多人协作和计划依赖图。

## 子任务推荐模型

- Plan Artifact Python core + 安全边界：GPT-5.6 Sol；路径安全与原子更新回归风险较高。
- Plan mode prompt/tool 接线：Composer 2.5；改动集中、测试明确。
- Desktop Plan 卡片与 Build：GPT-5.6 Sol；涉及长组件接线、异步状态和历史恢复。
- 测试与跨栈收口：GPT-5.6 Sol；需验证单一来源与执行覆盖不串状态。

## Definition of Done

- 开启 Plan 后问简单问题不会强制创建 Plan。
- 提出多步实现需求时，agent 通过 `plan_create` 生成项目内 `.agenticx/plans/*.plan.md`。
- 聊天出现专用 Plan 卡片，View Plan 打开同一 Markdown。
- 点击 Build 后在当前会话执行，Plan chip 仍保持，实际请求不受 Plan 写工具限制。
- Todo 状态由 `plan_update` 原子回写并在卡片上实时变化。
- 重启/切换会话后卡片从磁盘恢复最新状态。
- 所有指定 Python/Vitest/typecheck 验证通过。
