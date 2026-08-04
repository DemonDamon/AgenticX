# Plan B：Agent 运行态 Checkpoint 与崩溃恢复

Planned-with: kimi-k3
Suggested-Impl-Model: kimi-k3-max（tool_call 序列合法性是序列/一致性敏感改动）
Status: pending-review
Parent-Plan: `.cursor/plans/pending/2026-08-04-agenticx-ha-roadmap.plan.md`
Depends-On: `.cursor/plans/pending/2026-08-04-ha-session-storage-abstraction.plan.md`（FR-1 的 `load_agent_state/save_agent_state` 通路）
Covers-Gap: G-002，证据见 `research/codedeepresearch/agentscope/agentscope_ha_gap_analysis.md`

## 根因与证据链

进程崩溃后，运行中的 agent 任务直接丢失：`AgentTeamManager._tasks` 是纯内存 `asyncio.Task`（`agenticx/runtime/team_manager.py:157-191`）；启动时 `scan_interrupted_sessions`（`agenticx/studio/session_manager.py:838-866`）只把 `running` 标记为 `interrupted`，**不重启 agent loop**。现有 `_maybe_mid_turn_persist`（`agenticx/runtime/agent_runtime.py:2390`）只是消息快照，不含「第几轮 / 哪些 tool_call 未完成 / 确认门状态」，无法支撑重入。

对标机制（AgentScope）：`AgentState` 可整包序列化（`state/_state.py:32-263`）；`ChatService` 每轮 reply 结束 `finally` 落盘且 `asyncio.shield` 防取消丢写（`app/_service/_chat.py:709-849`）；锁租约过期后他副本可接管（`_service/_session.py:60-171`）。

## In scope

新增：
- `agenticx/runtime/checkpoint.py`
- `tests/test_ha_checkpoint_resume.py`

修改（只允许这些文件）：
- `agenticx/runtime/agent_runtime.py`
- `agenticx/studio/session_manager.py`
- `agenticx/runtime/confirm.py`
- `agenticx/cli/config_manager.py`（仅新增配置键）

## Out of scope

- 不做字节级流式断点续传（SSE 补发归 Plan C）。
- 不做子智能体任务原地复活：恢复时运行中子智能体统一标记 `interrupted` 并由 Meta 汇报（现状 `SubAgentRunStore` 时间线已可追溯，足够）。
- 不做跨副本「任务迁移」；多副本接管语义 = 会话锁释放后任一副本可 resume（锁由 Plan C 提供，本 plan 只提供 resume 能力本身）。
- 不改 `loop_detector.py`、`compactor.py`、`token_budget.py` 的任何策略。
- 不改 Desktop「断点续开」UI 恢复逻辑。

## FR 与 AC

### FR-1：`AgentCheckpoint` 数据模型与存取

落点：新建 `agenticx/runtime/checkpoint.py`。

```python
class AgentCheckpoint(BaseModel):
    session_id: str
    turn_id: str                 # 本轮用户输入的关联 id（run_turn 入口生成/透传）
    round_idx: int               # 已完成的最大工具轮次
    status: Literal["in_progress", "awaiting_confirm", "completed"]
    pending_tool_calls: list[dict]   # 已发出但未收到 tool 结果的 tool_call（序列化后的 dict）
    confirm_state: dict | None       # ConfirmGate 可序列化状态（FR-3）
    created_at: float
    updated_at: float
```

存取：`CheckpointStore` 类，内部委托 Plan A 的 `SessionStorageBackend.load_agent_state/save_agent_state`，key 语义 = `{"checkpoint": AgentCheckpoint.model_dump()}`；提供 `async save(cp)` / `async load(session_id) -> AgentCheckpoint | None` / `async clear(session_id)`。写失败只 log 不抛（对齐 `_persist_final_checkpoint` 的容错语义，`agent_runtime.py:2411-2420`）。

**AC-1**：`test_checkpoint_store_roundtrip`：save→load 字段一致；clear 后 load 返回 None；backend 用 local（tmp_path）与 fakeredis 各跑一遍。

### FR-2：主循环落点

落点：`agenticx/runtime/agent_runtime.py`。

- `AgentRuntime.__init__`（2286 起）：新增可选 kwarg `checkpoint_store: CheckpointStore | None = None`，存 `self._checkpoint_store`；为 None 时全部 checkpoint 逻辑短路（单机默认行为零变化）。
- `run_turn`（2558 起）入口：生成 `turn_id`（uuid4 hex），写初始 checkpoint（`status=in_progress, round_idx=0`）。
- 工具轮循环 `for round_idx in range(1, self.max_tool_rounds + 1):`（2984）：**每轮工具结果全部写回上下文之后、下一轮 LLM 调用之前**，更新 checkpoint（`round_idx=round_idx`，`pending_tool_calls=[]`）。若本轮 LLM 已返回 tool_calls 但工具尚未执行完，checkpoint 的 `pending_tool_calls` 记录这些 call。
- `_persist_final_checkpoint`（2411）现有调用点（2555）之后：turn 正常完成 → `checkpoint_store.clear(session_id)`。
- 取消/中断路径（`asyncio.CancelledError` 分支）：先写 checkpoint（保留当前 round 与 pending），再抛出——对齐 AgentScope 的 shield 语义，写操作包 `asyncio.shield`。

