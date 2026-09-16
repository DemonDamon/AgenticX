# 长程任务回放 01：权威事件账本与回放 API

Planned-with: gpt-5.6-sol-medium

Suggested-Impl-Model: gpt-5.6-sol-medium

Status: pending

Plan-Id: 2026-09-10-long-run-replay-01-event-ledger

Parent-Plan: `.cursor/plans/pending/2026-09-10-long-run-replay-branching-master.plan.md`

Depends-On: `.cursor/plans/pending/2026-09-09-near-personal-control-01-run-ledger.plan.md`

## Goal

在不改变 Agent 执行结果的前提下，把每次 Studio `AgentRuntime.run_turn()` 的语义事件可靠写入 append-only ledger，并提供分页读取、run 详情和确定性导出 API。该子规划完成后，后续 Desktop 可以在不重跑任何工具的情况下实现完整只读回放。

## Architecture

新增独立 `agenticx.runtime.replay_ledger` 包。`AgentRuntime` 只依赖一个可选 recorder protocol；未注入 recorder 时行为与现在完全一致。recorder 在 `run_turn` 外层观察现有 `RuntimeEvent`，不侵入每个工具分支；同时在 turn 开始时补 `run_started/user_message`，在 terminal 时补 `run_completed`。

本期本地 JSONL 是权威来源。`messages.json`、Graph、OTel、`ExecutionTrajectory` 都只是其他投影，不能反向覆盖 ledger。

`SubAgentRunStore` 不属于本期 JSONL 的替代对象。spawn/delegate 的身份、状态、activity 和 artifact 继续由依赖计划统一为 canonical store；Replay API 只按 `source_tool_call_id` 嵌套读取，不创建第二份 sub-agent DTO 或 activity 文件。

本期不向 `SessionStorageBackend` 增加 Redis append API：用户目标是本机 Desktop 跨重启回放，Personal Control Plane 也明确排除多副本 HA。`ReplayLedgerStore` 的 `sessions_root` 必须由 `SessionManager` 注入，禁止自行硬编码 `Path.home()`；未来出现多副本回放需求时，再新增独立 `ReplayLedgerBackend`，不能把 JSONL 细节塞进现有 message/agent_state channel。

SessionEventHub 的 live seq 与 Replay Ledger seq 是两套有意隔离的编号：前者只用于 bounded SSE reattach，可能因进程重启归零；后者是持久 run 内单调序号。前端不得拿 live seq 作为历史 branch seq。

## In scope

- 主会话和分身会话的 `run_turn` ledger。
- Studio loop 入口的 ledger。
- 崩溃后沿用原 `run_id`，不创建伪造的新 run。
- tool call/result 成对关联、round、确认、澄清、错误、final、usage、artifact refs。
- 子智能体 run 通过 `source_tool_call_id` 引用 canonical `SubAgentRunStore`，在 Replay projection 中嵌套展示；其内部 activity 保留自己的 seq，不混入主 turn 的 branch seq。
- 分页 API、run 详情、确定性 Markdown / JSON 导出。
- ledger 完整性与 gap 标记。

## Out of scope

- Desktop UI。
- 历史节点分叉。
- Git workspace snapshot。
- Redis ledger backend。
- 重写 `SubAgentRunStore`。
- token-by-token 持久化。
- 为旧 session 反向伪造完整 ledger。

## Exact files

Create:

- `agenticx/runtime/replay_ledger/__init__.py`
- `agenticx/runtime/replay_ledger/contracts.py`
- `agenticx/runtime/replay_ledger/store.py`
- `agenticx/runtime/replay_ledger/recorder.py`
- `agenticx/runtime/replay_ledger/effects.py`
- `agenticx/runtime/replay_ledger/export.py`
- `agenticx/studio/run_replay_routes.py`
- `tests/test_replay_ledger_store.py`
- `tests/test_replay_ledger_recorder.py`
- `tests/test_run_replay_api.py`
- `tests/test_run_replay_export.py`

Modify:

- `agenticx/runtime/agent_runtime.py`
  - `AgentRuntime.__init__`，约 L2714–2735；
  - `run_turn`，约 L3127–3218。
- `agenticx/runtime/checkpoint.py`
  - `AgentCheckpoint`，约 L45–55，新增可选 `run_id`。
- `agenticx/studio/session_manager.py`
  - `_resume_one_interrupted_session` 中 `AgentRuntime(...)`，约 L1219–1236；
  - session 删除路径，调用 ledger cleanup。
