# 长程任务回放 03：从稳定步骤安全分叉继续

Planned-with: gpt-5.6-sol-medium

Suggested-Impl-Model: gpt-5.6-sol-medium

Status: pending

Plan-Id: 2026-09-10-long-run-replay-03-safe-step-branch

Parent-Plan: `.cursor/plans/pending/2026-09-10-long-run-replay-branching-master.plan.md`

Depends-On:

- `.cursor/plans/pending/2026-09-10-long-run-replay-01-event-ledger.plan.md`
- `.cursor/plans/pending/2026-09-10-long-run-replay-02-desktop-replay.plan.md`

## Goal

允许用户在完成的长程任务回放中选择任意历史语义事件，并从该事件之前最近的稳定检查点创建新 session。新 session 继承当时模型可见上下文；对受控 Git isolate 任务，还恢复当时工作树内容。源任务不被截断，前缀工具不重跑，新指令通过现有聊天发送链路继续执行。

## User-visible semantics

示例：用户在回放中点击“工具调用 #101”并输入“不要继续用 bash，改用 file_edit”。

系统行为：

1. 找到 `#101` 之前最近的稳定检查点；
2. 该检查点必须位于包含工具 #100 结果的完整上下文之后；
3. 原工具 #101 的 assistant tool call 和 result 均不进入分支；
4. 创建新 session 和新 isolate worktree；
5. 恢复 #100 之后的 logical context 与 Git tree；
6. 打开新 pane；
7. 展示 lineage card；
8. 通过现有 send pipeline 发送新指令；
9. 新 run 记录 `parent_run_id/forked_from_event_id/forked_from_seq`。

## Critical distinction

本计划实现的是：

- **逻辑状态分叉**
- **受控 Git 工作区状态分叉**

本计划不实现：

- 进程内存、PID、PTY、TCP、浏览器登录态的恢复；
- 外部 API 副作用回滚；
- 从半条 token 或未完成 tool call 内部恢复。

UI 和导出必须使用“从步骤分叉”，不能写“完整恢复整个沙箱”。

## In scope

- 已完成、失败或中断 run 的稳定逻辑检查点。
- 单一受控 Git isolate worktree 的内容快照与恢复。
- tool call 到其前一个稳定边界的解析。
- 新 session、新 pane、新 run 与双向 lineage。
- 分支前外部写入和未知副作用的明确警告。
- 分支创建后通过现有聊天发送链路执行新指令。

## Out of scope

- 正在运行的源 session 原地分叉。
- 非 Git 目录的字节级快照。
- 多个可写 Git 根或 dirty submodule。
- 进程、内存、PTY、Socket、浏览器会话恢复。
- 外部系统回滚或 branch-local 模拟。
- 子智能体内部任意事件的独立分叉；第一期只从所属 Studio session 的稳定主上下文分叉。
- 自动运行多个分支、打分或合并。

## Exact files

Create:

- `agenticx/runtime/replay_ledger/context_checkpoint.py`
- `agenticx/runtime/replay_ledger/workspace_snapshot.py`
- `agenticx/runtime/replay_ledger/branch_service.py`
- `tests/test_run_context_checkpoint.py`
- `tests/test_run_workspace_snapshot.py`
- `tests/test_run_branch_service.py`
- `tests/test_run_branch_api.py`
- `desktop/src/components/replay/BranchFromStepDialog.tsx`
- `desktop/src/components/replay/BranchLineageCard.tsx`
- `desktop/src/components/replay/branch-client.ts`
- `desktop/src/components/replay/branch-client.test.ts`
- `desktop/src/components/replay/BranchFromStepDialog.test.tsx`

Modify:

- `agenticx/runtime/replay_ledger/contracts.py`
  - 新增主规划冻结的 `ContextCheckpoint`、`WorkspaceSnapshotRef`。
- `agenticx/runtime/replay_ledger/recorder.py`
  - 在稳定边界写 context/workspace checkpoint；
  - run 起点写初始 workspace snapshot。
