---
name: Near 委派会话隔离与事件驱动收口
overview: 新委派任务默认创建全新的分身执行会话，仅同一 delegation_id 的跟进复用原会话；同时禁止 Meta 通过 shell sleep 阻塞等待，确保 paused/completed/failed 状态可靠通知并避免受控终局被误判为 Incomplete。
todos:
  - id: delegation-session-isolation
    content: 测试先行实现每次新委派创建独立分身会话并保留追溯关系
    status: completed
  - id: delegation-wait-guard
    content: 禁止 Meta 在活跃委派后通过 shell sleep 阻塞当前轮
    status: completed
  - id: delegation-terminal-events
    content: 补齐 paused 终态传播并保持同一 delegation 的跟进会话
    status: completed
  - id: delegation-stall-consistency
    content: 修正 reasoning-only 暂停与受控终局 Incomplete 误判
    status: completed
  - id: delegation-regression
    content: 完成 Python、Vitest、类型检查和 Desktop 构建回归
    status: completed
isProject: true
---

# Near 委派会话隔离与事件驱动收口实施计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: GPT-5.6 Sol（跨 Python Runtime、Studio SSE 与 Desktop 状态机，涉及并发、持久化和回归敏感逻辑）

## 目标

消除数字分身新委派复用历史会话造成的上下文污染，并让 Meta 在发起后台委派后立即结束当前轮，由持久化 run ledger、运行时事件和 Desktop 状态同步负责后续完成/暂停/失败汇报。

## 根因与证据链

1. `agenticx/runtime/meta_tools.py::_find_or_create_avatar_session()` 当前按 `avatar_id` 返回最近未归档 session；只有完全没有历史时才调用 `SessionManager.create()`。
2. `delegate_to_avatar` 再由 `_run_delegation_in_avatar_session()` 将任务追加到该 session，造成不同任务共享历史。
3. 会话 `a6ad368d-b48d-48a3-9c25-2926fea1a4ad` 的 `dlg-43ac914c` 复用了已有旧任务的 `6ca62fac-6647-4e84-8320-81f9c7ff9077`。
4. Meta 首次查询 running 后自发执行 `bash_exec sleep 90`，造成 SSE 静默；第二次查询被防轮询终止后又可能被 Desktop 标成 Incomplete。
5. Studio 子智能体消息流终态集合遗漏 `subagent_paused`。

## 产品决策

- 每次新的 `delegate_to_avatar` 创建新 session，不继承该分身旧消息。
- 只有同一 `delegation_id` 的补充、暂停后继续或重试复用原 `avatar_session_id`。
- 普通分身单聊的最近会话恢复行为不变。
- 新委派 session 仍继承 Meta session 的 taskspaces、context_files 与沙箱权限。
- Meta 不阻塞等待；终态通过事件、run ledger 与 Desktop 自动汇报。

## In scope

- `agenticx/runtime/meta_tools.py`
- `agenticx/runtime/agent_runtime.py`
- `agenticx/runtime/prompts/meta_agent.py`
- `agenticx/studio/server.py`
- 必要时仅为委派元数据修改 `agenticx/studio/session_manager.py`
- `desktop/src/utils/task-stall-policy.ts`
- 对应 Python / Vitest 测试

## Out of scope

- 普通分身单聊 session 策略
- `spawn_subagent` 调度模型
- 全量重构 SessionManager、SubAgentRunStore 或 Desktop pane
- 自动重试任意失败任务、模型选择策略、工具轮次配置
- `agenticx/studio/server.py` 顶部 import 区的任何无关调整

## FR-1：新委派强制使用全新分身 session

### 精确落点

- `agenticx/runtime/meta_tools.py::_find_or_create_avatar_session`
- `dispatch_meta_tool_async()` 的 `delegate_to_avatar` 分支
- `_send_message_to_delegation` 与现有 delegation lookup 路径

### Before / After

当前调用 `_find_or_create_avatar_session()`，会返回该 avatar 最近会话。改为先扫描同 avatar 是否有运行中委派；无并发后生成 `delegation_id`，再调用 `_create_avatar_delegation_session()` 无条件 `SessionManager.create()`。

新 helper 设置 provider/model、`avatar_id`、`avatar_name`、任务摘要标题，以及：

```python
managed.session_kind = "delegation"
managed.delegation_id = delegation_id
managed.parent_owner_session_id = owner_session_id
```

新 session 的聊天历史天然为空；跟进路径继续按 `delegation_id` 定位已有 session，不新建。

### AC-1

- 新增 `tests/test_meta_tools_delegation_session.py::test_new_delegations_create_distinct_avatar_sessions`。
- 同一 avatar 连续两次新委派返回不同 `avatar_session_id`；第二个 session 不含第一次任务文本。
- 两个 session 各自保存不同 delegation ID，均绑定同一 avatar。

### AC-2