- `agenticx/studio/server.py`
  - 顶部 import 只精确新增 `ReplayLedgerRecorder` 与 `register_run_replay_routes`；
  - 主 chat 的 `AgentRuntime(...)`，约 L3564–3573；
  - loop 的 `AgentRuntime(...)`，约 L4544–4552；
  - `create_studio_app()` 内注册 routes，一处。

所有新 Python 文件必须使用英文 docstring/comment，顶部包含 `Author: Damon Li`，且只用绝对 import。

## FR-1: contracts and validation

在 `contracts.py` 实现主规划冻结的 `ReplayRunRecord`、`RunEvent`，并新增：

```python
RUN_STATUSES = frozenset(
    {"running", "completed", "failed", "cancelled", "interrupted"}
)
COMPLETENESS_VALUES = frozenset({"complete", "partial"})
EFFECT_CLASSES = frozenset(
    {"none", "read", "local_write", "external_write", "unknown"}
)
```

`from_dict()` 规则：

- 缺失 optional 字段回落默认；
- `seq < 1` 抛 `ValueError`；
- 空 `event_id/run_id/session_id/type` 抛 `ValueError`；
- 未知 `effect_class` 归一为 `unknown`；
- 未知 schema version 允许读取基础字段，但 `branchable=False`。

AC:

- `test_run_event_roundtrip`
- `test_run_event_rejects_invalid_sequence`
- `test_unknown_effect_class_becomes_unknown`
- `test_future_schema_event_is_readable_but_not_branchable`

## FR-2: append-only local store

`ReplayLedgerStore` 构造参数必须允许测试注入：

```python
class ReplayLedgerStore:
    def __init__(self, sessions_root: Path | None = None) -> None:
        ...
```

默认 root 复用 Studio sessions root 解析逻辑，不能再次硬编码与 `SessionManager` 不同的路径。对外方法：

```python
open_run(record: ReplayRunRecord) -> ReplayRunRecord
append_event(run_id: str, event: RunEvent) -> RunEvent
mark_partial(run_id: str, reason: str) -> ReplayRunRecord
close_run(run_id: str, status: str, completed_at: float) -> ReplayRunRecord
get_run(run_id: str) -> ReplayRunRecord | None
list_runs(session_id: str) -> list[ReplayRunRecord]
read_events(run_id: str, after_seq: int = 0, limit: int = 100,
            event_types: set[str] | None = None) -> tuple[list[RunEvent], bool]
write_blob(run_id: str, value: Any) -> str
read_blob(run_id: str, blob_ref: str) -> Any | None
delete_session_runs(session_id: str) -> None
```

写入规则：

- run 目录内 `.lock` 使用现有跨进程 file lock helper；找不到可复用 helper时使用 `fcntl` 仅限本地 backend，并为 Windows 提供 `msvcrt` 分支。
- `append_event` 在锁内读取 `run.last_seq`，强制 `event.seq == last_seq + 1`；recorder 传 `seq=0` 时由 store 分配。
- JSONL 每行一次 `write + flush + os.fsync`，随后原子更新 `run.json`。
- `event_id` 已存在时幂等返回原事件，不重复 append。
- `write_blob` 用 canonical JSON（`sort_keys=True,separators=(",", ":")`）计算 SHA-256，gzip 写临时文件后 `os.replace`；同 hash 已存在直接复用。
- `read_events` 遇到单行坏 JSON时跳过该行，并将 run 标记 `partial/corrupt_event_line`；不得让 API 500。

AC:

- `test_append_assigns_strictly_monotonic_seq`
- `test_duplicate_event_id_is_idempotent`
- `test_parallel_append_has_no_duplicate_sequence`
- `test_cold_restart_preserves_run_and_events`
- `test_corrupt_line_marks_partial_and_keeps_readable_rows`
- `test_blob_content_addressing_deduplicates_payload`
- `test_delete_session_runs_removes_only_target_session`

## FR-3: effect classification

`effects.py` 提供：

```python
def classify_tool_effect(tool_name: str, arguments: dict[str, Any]) -> str:
    ...
```

规则：

- `file_read/list_files/file_search/grep_search/web_search/web_fetch/knowledge_search/session_search` → `read`
- `file_write/file_edit/todo_write/scratchpad_write` → `local_write`
- `request_action_confirmation` → `none`
- `bash_exec/bash_bg_start` 调 `assess_command(command)`：
  - findings 含 `external_publish` 或不可逆宿主动作 → `external_write`
  - 只含 workspace write → `local_write`
  - 无法证明只读或本地写 → `unknown`
