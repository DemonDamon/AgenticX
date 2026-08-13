# deepseek-harness AgenticX Gap Analysis

Locked upstream SHA: `47f943859bef60e4160492346772ded9b24f765a`  
User goal: 将 DeepSeek Harness 核心 harness、尤其长程任务稳定执行，沉淀进 AgenticX 底层框架。  
Verdict input: 无合格 P0 → 有合格 P1 → `SELECTIVE_ADOPT`。

## AgenticX Evidence

| Capability | Path | Symbol | Current behavior |
|------------|------|--------|------------------|
| Studio 热路径 agent loop | `agenticx/runtime/agent_runtime.py` | `AgentRuntime.run_turn` (~L2851) | LLM + 工具轮次，上限 `max_tool_rounds`；SSE `RuntimeEvent` |
| 历史配对清洗 | `agenticx/runtime/agent_runtime.py` | `_sanitize_context_messages` L1417–1516 | **剥离**未配对 `tool_calls`，不合成错误 tool 结果 |
| 崩溃 checkpoint | `agenticx/runtime/checkpoint.py` | `AgentCheckpoint`, `RESUME_SYSTEM_HINT` L37–54 | 保存 round/pending；resume **不重跑** pending tools；依赖 sanitizer |
| 中途落盘 | `agenticx/runtime/agent_runtime.py` | `_maybe_mid_turn_persist` L2640–2657 | 按间隔/工具次数 best-effort；异常 `pass` |
| Studio persist 回调 | `agenticx/studio/server.py` | `_mid_turn_persist_cb` ~L3272 | `except: pass`，非 fail-closed |
| 主动压缩 | `agenticx/runtime/compactor.py` | `ContextCompactor.maybe_compact` L664+ | 轮初/token budget 触发摘要压缩 |
| Overflow 管线（非 Studio 热路径） | `agenticx/core/overflow_recovery.py` | `OverflowRecoveryPipeline` L37 | L1 truncate → L2 compact → L3 heuristic；挂在 `ContextCompiler` / `AgentExecutor` |
| Overflow 检测函数 | `agenticx/runtime/context_budget.py` | `is_context_window_exceeded_error` L143–145 | **已定义，全仓无调用点** |
| 循环检测 | `agenticx/runtime/loop_detector.py` | `LoopDetector` L26 | warning/critical；含 ping-pong、guard rejection、file_edit 失败 |
| 工具结果预算 | `agenticx/runtime/tool_result_budget.py` | `apply_tool_result_budget` | 归档/衰减大结果 |
| Offload | `agenticx/core/offload/` | `FileOffloader` | 大 payload 落盘句柄 |
| 工具超时 | `agenticx/tools/executor.py` | timeout 取值 ~L356 | 工具级 timeout 已存在 |
| 长任务编排 | `agenticx/longrun/orchestrator.py` | `LongRunOrchestrator` | 轮询源、工作区隔离、停滞、续跑/失败退避 |
| 项目状态机 | `agenticx/project_state/` | `ProjectStore`, feature 状态机 | 磁盘 SoT：implement/verify/commit |
| 子智能体 | `agenticx/runtime/team_manager.py` | `spawn_subagent` | 隔离 session，默认可继承父上下文摘要 |

## Checked scope

- Paths: `agenticx/runtime/agent_runtime.py`, `checkpoint.py`, `compactor.py`, `loop_detector.py`, `tool_result_budget.py`, `context_budget.py`, `token_budget.py`, `agenticx/core/overflow_recovery.py`, `context_compiler.py`, `agent_executor.py`, `self_repair.py`, `agenticx/longrun/`, `agenticx/project_state/`, `agenticx/tools/executor.py`, `agenticx/studio/server.py` persist 回调, `conclusions/runtime_module_conclusion.md`, `longrun_module_conclusion.md`, `core_module_conclusion.md`, `project_state_module_conclusion.md`
- Search terms: `OverflowRecoveryPipeline`, `is_context_window_exceeded_error`, `_sanitize_context_messages`, `mid_turn_persist`, `maybe_compact`, `CONTEXT_WINDOW`, `LoopDetector`, `spill`, `ralph`, `goal round`, `interruptedTurnClosers`
- Scope limitation: conclusions apply only to the checked scope. 未宣称「AgenticX 任何地方都不存在某能力」。Studio/Desktop 对话热路径是 `AgentRuntime`，不是 `AgentExecutor`。

## User-problem sources (not invented)

1. 用户原话：要把「核心 harness，尤其长程任务稳定执行」沉淀进底层框架。
2. 工作区已知问题：SSE 中止后后端可能跑完但 FINAL 未达 UI，易与 `messages.json` 不一致；`max_tool_rounds` 触顶中断长任务。
3. 代码自述：`checkpoint.py` 明确「pending tools 不重跑 + sanitizer 去掉 dangling tool_calls」。