- `agenticx/runtime/replay_ledger/store.py`
  - checkpoint content-addressed 读写；
  - Git ref 清理登记。
- `agenticx/studio/run_replay_routes.py`
  - `POST /api/runs/{run_id}/branches`。
- `agenticx/studio/session_manager.py`
  - 新增 `fork_session_from_checkpoint(...)`，不得改坏现有 `fork_session()`。
- `agenticx/runtime/isolate_run.py`
  - 只新增“从已验证 tree 创建 isolate”的 helper；
  - 保留现有 ensure/adopt/discard 行为。
- `desktop/src/components/replay/RunReplayPanel.tsx`
- `desktop/src/components/replay/ReplayTimeline.tsx`
- `desktop/src/components/replay/ReplayEventDetail.tsx`
- `desktop/src/utils/session-message-map.ts`
  - 识别 `metadata.branch_lineage`，仅供 lineage card。
- `desktop/src/components/messages/MessageRenderer.tsx`
  - 对 branch lineage system row 渲染 `BranchLineageCard`。
- `desktop/locales/zh/workspace.json`
- `desktop/locales/en/workspace.json`

不修改 Enterprise。`server.py` 已在 01 注册 routes，本期不再碰其 import 区。

## FR-1: stable boundary detection

`context_checkpoint.py`：

```python
def latest_tool_batch_is_complete(messages: list[dict[str, Any]]) -> bool:
    ...

def context_is_branch_stable(
    event: RunEvent,
    agent_messages: list[dict[str, Any]],
) -> tuple[bool, str]:
    ...
```

规则：

- `tool_result` 事件只有在最近 assistant `tool_calls[]` 的每个 id 都有后续 `role=tool/tool_call_id=id` 时稳定；
- 不允许依赖 `_sanitize_context_messages` 自动丢掉未配对调用后再说稳定；
- `confirm_response` / `clarification_response` 必须已写入 agent messages；
- `run_completed` 稳定；
- `tool_call`、`tool_progress`、`confirm_required`、`clarification_required`、TOKEN 起止、stall 不稳定；
- 任意 ledger gap 之后的事件默认不稳定；
- stable context 写入前再通过 `_sanitize_context_messages`，并断言所有 assistant tool calls 成对。

AC:

- 单工具 result 后稳定；
- 并行 3 个 tool calls，只收到前 2 个 result 时不稳定；
- 第 3 个 result 后稳定；
- tool call #101 映射到之前的稳定 checkpoint；
- pending confirm 不稳定；
- gap 后禁用。

## FR-2: context checkpoint capture

每个稳定边界写 `ContextCheckpoint`。内容：

- sanitized `agent_messages`
- 截止当前边界的 `chat_history`
- `context_files`
- `taskspaces`
- `active_taskspace_id`
- JSON-safe `scratchpad`
- `artifacts`
- todo items
- provider/model
- session mode
- current system prompt SHA-256
- workspace ref

过滤：

- 去掉 `scratchpad` 中 Future、lock、live connection 等不可序列化值；
- 保留 `subagent_result::*`、plan mode、isolate state和用户任务状态；
- 不保存 `mcp_hub`、LLM client、confirm Future；
- `chat_history` 每行保留原 id/role/content/tool metadata/attachments/timestamp；
- context checkpoint gzip + content hash 去重。

run record 保存 `checkpoint_count` 和 `last_branchable_seq`。

写失败：

- event 保留；
- event `branchable=false`；
- `unbranchable_reason=context_checkpoint_failed`；
- 原任务继续。

AC:

- 100 个稳定边界可读取；
- 相同 context hash 去重；
- checkpoint 无 unpaired tool call；
- JSON 非法 scratchpad 值被跳过并记 warning；
- context 文件与 taskspace 路径保持。

## FR-3: workspace snapshot

`workspace_snapshot.py`：