- `mcp_call`、Computer Use、浏览器 click/type → `unknown`
- 消息、审批、日历、Git remote write 的已知工具名 → `external_write`
- 未识别工具 → `unknown`

不得复制 `COMMAND_RISK_CATEGORIES`。

AC:

- `test_read_tool_effect`
- `test_file_edit_is_local_write`
- `test_bash_external_publish_reuses_command_safety`
- `test_unknown_mcp_is_unknown`
- `test_external_message_tool_is_external_write`

## FR-4: recorder

`ReplayLedgerRecorder`：

```python
class ReplayLedgerRecorder:
    def __init__(
        self,
        *,
        store: ReplayLedgerStore,
        session_id: str,
        agent_id: str,
        provider: str | None,
        model: str | None,
        resume_run_id: str | None = None,
    ) -> None:
        ...

    def start_turn(self, *, turn_id: str, user_input: str,
                   history_metadata: dict[str, Any] | None = None) -> str:
        ...

    def observe(self, event: RuntimeEvent, *, session: StudioSession,
                round_idx: int | None = None) -> None:
        ...

    def finish(self, status: str) -> None:
        ...
```

Normalization：

- `start_turn` 开 run 并写 `run_started`、`user_message`。
- 第一个 TOKEN 只写 `assistant_output_started`；后续 TOKEN 不写。
- FINAL 写 `assistant_output_completed` 和 `run_completed`；完整正文/reasoning/usage 写 blob。
- TOOL_CALL 写完整 arguments blob，并缓存 `tool_call_id -> event_id`。
- TOOL_RESULT 的 `parent_event_id` 必须指向对应 TOOL_CALL；完整 result/structured 写 blob。
- 确认、澄清、错误、compaction、stall 原样转为白名单事件。
- recorder 的任何异常被捕获并 `mark_partial`，不得抛进 agent loop。
- 单个 runtime 只允许一个 active run；重复 `start_turn` 抛内部错误并被调用方降级为 recorder disabled。

AC:

- fake runtime 两轮工具后 FINAL，断言序列包含：
  `run_started,user_message,round_started,tool_call,tool_result,round_started,tool_call,tool_result,round_started,assistant_output_started,assistant_output_completed,run_completed`
- 1000 TOKEN 只产生一条 output-start 和一条 output-completed。
- TOOL_RESULT parent 指向 TOOL_CALL。
- recorder 故障时原 `AgentRuntime` 仍 FINAL。
- tool args/result 完整值可从 payload_ref 读回。

## FR-5: AgentRuntime wiring

在 `AgentRuntime.__init__` 新增：

```python
run_recorder: ReplayLedgerRecorder | None = None
```

不要让 runtime import 具体 Local store。`run_turn`：

1. 现有 checkpoint store 生成/恢复 `turn_id`；
2. recorder `start_turn`；
3. 对 `_run_turn_inner` 的每个 event，先 `recorder.observe(...)` 再 yield；
4. 正常 FINAL → `finish("completed")`；
5. ERROR terminal → 根据现有 failure 判断 `failed/interrupted`；
6. generator cancel → `finish("interrupted")`；
7. ledger 异常不改变 yield 序列。

`AgentCheckpoint` 新增 `run_id: str | None = None`。写 checkpoint 时记录 recorder 当前 run id；resume 时 `ReplayLedgerRecorder(resume_run_id=checkpoint.run_id)`，继续原 run 并写一条 `run_resumed`，禁止开第二个 run。

AC:

- 扩展 `tests/test_ha_checkpoint_resume.py`：
  - checkpoint roundtrip 保留 run id；
  - resume 后 run 数量仍为 1；
  - seq 继续增长；
  - run 含 `run_resumed`。
- 现有 `_collect_events` 断言保持不变，证明 ledger 未修改 RuntimeEvent 输出。

## FR-6: Studio lifecycle wiring

`server.py` 主 chat 与 loop 构造 runtime 时注入 recorder。构造 helper 放在 `replay_ledger/recorder.py`：

```python
def recorder_for_session(
    manager: SessionManager,
    session_id: str,
    *,
    agent_id: str,
) -> ReplayLedgerRecorder | None:
    ...
```

helper 获取 sessions root、provider/model。失败返回 None 并 log。

子智能体：