- `test_delegation_session_inherits_source_workspace_context`：taskspaces/context_files 仍继承。
- `test_followup_reuses_delegation_avatar_session`：同一 dlg 跟进不新建。
- `test_second_delegation_is_blocked_while_same_avatar_is_running`：保留防并发。

## FR-2：Meta 禁止 shell sleep 阻塞等待

### 精确落点

- `agenticx/runtime/agent_runtime.py::AgentRuntime.run_turn` 工具执行前
- `agenticx/runtime/prompts/meta_agent.py` 委派规则

当 Meta session 有 running delegation，且 `bash_exec` / `bash_bg_start` 是以 `sleep` 或 shell builtin `wait` 为首命令的纯等待命令时，返回受控 tool result，不执行。解析必须锚定命令边界，不误伤业务脚本中出现的字符串。

### AC-3

- `tests/test_agent_runtime.py::test_meta_blocks_pure_shell_sleep_while_delegation_running`。
- fake executor 未调用；非 Meta、无活跃委派、普通包含 sleep 文本的命令不受影响。

## FR-3：paused/completed/failed 终态可靠传播

### 精确落点

- `agenticx/studio/server.py::_subagent_message_stream` 的 `terminal_types`
- `agenticx/runtime/meta_tools.py::_run_delegation_in_avatar_session`

将 `subagent_paused` 加入终态集合；保持 run ledger、team event、pending summary 三重兜底，不新增轮询。

### AC-4

- 扩展 `tests/test_smoke_delegation_paused.py`，断言 paused 同时进入 `_delegation_info`、pending summary 与 team event。
- Studio 流测试或纯 helper 测试断言 paused 为终态。

## FR-4：状态一致性与 reasoning-only fail-fast

### 精确落点

- `desktop/src/utils/task-stall-policy.ts::lastTurnHasCompletedAssistantReply`
- `desktop/src/utils/task-stall-policy.ts::shouldTriggerIncompleteEndStall`
- `agenticx/runtime/agent_runtime.py` reasoning-only retry 分支

带 `metadata.turn_terminal === true` 和非空正文的受控状态查询终局视为完成，不进入 Channel C Incomplete；只有 reasoning、无正文仍不完整。真实委派连续 reasoning-only 且无新工具调用时，以 `SUBAGENT_PAUSED(detector="reasoning_only_stall")` 提前暂停，不新增状态枚举。

### AC-5

- `desktop/src/utils/task-stall-policy.test.ts` 新增状态查询受控终局不触发 Incomplete。
- 保留 reasoning-only 触发 Incomplete 的既有用例。
- Python 新增委派 reasoning-only fail-fast 测试。

## TDD 实施顺序

1. 写 FR-1 测试并确认因 session 复用失败。
2. 实现新 session helper与跨 session 防并发；运行至绿。
3. 写 FR-2 测试并确认 sleep 会执行；实现精准门禁与提示。
4. 写 FR-3/FR-4 测试并确认当前缺口；实现最小事件和状态修复。
5. 运行完整相关回归、类型检查与 Desktop build。

## 验证命令

```bash
pytest -q tests/test_meta_tools_delegation_session.py tests/test_smoke_delegation_paused.py tests/test_agent_runtime.py
cd desktop && npm test -- --run src/utils/task-stall-policy.test.ts
cd desktop && npx tsc --noEmit
cd desktop && npm run build
```

修改 `agenticx/studio/server.py` 后额外执行临时端口冷启动及 `/api/session`、`/api/avatars`、`/api/sessions` 核心 API smoke。

## 风险与回滚

- 每次委派新增 session 会增加历史条目；`session_kind="delegation"` 为后续分组保留语义，本次不重构列表。
- 必须先扫描运行中委派再创建，避免拒绝并发时留下空 session。
- 纯等待识别不得宽泛 substring 匹配。
- 回滚 delegate 分支 helper 即可恢复旧行为；新增元数据字段向后兼容。

## 实施验证记录

- 新增与本次行为直接相关的 Python 测试全部通过；组合回归 73 项中 72 项通过。
- 唯一失败为既有 `test_skip_user_history_still_persists_display_user`：单独复跑仍得到 `[1, 1, 1, 2] != [1, 2]`，与本次委派分支无关，本次不越界修改。
- `npx vitest run src/utils/task-stall-policy.test.ts`：70 项通过。
- `npm run build`：通过。
- `npx tsc --noEmit`：仓库当前存在大量既有类型错误，本次修改文件未新增 IDE lint 错误；生产构建中的 TypeScript 编译步骤通过。
- `python -m compileall` 与 `git diff --check`：通过。
- `agx serve --host 127.0.0.1 --port 18766` 冷启动成功；`/api/session`、`/api/avatars`、`/api/sessions` 均返回 200。
- 首次 smoke 使用 shell 中不可用的 `curl` 命令失败，改用绝对路径 `/usr/bin/curl` 后通过。