```python
def capture_git_workspace_snapshot(
    session: StudioSession,
    *,
    session_id: str,
    run_id: str,
    seq: int,
) -> WorkspaceSnapshotRef:
    ...

def restore_git_workspace_snapshot(
    snapshot: WorkspaceSnapshotRef,
    *,
    target_session_id: str,
) -> dict[str, str]:
    ...

def delete_snapshot_refs(session_id: str) -> None:
    ...
```

捕获前置条件：

- `load_isolate_state(session)` 返回有效 worktree；
- worktree 位于 `AGX_ISOLATE_ROOT` / 默认 isolate root 内；
- repo root、worktree 都通过 `resolve(strict=True)`；
- 只存在一个可写 Git 根；
- 无 dirty submodule；
- `git status --porcelain=v1 -z` 成功。

敏感路径：

- 先应用 `permissions.path_rules` 的 deny；
- 再拒绝 basename / glob：`.env`、`.env.*`、`credentials*.json`、`*secret*`、`*.pem`、`*.key`；
- 若这些路径有变更，不静默漏掉，整个 snapshot 标 `branchable=false/sensitive_path_changed`。

大文件：

- 任何新增/修改文件 > 20 MiB → `large_file_changed`；
- 不把文件内容打印到日志；
- 路径日志仅记录相对路径。

性能：

- run 开始捕获初始 tree；
- 后续只在稳定边界且自上次 snapshot 后出现 `local_write/unknown` 事件时重新构建；
- `tree_oid` 与上次相同则复用 workspace ref；
- read-only 工具直接复用上个 workspace ref。

临时 index：

- 必须设置独立 `GIT_INDEX_FILE`；
- 必须在 `finally` 删除；
- 不运行 `git add` 于真实 index；
- 不 checkout/reset/clean 用户 checkout；
- ref 使用 `refs/agenticx/replay/...`；
- ref 名各段只允许 `[A-Za-z0-9._-]`，其他字符替换 `_`。

AC:

- tracked 修改、删除、非 ignored untracked 文件进入 tree；
- `.gitignore` 文件不进入；
- 真实 index hash 捕获前后相同；
- tree 未变化复用；
- sensitive/large/submodule dirty 禁用；
- 两个 session refs 隔离；
- cleanup 只删目标 session refs。

## FR-4: restore workspace without visible synthetic commit

`restore_git_workspace_snapshot`：

1. 在 isolate root 为新 session 创建新目录；
2. `git worktree add -b agx-branch/<safe-id> <dest> <base_sha>`；
3. 在新 worktree 执行 `git read-tree --reset -u <tree_oid>`；
4. 在新 worktree执行 `git reset --mixed <base_sha>`，只用于把 snapshot 内容恢复成未提交 working state；
5. 验证 `git write-tree`（临时 index）重新得到同一 `tree_oid`；
6. 返回 `isolate_run.save_isolate_state` 所需 state。

如果任一步失败：

- 删除新 worktree和新 branch；
- 不改源 worktree；
- API 返回具体 `workspace_restore_failed:<stage>`；
- 不创建半成品 session，或若 session 已创建则立即清理。

AC:

- 新 worktree文件字节等于 snapshot；
- `git log` 不出现 synthetic snapshot commit；
- 源 worktree status 不变；
- 新分支与源分支独立；
- 故障注入每个 stage 都清理。

## FR-5: branch checkpoint resolution

`branch_service.py`：

```python
def resolve_branch_checkpoint(
    *,
    events: list[RunEvent],
    requested_event_id: str,
) -> tuple[RunEvent | None, str]:
    ...
```

规则：

- 选中 branchable event：使用该事件 checkpoint；
- 选中 tool_call：只搜索 `seq < selected.seq` 的最近 branchable event；
- 选中 tool_result 但该 batch 未完成：搜索更早 checkpoint；
- 选中 final：可使用 final checkpoint；
- 不跨 ledger gap；
- 找不到返回 `no_stable_checkpoint`；
- 返回请求事件和解析事件，UI 必须同时展示。

AC:

- 工具 101 → checkpoint 100；
- 并行 batch 中间 result → batch 前 checkpoint；
- batch 最后 result → 当前 checkpoint；
- gap 前可分、gap 后不可分；
- event id 不存在明确 404。