---

### G-001 中断 turn 合成 closer（NOT_STARTED / OUTCOME_UNKNOWN）

- User problem: 崩溃/SSE 中断后续跑时，AgenticX 去掉未完成 tool_calls，模型看不到「调用已发出但结果未知」与「调用尚未开始」的区别；`checkpoint.py` 与 AGENTS.md SSE/快照不一致问题直接相关。
- Upstream evidence: E-007, E-008, E-022
- AgenticX current state: `_sanitize_context_messages` 删除未配对 calls；`RESUME_SYSTEM_HINT` 只给笼统「已移除未完成调用」。
- Actual gap: 缺少与 `interruptedTurnClosers` 等价的 **保留 assistant tool-call + 合成错误 tool 结果 + 副作用安全文案**。
- Value: high
- Cost: medium
- Regression risk: medium（必须继续保证 provider pairing 合法）
- Decision: **P1**
- Minimal adoption: 在 resume/加载路径追加合成 tool 消息（两种 code），再走现有 sanitizer；不要改成重跑 pending tools。
- Scope boundary: 不引入 SessionEvent 全量事件源；不改 JSONL/zstd。
- Acceptance evidence: 单测：① assistant 有 tool_call 无 tool 行 → 合成 NOT_STARTED 文本且 pairing 合法；② 有 tool 行但无 result（若未来落了 in-flight 标记）→ OUTCOME_UNKNOWN 且禁止盲目重试副作用。对照 `packages/core/session/tests/repair.spec.ts` 分支。

### G-002 LLM/工具副作用前的 fail-closed 语义检查点

- User problem: 用户要求长程稳定；已知 mid-turn 落盘失败被吞掉（`_maybe_mid_turn_persist` / `_mid_turn_persist_cb` `except: pass`），崩溃可丢失「已决定调用但未落盘」的前缀。
- Upstream evidence: E-009
- AgenticX current state: 间隔/计数 best-effort persist；checkpoint save 失败只 warning。
- Actual gap: 没有「flush 失败则 **禁止** 进入 LLM adapter / tool body」的硬屏障。
- Value: high
- Cost: medium
- Regression risk: medium（fail-closed 会把存储故障变成可见错误，需可观测）
- Decision: **P1**
- Minimal adoption: 在 `AgentRuntime` 即将 `stream_with_tools`/`invoke` 之前、以及 `dispatch_tool_async` 之前 await/同步 flush；失败则发 ERROR 事件并跳过该副作用。
- Scope boundary: 不替换 `messages.json` 为事件日志；不引入 Cordis waterfall。
- Acceptance evidence: 单测注入 persist 失败：断言 LLM mock 未被调用、工具 mock 未被调用。对照 `session-checkpoint-policy.spec.ts` 意图。

### G-003 Studio 热路径：provider 确认 overflow 后同轮 compact+retry

- User problem: 长程任务上下文膨胀；用户明确要稳定执行。`is_context_window_exceeded_error` 全仓无调用。`OverflowRecoveryPipeline` 在 `AgentExecutor`/`ContextCompiler`，Studio 走 `AgentRuntime`。
- Upstream evidence: E-012, E-011
- AgenticX current state: 轮初 `maybe_compact` + token budget COMPRESS；**没有**「LLM 返回 context overflow → 压缩 → **重试同一 round**」。
- Actual gap: Studio 热路径缺少 DSH `agent/request-error` → retry 闭环。
- Value: high
- Cost: low–medium
- Regression risk: medium（错误 compact 后死循环；需 `maxOverflowRetries` 与 replace 前进判定）
- Decision: **P1**
- Minimal adoption: 在 `AgentRuntime` invoke/stream 失败分支调用已有 `is_context_window_exceeded_error` → `compactor.maybe_compact(force=True)` → 同一 `round_idx` 重试，上限 2–3。
- Scope boundary: 不把 `OverflowRecoveryPipeline` 整段搬进 Studio；不改 `AgentExecutor` 已有路径。
- Acceptance evidence: mock LLM 第一次抛 context window exceeded、第二次成功；断言 compact 被调用且只 retry 有限次。

### G-004 Ralph 式「每轮新鲜子智能体 + 有界 structured handoff」

