---
name: subagent-ux-implementation
overview: 修复子智能体路径偏航、轮次上限、不可对话、失败不可恢复四类问题，并补齐前后端联动与回归测试。
todos:
  - id: p1-workspace-context
    content: 补齐 StudioSession.workspace_dir 并在 server/repl 初始化
    status: pending
  - id: p1-subagent-prompt
    content: 实现子智能体专用 system prompt 并接入 run_turn
    status: pending
  - id: p2-round-policy
    content: 子智能体 max_tool_rounds=25，并新增 checkpoint/paused 事件
    status: pending
  - id: p3-subagent-chat
    content: 打通 ChatRequest.agent_id、server 分流、team_manager 子智能体消息注入
    status: pending
  - id: p4-retry-flow
    content: 实现 retry_subagent（meta tool + server endpoint + team manager）
    status: pending
  - id: p4-frontend-actions
    content: 前端新增子智能体对话/重试入口与发送目标切换
    status: pending
  - id: verify
    content: 补测试并运行 pytest + lint，确认无回归
    status: pending
isProject: false
---

# 子智能体 UX 优化实施计划

## 目标与验收

- 子智能体默认在用户指定工作目录内执行，不再盲扫 `~/`。
- 复杂任务不再频繁触发“达到最大工具调用轮数”即失败，改为可感知检查点与暂停语义。
- 用户可在桌面端选择某个子智能体直接追问。
- 失败后的子智能体可一键重试（保留关键上下文）。

## 实施阶段

### Phase 1：工作目录与角色约束注入（优先）

- 扩展 `[/Users/damon/myWork/AgenticX/agenticx/cli/studio.py](/Users/damon/myWork/AgenticX/agenticx/cli/studio.py)` 的 `StudioSession`，新增 `workspace_dir` 并在 REPL 初始化。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/studio/server.py](/Users/damon/myWork/AgenticX/agenticx/studio/server.py)` 创建 session 时写入 `workspace_dir`（`AGX_WORKSPACE_ROOT` 或 `os.getcwd()`）。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py](/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py)` 新增 `_build_subagent_system_prompt(context, session)`，注入：`name/role/task/workspace_dir/context_files` 以及“禁止系统目录盲扫”规则。

### Phase 2：轮次策略与可观测性

- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py](/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py)` 中对子智能体 runtime 使用更高上限（25 轮）。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/agent_runtime.py](/Users/damon/myWork/AgenticX/agenticx/runtime/agent_runtime.py)` 增加每 8 轮一次 `subagent_checkpoint` 事件。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/events.py](/Users/damon/myWork/AgenticX/agenticx/runtime/events.py)` 增加 `subagent_checkpoint`/`subagent_paused` 枚举；子智能体超限发 `subagent_paused`（meta 保持原 error 语义）。

### Phase 3：子智能体对话通道

- 在 `[/Users/damon/myWork/AgenticX/agenticx/studio/protocols.py](/Users/damon/myWork/AgenticX/agenticx/studio/protocols.py)` 给 `ChatRequest` 增加 `agent_id`。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py](/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py)` 新增 `send_message_to_subagent(agent_id, message)`，把用户追问注入目标子智能体会话。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/studio/server.py](/Users/damon/myWork/AgenticX/agenticx/studio/server.py)` 的 `/api/chat` 支持 `agent_id!=meta` 分支。
- 在 `[/Users/damon/myWork/AgenticX/desktop/src/components/ChatView.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/ChatView.tsx)` 增加“当前对话目标”为选中子智能体时的发送逻辑与 UI 标识。

### Phase 4：失败恢复与重试

- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py](/Users/damon/myWork/AgenticX/agenticx/runtime/team_manager.py)` 新增 `retry_subagent(agent_id, refined_task=None)`。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/runtime/meta_tools.py](/Users/damon/myWork/AgenticX/agenticx/runtime/meta_tools.py)` 增加 `retry_subagent` 工具，并在 `[/Users/damon/myWork/AgenticX/agenticx/cli/agent_tools.py](/Users/damon/myWork/AgenticX/agenticx/cli/agent_tools.py)` 加入 `META_TOOL_NAMES`。
- 在 `[/Users/damon/myWork/AgenticX/agenticx/studio/server.py](/Users/damon/myWork/AgenticX/agenticx/studio/server.py)` 增加 `POST /api/subagent/retry`。
- 在 `[/Users/damon/myWork/AgenticX/desktop/src/components/SubAgentCard.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SubAgentCard.tsx)` 与 `[/Users/damon/myWork/AgenticX/desktop/src/components/SubAgentPanel.tsx](/Users/damon/myWork/AgenticX/desktop/src/components/SubAgentPanel.tsx)` 增加“对话/重试”按钮与回调。

## 验证与回归

- 补充并运行 `[/Users/damon/myWork/AgenticX/tests/test_meta_tools.py](/Users/damon/myWork/AgenticX/tests/test_meta_tools.py)`（覆盖 `retry_subagent` 及工具调度）。
- 对本次改动文件执行 lint/诊断，确保无新增错误。
- 手测路径：
  1. 指定目标目录任务，确认不再从 `~/` 扫描起步；
  2. 长任务可见 checkpoint；
  3. 选中子智能体后可直接追问；
  4. failed 后可点重试并生成新子智能体。