## FR-6: create branch session

`BranchService.create_branch(...)` 参数：

```python
source_run_id: str
source_event_id: str
instruction: str
provider: str | None
model: str | None
```

执行顺序：

1. 验证 instruction 非空且 <= 20_000 字符；
2. 加 source session branch lock；
3. source `execution_state == running` → 409；
4. 加载 run/events/checkpoint；
5. 检查 run completeness 与 checkpoint branchable；
6. 汇总 checkpoint 之前 `external_write/unknown` 事件为 warnings，只返回工具名/数量，不回显敏感参数；
7. 如果 workspace mode=git，先创建新 isolate worktree；
8. `SessionManager.create()` 新 session；
9. 复制 avatar binding、provider/model、session mode；
10. 恢复 context checkpoint；
11. 写 scratchpad reserved key：

```json
{
  "run_branch_lineage": {
    "parent_session_id": "...",
    "parent_run_id": "...",
    "source_event_id": "...",
    "source_seq": 101,
    "resolved_checkpoint_event_id": "...",
    "resolved_checkpoint_seq": 100
  }
}
```

12. chat history 末尾追加仅 UI 可见的 system notice row：

```json
{
  "role": "system",
  "content": "",
  "system_notice": true,
  "metadata": {
    "branch_lineage": {
      "parent_session_id": "...",
      "parent_run_id": "...",
      "requested_seq": 101,
      "restored_seq": 100
    }
  }
}
```

该 row 不进入 `agent_messages`。

13. 持久化新 session；
14. 返回 session id、lineage、warnings、原 instruction；
15. 释放锁。

分支 endpoint 不直接启动 SSE，不自行执行 instruction。Desktop 成功打开新 pane 后通过现有 chat send pipeline 发送 instruction。

AC:

- source running 返回 409；
- 新 session context 截止 resolved checkpoint；
- 原 tool 101 不在 agent_messages；
- 原 session hash 不变；
- provider/model override 生效；
- lineage cold restart 后仍在；
- 两次从同一节点分叉得到两个不同 session/worktree。

## FR-7: branch API

在 `run_replay_routes.py` 新增 Pydantic request model，禁止裸 dict：

```python
class CreateRunBranchRequest(BaseModel):
    source_event_id: str = Field(min_length=1, max_length=128)
    instruction: str = Field(min_length=1, max_length=20_000)
    provider: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=256)
```

接口：

```text
POST /api/runs/{run_id}/branches
```

返回和错误码按 master plan。所有底层异常转换为可定位 code + detail；detail 不包含 secret、token、完整命令参数。

AC:

- schema 校验 422；
- token auth；
- 404/409 语义稳定；
- success 包含 requested/resolved 两个事件；
- response 不泄漏 payload。

## FR-8: Desktop branch interaction

`ReplayEventDetail` 在以下条件显示按钮：

- run 已完成/failed/interrupted，不是 running；
- event 或其前缀存在 resolved checkpoint；
- API event `branchable=true` 或 `unbranchableReason` 可解释。

按钮文案“从此前分叉”，不是“重试”。

`BranchFromStepDialog`：

- 主体背景、遮罩和输入框使用设置弹层语义 token；
- 宽度不超过 640px；
- 显示：
  - 请求步骤 `#requestedSeq`；
  - 实际恢复步骤 `#resolvedSeq`；
  - “此前 N 个工具不会重新执行”；
  - workspace 状态；
  - external/unknown effect 警告；
  - instruction textarea；
  - provider/model selector；
- 底部“取消”紧靠主按钮左侧；
- 创建中显示阶段：
  - 验证检查点；
  - 恢复工作区；
  - 创建会话；
  - 准备继续；
- 失败时保留弹层、输入和底层 code/detail。

提交成功：

1. `addPane` / `setPaneSessionId` 立即打开新 pane；
2. 加载新 session messages，显示 lineage card；
3. 调用提取后的公共发送函数发送 instruction；
4. 发送失败时把 instruction 放回新 pane composer，并显示就近错误。