- 不修改 `team_manager.py`、`meta_tools.py` 的 canonical 写链；
- Replay API 从依赖计划提供的 resolver 读取 `SubAgentRunStore`；
- 主 ledger 中 `delegate_to_avatar` / `spawn_subagent` 的 tool call id 是 parent anchor；
- 子 run activity 作为嵌套 timeline 返回，保留自己的局部 seq，禁止伪造主 ledger 全局 seq。

删除 session 时，`SessionManager.delete()` 在确认消息目录删除成功后调用 `ReplayLedgerStore.delete_session_runs()`；若 runs 已包含在 session 目录删除中，该方法仍负责清除后续子规划使用的 Git refs。

AC:

- `test_studio_main_turn_creates_one_run`
- `test_loop_turns_create_ordered_runs`
- `test_subagent_reference_events_link_source_tool_call`
- `test_session_delete_removes_run_index`

## FR-7: replay API

`run_replay_routes.py` 使用 `APIRouter` 或 `register_run_replay_routes(app, manager, check_token)`，不要继续把大段 handler 堆进 `server.py`。

接口：

```text
GET /api/runs?session_id=
GET /api/runs/{run_id}
GET /api/runs/{run_id}/events?after_seq=&limit=&types=
GET /api/runs/{run_id}/export?format=markdown|json&redact=true
```

校验：

- 所有接口调用 `check_token`；
- `limit` 范围 1..500；
- run 的 session 必须存在或有持久化记录；
- `types` 只保留事件白名单；
- events 返回 `next_seq` 与 `has_more`；
- detail 默认不展开 blob；`include_payload=true` 仅 events endpoint 支持，并仍受 500 条上限。

旧 session 无 run：

```json
{
  "ok": true,
  "runs": [],
  "legacy_summary_available": true,
  "reason": "no_replay_ledger"
}
```

不得从 messages 自动伪造 run。

AC:

- token 缺失 / 错误时沿用现有 401/403 语义；
- 分页 120 条事件按 50/50/20 读取，无重复；
- types filter 只返回指定类型；
- legacy session 返回空 runs + reason；
- corrupt row 返回 200 + run completeness partial。

## FR-8: deterministic export

`export.py`：

```python
def export_run_markdown(
    record: ReplayRunRecord,
    events: list[RunEvent],
    *,
    resolve_payload: Callable[[str], Any | None],
    redact: bool = True,
) -> str:
    ...
```

Markdown 固定结构：

- 标题
- Run metadata
- 原始指令
- Outcome
- Timeline（序号、相对时间、主体、事件、摘要）
- Tool calls（工具、参数摘要、结果状态、耗时）
- Confirmations / clarifications
- Errors / gaps
- Artifacts
- Branch lineage

脱敏：

- key 名匹配 `api_key|apikey|authorization|token|secret|password|cookie` 时值替换为 `[REDACTED]`；
- bearer token 正则替换；
- 不修改本地 ledger 原文；
- JSON `redact=false` 仍只通过 Desktop token 暴露。

AC:

- 同一输入两次导出 byte-identical；
- Markdown 包含 100 个工具事件且顺序一致；
- 常见 secret 字段与 Bearer 不出现在默认导出；
- `redact=false` JSON 可保留本地原值；
- gap 明确显示“记录不完整”，不伪造缺失步骤。

## Verification

先运行单测：

```bash
/opt/miniconda3/bin/python -m pytest \
  tests/test_replay_ledger_store.py \
  tests/test_replay_ledger_recorder.py \
  tests/test_run_replay_api.py \
  tests/test_run_replay_export.py \
  tests/test_ha_checkpoint_resume.py \
  tests/test_smoke_subagent_run_store.py \
  -q --no-cov
```

再运行 runtime / session 回归：

```bash
/opt/miniconda3/bin/python -m pytest \
  tests/test_session_manager_persistence.py \
  tests/test_studio_server.py \
  tests/test_smoke_session_turn_completion.py \
  tests/test_smoke_session_event_hub.py \
  -q --no-cov
```

因为修改 `agenticx/studio/server.py`，必须冷启动：

```bash
agx serve --host 127.0.0.1 --port 8769
```

另一个终端用 Desktop token 验证：

- `/api/session`
- `/api/avatars`
- `/api/sessions`
- `/api/runs?session_id=<test-session>`

均不得因 import 或 route 注册崩溃。

## Done definition

- 新 run 默认有 durable ledger；
- 100+ 工具不截断；
- 冷重启可分页读取；
- 只读 API 不触发执行；
- crash resume 延续同一 run；
- ledger 失败不拖垮 Agent；
- 旧会话诚实显示无完整账本；
- 所有测试及 cold-start smoke 通过。