- User problem: 用户要长程稳定；同会话 `max_tool_rounds` 会触顶。AgenticX 已有 spawn/longrun/project_state，但子智能体常带父上下文，缺少「部署拥有的、模型改不了的、上下文复位循环」。
- Upstream evidence: E-016, E-019
- AgenticX current state: `spawn_subagent` / `delegate_to_avatar` 继承摘要；`LongRunOrchestrator` 是任务源轮询不是对话窗口复位；`project_state` 是特性状态机。
- Actual gap: 没有固定编排：每轮 `inheritsParentContext=false` + workspace SoT + 有界 JSON handoff + complete/blocked/budget-limited。
- Value: medium–high
- Cost: medium
- Regression risk: low–medium（新 meta tool，默认可关）
- Decision: **P1**
- Minimal adoption: 一个 Studio/meta 工具（名称用产品中性词，如 `fresh_round_loop`），内部用现有 `spawn_subagent` 但 **不注入** 父对话；只传 objective + 上一轮 report；cap 默认远小于 256（例如 16–32）以免成本爆炸。
- Scope boundary: 不引入 Cordis workflow 引擎/worker thread；不把 Ralph 商标/品牌写进 git；不把该工具当默认长任务路径（普通长任务仍走 longrun/project_state）。
- Acceptance evidence: 单测假子智能体两轮 `continue` 后 `complete`；断言第二轮 prompt 不含第一轮对话全文、只含 bounded report；`inherits` 父 `chat_history` 为假。

### G-005 同会话 Goal 自动续轮驱动

- User problem: unvalidated hypothesis 相对 AgenticX 已有 todo + project_state + longrun continuation。用户要的是长程稳定，不是再要一套 phase 状态机。
- Upstream evidence: E-015
- AgenticX current state: `todo_manager`、`project_state` feature 循环、`LongRunOrchestrator` 续跑。
- Actual gap: 缺少「同会话 idle 后自动再开一轮、activation 不落盘」的策略；与现有磁盘状态机职责重叠。
- Value: medium
- Cost: high（与 project_state/longrun 双写风险）
- Regression risk: high
- Decision: **P2**
- Minimal adoption: no implementation until G-001–G-004 落地并证明同会话自动续轮仍缺。
- Scope boundary: 不移植 `goal-round-driver`。
- Acceptance evidence: n/a this cycle

### G-006 Spill 策略相对 tool_result_budget 的增量

- User problem: unvalidated hypothesis（已有归档/offload）。
- Upstream evidence: E-013
- AgenticX current state: `apply_tool_result_budget` + `FileOffloader`。
- Actual gap: DSH 强调 head/tail + locator + 失败保成功；AgenticX 已有归档，细节不同。
- Value: low–medium
- Cost: low
- Regression risk: low
- Decision: **P2**
- Minimal adoption: 若 G-003 后仍见大 tool 结果撑爆窗口，再给 archive 文案加 locator。
- Scope boundary: 不新建 spillStore 服务。
- Acceptance evidence: n/a this cycle

### G-007 重复工具 advisory reminder

- User problem: 已有 `LoopDetector` warning/critical（含 nudge）。
- Upstream evidence: E-017 vs `LoopDetector._detect_generic_repeat`
- AgenticX current state: 阈值更高（8/15）且可 stuck 停转。
- Actual gap: NO-GAP 主路径；DSH 更早、更温和、不 veto。
- Value: low
- Cost: low
- Regression risk: medium（双重 nudge）
- Decision: **NO-GAP**（可选 P2 调阈值，本次不做）
- Minimal adoption: no implementation
- Scope boundary: 不替换 LoopDetector。
- Acceptance evidence: n/a

### G-008 Cordis「everything is a plugin」运行时

- User problem: 用户要的是长程稳定机制，不是换微内核。
- Upstream evidence: E-020
- AgenticX current state: Python runtime + HookRegistry + Studio。
- Actual gap: 架构风格差异，不是能力缺口。
- Value: low（迁入）
- Cost: high
- Regression risk: high
- Decision: **NO-GAP**（明确不采用）
- Minimal adoption: no implementation
- Scope boundary: 禁止引入 Cordis/vendor、Web UI、Landlock、Typert 作为框架依赖。
- Acceptance evidence: n/a

### G-009 工具超时 waterfall

- User problem: AgenticX `tools/executor.py` 已按 tool.timeout 执行。
- Upstream evidence: E-018
- Actual gap: NO-GAP in checked scope
- Value: low
- Cost: low
- Regression risk: low
- Decision: **NO-GAP**
- Minimal adoption: no implementation
- Scope boundary: 不引入 `dsh-timeout` 语义层。
- Acceptance evidence: n/a

## Priority → verdict

| ID | Decision |
|----|----------|
| G-001 | P1 |
| G-002 | P1 |
| G-003 | P1 |
| G-004 | P1 |
| G-005 | P2 |
| G-006 | P2 |
| G-007 | NO-GAP |
| G-008 | NO-GAP |
| G-009 | NO-GAP |

无 P0 → 有用户问题支撑的 P1 → **SELECTIVE_ADOPT**。