如果 `ChatPane` 当前发送逻辑无法外部调用，只允许做一次机械抽取：

- 从 `ChatPane.tsx` 抽 `sendTextToPane(...)` 到 `desktop/src/chat/send-text-to-pane.ts`；
- 原发送路径和分支发送共同调用；
- 不改变现有 queue、interrupt、attachment、model、vision、permission 行为；
- 必须用现有测试证明普通发送未回归。

AC:

- modal 保留失败输入；
- success 打开新 pane；
- branch instruction 只发送一次；
- 一侧 pane 分叉不改变其他 pane 模型；
- lineage card cold reload 仍显示；
- 普通聊天发送测试保持。

## FR-9: lineage rendering

`BranchLineageCard` 是紧凑系统卡：

- “从「源会话标题」的步骤 #101 分叉”
- “实际恢复至稳定步骤 #100”
- 点击可打开源 session 并定位对应 replay event；
- 不显示粗边框；
- 不作为 assistant 气泡；
- 不参与复制普通消息正文；
- 允许多个分支形成链，显示直接 parent，不递归加载整棵树。

源 run detail 的 branch count 通过 run index 查询；ReplaySummaryBar 显示分支数。

AC:

- mapLoadedSessionMessage 识别 lineage metadata；
- MessageRenderer 走专用 card；
- 点击源链接打开正确 session/run/event；
- 缺源 session 时卡片仍显示 id 摘要且不崩。

## Safety invariants

- 分支不能绕过当前版本 hooks、权限确认、path policy、command sandbox、MCP allowlist。
- checkpoint 内旧的 confirm approval、一次性 allowlist、连接对象不得恢复。
- MCP 连接按新 session 当前配置重新建立；不复制 live transport。
- 外部副作用只警告，不声称回滚。
- `source_session_running` 时禁止分叉，避免 checkpoint 与继续写入竞态。
- 不执行用户 checkout 上的 reset/clean/checkout。
- 私有 snapshot ref 不进入 commit message、PR 或普通 branch list UI。

## Verification

Python：

```bash
/opt/miniconda3/bin/python -m pytest \
  tests/test_run_context_checkpoint.py \
  tests/test_run_workspace_snapshot.py \
  tests/test_run_branch_service.py \
  tests/test_run_branch_api.py \
  tests/test_replay_ledger_store.py \
  tests/test_replay_ledger_recorder.py \
  tests/test_ha_checkpoint_resume.py \
  tests/test_session_manager_persistence.py \
  -q --no-cov
```

Desktop：

```bash
cd desktop
npm test -- \
  src/components/replay/branch-client.test.ts \
  src/components/replay/BranchFromStepDialog.test.tsx \
  src/components/replay/RunReplayPanel.test.tsx \
  src/utils/session-message-map.test.ts
npm run typecheck
npm run build
```

端到端手工验收：

1. 在 isolate code-dev session 中执行至少 5 个工具，其中第 3 个修改文件；
2. 完成后打开回放；
3. 选择第 4 个 tool call；
4. 输入不同实现指令；
5. 确认新 pane 打开；
6. 确认新 worktree 文件状态等于第 3 个工具完成后；
7. 确认第 4、5 个原工具没有出现在新 Agent context；
8. 确认源 worktree未变化；
9. 在新分支继续修改；
10. 两边 diff 独立；
11. 测试一次 external/unknown tool 历史，弹层显示不可回滚警告；
12. 测试非 Git workspace，按钮禁用并解释原因。

## Done definition

- 工具 101 可以从工具 100 后创建新 session；
- 前 100 个工具不重跑；
- 新 LLM context tool pairs 合法；
- Git workspace 精确恢复且源工作区不变；
- 外部副作用不被误称为已回滚；
- 不可分叉状态有具体原因；
- 分支 lineage 可跨重启追溯；
- Python、Desktop 和端到端验收全部通过。