意图对照（before/after）：

```python
# before：崩溃后磁盘只有 messages.json，无法知道跑到第几轮
# after（伪代码，插在 2984 循环体尾部）
if self._checkpoint_store is not None:
    await asyncio.shield(self._checkpoint_store.save(AgentCheckpoint(
        session_id=..., turn_id=self._current_turn_id,
        round_idx=round_idx, status="in_progress",
        pending_tool_calls=[...], confirm_state=...,
        created_at=..., updated_at=time.time(),
    )))
```

**AC-2**：`test_checkpoint_written_per_round`：fake LLM 返回 2 轮 tool_calls 后结束；断言 checkpoint 写序列的 `round_idx` 为 0→1→2 且完成后被 clear。

### FR-3：ConfirmGate 状态序列化

落点：`agenticx/runtime/confirm.py:34-125`。

`ConfirmGate._pending`（62 行）是 `Dict[str, asyncio.Future[bool]]`，Future 不可序列化。做法：新增方法 `export_state() -> dict`（返回 `{request_id: {"question": ..., "requested_at": ...}}`，只含可序列化字段）与 `restore_state(state: dict) -> None`（重建 pending 条目为「等待外部确认」态，Future 新建）。checkpoint 的 `confirm_state` 取自 `export_state()`；resume 时调 `restore_state()`，恢复后该确认继续等待用户（超时语义不变，`AGX_CONFIRM_TIMEOUT_SEC`）。

**AC-3**：`test_confirm_gate_export_restore`：export→新实例 restore→pending keys 一致且可正常 resolve。

### FR-4：崩溃恢复入口

落点：`agenticx/studio/session_manager.py`。

- 保留 `scan_interrupted_sessions`（838-866）现有标记语义不变。
- 新增 `async def resume_interrupted_sessions(self) -> list[str]`：对 `scan_interrupted_sessions` 返回的每个 sid，`CheckpointStore.load(sid)`；有 checkpoint 且 `status != completed` → 重建 `ManagedSession`、恢复 `ConfirmGate`、以「恢复模式」重入 `AgentRuntime.run_turn`：上下文 = 磁盘消息（现状加载路径）+ 系统提示追加一行「本会话从崩溃中恢复，已完成 N 轮工具调用，请基于现有上下文继续」（文案常量写在 checkpoint.py，禁止自由发挥多语言版本）；`pending_tool_calls` 对应的 assistant tool_calls 消息若已在上下文尾部，则先重放工具执行补齐 tool 消息再进下一轮——**这是保证 provider 400 不出现的关键不变量**：重入前上下文必须过 `_sanitize_context_messages`（`agent_runtime.py:1222`）清洗。
- 开关：env `AGX_RESUME_INTERRUPTED` > `runtime.resume_interrupted`，默认 `false`（保守）；HA 模式（`AGX_HA_MODE=redis`）下默认 `true`。
- 调用点：`server.py` lifespan 启动序列中 `scan_interrupted_sessions` 之后追加 `await session_manager.resume_interrupted_sessions()`（改 server.py 须遵守该文件红线：精确增行 + 冷启动 smoke）。

**AC-4**：`test_resume_from_checkpoint`：构造「round 2 完成、round 3 的 tool_calls 已发出未执行」的 checkpoint + 磁盘消息；调 `resume_interrupted_sessions`；断言：(1) 重入后首轮 LLM 收到的上下文通过 `_sanitize_context_messages` 校验（assistant tool_calls 均有配对的 tool 消息）；(2) fake LLM 被调用时 `round_idx` 从 3 开始；(3) 完成后 checkpoint cleared、`execution_state=idle`。
**AC-5**：`test_resume_disabled_by_default`：默认配置下 `resume_interrupted_sessions` 为空操作。

### FR-5：子智能体边界语义

落点：`session_manager.py` 的 resume 路径内。恢复主会话时，若 `SubAgentRunStore`（`agenticx/runtime/subagent_runs/store.py:27`）中存在该会话 `status=running` 的 run，统一标记为 `interrupted` 并在恢复后的首条系统提示中列出（供 Meta 汇报）。不重启子任务。

**AC-5**：`test_resume_marks_subagents_interrupted`：预置 running run 记录，resume 后其状态为 interrupted。

## 发现的非目标问题（记录，不修）

- `AgentTeamManager._registry` 是类级全局表（`team_manager.py:159`），多副本下会互相可见——Plan C 的会话锁到位前，HA 模式文档须注明「同一会话同一时间只应在一个副本活跃」。
- `_mid_turn_persist` 30s/3 工具的频率在 redis 模式下可能造成写放大——实施时观测，若明显则在 Plan A 回执中建议调阈值，不在本 plan 改默认值。

## 验证

```bash
pytest tests/test_ha_checkpoint_resume.py -v
pytest tests/ -k "agent_runtime or confirm or session_manager" -q
# 手工：agx serve 起一个会跑多轮工具的会话，round 进行中 kill -9，AGX_RESUME_INTERRUPTED=1 重启，观察会话从断点继续且最终完成
```
