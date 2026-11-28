# Plan: AgenticX 运行时不变量内化 04 —— Harness 事件出口

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-04-harness-event-outlet
Parent-Plan: `.cursor/plans/pending/2026-11-27-runtime-invariants-master.plan.md`

> 规划阶段的说明：本环境允许只读探针。本文件的事实来自**阅读核实**（给出 `文件:行号`，行号以当前工作树 `23cf58d4` 为准）加**已执行的只读验证命令**（下文「规划阶段已执行的探针」清单；基线数字均为实际输出）。没有执行任何写操作。

规划阶段已执行的探针（全部只读）：

1. `/opt/miniconda3/bin/python3 -m pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py -q --no-cov` → **56 passed**（既有基线，master plan Verification 基线第 4 条）。
2. `RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py` → 4 条规则全部通过（`ledger-read-bypass` 2/2、`checkpoint-save-bypass` 0/0、`resume-anchor-bypass` 0/0、`dispatch-mailbox-bypass` 0/0）。
3. `git grep` 若干（新 ratchet 规则候选 pattern 的实测命中数、`run_recorder` 传点、`capabilities()` 消费方、`HarnessEvent` 等命名空闲性），结论写进「核实结论」。

## Goal

让 master plan 的闭环判据成立：**一个外部 CLI 的回合结束后，账本里有它的结构化事件；能力声明与实测不一致时测试失败。**

拆成验收条件：

- **AC-1（回合结束账本里有结构化事件）**：经 studio chat 路由（`run_external_harness_turn`）执行的外部 harness 回合（任意一个 exec-CLI / app-server / bridge / PTY 路径），回合结束后，Replay Ledger 里出现一个该回合的 run，含至少 `run_started`、`user_message`、`assistant_output_completed`（或 `error`）、`run_completed` 四类结构化事件；事件经 `HarnessAdapter` 上的事件出口（`attach_event_sink` + `emit_harness_event`）产生，不由调用方解析原始字节伪造。
- **AC-2（不遮蔽既有账本消费方）**：外部 harness 回合记在独立命名空间 `<owner_session_id>:harness` 下；owner 会话的 `find_open_run` / `list_runs` / `/api/runs` / 恢复锚点投影 / 重连回放结果与 04 之前完全一致；会话删除时命名空间账本随之清理。
- **AC-3（能力声明与实测不一致时测试失败）**：registry 一致性检查（`capability_mismatches`）对内置 4 个 adapter 断言零 mismatch；一个故意声明与实现不符的 adapter 必须被检查器报出（失败路径）；一致性判据是「声明档 vs 实际实现/实测行为」，不只读声明。
- **AC-4（旧行为不回归）**：开关关闭后（`AGX_HARNESS_LEDGER_EVENTS=0`），不 attach 出口、不写任何账本文件，`run_external_harness_turn` 的返回值、chat_history 行形状、binding 更新与 04 之前逐字一致；`turn()` 的签名与返回值不变；56 个既有 harness 用例与 01/03 的全部账本测试保持通过。

同时满足 master plan「入口」字段的落点约束：新增代码集中在 `agenticx/harness/types.py`、`adapter.py`、`registry.py`、`adapters/*.py`（外加账本桥接新模块与 studio 侧最小接线，见 Design D-7）。

参考依据见 master plan『背景与参考来源』。

## 核实结论

### 0. 阅读范围与方法

阅读 + 只读探针（见头部清单）。引用的行号已在当前工作树逐条复核。用到的既有 API（签名、参数名、字段、枚举值）在 Tasks 的「依赖的现有 API」表里给出出处；没有亲自读到的 API 一律不进入代码块，而是列入 `### 未经执行验证的假设清单`。

### 1. 外部 CLI 回合现在从哪里发起、结果去哪了

**结论：外部 CLI 回合的唯一生产发起方是 studio chat 路由 `run_external_harness_turn`（`asyncio.to_thread` 包成异步任务）；回合结果只落 `session.chat_history`（user + harness-attributed assistant 两行）与 binding（native_thread_id / surface_session_id），没有任何账本记录。事件出口应接在 `_run_external_harness_turn_body` 这一层（它同时持有 owner session 与 adapter），账本命名空间以 owner studio session 为根。**

发起方与结果去向，逐个路径：

| 路径 | 发起点 | 结果去向 | 有无 owner session / run 可挂 |
| --- | --- | --- | --- |
| studio chat 路由（生产主路径） | SSE `/api/chat` 流式端点 `server.py:370-379` 创建 `harness_wiring.run_external_harness_turn_async`（`asyncio.to_thread(run_external_harness_turn)`，`harness_wiring.py:1579-1598`）→ `run_external_harness_turn`（`:952-987`，单飞锁）→ `_run_external_harness_turn_body`（`:1096-1252`）：`adapter = harness_registry().require(harness_id)`（`:1132`）→ `ensure_harness_session_lease`（`:1133-1135`）→ `adapter.turn(surface_sid, request)`（`:1169`）；Codex provider mismatch 时 `_retry_turn_after_provider_mismatch`（`:1176-1185`，内部再次 `adapter.turn`，`:1092`） | `session.chat_history` 追加 user 行（`:1155-1161`）+ assistant 行（`:1199-1206`，metadata 带 `harness` / `harness_status` / `native_thread_id`）；binding 更新（`:1240-1246`）；`manager._persist_session_state`（`:1248-1251`） | 有：`managed.studio_session`（`:1109`）与 `manager._sessions_root`（`session_manager.py:674`）；`TurnRequest.owner_session_id=sid`（`:1163-1168`） |
| mid-session switch 的注入回合 | `switch_harness`（`harness_wiring.py:1363` 起）→ `HandoffEngine.execute_handoff`（`handoff/engine.py:120-249`）：`adapter.spawn`（`:192`）→ `adapter.turn(session_id, request)`（`:224`，注入 payload + pending user message） | `HandoffStore` 的 handoff 记录 + chat_history 的边界 system-notice 行 | 有 owner session，但注入回合不是「用户回合」，04 不接（见 Out of scope） |
| 独立 harness-surface HTTP app | `agx harness-surface serve` 的 `http_app.py:35` `_registry = default_registry()`；`post_turn`（`:225-249`）直接 `adapter.turn` | HTTP JSON 响应（`TurnResponse`），无持久化 | 无：该 app 没有 owner session / sessions_root，04 不接（见 Out of scope） |
| CLI 只读面 | `cli/harness_surface_commands.py:78` `default_registry().descriptors()` | 终端输出 | 只读，无回合 |
| 恢复 / 健康扫描对 harness 的引用 | `session_manager.py:1634` `default_registry().list_ids()` | 提示文案 | 无回合 |
| 流式原始字节 | `http_app.py:295` `adapter.iter_stream_chunks(session_id)`（唯一调用方）→ SSE octet-stream；studio 侧无调用（全仓 `iter_stream_chunks(` 只有 `http_app.py:295` 与 `claude_code.py:281` / `adapter.py:97` 定义） | HTTP 客户端 | 无账本接线（文本增量不落盘，见第 6 节） |

`TurnResult` 在 studio 路径里用完即弃（除了 `chat_history` 行与 binding 字段）；没有任何地方把它写进 Replay Ledger。`run_recorder` 的传点经 grep 实测共 **4 处**（master plan 现状盘点写「三处」，03 之后新增一处）：`session_manager.py:1321`（builtin 恢复路径 `recorder_for_session`）、`server.py:4804`（meta 回合）、`server.py:5852`（loop 回合）、`team_manager.py:1540-1544`（03 的唤醒回合 `_build_wake_recorder`）。外部 harness 回合不在其中——这正是 master plan 说的「外部 CLI 的回合进不了账本」。

**对设计的影响**：事件出口的「出口」在 adapter 上（emit 调用点在 `turn()` 内部），「接线」（组装 recorder、attach sink）在 `_run_external_harness_turn_body`——它同时拿得到 adapter、surface session、owner session 与 `manager._sessions_root`（`recorder_for_session` 同款来源，`recorder.py:603-631`）。`_run_external_harness_turn_body` 里的 `manager` 是 duck-typed（`Any`），测试用 `FakeManager`（`tests/test_studio_harness_wiring.py:114-180`）没有 `_sessions_root` 属性——接线必须 `getattr(manager, "_sessions_root", None)` 容错（详见 D-7）。

### 2. 账本写入接口怎么复用

**结论：完全复用 `ReplayLedgerRecorder`。它的 `observe` 吃 `RuntimeEvent`（`type` + `data` 两个公开字段），bridge 把出口事件构造成 `RuntimeEvent(FINAL)` / `RuntimeEvent(ERROR)` 喂进去即可；`start_turn(turn_id=, user_input=, session=None)` 产生 `run_started` + `user_message`；成功回合经 FINAL 分支自动 `finish("completed")`。账本数据模型零新增：只使用现有 `EVENT_TYPES` 中的 7 类。**

逐条核对（`agenticx/runtime/replay_ledger/recorder.py`）：

- 构造：`ReplayLedgerRecorder(store=, session_id=, agent_id=, provider=, model=, enterprise_trace=)`（`:58-69`；03 已加 `enterprise_trace: bool = True` 开关，`:77` 持有、`:593` 消费）。03 的写法模板：`team_manager._build_wake_recorder`（`team_manager.py:1468-1499`）——`ReplayLedgerStore(sessions_root)` + 独立命名空间 session_id + `validate_ledger_id` 预校验 + `enterprise_trace=False`。
- `start_turn(*, turn_id, user_input, history_metadata=None, session=None)`（`:91-204`）：open run → `run_started`（`:190-192`）→ `user_message`（`:193-199`）。`session=None` 时跳过 `_capture_initial_workspace`（`:180` 的 `if session is not None`）——**这正是 04 要的**：外部 harness 回合的 cwd 是用户任意目录，不该在其上跑 git 快照，也不做 branchable 检查点。`session=None` 传入合法（参数类型 `Any`、无断言）。
- `observe(event: RuntimeEvent, *, session: Any, round_idx=None)`（`:421-576`）：分派表——`EventType.TOKEN` 只记首个 `assistant_output_started`；`TOOL_CALL` / `TOOL_RESULT` 需要成对 `tool_call_id`；**`EventType.FINAL` → `assistant_output_completed` + 自动 `self.finish("completed")`（`:536-559`）**；`EventType.ERROR` → 经 `_EVENT_MAP`（`:40-52` 的 `"error"`）落 `error` 事件（`:561-574`）；映射表外的类型忽略（`:561-562` 的 `if mapped in EVENT_TYPES`）。04 的 bridge 只构造 `FINAL` 与 `ERROR` 两类 `RuntimeEvent`，`session` 一律传 `None`。
- `finish(status)`（`:581-600`）：`run_completed` + `close_run`；`close_run` 要求 status ∈ `RUN_STATUSES - {"running"}`（`store.py:346-347`，即 completed / failed / cancelled / interrupted）。`enterprise_trace=True` 时 `enqueue_completed_run`（`:593-595`）。
- `recorder_for_session` 工厂（`:603-631`）不适合直接复用：它读 `managed.studio_session` 的 `scratchpad["run_branch_lineage"]` 并默认 `enterprise_trace=True`，语义是 builtin 回合。04 的 bridge 自建 recorder（03 `_build_wake_recorder` 先例），显式 `enterprise_trace=False`（推荐，见「需主会话定案」）。

事件序列设计（最小、全部落在现有 `EVENT_TYPES` 内，`contracts.py:22-51`）：

| 出口事件 | bridge 动作 | 账本事件 |
| --- | --- | --- |
| `turn_started`（payload 含 outbound user_text） | `recorder.start_turn(turn_id=uuid4().hex, user_input=..., session=None)` | `run_started`、`user_message` |
| `turn_finished` 且 `status == "success"` | 构造 `RuntimeEvent(type="final", data={"text": result_text, "terminal_reason": "completed", "harness": <id>, "detail": <白名单摘要>})` 喂 `recorder.observe(event, session=None)` | `assistant_output_completed`（全文进 blob，`recorder.py:537`）+ 自动 `finish("completed")` → `run_completed` |
| `turn_finished` 且 `status != "success"` | 先喂 `RuntimeEvent(type="error", data={"text": <错误摘要>, "status": <turn status>})`，再 `recorder.finish(<ledger status>)` | `error` + `run_completed` |

状态映射（固定）：`success → "completed"`；`timeout → "interrupted"`（final state unknown，与 `TURN_STATUS_TIMEOUT` 的注释语义一致，`types.py:123`）；其余（`error` / `exited` / `blocked`）`→ "failed"`。

**工具级事件（`tool_call` / `tool_result`）刻意不记**：外部 CLI 的工具观测（如 Codex `exec_command_begin`、OpenCode `tool_use`）没有与账本 `tool_call_id` 语义对齐的稳定配对；01 的恢复投影把「没有 `tool_result` 的 `tool_call`」判为 pending（01 plan 核实结论 1 的投影规则），外部 CLI 的单向观测会制造假 pending、污染未来的恢复路径。v1 只记回合级事件；CLI 侧工具摘要（`observed_tools` / `commands` / `tokens`）作为 `turn_finished` payload 的白名单字段进入 FINAL blob，可审计、可回放。**账本数据模型（`EVENT_TYPES`、dataclass 字段、`SCHEMA_VERSION`）零改动，无「需主会话定案」项。**

### 3. 「能力声明与 spawn 时实测一致」怎么做成可测试的

**结论：一致性做成两层，全部密闭（不依赖真实 CLI 二进制在场）：(1) 静态层——`registry.capability_mismatches(adapter)` 对「声明档 vs 实际实现」逐标志检查；(2) 实测层——用 fake CLI 可执行（既有测试模式）真实 spawn 出会话后实测方法行为（`iter_stream_chunks` 抛 `CapabilityNotSupported` 等）。失败路径由「故意不一致的假 adapter」用例直接覆盖。运行时的「spawn 时实测」落在事件出口本身：attach 的返回值就是出口实测，`False` 即不记账本。**

先看事实（第 4 节详表）：`capabilities()` 在生产代码里只有 3 个消费方，其中只有 `resume` 标志被真正用于降级。**现有代码里就存在一个「声明与实测不符」的实例**：`CodexAdapter` 声明 `streaming=True`（`codex.py:108`），但它的 `iter_stream_chunks` 是基类默认实现（`adapter.py:97-99`，raise `CapabilityNotSupported`）——它实际的流式能力是 `drain_midturn_stream_items`（`codex.py:284-293`，SSE 200ms pump 轮询），不是 `iter_stream_chunks` 接口。master plan 风险条「能力声明与实际不符」不是假设，是现状。一致性检查器因此必须把「streaming 的实现方式」判定为「`iter_stream_chunks` 覆写 **或** 存在可调用的 `drain_midturn_stream_items`」，否则内置 codex 自己就不过。

密闭测试设计（第 3 问的正面回答）：

| 层 | 用例 | 什么算「实测」 | 真实 CLI 在场时的一致性行为 |
| --- | --- | --- | --- |
| 静态 | `test_builtin_adapters_have_no_capability_mismatch`：对 `default_registry().adapters()` 逐个断言 `capability_mismatches(adapter) == []` | 声明档 vs 类（含继承链）的方法覆写事实：`streaming=True ⟹ iter_stream_chunks 非基类默认 或 drain_midturn_stream_items 可调用`；`pty=True ⟹ write_pty 且 resize_pty 均覆写`；`permission=True ⟹ permission 覆写`；`resume=True ⟹ adopt_thread 覆写` | 与 CLI 在场与否无关（纯反射，零进程） |
| 静态（失败路径） | `test_mismatched_adapter_is_reported`：本地定义一个声明 `streaming=True, pty=True` 但不实现任何方法的假 adapter，断言 `capability_mismatches` 报出至少这两条 | 同上 | 同上。**这就是「能力声明与实测不一致时测试失败」的直接实现** |
| 行为 | `test_spawned_session_probe_matches_declared_capabilities`：fake CLI spawn 出真实会话后，对声明 `streaming=False` / `permission=False` 的 adapter 调 `iter_stream_chunks` / `permission`，断言抛 `CapabilityNotSupported`；对 `resume=True` 的 adapter 调 `adopt_thread(sid, "")` 断言抛 `ValueError`（证明有实现，`_exec_cli.py:357-358`） | **真实 spawn + 真实方法调用**（fake 可执行 = `AGX_*_EXECUTABLE` monkeypatch，`tests/test_harness_exec_adapters.py:150-172` 的既有模式；app-server 路径有 `tests/test_codex_app_server.py:36-152` 的 JSON-RPC fake） | 测试恒密闭（不回落真实 CLI）；真实 CLI 在场与否只影响 `descriptors()` 的 `available` 字段（`registry.py:66-69` 有 try/except），不影响一致性判定 |
| 运行时 | 出口接线本身：`adapter.attach_event_sink(sid, sink)` 的返回值（True/False）——attach 成功才记账本 | spawn 出的 surface 会话上真实注册出口 | 生产环境的每个外部 harness 回合都在「spawn 后」做这一次实测；False → 不记（降级） |

不进 v1 静态判据的标志：`idempotency` / `turn_snapshots` / `handoff_injection` 没有独立方法对应（行为内嵌在 `turn()` 与 detail 里），其「实测」已由既有行为测试覆盖（`tests/test_harness_surface.py:601` `test_turn_codebuddy_idempotency_dedup`、`tests/test_harness_exec_adapters.py:230` `test_opencode_turn_tool_events`）；`capability_mismatches` 对这三个标志返回「不判定」（不报 mismatch），docstring 写明理由。

### 4. `HarnessCapabilities` 标志位的真实消费方

**结论：7 个标志里只有 `resume` 有运行时降级消费方（2 处）；其余 6 个只是「报告字段」（descriptors → /v1/harnesses / CLI 列表），调用方实际靠 `CapabilityNotSupported` 异常与 `TurnInProgressError` 兜底，`types.py:64-66` 注释「UI and callers must degrade by these flags」在现状下是愿望而非事实。一致性测试测的正是「声明与这些实现事实的关系」，不是把这些调用方改造成按标志降级（那不在 04 范围）。**

grep 全仓 `capabilities()`（`agenticx/` 内，逐条阅读）：

| 标志 | 声明（4 个 adapter） | 运行时消费方 | 现状评价 |
| --- | --- | --- | --- |
| `resume` | claude-code F / codebuddy F / codex T（`codex.py:111`）/ opencode T（`opencode.py:45`） | `handoff/engine.py:200-203`（`STRATEGY_RESUME` 时声明 False → 抛 `HandoffError` 降级）；`harness_wiring.py:761-766`（`ensure_harness_session_lease`：声明 True 才 `adopt_thread`，失败静默回落新线程） | 唯一按标志降级的标志 ✓ |
| `streaming` | claude-code T（`claude_code.py:116`）/ codex T（`codex.py:108`）/ codebuddy F / opencode F | 无。`iter_stream_chunks` 的实际门禁是 `CapabilityNotSupported`（`adapter.py:97-99` 基类默认 raise；`claude_code.py:281-291` 只对 `visible_tui` 会话放行；`http_app.py:295-297` 调用方 catch）；codex 声明 T 但方法未覆写（见第 3 节） | 声明与实现脱节的实例 |
| `permission` | claude-code T（`claude_code.py:114`）/ 其余 F | 无按标志降级；`http_app.py:273-275` / `server.py:3606-3634` 都是 catch `CapabilityNotSupported`；`codebuddy.py:327-334` 覆写为显式 raise + hint | 报告字段 |
| `pty` | claude-code T（`claude_code.py:115`）/ 其余 F | 无；`write_pty` / `resize_pty` 靠 `claude_code.py:297-302` / `:312-317` 的 session_kind gate（raise `CapabilityNotSupported`） | 报告字段 |
| `turn_snapshots` | codex T / codebuddy T / opencode T / claude-code F | **零消费方**（grep 无 `.turn_snapshots` 属性读取；快照体现在 `TurnResult.detail` 的 `turn_seq` / `observed_tools` / `tokens` 等） | 纯报告 |
| `idempotency` | codebuddy T（`codebuddy.py:103`）/ 其余 F | 无先查标志的调用方；`http_app.py:101-105` 的 TurnBody 描述说「Honored when the adapter declares capabilities.idempotency」，但 `post_turn` 无条件透传 key（`:229-233`）；实际去重由 `codebuddy.py:154-157` 的 `turn_matches_idempotency_key` 行为实现 | 报告字段 + 行为兜底 |
| `handoff_injection` | 全部 F | 零消费方 | SP4 预留 |

**对设计的影响**：04 不改造调用方按标志降级（master plan 边界「控制面只做向后兼容的增量扩展」）；一致性测试把上表「声明 vs 实现」的关系固化，特别是把 codex streaming 的「声明 T + `drain_midturn_stream_items` 实现」这一事实钉死——未来有人改 `capabilities()` 或删 drain 方法时测试红。

### 5. 向后兼容的具体含义：出口形状逐一评估

**结论：选「adapter 实例上的可选方法对（`attach_event_sink` + `emit_harness_event`，基类给默认实现）」。不改 `turn()` 的签名与返回值，不改 `TurnRequest` / `TurnResult` 的字段，四个 adapter 只在 `turn()` 体内加 emit 调用，所有现有调用方（http_app、handoff engine、CLI、studio）零改动零影响。**

三个候选形状的评估：

| 形状 | 做法 | 对四个 adapter 的影响 | 对调用方的影响 | 评估 |
| --- | --- | --- | --- | --- |
| **甲（选）：实例级注册 + 基类 emit 辅助** | `HarnessAdapter.attach_event_sink(session_id, sink) -> bool` 与 `emit_harness_event(session_id, type, payload) -> None`（基类默认实现：惰性 dict 存 sink，emit 吞异常推送）；4 个 adapter 的 `turn()` 体内加 emit 调用 | 每个加 1–6 行 emit 调用；`turn()` 签名不动 | attach/detach 是新 API，不碰旧调用 | **选它**：master plan 字面「给 HarnessAdapter 加出口」；事件生命周期 = 回合生命周期，挂 session 粒度最准；基类默认实现让全部 adapter 免费获得出口 |
| 乙：`TurnRequest` 加 `event_sink` 可选字段 | adapter 在 `turn()` 内读 `request.event_sink` 发事件 | 同样要在 4 个 `turn()` 体内加调用 | 请求对象混入回调；`http_app.post_turn` / `handoff engine` / `meta_tools` 构造 `TurnRequest` 的地方都「能」塞回调，出口的受控性变差（HTTP 层可透传不可控回调）；契约类型（types.py 的 dataclass）被塞行为字段 | 弃 |
| 丙：独立方法 `turn_events(session_id, request) -> Iterator[HarnessEvent]` | 回合后补一个事件迭代器 | 要求 adapter 把 turn 内部翻成可重放的生成器（或缓存事件），`_exec_cli` 的子进程流无法二次迭代；等于双份 turn 实现 | 调用方多一次调用 | 弃：破坏性最大 |

甲的一个实现陷阱（已核实）：`ClaudeCodeAdapter` 与 `CodeBuddyAdapter` 是 `BridgeSessionManager` + `HarnessAdapter` 多继承（`claude_code.py:105`、`codebuddy.py:90`），它们没有定义 `__init__`，实例化走 `BridgeSessionManager.__init__`——**基类 `HarnessAdapter` 若定义 `__init__` 初始化实例属性，不会被执行**（MRO 上 `BridgeSessionManager.__init__` 先被调用且不转发）。因此 sink 注册表必须**惰性初始化**（`self.__dict__.get(...)` 检查后写入，见 Task 1 代码块），不能依赖 `__init__`。

**「向后兼容」逐项承诺**（写进 AC-4）：

1. `turn()` 的签名与返回值不动（4 个 adapter 均只加体内语句）。
2. `TurnRequest` / `TurnResult` / `HarnessCapabilities` / `HarnessDescriptor` 字段零改动（不新增 capability 标志——出口不是「能力」，对全部 adapter 可用，无需 gate；见 Out of scope 第 1 条）。
3. 不 attach sink 时（所有现有调用方的状态）：emit 是 no-op（找不到 sink 直接返回），`turn()` 行为逐字不变。
4. `http_app.py`（独立 app）、`handoff/engine.py`、`cli/harness_surface_commands.py`、`server.py` 零改动（server.py 本 plan 不碰）。
5. 新增 API 均带默认实现（非 abstract），旧第三方子类不需要任何适配。

### 6. 事件出口 → 账本的接线放哪；流式路径的原始字节怎么处理

**结论：调用方层（`_run_external_harness_turn_body`）组装 recorder 并 attach 出口；adapter 只持有出口（注册 + emit），不持有 recorder、不 import replay_ledger。原始字节流（`iter_stream_chunks`，PTY）完全不解析、不落盘；04 记录的事件全部来自 `turn()` 路径的结构化结果（`TurnResult` 与回合边界），文本增量不落盘。**

分工（为什么这样切）：

- adapter 层（`agenticx/harness/`）：出口原语 + emit 调用点。**`agenticx/harness/` 包的模块层不新增对 `agenticx.runtime.replay_ledger` 的 import 边**（03 D-9 同款纪律；现状 `harness/` 包零依赖 `runtime/replay_ledger`，grep 零命中），保持 harness 包可独立测试。
- bridge 层（新模块 `agenticx/harness/ledger_outlet.py`）：`HarnessLedgerBridge`（吃出口事件 → 写 recorder）。对 `replay_ledger` 的 import 全部放在函数体内。放 harness 包内（master plan 入口「`agenticx/harness/`」的合理延伸；`adapters/*.py` 之外包内新增一个纯函数模块）。
- 接线层（`harness_wiring.py` `_run_external_harness_turn_body`）：回合前组装 bridge + `attach_event_sink`，`finally` detach。它是唯一同时拿到 adapter、surface_sid、owner session 与 `manager._sessions_root` 的层（第 1 节核实）。

流式路径（第 6 问后半）的逐条处置：

| 流 | 现状 | 04 处置 |
| --- | --- | --- |
| `iter_stream_chunks` 原始 PTY 字节（claude-code visible_tui；`claude_code.py:281-291`） | HTTP octet-stream（`http_app.py:290-300`） | **不解析、不落盘**（master plan「文本增量不落盘」+「不做 PTY 兜底」）。visible_tui 的回合同样有 `turn()` 路径（`wait_for_visible_tui_result`，`claude_code.py:206-224`），回合级事件照发（结果级，无中间事件） |
| Codex app-server 的 mid-turn delta（`item/agentMessage/delta` → `midturn_items` 队列，`codex.py:284-297`，SSE 200ms pump 消费） | studio SSE token 泵 | 文本增量不落盘；回合级 `turn_started` / `turn_finished` 在 `turn()` 路径发（D-4 表） |
| Exec CLI 的 NDJSON 事件行（`_exec_cli.py:245-253` 逐行 `ujson.loads` → `_consume_event`） | 折进 `acc`（result_text / detail） | **落盘的只有回合级边界与结果摘要**；逐事件粒度（`exec_command_begin` 等）刻意不落（第 2 节的假 pending 理由），CLI 工具观测以白名单进 `turn_finished` payload |

### 7. 新 ratchet 规则（必做）

**结论：新增第 5 条规则 `harness-outlet-bypass`，pattern 为 `RunEvent(`，exclude `agenticx/runtime/replay_ledger/`，基线 0（grep 实测：`agenticx/` 下、replay_ledger 之外 `RunEvent(` 零命中）。它保护的 04 不变量：账本事件行（`RunEvent`）只能在 `agenticx/runtime/replay_ledger/` 内构造（recorder 与 store 拥有该类型）；harness 回合的账本写入必须经 recorder / 事件出口，任何绕过出口直接构造 `RunEvent` 写行的新代码都会被抓住。**

pattern 选择过程（grep 实测，均在 `agenticx/` 下、排除 `agenticx/runtime/replay_ledger/`）：

| 候选 pattern | 命中 | 结论 |
| --- | --- | --- |
| `RunEvent(` | **0** | ✓ 采用。语义纯：`RunEvent` 是 replay_ledger 的私有构造物（recorder / store / contracts 内部），外部出现即旁路 |
| `append_event(` | 8（`agenticx/sessions/base.py:160,308`、`database.py:346`、`in_memory.py:172,184`、`session_event_hub.py:92,111`） | ✗ 命中全是 `SessionEvent.append_event`（另一套 API），语义污染 |
| `ReplayLedgerStore(` | 5（`checkpoint.py:178`、`subagent_runs/dispatch.py:222`、`team_manager.py:1490`、`run_replay_routes.py:81`、`session_manager.py:1377`） | ✗ 合法使用者（03/01 自己的接线），不能做 pattern |

现有 4 条规则（`ratchet-baseline.json`）不许调大、不许触发：`ledger-read-bypass` 基线 2、`checkpoint-save-bypass` 0、`resume-anchor-bypass` 0、`dispatch-mailbox-bypass` 0，本 plan 的全部代码（含测试）不引入 `run_dir / "events.jsonl"`、`runs/*/events.jsonl`、`save_agent_state(`、`project_resume_anchor(`、`.mailbox.json`、`.context.json` 字面量（`agenticx/` 下、除各自 exclude 目录外）——Task 代码块已逐字自查（Tasks 末尾的自查清单）。

### 8. `EVENT_TYPES`、`RunEvent.type` 的枚举约束、两个 harness 测试文件的现状

**结论：`EVENT_TYPES` 共 26 类（`contracts.py:22-51`）；`RunEvent.type` 不受枚举约束——`from_dict` 只做非空校验（`contracts.py:285` 的 `_required_text`），`store.append_event` 也不校验 type（只校验 event_id 去重与 seq，`store.py:281-326`）；`effect_class` 不在 `EFFECT_CLASSES` 时归 `"unknown"`（`contracts.py:266-268`）。04 不利用这个「宽松」写新类型，只用现有 7 类。基线：`pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py -q --no-cov` → 56 passed（规划阶段实际执行）。**

两个测试文件的覆盖面（读全部用例）：

- `tests/test_harness_surface.py`（757 行，23 个用例）：registry 基础（3）、HTTP auth/meta（3）、claude-code spawn（5，`subprocess.Popen` monkeypatch 成 ScriptedStream fake，`:228` 起）、codebuddy spawn（4）、turn 路由（4：success / timeout / blocked / inflight 409）、idempotency dedup（1，`:601`）、permission 400（1）、stream 400（1）、会话生命周期（2）、可用性（1）。
- `tests/test_harness_exec_adapters.py`（558 行，27 个用例）：registry（2）、opencode spawn/turn（12，fake CLI 可执行回放协议流）、codex spawn/turn（13，`AGX_CODEX_TRANSPORT=exec`，`:169`）。
- 相邻：`tests/test_codex_app_server.py`（JSON-RPC fake app-server，覆盖 app-server 路径的真 `turn()`，`:36-152` 的 `_FAKE_APP_SERVER` 协议脚本）；`tests/test_studio_harness_wiring.py`（40 个用例，`RecordingAdapter` + `FakeManager` 直调 `run_external_harness_turn`——04 接线测试的样板）；`tests/test_session_harness_binding.py`、`tests/test_smoke_openharness_features.py`、`tests/test_codebuddy_oauth_harness_refresh.py`、`tests/test_harness_handoff.py`、`tests/test_harness_turn_error_surface.py`、`tests/test_near_cross_harness_swarm_ui.py`（回归清单进 Verification）。

### 9. 与 master plan 假设不同、或需主会话知晓的事实

- **F-1 `run_recorder` 传点是 4 处不是 3 处。** master plan 现状盘点写「三处」（`session_manager.py:1321`、`server.py:4804`、`:5852`——三处行号经复核仍准）；03 落地后新增 `team_manager.py:1540-1544`（唤醒回合）。不影响 04 设计，主会话引用行号时注意。
- **F-2 能力声明与实现已经存在一处脱节（第 3/4 节）：Codex 声明 `streaming=True` 但未覆写 `iter_stream_chunks`**，实际实现是 `drain_midturn_stream_items`。04 的一致性检查器把它判定为「一致」（实现方式判定含 drain 路径）；如果主会话希望把 codex 改成覆写 `iter_stream_chunks` 或声明改 False，那是另一个改动（不在 04 范围），见「需主会话定案」。
- **F-3 `iter_stream_chunks` 的唯一外部调用方是独立 harness-surface HTTP app（`http_app.py:295`）**，studio 进程内不消费原始字节流——所以「绕过出口直读原始流写账本」在 studio 侧当前没有实体路径，新 ratchet 规则保护的「绕过」形态实际是「直接构造 `RunEvent` 写行」。
- **F-4 `_run_external_harness_turn_body` 的 provider-mismatch 重试路径（`harness_wiring.py:1170-1185`）会对同一用户输入跑两次 `adapter.turn`**。出口会发两组 `turn_started` / `turn_finished`；bridge 必须支持同一 recorder 实例上的多回合序列（`recorder.start_turn` 在 `finish` 后可复用，`recorder.py:100-113` 的重置分支）——设计里已处理（D-6）。
- **F-5 `FakeManager`（wiring 测试）没有 `_sessions_root` 属性**（`tests/test_studio_harness_wiring.py:114-180`），接线代码必须 `getattr` 容错，否则 40 个既有 wiring 用例全红。
- **F-6 app-server 路径可密闭测试**：`tests/test_codex_app_server.py` 的 `_FAKE_APP_SERVER` 是完整 JSON-RPC stdio 协议脚本（initialize → thread/start → turn/start → delta → turn/completed），04 的 emit 覆写层测试直接复用该 fixture 思路。
- **F-7 `recorder.start_turn` 会 raise（不吞）**（`:200-203` 的 `except Exception: ... raise`）——bridge 必须整体 try/except，账本失败绝不影响 harness 回合（AC-4 的硬要求）。
- **F-8 `session_manager.delete` 已有 03 加的 dispatch 命名空间清理块（`session_manager.py:1380-1385`）**，04 的 harness 命名空间清理是同一模式的第三行插入（见 D-5）。

## Root cause

闭环判据今天不成立，是三个缺口叠加：

1. **出口缺失**：`HarnessAdapter` 的回合面只有 `turn() → 单个 TurnResult`（`adapter.py:79`）与原始字节流 `iter_stream_chunks()`（`adapter.py:97`，仅 http_app 消费）。回合的结构化过程（开始、结果、状态、detail）没有任何可订阅的通道，账本想记也拿不到。
2. **接线缺失**：`_run_external_harness_turn_body` 把回合结果只写进 `session.chat_history`（`harness_wiring.py:1199-1206`）；全仓 4 处 `run_recorder` 传点没有一处覆盖外部 harness 回合（第 1 节）。
3. **声明与实现无一致性约束**：`HarnessCapabilities` 的 7 个标志只有 `resume` 有降级消费方（第 4 节）；`types.py:64-66` 要求的「按标志降级」无机制保障，且现状已有一处脱节（F-2）。没有任何测试会因「声明与实测不符」而失败。

实施者可以用这条链自查：Task 1 完成后第 3 环不再成立（脱节被检查器钉死）；Task 2 完成后第 1 环不再成立（出口存在且四路径 emit）；Task 3 完成后第 2 环不再成立（回合落账本）。

## Design

每个决定写清选了什么、备选是什么、为什么。

### D-1 开关：一个布尔，默认开

- 选了：`AGX_HARNESS_LEDGER_EVENTS` / `runtime.harness_ledger_events`，默认 `True`，经 `agenticx/runtime/harden_flags.py` 的 `_resolve_bool` 解析（`:57-64`；开关函数插在 `dispatch_mailbox_enabled`（`:147-149`）之后，与 01/03 同款）。关闭后：不构造 bridge、不 attach、不写任何账本文件；`run_external_harness_turn` 的返回值、chat_history 行、binding 更新与 04 前逐字一致。
- 备选：默认关。否决：闭环判据是 master plan 要内化的不变量；03（D-11）、01/02 的开关口径全部默认开。
- 为什么不拆两个开关（出口 / 记账本）：出口本身是 best-effort no-op 基础设施，没有单独关闭的价值；记账本的关闭已覆盖回滚诉求。

### D-2 出口形状：adapter 实例上的可选方法对（基类默认实现）

见核实结论第 5 节的评估表。API（Task 1 完整代码）：

- `HarnessEvent`（frozen dataclass，`types.py`）：`type` / `harness` / `session_id` / `payload` / `ts`；`HARNESS_EVENT_TYPES = frozenset({"turn_started", "turn_finished"})`；`HarnessEventSink = Callable[[HarnessEvent], None]`（type alias）。
- `attach_event_sink(session_id, sink) -> bool`（基类）：惰性 dict 注册（`self.__dict__` 检查，规避多继承 `__init__` 陷阱，见第 5 节）；`sink=None` 即注销；返回 `True`（出口实测点，见第 3 节运行时层）。
- `emit_harness_event(session_id, event_type, payload) -> None`（基类）：无 sink 时 no-op；有 sink 时构造 `HarnessEvent` 推送并**吞掉一切异常**（出口绝不影响回合）。
- `_emit_turn_started(session_id, request)` / `_emit_turn_finished(session_id, result)`（基类 helper）：统一 payload 形状（白名单），四个 adapter 各一行调用。

事件类型词汇表有意只有 2 个（回合边界）——CLI 逐事件粒度不在 v1（第 2 节的假 pending 理由 + 最小闭环判据），`HARNESS_EVENT_TYPES` 的存在让「出口事件的 type 受约束」成为可测试事实（词汇表由 `tests/test_harness_capability_consistency.py::test_harness_event_types_vocabulary_is_pinned` 钉死；emit 本身不校验 type，保持纯 best-effort——校验抛错会违背「出口绝不影响回合」）。

### D-3 emit 调用点：四路径逐一定位

| adapter / 路径 | `turn_started` 位置 | `turn_finished` 位置 | 不发事件的分支 |
| --- | --- | --- | --- |
| `_exec_cli.py` `turn()`（opencode 全路径 + codex exec 回退路径） | `:186` state 置 running 后（`argv` 构造前） | 尾部三个 return 块（timeout `:290-301` / error `:302-315` / exit 非 0 `:316-329` / success `:330-337`）统一改为「构造 `result` → emit → `return result`」 | `FileNotFoundError`（`:200-203` re-raise，无回合） |
| `codex.py` `turn()` 覆写（app-server 路径） | `_app_server_turn` 内 `turn/start` 请求成功后（`:425-427` 附近插一行）——**刻意不在方法开头**：app-server 启动失败回退 exec 时（`:337-345`），exec 引擎自己发 started，提前发会造成双 started | `turn()` 覆写里 `result = self._app_server_turn(...)` 正常返回后 emit（回退分支不 emit——exec 引擎已 emit） | exec 分支（`:333-334`，引擎内 emit）；`AppServerUnavailable` 回退分支（`:336-345`） |
| `claude_code.py` `turn()` | `send_user_message` 成功后（`:201-204` 的 try 块之后） | 四个 return 块前各插一行 emit（visible_tui `:214-224` / headless 成功 `:233-240` / exited `:242-252` / timeout `:253-270`） | `maybe_run_cb_subagents` 拦截分支（`:191-199`，跨 harness 子代理回合不属本 adapter 的回合）；`SessionNotFoundError` raise 路径 |
| `codebuddy.py` `turn()` | `send_user_message` 成功后（`:204-207` try 块之后） | 单个 return 块前（`:208-215`） | idempotency dedup 分支（`:154-163`，无新回合）；`maybe_run_cc_subagents` 拦截分支（`:190-198`）；`SessionNotFoundError` / `TurnInProgressError` raise 路径 |

emit 失序的防御（F-4 的重试 + 跨 adapter 语义差异可能产生的边界）：bridge 对「重复 `turn_started`（run 已开）」与「孤立 `turn_finished`（无活动 run）」都安全忽略（log + return），best-effort 契约写进 `ledger_outlet.py` docstring 与测试。

### D-4 账本桥：`HarnessLedgerBridge`（新模块 `agenticx/harness/ledger_outlet.py`）

- 职责：持有 recorder；`on_event(event: HarnessEvent)` 按第 2 节的映射表写账本；全程 try/except（`recorder.start_turn` 会 raise，F-7）。
- 构造：`build_turn_ledger_bridge(adapter, surface_sid, *, sessions_root, session_id, agent_id, provider, model) -> HarnessLedgerBridge | None` 工厂：`validate_ledger_id` 预校验命名空间 id（03 先例 `team_manager.py:1485-1488`）、`ReplayLedgerRecorder(store=ReplayLedgerStore(sessions_root), session_id=<owner>:harness, agent_id=<harness_id>, provider=..., model=..., enterprise_trace=False)`。`replay_ledger` 的 import 全在函数体内。
- `agent_id` 用 **harness_id**（如 `claude-code`）：run 记录的 agent_id 语义是「谁跑了这回合」，外部 harness 回合没有 avatar；`agent_id` 无 LEDGER_ID_PATTERN 约束（`contracts.py:119` 只 strip）。
- 命名空间 `<owner_session_id>:harness`（`validate_ledger_id` 的 pattern `^[A-Za-z0-9._:-]{1,128}$` 允许 `:`，03 同款）。备选：按 harness 分 `<owner>:harness:<hid>`——弃：跨 harness 切换后同一会话的回合时序分散在多个目录，`created_at` 排序失去全局意义；统一命名空间下 run 的 `provider`/`model` + payload 里的 `harness` 字段已可区分。
- 为什么不直接记 owner session（备选乙）：`find_open_run`（`resume_anchor.py:41-52`）取「最新 running run」，harness 回合崩溃停在 `running` 会盖住 builtin 回合的恢复锚点；`project_resume_anchor` 会把 harness run 投影成 `AgentCheckpoint`（外部 CLI 回合无法从账本恢复，投影无意义）；`/api/runs` 的列表会混入 harness 回合。03 核实结论 3 的消费方表逐条适用于此，结论相同：独立命名空间是唯一「零读取方改动」的方案。

### D-5 会话删除时清理命名空间账本

`session_manager.delete` 现已清理 owner 账本（`:1377-1379`）与 dispatch 命名空间（`:1380-1385`，03 加的）。04 在 `:1385` 之后插入第三块（同模式）：`ReplayLedgerStore(Path(self._sessions_root)).delete_session_runs(f"{sid}:harness")`，try/except 吞错。不依赖 run 记录遍历（harness 命名空间只有一个、id 由 owner sid 直接确定），比 03 的 dispatch 清理更简单。

### D-6 一致性检查器：`registry.capability_mismatches(adapter)`

- 位置：`registry.py`（master plan 入口点名该文件；「registry 里的声明档与 adapter 实际具备的能力函数之间的一致性」正落在登记处的职责上）。
- 返回 `List[str]`（每条一段描述性文字，如 `"codex: declares streaming=True but implements neither iter_stream_chunks nor drain_midturn_stream_items"`）。
- 判定表（静态反射，见第 3 节；检查器**只判 True 侧**——「声明了却不实现」才是脱节，「声明 False 却多实现」是保守声明、不算不一致；`idempotency` / `turn_snapshots` / `handoff_injection` 不判定，docstring 写明理由）：

| 标志 | 声明 True ⟹ 必须成立 |
| --- | --- |
| `streaming` | `type(adapter).iter_stream_chunks is not HarnessAdapter.iter_stream_chunks` 或 `callable(getattr(adapter, "drain_midturn_stream_items", None))` |
| `pty` | `write_pty` 与 `resize_pty` 均非基类默认 |
| `permission` | `permission` 非基类默认 |
| `resume` | `adopt_thread` 非基类默认（基类 `:137-146` raise `NotImplementedError`） |

- 「声明 False 且覆写为显式 raise」（codebuddy 的 permission，`:327-334`）的判等不在检查器里做（多实现/显式拒绝不构成脱节）；行为级断言（对 spawn 会话调 `permission` 抛 `CapabilityNotSupported`）由 `test_spawned_session_probe_matches_declared_capabilities` 覆盖（opencode 探针，同一语义）。

### D-7 接线：`_run_external_harness_turn_body` 的 attach / detach

- 位置：`:1136`（`surface_sid = lease.surface_session_id` 之后）构造 bridge 并 attach；`:1247-1251` 的 `manager._persist_session_state` 附近 try/finally detach。插在 `user_text` 处理与 `adapter.turn` 之间。
- 全程 best-effort：`harness_ledger_events_enabled()` 为 False、`getattr(manager, "_sessions_root", None)` 为 None（F-5）、`validate_ledger_id` 不过、recorder 构造失败——任一失败 → bridge 为 None → 不 attach，回合照常。
- provider / model：`managed.studio_session.provider_name` / `model_name`（`_run_external_harness_turn_body` 里 `:1109` 已有 `session`；与 `chat_model`/`chat_provider` 参数的时效性差异不影响账本语义——记会话档的值）。
- 事件 → bridge 的入口是 sink 闭包（`bridge.on_event`），emit 吞异常 + bridge 自身 try/except 双保险（F-7）。

### D-8 ratchet：`harness-outlet-bypass`

见核实结论第 7 节。规则 JSON 追加到 `scripts/ci/ratchet-baseline.json` 的 `rules` 数组末尾（第 5 条）。

### D-9 不改的东西（及为什么）

- `registry.py` 的 `descriptors()` 不加出口字段（不新增能力声明；出口对全部 adapter 可用，不是 capability）。
- `http_app.py` 不加出口接线（独立 app 无 owner session / sessions_root，没有账本可挂；见 Out of scope）。
- `server.py` 不改（接线在 `harness_wiring` 层已完成；`server.py:371` 只是异步包装）。
- `iter_stream_chunks` / `drain_midturn_stream_items` / PTY 语义不动。
- `agenticx/runtime/replay_ledger/` 零改动（复用 01/03 的全部接口；`enterprise_trace` 开关已存在）。
- 账本数据模型零改动（第 2 节）。

### 仓库对新 Python 文件的惯例（新代码遵守）

- 包内库模块：首行 docstring，末尾一行 `Author: Damon Li`，`from __future__ import annotations`，绝对导入，注释与 docstring 用英文。
- 测试文件：首行 docstring + `Author: Damon Li`；fake CLI 可执行沿用 `tests/test_harness_exec_adapters.py:30-158` 的写法（`_write_fake_cli` + `monkeypatch.setenv("AGX_*_EXECUTABLE", ...)`）；studio 侧接线测试沿用 `tests/test_studio_harness_wiring.py` 的 `RecordingAdapter` / `FakeManager` / `wiring` fixture 写法（`:30-235`）。
- 环境变量前缀 `AGX_`，配置键在 `runtime.*` 下，布尔开关经 `harden_flags._resolve_bool` 解析；新开关要有关闭后回到旧行为的测试。
- `agenticx/harness/` 包的模块层不新增对 `agenticx.runtime.replay_ledger` 的 import（只在函数体内 import）；不在 `agenticx/runtime/replay_ledger/` 之外出现 `RunEvent(`、`run_dir / "events.jsonl"`、`runs/*/events.jsonl` 字面量；不新增 `save_agent_state(`、`project_resume_anchor(` 调用；不出现 `.mailbox.json`、`.context.json` 字面量。

## In scope

- `HarnessEvent` 类型、`HarnessEventSink` 别名、事件词汇表（`types.py`）。
- `HarnessAdapter.attach_event_sink` / `emit_harness_event` / 两个 turn helper（基类默认实现，`adapter.py`）。
- 四个 adapter 的 `turn()` 体内 emit 调用点（`_exec_cli.py`、`codex.py`、`claude_code.py`、`codebuddy.py`；签名与返回值不动）。
- `registry.capability_mismatches` 一致性检查器。
- 账本桥 `agenticx/harness/ledger_outlet.py`（bridge + 工厂；命名空间 `<owner>:harness`；`enterprise_trace=False`）。
- `harness_wiring._run_external_harness_turn_body` 的 attach / detach 接线 + 开关 `AGX_HARNESS_LEDGER_EVENTS`（`harden_flags.py`）。
- `session_manager.delete` 补 harness 命名空间清理（第三块插入）。
- ratchet 第 5 条规则 `harness-outlet-bypass`（基线 0）。
- 三个新测试文件（出口 / 一致性 / 账本接线），覆盖 AC-1…AC-4；56 个既有 harness 用例与 01/03 账本用例保持通过。

## Out of scope

- 新增 adapter；新增 harness 能力（`HarnessCapabilities` 不加标志、`descriptors()` 不加字段）；统一降级抽象（把调用方改造成按标志降级）。
- 修改任何现有方法的签名与返回值（`turn()` / `spawn()` / `stop()` / `iter_stream_chunks` / `TurnRequest` / `TurnResult` 全部不动）。
- PTY 兜底与 transcript 历史补齐；`iter_stream_chunks` 原始字节的解析与落盘；CLI 逐事件粒度（`exec_command_begin` 等）的账本化；Codex 双路径（app-server 失败回退 exec）提成统一约定——master plan 已定「其余 adapter 没有第二条路径，提了也没有消费方」。
- `http_app.py`（harness-surface 独立 app）的出口 / 账本接线（无 owner session 可挂）；`switch_harness` / `HandoffEngine.execute_handoff` 注入回合的账本化（非用户回合；按需再做）。
- 账本数据模型：`EVENT_TYPES`、`RunEvent` / `ReplayRunRecord` / `ContextCheckpoint` 字段、`SCHEMA_VERSION` 一律不动。
- `agenticx/runtime/replay_ledger/` 的任何行为变更；`agenticx/runtime/agent_runtime.py`、`session_event_hub.py`、`coordination/`、`studio/storage/` 不改；`agenticx/studio/server.py` 不改。
- 修 Codex streaming 声明与 `iter_stream_chunks` 的脱节本身（F-2：一致性检查器把它判为「一致（drain 实现路径）」；若主会话想改声明或补实现，另开小 commit）。
- 重试 / 优先级 / 跨 harness 编排 / 托管副本；跨副本（HA）的 harness 回合账本共享。
- 调大 ratchet 基线；修改既有 4 条规则。

## Precise landing points

| 文件 | 动作 | 位置 | 内容 |
| --- | --- | --- | --- |
| `agenticx/harness/types.py` | Modify | `:177`（`HarnessDescriptor` 定义之后、文件末尾）追加 | `HarnessEvent`、`HARNESS_EVENT_TYPES`、`HarnessEventSink`（Task 1 代码块 A） |
| `agenticx/harness/adapter.py` | Modify | `:19`（import 区 `List` 后加 `Callable` 不需要——用 `from typing import Any, Dict, Iterator, List, Optional` 已够，`HarnessEventSink` 从 types 导入）；`:152-153`（`_require_session` 之后、文件末尾）追加 | import 区加 `HarnessEvent` / `HarnessEventSink` / `HARNESS_EVENT_TYPES`；四个方法（Task 1 代码块 B） |
| `agenticx/harness/registry.py` | Modify | `:13`（import 区加 `Callable` 不需要）；`:79`（`descriptors` 方法之后、`_default_registry` 段之前）追加 | `capability_mismatches`（Task 1 代码块 C） |
| `agenticx/harness/adapters/_exec_cli.py` | Modify | `:188`（`argv = [...]` 之前插一行）；`:290-337`（四个 return 块改为构造 + emit + return） | emit 接线（Task 2 代码块 D） |
| `agenticx/harness/adapters/codex.py` | Modify | `:332-345`（`turn()` 覆写整体替换）；`:424-427`（`turn/start` 成功后插一行） | emit 接线（Task 2 代码块 E） |
| `agenticx/harness/adapters/claude_code.py` | Modify | `:204`（`send_user_message` try 块后插一行）；`:214` / `:233` / `:242` / `:253`（四个 return 前各插一行） | emit 接线（Task 2 代码块 F） |
| `agenticx/harness/adapters/codebuddy.py` | Modify | `:207`（`send_user_message` try 块后插一行）；`:209`（return 块前插一行） | emit 接线（Task 2 代码块 G） |
| `agenticx/harness/ledger_outlet.py` | Create | — | bridge + 工厂（Task 3 代码块 H，完整内容） |
| `agenticx/runtime/harden_flags.py` | Modify | `:149`（`dispatch_mailbox_enabled` 之后、`:152` `cancelled_prefix_finalize_enabled` 之前）插入 | `harness_ledger_events_enabled()`（Task 3 代码块 I） |
| `agenticx/studio/harness_wiring.py` | Modify | `:50`（import 区加一行）；`:1136` 与 `:1138` 之间插入 attach 块；`:1247-1251` 的 try 前后改 finally detach | 接线（Task 3 代码块 J） |
| `agenticx/studio/session_manager.py` | Modify | `:1385`（dispatch 清理块之后、`:1386` `_purge_session_state` 之前）插入 | harness 命名空间清理（Task 3 代码块 K） |
| `scripts/ci/ratchet-baseline.json` | Modify | `rules` 数组末尾追加第 5 条 | `harness-outlet-bypass`（Task 3 代码块 L） |
| `tests/test_harness_event_outlet.py` | Create（Test） | — | Task 1/2 测试（完整内容） |
| `tests/test_harness_capability_consistency.py` | Create（Test） | — | Task 1 测试（完整内容） |
| `tests/test_harness_ledger_outlet.py` | Create（Test） | — | Task 3 测试（完整内容） |
| `agenticx/studio/server.py` | 不改 | — | 接线在 harness_wiring 层完成 |
| `agenticx/harness/http_app.py` | 不改 | — | 独立 app 无账本可挂 |
| `agenticx/runtime/replay_ledger/*` | 不改 | — | 复用 01/03 接口 |

## Tasks

三个串行任务：出口原语与一致性检查器 → 四个 adapter 的 emit 接线 → 账本桥与 studio 接线（含 ratchet）。每个任务先写失败的测试，再写实现。**实现与本 plan 一致但测试仍失败时，停下报告，不许改断言。** 新文件给完整代码；被修改的既有文件用「在 `文件:行号` 之间插入 / 把 X 替换为 Y」的精确写法，行号以当前工作树 `23cf58d4` 为准；同一任务内的行号指未应用本任务之前的状态，应用后以给出的锚点文本定位。

所有测试命令都用 `/opt/miniconda3/bin/python3 -m pytest <文件> -q --no-cov`（`.venv` 没有 pytest）。规划阶段已执行的探针见头部；下列命令中标注「已执行」的是实测输出，其余为待实施时执行。

### Task 1：事件出口原语 + 一致性检查器（types.py / adapter.py / registry.py + 两个测试文件）

依赖的现有 API：

| API | 出处 | 用法 |
| --- | --- | --- |
| `TurnRequest`（`text` / `wait_seconds` / `owner_session_id`） | `agenticx/harness/types.py:95-107` | `_emit_turn_started` 读 `request.text` / `wait_seconds` |
| `TurnResult`（`status` / `result_text` / `deduplicated` / `detail`） | `agenticx/harness/types.py:139-154` | `_emit_turn_finished` 读白名单字段 |
| `HarnessAdapter` 类属性 `harness_id` | `agenticx/harness/adapter.py:41-42` | emit 的 `harness` 字段 |
| `HarnessCapabilities` 字段 | `agenticx/harness/types.py:60-92` | `capability_mismatches` 逐标志反射 |
| `default_registry().adapters()` | `agenticx/harness/registry.py:58-60` | 一致性测试遍历 4 个内置 adapter |

#### 代码块 A —— `agenticx/harness/types.py`（在 `:177` `available: bool = False` 之后、文件末尾追加；`:14` 的 `from typing import ...` 加 `Callable`）

把 `:14` 的 `from typing import Any, Dict, Optional` 替换为 `from typing import Any, Callable, Dict, Optional`，然后在文件末尾（`:177` 之后）追加：

```python
HARNESS_EVENT_TURN_STARTED = "turn_started"
HARNESS_EVENT_TURN_FINISHED = "turn_finished"

#: Event vocabulary of the structured harness event outlet. v1 carries
#: turn-level boundaries only: text deltas and per-CLI tool events stay
#: out of any ledger by design (see the runtime-invariants master plan).
HARNESS_EVENT_TYPES = frozenset(
    {HARNESS_EVENT_TURN_STARTED, HARNESS_EVENT_TURN_FINISHED}
)


@dataclass(frozen=True)
class HarnessEvent:
    """One structured event emitted through the adapter event outlet.

    Adapters emit these at turn boundaries; sinks translate them into
    consumers (today: the replay-ledger bridge). The outlet is optional,
    best-effort, and must never affect the turn itself.
    """

    type: str
    harness: str
    session_id: str
    payload: Dict[str, Any] = field(default_factory=dict)
    ts: float = 0.0


#: Callable receiving one :class:`HarnessEvent`; it must never raise.
HarnessEventSink = Callable[["HarnessEvent"], None]
```

#### 代码块 B —— `agenticx/harness/adapter.py`（`:21-28` 的 types 导入块加三个名字；`:17` 后加 `import time`；`:152-153`（`_require_session` 之后、文件末尾）追加四个方法）

把 `:21-28` 的导入块替换为：

```python
import time

from agenticx.harness.types import (
    HARNESS_EVENT_TURN_FINISHED,
    HARNESS_EVENT_TURN_STARTED,
    HarnessCapabilities,
    HarnessEvent,
    HarnessEventSink,
    PermissionDecision,
    SessionNotFoundError,
    TurnRequest,
    TurnResult,
)
```

（`CapabilityNotSupported` 原在导入里，仍保留在列表中——完整列表为 `CapabilityNotSupported, HARNESS_EVENT_TURN_FINISHED, HARNESS_EVENT_TURN_STARTED, HarnessCapabilities, HarnessEvent, HarnessEventSink, PermissionDecision, SessionNotFoundError, TurnRequest, TurnResult`，按字母序。）然后在 `_require_session` 方法（`:151-153`）之后追加：

```python
    # ------------------------------------------------------------------
    # structured event outlet (optional, best-effort)
    # ------------------------------------------------------------------
    def _event_sinks(self) -> Dict[str, "HarnessEventSink"]:
        """Lazily created per-instance sink registry.

        Lazy on purpose: ClaudeCodeAdapter / CodeBuddyAdapter mix in
        bridge managers whose ``__init__`` runs first and never calls the
        harness-side ``__init__``, so attribute setup cannot live in an
        ``__init__`` on this base class.
        """
        sinks = self.__dict__.setdefault("_harness_event_sinks", {})
        if not isinstance(sinks, dict):
            sinks = {}
            self.__dict__["_harness_event_sinks"] = sinks
        return sinks

    def attach_event_sink(
        self, session_id: str, sink: "HarnessEventSink | None"
    ) -> bool:
        """Register (or clear, with ``None``) the event sink of one session.

        Returns True when the outlet is usable for that session. Entries
        are per surface session id; attaching ``None`` or a new sink
        replaces the previous entry, so a sink leaked by a crashed turn
        never outlives the next attach of the same session.
        """
        sid = str(session_id or "").strip()
        if not sid:
            return False
        if sink is None:
            self._event_sinks().pop(sid, None)
            return True
        if not callable(sink):
            return False
        self._event_sinks()[sid] = sink
        return True

    def emit_harness_event(
        self, session_id: str, event_type: str, payload: Dict[str, Any]
    ) -> None:
        """Push one structured event to the session's registered sink.

        Best-effort by contract: no sink registered, or a raising sink,
        never propagates into the turn.
        """
        sid = str(session_id or "").strip()
        sink = self._event_sinks().get(sid)
        if sink is None:
            return
        event = HarnessEvent(
            type=str(event_type or ""),
            harness=self.harness_id,
            session_id=sid,
            payload=dict(payload or {}),
            ts=time.time(),
        )
        try:
            sink(event)
        except Exception:
            pass

    def _emit_turn_started(self, session_id: str, request: TurnRequest) -> None:
        """Emit ``turn_started`` for one dispatched turn."""
        self.emit_harness_event(
            session_id,
            HARNESS_EVENT_TURN_STARTED,
            {
                "user_text": str(request.text or ""),
                "wait_seconds": request.wait_seconds,
                "owner_session_id": str(
                    getattr(request, "owner_session_id", "") or ""
                ),
            },
        )

    def _emit_turn_finished(self, session_id: str, result: TurnResult) -> None:
        """Emit ``turn_finished`` with a whitelisted result summary."""
        detail = result.detail if isinstance(result.detail, dict) else {}
        summary_keys = (
            "native_thread_id",
            "turn_count",
            "turn_seq",
            "observed_tools",
            "tokens",
            "usage_totals",
            "exit_code",
            "mode",
            "transport",
        )
        detail_summary = {key: detail[key] for key in summary_keys if key in detail}
        self.emit_harness_event(
            session_id,
            HARNESS_EVENT_TURN_FINISHED,
            {
                "status": str(result.status or ""),
                "result_text": str(result.result_text or ""),
                "deduplicated": bool(result.deduplicated),
                "detail": detail_summary,
            },
        )
```

#### 代码块 C —— `agenticx/harness/registry.py`（`:79` `descriptors` 方法结束后、`:82` `_default_registry` 段之前追加模块级函数）

```python
def capability_mismatches(adapter: HarnessAdapter) -> List[str]:
    """Report declared capabilities that the adapter does not implement.

    Static reflection over the adapter class (including inherited
    overrides): each mismatch is one human-readable sentence. The
    consistency tests assert the builtin adapters produce none of these
    and that a deliberately lying adapter does.

    ``streaming`` accepts either an ``iter_stream_chunks`` override or a
    callable ``drain_midturn_stream_items`` (the Codex app-server pump
    is a real streaming implementation that does not use the chunk
    iterator). ``idempotency`` / ``turn_snapshots`` / ``handoff_injection``
    have no dedicated method to reflect on, so they are not judged here;
    their behavior is pinned by the existing turn tests instead.
    """
    caps = adapter.capabilities()
    cls = type(adapter)

    def _overridden(name: str) -> bool:
        return getattr(cls, name, None) is not getattr(HarnessAdapter, name, None)

    out: List[str] = []
    if caps.streaming and not (
        _overridden("iter_stream_chunks")
        or callable(getattr(adapter, "drain_midturn_stream_items", None))
    ):
        out.append(
            f"{adapter.harness_id}: declares streaming=True but implements "
            "neither iter_stream_chunks nor drain_midturn_stream_items"
        )
    if caps.pty and not (_overridden("write_pty") and _overridden("resize_pty")):
        out.append(
            f"{adapter.harness_id}: declares pty=True without both write_pty "
            "and resize_pty overrides"
        )
    if caps.permission and not _overridden("permission"):
        out.append(
            f"{adapter.harness_id}: declares permission=True without a "
            "permission override"
        )
    if caps.resume and not _overridden("adopt_thread"):
        out.append(
            f"{adapter.harness_id}: declares resume=True without an "
            "adopt_thread override"
        )
    return out
```

`registry.py` 的 import 无需新增（`List` 已在 `:10`，`HarnessAdapter` 已在 `:12`）。

#### 测试：`tests/test_harness_event_outlet.py`（Create，完整内容——Task 1 只落「outlet primitives」节；Task 2 追加「emit wiring」节）

```python
#!/usr/bin/env python3
"""Tests for the structured harness event outlet (runtime invariants 04).

Covers the outlet primitives on the adapter base class and the emit
wiring of all four builtin adapters (exec CLI engine, Codex app-server,
the two bridge adapters). No real CLI is spawned: exec paths run fake
executable stubs, bridges run fake subprocesses.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import queue
import stat
import subprocess
import threading
from typing import Any, Dict, List, Optional

import pytest

from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter
from agenticx.harness.adapters.codebuddy import CodeBuddyAdapter
from agenticx.harness.adapters.opencode import OpenCodeAdapter
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.types import (
    HARNESS_EVENT_TURN_FINISHED,
    HARNESS_EVENT_TURN_STARTED,
    HarnessEvent,
    TurnRequest,
)


class RecordingSink:
    """Collect every event; optionally raise on call."""

    def __init__(self, *, raise_on_event: bool = False) -> None:
        self.events: List[HarnessEvent] = []
        self.raise_on_event = raise_on_event

    def __call__(self, event: HarnessEvent) -> None:
        if self.raise_on_event:
            raise RuntimeError("sink exploded")
        self.events.append(event)


# ----------------------------------------------------------------------
# outlet primitives
# ----------------------------------------------------------------------
def test_attach_and_roundtrip_emits_event() -> None:
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True

    adapter.emit_harness_event("sid-1", "turn_started", {"user_text": "hi"})

    assert len(sink.events) == 1
    event = sink.events[0]
    assert event.type == "turn_started"
    assert event.harness == "opencode"
    assert event.session_id == "sid-1"
    assert event.payload == {"user_text": "hi"}
    assert event.ts > 0.0


def test_attach_none_clears_the_sink() -> None:
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True
    assert adapter.attach_event_sink("sid-1", None) is True

    adapter.emit_harness_event("sid-1", "turn_started", {})

    assert sink.events == []


def test_attach_rejects_invalid_targets() -> None:
    adapter = OpenCodeAdapter()
    assert adapter.attach_event_sink("", RecordingSink()) is False
    assert adapter.attach_event_sink("sid-1", "not-callable") is False


def test_emit_without_sink_is_noop() -> None:
    adapter = OpenCodeAdapter()
    adapter.emit_harness_event("never-attached", "turn_started", {})
    # no sink, no raise, nothing to assert beyond survival


def test_emit_swallows_sink_errors() -> None:
    adapter = OpenCodeAdapter()
    adapter.attach_event_sink("sid-1", RecordingSink(raise_on_event=True))
    adapter.emit_harness_event("sid-1", "turn_started", {})
    # a broken sink must never propagate into the turn


def test_sink_registry_is_lazy_without_init() -> None:
    # The bridge adapters never run the harness-side __init__, so the
    # registry must rebuild itself lazily even when the attribute is
    # missing from __dict__.
    adapter = OpenCodeAdapter()
    adapter.__dict__.pop("_harness_event_sinks", None)
    sink = RecordingSink()
    assert adapter.attach_event_sink("sid-1", sink) is True
    adapter.emit_harness_event("sid-1", "turn_started", {})
    assert len(sink.events) == 1
```

#### 测试：`tests/test_harness_capability_consistency.py`（Create，完整内容）

```python
#!/usr/bin/env python3
"""Capability-declaration vs implementation consistency tests (04).

AC-3 of the runtime-invariants master plan: a harness whose declared
capabilities are not backed by real implementations must fail here.

Author: Damon Li
"""

from __future__ import annotations

import stat
from typing import Any, Dict, List, Optional

import pytest

from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import capability_mismatches, default_registry
from agenticx.harness.types import (
    CapabilityNotSupported,
    HARNESS_EVENT_TYPES,
    HarnessCapabilities,
)


class _LyingAdapter(HarnessAdapter):
    """Declares capabilities it does not implement at all."""

    harness_id = "lying"
    display_name = "Lying"
    description = "declares everything, implements nothing"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=True,
            pty=True,
            streaming=True,
            turn_snapshots=True,
            idempotency=True,
            resume=True,
        )

    def spawn(self, cwd, *, options: Optional[Dict[str, Any]] = None):
        return {}

    def turn(self, session_id, request):
        raise NotImplementedError

    def stop(self, session_id) -> bool:
        return False

    def available(self) -> bool:
        return True

    def describe(self, session_id):
        return None

    def list_sessions(self) -> List[Dict[str, Any]]:
        return []


def test_builtin_adapters_have_no_capability_mismatch() -> None:
    for adapter in default_registry().adapters():
        assert capability_mismatches(adapter) == [], (
            f"capability mismatch on {adapter.harness_id}"
        )


def test_mismatched_adapter_is_reported() -> None:
    mismatches = capability_mismatches(_LyingAdapter())
    joined = "\n".join(mismatches)
    assert "streaming=True" in joined
    assert "pty=True" in joined
    assert "permission=True" in joined
    assert "resume=True" in joined
    assert len(mismatches) == 4


def test_harness_event_types_vocabulary_is_pinned() -> None:
    assert HARNESS_EVENT_TYPES == frozenset({"turn_started", "turn_finished"})


def test_spawned_session_probe_matches_declared_capabilities(
    tmp_path, monkeypatch
) -> None:
    # Behavior-level probe on a real spawned session (fake executable):
    # declared-off capabilities must raise CapabilityNotSupported, and a
    # declared resume implementation must exist (ValueError on an empty
    # thread id is the engine's own contract).
    from agenticx.harness.adapters.opencode import OpenCodeAdapter

    exe = tmp_path / "fake-opencode"
    exe.write_text("#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", str(exe))

    adapter = OpenCodeAdapter()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]

    with pytest.raises(CapabilityNotSupported):
        adapter.iter_stream_chunks(sid)
    with pytest.raises(CapabilityNotSupported):
        adapter.permission(sid, None)
    with pytest.raises(ValueError):
        adapter.adopt_thread(sid, "")
```

#### Task 1 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_event_outlet.py tests/test_harness_capability_consistency.py -q --no-cov
# 预期：全部新增用例通过（先写测试时红：attach_event_sink 等尚不存在）
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py tests/test_codex_app_server.py -q --no-cov
# 预期：56 + app-server 既有用例全部通过（基线 56 已实测）
```

依赖的现有 API（Task 1）：

| API | 出处 | 用法 |
| --- | --- | --- |
| `TurnRequest.text` / `.wait_seconds` / `.owner_session_id` | `agenticx/harness/types.py:95-107` | `_emit_turn_started` payload |
| `TurnResult.status` / `.result_text` / `.deduplicated` / `.detail` | `agenticx/harness/types.py:139-154` | `_emit_turn_finished` payload |
| `HarnessAdapter` 抽象方法集（`capabilities` / `spawn` / `turn` / `stop` / `available` / `describe` / `list_sessions`） | `agenticx/harness/adapter.py:51-133` | `_LyingAdapter` 桩实现 |
| `default_registry().adapters()` | `agenticx/harness/registry.py:58-60, 86-105` | 一致性测试 |
| `OpenCodeAdapter.spawn`（`AGX_OPENCODE_EXECUTABLE` 覆盖） | `agenticx/harness/adapters/_exec_cli.py:125-127, 142-160` | spawn 实测探针 |
| `CapabilityNotSupported` | `agenticx/harness/types.py:31-41` | 基类默认 raise（`adapter.py:97-117`） |

### Task 2：四个 adapter 的 emit 接线（`_exec_cli.py` / `codex.py` / `claude_code.py` / `codebuddy.py`）

#### 代码块 D —— `agenticx/harness/adapters/_exec_cli.py` `turn()`

在 `:188`（`argv = [self.executable()] + self._build_args(session, request.text)` 之前）不插；`_emit_turn_started` 插在 `:204`（`session.proc = proc`）之后——`FileNotFoundError`（`:200-203` re-raise）意味着没有回合开始，不能只发 started：

```python
        session.proc = proc
        # Emitted after a successful spawn: a missing executable means no
        # turn ever started, so it must not announce one.
        self._emit_turn_started(session_id, request)
```

把 `:290-301` 的 timeout return 块：

```python
        if timed_out:
            timeout_detail = dict(detail, wait_seconds=request.wait_seconds)
            if visible_tail and not timeout_detail.get("terminal_detail"):
                timeout_detail["terminal_detail"] = visible_tail[:500]
            return TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_TIMEOUT,
                result_text="",
                tail=tail,
                detail=timeout_detail,
            )
```

替换为：

```python
        if timed_out:
            timeout_detail = dict(detail, wait_seconds=request.wait_seconds)
            if visible_tail and not timeout_detail.get("terminal_detail"):
                timeout_detail["terminal_detail"] = visible_tail[:500]
            result = TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=TURN_STATUS_TIMEOUT,
                result_text="",
                tail=tail,
                detail=timeout_detail,
            )
            self._emit_turn_finished(session_id, result)
            return result
```

把 `:302-315` 的 error return 块（`if error_text:` 起到其 `return TurnResult(...)` 止）按同样模式替换（`return TurnResult(...)` → `result = TurnResult(...)` + `self._emit_turn_finished(session_id, result)` + `return result`）；`:316-329` 的 exit-code error 块与 `:330-337` 的 success return 块同样处理。四个块的替换后形态一致：

```python
            result = TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=<各自的状态常量>,
                result_text=<各自的文本>,
                tail=tail,
                detail=<各自的 detail>,
            )
            self._emit_turn_finished(session_id, result)
            return result
```

#### 代码块 E —— `agenticx/harness/adapters/codex.py`

把 `:332-345` 的 `turn()` 覆写整体替换为：

```python
    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        if preferred_transport() == "exec":
            return super().turn(session_id, request)
        try:
            result = self._app_server_turn(session_id, request)
        except AppServerUnavailable:
            session = self._get(session_id)
            # Handshake/startup failed: drop the broken process and use
            # exec --json rather than failing the user's turn. The exec
            # engine emits its own turn events on this fallback path.
            self._close_app_server(session)
            with self._lock:
                if session.state == "running":
                    session.state = "idle"
            return super().turn(session_id, request)
        self._emit_turn_finished(session_id, result)
        return result
```

在 `_app_server_turn` 内 `:425-427`（`turn = started.get("turn") ...` / `rpc.acc["turn_id"] = str(turn["id"])` 块）之后、`:428`（`wait = request.wait_seconds ...`）之前插入：

```python
            self._emit_turn_started(session_id, request)
```

（插在 `turn/start` 成功之后是刻意的：app-server 启动失败回退 exec 的路径上，started 只由 exec 引擎发一次，不会双发。）

#### 代码块 F —— `agenticx/harness/adapters/claude_code.py` `turn()`

在 `:204`（`except KeyError as exc: raise SessionNotFoundError(...)` 块之后、`:206` `if session.session_kind == "visible_tui":` 之前）插入：

```python
        self._emit_turn_started(session_id, request)
```

把 `:214-224` 的 visible_tui return 块替换为（`return TurnResult(...)` → result 变量 + emit + return，其余逐字保留）：

```python
            result = TurnResult(
                harness=self.harness_id,
                session_id=session_id,
                status=status,
                result_text=cleaned[:_RESULT_TEXT_MAX_CHARS] if cleaned else "",
                tail=tail,
                detail={
                    "mode": "visible_tui",
                    "parse_confidence": confidence,
                },
            )
            self._emit_turn_finished(session_id, result)
            return result
```

`:233-240`（headless success）、`:242-252`（exited）、`:253-270`（timeout）三个 return 块同样处理：`return TurnResult(` → `result = TurnResult(`，收尾两行 `self._emit_turn_finished(session_id, result)` / `return result`。四个块的 `TurnResult(...)` 构造参数逐字不动。

#### 代码块 G —— `agenticx/harness/adapters/codebuddy.py` `turn()`

在 `:207`（`except KeyError as exc: raise SessionNotFoundError(session_id) from exc` 块之后、`:208` `status, snap = self.wait_for_turn(...)` 之前）插入：

```python
        self._emit_turn_started(session_id, request)
```

把 `:208-215` 替换为：

```python
        status, snap = self.wait_for_turn(session_id, request.wait_seconds)
        result = self._turn_result(
            session_id,
            status,
            snap,
            deduplicated=False,
            user_text=request.text,
        )
        self._emit_turn_finished(session_id, result)
        return result
```

（idempotency dedup 分支 `:154-163` 与 cross-harness 拦截分支 `:190-198` 刻意不 emit：前者没有新回合，后者是另一个 harness 的回合。）

#### 测试：`tests/test_harness_event_outlet.py` 追加「emit wiring」节

```python
# ----------------------------------------------------------------------
# emit wiring: exec CLI engine (opencode), codex exec fallback,
# codex app-server, and the two bridge adapters
# ----------------------------------------------------------------------
_FAKE_OPENCODE_CLI = r'''#!/usr/bin/env python3
import json, sys
print(json.dumps({"type": "step_start", "sessionID": "ses_o1",
      "part": {"type": "step-start"}}))
print(json.dumps({"type": "tool_use", "sessionID": "ses_o1", "part": {
    "type": "tool", "tool": "write", "callID": "c1",
    "state": {"status": "completed", "input": {}, "output": "ok"}}}))
print(json.dumps({"type": "text", "sessionID": "ses_o1",
      "part": {"type": "text", "text": "Hello from opencode"}}))
print(json.dumps({"type": "step_finish", "sessionID": "ses_o1", "part": {
    "type": "step-finish", "reason": "stop",
    "tokens": {"total": 7814, "input": 5764, "output": 2}}}))
'''


_FAKE_APP_SERVER_CLI = r'''#!/usr/bin/env python3
import json, sys
for raw in sys.stdin:
    raw = raw.strip()
    if not raw:
        continue
    msg = json.loads(raw)
    method = msg.get("method")
    msg_id = msg.get("id")
    if method == "initialize":
        print(json.dumps({"id": msg_id, "result": {"userAgent": "stub"}}),
              flush=True)
    elif method == "thread/start":
        print(json.dumps({"id": msg_id, "result": {"thread": {"id": "thr_1"}}}),
              flush=True)
    elif method == "turn/start":
        print(json.dumps({"id": msg_id, "result": {"turn": {
            "id": "turn_1", "status": "inProgress"}}}), flush=True)
        print(json.dumps({"method": "item/completed", "params": {
            "threadId": "thr_1", "turnId": "turn_1",
            "item": {"type": "agentMessage", "id": "i1",
                     "text": "app-server reply"}}}), flush=True)
        print(json.dumps({"method": "turn/completed", "params": {
            "threadId": "thr_1", "turn": {"id": "turn_1",
            "status": "completed", "error": None}}}), flush=True)
    elif msg_id is not None:
        print(json.dumps({"id": msg_id, "error": {"code": -32601,
                                                  "message": "unknown"}}),
              flush=True)
'''


def _write_fake_cli(tmp_path, name: str, source: str) -> str:
    path = tmp_path / name
    path.write_text(source)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return str(path)


_CC_RESULT = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"hello from claude","session_id":"abc","duration_ms":10}'
)

_WB_RESULT = (
    '{"type":"result","subtype":"success","is_error":false,'
    '"result":"OK","duration_ms":9804,"num_turns":2,'
    '"usage":{"input_tokens":100,"output_tokens":3,'
    '"cache_read_input_tokens":5,"cache_creation_input_tokens":0},'
    '"permission_denials":[]}'
)


def test_exec_cli_turn_emits_started_and_finished(tmp_path, monkeypatch) -> None:
    exe = _write_fake_cli(tmp_path, "fake-opencode", _FAKE_OPENCODE_CLI)
    monkeypatch.setenv("AGX_OPENCODE_EXECUTABLE", exe)
    adapter = OpenCodeAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    started = sink.events[0]
    assert started.payload["user_text"] == "hello"
    finished = sink.events[1]
    assert finished.payload["status"] == "success"
    assert finished.payload["result_text"] == "Hello from opencode"
    assert finished.payload["detail"]["tokens"]["input"] == 5764


def test_codex_exec_transport_emits_events(tmp_path, monkeypatch) -> None:
    from agenticx.harness.adapters.codex import CodexAdapter

    exe = _write_fake_cli(tmp_path, "fake-codex", _FAKE_CODEX_CLI)
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.setenv("AGX_CODEX_TRANSPORT", "exec")
    adapter = CodexAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "All done from codex"
    assert sink.events[1].payload["detail"]["tokens"]["input"] == 100


def test_codex_app_server_turn_emits_events(tmp_path, monkeypatch) -> None:
    from agenticx.harness.adapters.codex import CodexAdapter

    exe = _write_fake_cli(tmp_path, "fake-codex-app-server", _FAKE_APP_SERVER_CLI)
    monkeypatch.setenv("AGX_CODEX_EXECUTABLE", exe)
    monkeypatch.delenv("AGX_CODEX_TRANSPORT", raising=False)
    adapter = CodexAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path))
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="hello", wait_seconds=30.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "app-server reply"
    assert sink.events[1].payload["detail"]["transport"] == "app-server"


**注意（写给实施者）**：`test_claude_code_headless_turn_emits_events` / `test_codebuddy_turn_emits_events` / `test_codebuddy_dedup_turn_does_not_double_emit` 三个用例的 fake 机制依赖 `ScriptedStream` / `TriggeredStdin` / `FakeProc` / `_fake_popen_factory` 四段类与函数——实施时把它们从 `tests/test_harness_surface.py:51-127` **复制**进本文件（不能跨测试文件 import），然后按下列方式驱动：

```python
def test_claude_code_headless_turn_emits_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.cc_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_CC_RESULT]),
    )
    adapter = ClaudeCodeAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"mode": "headless"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="say hello", wait_seconds=5.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[0].payload["user_text"] == "say hello"
    assert sink.events[1].payload["result_text"] == "hello from claude"


def test_codebuddy_turn_emits_events(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT]),
    )
    adapter = CodeBuddyAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"permission_mode": "default"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    result = adapter.turn(sid, TurnRequest(text="do the thing", wait_seconds=5.0))

    assert result.status == "success"
    assert [e.type for e in sink.events] == [
        HARNESS_EVENT_TURN_STARTED,
        HARNESS_EVENT_TURN_FINISHED,
    ]
    assert sink.events[1].payload["result_text"] == "OK"
    assert sink.events[1].payload["detail"]["turn_seq"] == 1


def test_codebuddy_dedup_turn_does_not_double_emit(
    tmp_path, monkeypatch
) -> None:
    # Reuse the surface-test idempotency fake: first turn sends a key,
    # second turn with the same key must dedup WITHOUT a second
    # turn_started (no new child turn actually ran).
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        _fake_popen_factory([_WB_RESULT]),
    )
    adapter = CodeBuddyAdapter()
    sink = RecordingSink()
    view = adapter.spawn(str(tmp_path), options={"permission_mode": "default"})
    sid = view["session_id"]
    adapter.attach_event_sink(sid, sink)

    first = adapter.turn(sid, TurnRequest(text="a", wait_seconds=5.0,
                                          idempotency_key="k1"))
    second = adapter.turn(sid, TurnRequest(text="a", wait_seconds=5.0,
                                           idempotency_key="k1"))

    assert first.status == "success" and second.deduplicated is True
    started = [e for e in sink.events if e.type == HARNESS_EVENT_TURN_STARTED]
    assert len(started) == 1
```

（`_FAKE_CODEX_CLI` 取 `tests/test_harness_exec_adapters.py:78-133` 的 `_FAKE_CODEX` 脚本内容，复制进本文件；surface 测试的 `_CC_RESULT_SUCCESS` / `_WB_RESULT_SUCCESS`（`tests/test_harness_surface.py:30-48`）同样复制。）

#### Task 2 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_event_outlet.py -q --no-cov
# 预期：新增 emit wiring 用例全部通过
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py tests/test_codex_app_server.py tests/test_harness_handoff.py tests/test_session_harness_binding.py -q --no-cov
# 预期：全部既有用例通过（emit 在无 sink 时为 no-op，行为逐字不变）
```

依赖的现有 API（Task 2）：

| API | 出处 | 用法 |
| --- | --- | --- |
| `ExecCliHarnessAdapter.turn` 尾部四个 return 块 | `agenticx/harness/adapters/_exec_cli.py:290-337` | emit 插入点 |
| `CodexAdapter.turn` 覆写 / `_app_server_turn` | `agenticx/harness/adapters/codex.py:332-345, 347-456` | 双路径 emit |
| `ClaudeCodeAdapter.turn` 四个 return | `agenticx/harness/adapters/claude_code.py:201-270` | emit 插入点 |
| `CodeBuddyAdapter.turn` dispatch 段 | `agenticx/harness/adapters/codebuddy.py:204-215` | emit 插入点 |
| `turn_matches_idempotency_key`（dedup 分支） | `agenticx/harness/adapters/codebuddy.py:154-163` | dedup 不 emit 的断言 |
| `agenticx.cc_bridge.session_manager.subprocess.Popen` / `agenticx.wb_bridge.session_manager.subprocess.Popen` monkeypatch 点 | `tests/test_harness_surface.py:482, 527` | 测试 fake |
| `AGX_CODEX_TRANSPORT` / `preferred_transport()` | `agenticx/harness/adapters/_codex_app_server.py`（`codex.py:333` 消费） | 双路径测试分流 |

### Task 3：账本桥与 studio 接线（`ledger_outlet.py` / `harden_flags.py` / `harness_wiring.py` / `session_manager.py` / ratchet）

#### 代码块 H —— `agenticx/harness/ledger_outlet.py`（Create，完整内容）

```python
"""Replay-ledger bridge for the structured harness event outlet.

Translates outlet events (``turn_started`` / ``turn_finished``) of one
external-harness turn into replay-ledger rows through the regular
``ReplayLedgerRecorder``. The ledger data model is untouched: only the
existing event types are written (run_started / user_message /
assistant_output_completed / error / run_completed).

Contract (best-effort everywhere, the harness turn itself is never
affected):

- a repeated ``turn_started`` while a run is already open is ignored;
- an orphan ``turn_finished`` without an open run is ignored;
- any recorder failure disables the bridge for the rest of the turn.

The replay_ledger imports live inside functions on purpose: the harness
package keeps no module-level dependency on ``agenticx.runtime``.

Author: Damon Li
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from agenticx.harness.types import (
    HARNESS_EVENT_TURN_FINISHED,
    HARNESS_EVENT_TURN_STARTED,
    HarnessEvent,
)

logger = logging.getLogger(__name__)

#: Ledger session namespace of one studio session's harness turns.
HARNESS_LEDGER_NAMESPACE = "harness"

_TURN_STATUS_TO_LEDGER_STATUS = {
    "success": "completed",
    "timeout": "interrupted",
}


def harness_ledger_session_id(owner_session_id: str) -> str:
    """Ledger namespace id that isolates one owner session's harness turns."""
    owner = str(owner_session_id or "").strip()
    return f"{owner}:{HARNESS_LEDGER_NAMESPACE}"


class HarnessLedgerBridge:
    """Consume outlet events of one surface session into one recorder."""

    def __init__(self, recorder: Any) -> None:
        self._recorder = recorder
        self._run_open = False
        self._disabled = False

    def on_event(self, event: HarnessEvent) -> None:
        """Sink callback; every failure is contained here."""
        try:
            self._handle(event)
        except Exception:
            self._disabled = True
            logger.warning("harness ledger bridge failed", exc_info=True)

    def _handle(self, event: HarnessEvent) -> None:
        if self._disabled:
            return
        if event.type == HARNESS_EVENT_TURN_STARTED:
            if self._run_open:
                # A retry or a fallback path re-announced the same turn;
                # the first announcement already opened the run.
                return
            self._recorder.start_turn(
                turn_id=uuid.uuid4().hex,
                user_input=str(event.payload.get("user_text") or ""),
                session=None,
            )
            self._run_open = True
            return
        if event.type == HARNESS_EVENT_TURN_FINISHED:
            if not self._run_open:
                # Orphan finish (e.g. an early error result before the
                # turn was ever established): nothing to close.
                return
            status = str(event.payload.get("status") or "")
            if status == "success":
                self._recorder.observe(_final_event(event), session=None)
            else:
                self._recorder.observe(_error_event(event), session=None)
                self._recorder.finish(
                    _TURN_STATUS_TO_LEDGER_STATUS.get(status, "failed")
                )
            self._run_open = False


def _final_event(event: HarnessEvent) -> Any:
    """RuntimeEvent carrying the final assistant payload (text in blob)."""
    from agenticx.runtime.events import RuntimeEvent

    payload = dict(event.payload or {})
    return RuntimeEvent(
        type="final",
        data={
            "text": str(payload.get("result_text") or ""),
            "terminal_reason": "completed",
            "harness": str(event.harness or ""),
            "detail": dict(payload.get("detail") or {}),
        },
    )


def _error_event(event: HarnessEvent) -> Any:
    """RuntimeEvent carrying the failure summary."""
    from agenticx.runtime.events import RuntimeEvent

    payload = dict(event.payload or {})
    return RuntimeEvent(
        type="error",
        data={
            "text": str(payload.get("result_text") or "")[:500],
            "status": str(payload.get("status") or ""),
            "harness": str(event.harness or ""),
        },
    )


def build_turn_ledger_bridge(
    *,
    sessions_root: Optional[Path],
    session_id: str,
    agent_id: str,
    provider: Optional[str],
    model: Optional[str],
) -> Optional[HarnessLedgerBridge]:
    """Build the bridge for one owner session, or None when unusable.

    ``session_id`` is the ledger namespace id (already validated by the
    caller); ``agent_id`` is the harness id of the running turns.
    """
    if sessions_root is None:
        return None
    try:
        from agenticx.runtime.replay_ledger.contracts import validate_ledger_id
        from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        namespace = validate_ledger_id(session_id, "session_id")
        recorder = ReplayLedgerRecorder(
            store=ReplayLedgerStore(sessions_root),
            session_id=namespace,
            agent_id=str(agent_id or "").strip() or "harness",
            provider=str(provider or "").strip() or None,
            model=str(model or "").strip() or None,
            # External-CLI turn text (user prompt + CLI output) must not
            # reach the enterprise trace outbox (03 D-6b precedent).
            enterprise_trace=False,
        )
        return HarnessLedgerBridge(recorder)
    except Exception:
        logger.warning("harness ledger bridge unavailable", exc_info=True)
        return None
```

#### 代码块 I —— `agenticx/runtime/harden_flags.py`（`:149`（`dispatch_mailbox_enabled` 的 return 行）之后、`:152`（`cancelled_prefix_finalize_enabled`）之前插入）

```python
def harness_ledger_events_enabled() -> bool:
    """``AGX_HARNESS_LEDGER_EVENTS`` / ``runtime.harness_ledger_events``.

    When on, external-harness turns executed through the studio chat
    routing are recorded into the replay ledger under an isolated
    namespace (``<owner_session_id>:harness``) via the adapter event
    outlet. When off, no bridge is attached and no ledger files are
    written; the turn path is byte-for-byte the pre-04 behavior.
    """
    return _resolve_bool("AGX_HARNESS_LEDGER_EVENTS", "runtime.harness_ledger_events", True)
```

#### 代码块 J —— `agenticx/studio/harness_wiring.py`

（j-1）`:50`（`from agenticx.studio.session_manager import require_safe_session_id` 之后）加：

```python
from agenticx.runtime.harden_flags import harness_ledger_events_enabled
```

（j-2）在 `_run_external_harness_turn_body` 内 `:1136`（`surface_sid = lease.surface_session_id`）与 `:1138`（`user_text = str(user_text or "").strip()`）之间插入：

```python
    ledger_bridge = _attach_turn_ledger_bridge(
        adapter,
        surface_sid,
        manager=manager,
        sid=sid,
        harness_id=harness_id,
        session=session,
    )
```

（j-3）在 `_run_external_harness_turn_body` 之前（`:1096` `def _run_external_harness_turn_body` 之前）插入新私有函数：

```python
def _attach_turn_ledger_bridge(
    adapter: Any,
    surface_sid: str,
    *,
    manager: Any,
    sid: str,
    harness_id: str,
    session: Any,
) -> Optional[Any]:
    """Attach the ledger bridge to the adapter outlet; None on any miss."""
    try:
        if not harness_ledger_events_enabled():
            return None
        from agenticx.harness.ledger_outlet import (
            build_turn_ledger_bridge,
            harness_ledger_session_id,
        )

        sessions_root = getattr(manager, "_sessions_root", None)
        bridge = build_turn_ledger_bridge(
            sessions_root=Path(sessions_root) if sessions_root else None,
            session_id=harness_ledger_session_id(sid),
            agent_id=harness_id,
            provider=getattr(session, "provider_name", None),
            model=getattr(session, "model_name", None),
        )
        if bridge is None:
            return None
        if not adapter.attach_event_sink(surface_sid, bridge.on_event):
            return None
        return bridge
    except Exception:
        return None
```

（j-4）把 `:1247-1252`：

```python
    managed.updated_at = time.time()
    try:
        manager._persist_session_state(sid, session)
    except Exception:
        pass
    return result
```

替换为：

```python
    managed.updated_at = time.time()
    try:
        manager._persist_session_state(sid, session)
    except Exception:
        pass
    if ledger_bridge is not None:
        # Normal path detaches here; a turn that raised mid-flight is
        # cleaned up by the next attach of the same surface session
        # (sink registry entries are replaced, never accumulated).
        adapter.attach_event_sink(surface_sid, None)
    return result
```

（provider-mismatch 的重试回合 `:1170-1185`：重试在 `_retry_turn_after_provider_mismatch` 内部的**新** surface sid 上执行，原 F-4 假设「外层 sink 仍在注册表上」不成立——实施后评审修正为把 `ledger_bridge` 传进重试助手，在 lease 之后、`adapter.turn` 之前把 sink 从旧 sid 搬到新 sid（见 (j-5)；被 `test_provider_mismatch_retry_is_recorded_as_a_second_run` 钉死）。）

（j-5）`_retry_turn_after_provider_mismatch` 的签名加仅关键字参数 `ledger_bridge: Any = None`；在 `lease = ensure_harness_session_lease(...)` 之后、`outbound = ...` 之前插入：

```python
    if ledger_bridge is not None:
        # The retry runs on a fresh surface session; move the event sink
        # before the turn so the retried turn reaches the same bridge and
        # opens a second ledger run instead of vanishing.
        try:
            adapter.attach_event_sink(surface_sid, None)
            adapter.attach_event_sink(
                lease.surface_session_id, ledger_bridge.on_event
            )
        except Exception:
            pass
```

调用点（`_run_external_harness_turn_body` 的 mismatch 分支）相应传 `ledger_bridge=ledger_bridge`。

#### 代码块 K —— `agenticx/studio/session_manager.py`（`:1385`（dispatch 清理块的 `except` 收尾）之后、`:1386` `purged = self._purge_session_state(sid)` 之前插入）

```python
        try:
            ReplayLedgerStore(Path(self._sessions_root)).delete_session_runs(
                f"{sid}:{_HARNESS_LEDGER_NAMESPACE}"
            )
        except Exception:
            _log.warning(
                "harness ledger cleanup failed session=%s", sid, exc_info=True
            )
```

其中 `_HARNESS_LEDGER_NAMESPACE` 从 `agenticx.harness.ledger_outlet` 导入（`session_manager.py` 顶部 import 区加 `from agenticx.harness.ledger_outlet import _HARNESS_LEDGER_NAMESPACE` 不可取——模块级 import 引入 studio→harness 的边已有（`harness_wiring` 同层），但 `session_manager.py` 现状不 import `agenticx.harness`（读其 import 区核实：`:1-60` 无 harness import）。为避免给 `session_manager.py` 加模块级 harness import（server.py 的 import 链权重），直接内联字面量 `"harness"` 常量：插入块中用 `f"{sid}:harness"`，并在注释里说明与 `ledger_outlet.HARNESS_LEDGER_NAMESPACE` 对齐：

```python
        try:
            # Namespace id mirrors agenticx/harness/ledger_outlet.py
            # (harness_ledger_session_id: "<owner>:harness").
            ReplayLedgerStore(Path(self._sessions_root)).delete_session_runs(
                f"{sid}:harness"
            )
        except Exception:
            _log.warning(
                "harness ledger cleanup failed session=%s", sid, exc_info=True
            )
```

（与 `delete_dispatch_ledger_runs` 的函数内 import 模式一致，`ReplayLedgerStore` 已在 `:1377` 用过。）

#### 代码块 L —— `scripts/ci/ratchet-baseline.json`（`rules` 数组末尾、第 4 条 `dispatch-mailbox-bypass` 之后追加第 5 条）

```json
    ,
    {
      "id": "harness-outlet-bypass",
      "description": "Replay ledger event rows are constructed only inside agenticx/runtime/replay_ledger/ (the recorder and the store own RunEvent). A RunEvent( literal elsewhere bypasses the recorder / harness event outlet and would append unnormalized rows. Baseline 0: no such literal exists outside the package at review time.",
      "exclude": ["agenticx/runtime/replay_ledger/"],
      "patterns": ["RunEvent("],
      "baseline": 0
    }
```

（注意 JSON 语法：实际写入时把上一条规则结尾的 `}` 后补 `,`，保持整个文档合法 JSON。）

#### 测试：`tests/test_harness_ledger_outlet.py`（Create，完整内容）

```python
#!/usr/bin/env python3
"""Replay-ledger wiring tests for the harness event outlet (04).

Drives ``run_external_harness_turn`` with the studio wiring-test fakes
(RecordingAdapter / FakeManager) against a tmp sessions root, then
asserts the ledger namespace, event sequence, and the isolation of every
existing ledger reader.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.harness.adapter import HarnessAdapter
from agenticx.harness.registry import HarnessRegistry
from agenticx.harness.types import (
    TURN_STATUS_ERROR,
    TURN_STATUS_SUCCESS,
    TURN_STATUS_TIMEOUT,
    HarnessCapabilities,
    TurnRequest,
    TurnResult,
)
from agenticx.harness.handoff import HandoffEngine, HandoffStore
import agenticx.studio.harness_wiring as hw


class LedgerRecordingAdapter(HarnessAdapter):
    """In-memory adapter; turn status is scripted per test."""

    def __init__(self, harness_id: str = "alpha", status: str = "success") -> None:
        self.harness_id = harness_id
        self.display_name = harness_id.title()
        self.description = f"{harness_id} adapter"
        self._status = status
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self.spawn_count = 0

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            permission=False, pty=False, streaming=False, resume=True
        )

    def spawn(self, cwd: str, *, options: Optional[Dict[str, Any]] = None):
        self.spawn_count += 1
        sid = f"{self.harness_id}-surf-{self.spawn_count}"
        self._sessions[sid] = {
            "session_id": sid,
            "cwd": cwd,
            "state": "idle",
            "options": dict(options or {}),
            "native_thread_id": f"{self.harness_id}-native-{self.spawn_count}",
            "raw": {},
        }
        return dict(self._sessions[sid])

    def turn(self, session_id: str, request: TurnRequest) -> TurnResult:
        self._emit_turn_started(session_id, request)
        result = TurnResult(
            harness=self.harness_id,
            session_id=session_id,
            status=self._status,
            result_text=f"{self.harness_id} reply",
            tail="",
            detail={"native_thread_id": "n-1"},
        )
        self._emit_turn_finished(session_id, result)
        return result

    def stop(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None

    def available(self) -> bool:
        return True

    def describe(self, session_id: str):
        return self._sessions.get(session_id)

    def list_sessions(self) -> List[Dict[str, Any]]:
        return list(self._sessions.values())


class FakeManaged:
    def __init__(self, session: StudioSession) -> None:
        self.studio_session = session
        self.execution_state = "idle"
        self.updated_at = 0.0


class FakeManager:
    def __init__(self, session: StudioSession, sessions_root: str) -> None:
        self._session = session
        self._sessions_root = sessions_root

    def get(self, session_id: str, touch: bool = True):
        if str(session_id) == self._session.session_id:
            return FakeManaged(self._session)
        return None

    def get_session_harness(self, session_id: str):
        s = self._session
        return {
            "harness_id": s.harness_id,
            "harness_thread_id": s.harness_thread_id,
            "harness_options": s.harness_options,
            "harness_session_id": s.harness_session_id,
        }

    def set_session_harness(
        self,
        session_id: str,
        *,
        harness_id,
        thread_id=None,
        options=None,
        surface_session_id=None,
    ) -> bool:
        s = self._session
        normalized = harness_id if harness_id not in (None, "", "python-agent") else None
        s.harness_id = normalized
        s.harness_thread_id = (
            str(thread_id).strip() or None
            if (normalized is not None and thread_id is not None)
            else None
        )
        s.harness_options = dict(options) if (normalized and options) else None
        s.harness_session_id = (
            str(surface_session_id).strip() or None
            if (normalized is not None and surface_session_id is not None)
            else None
        )
        return True

    def _persist_session_state(self, session_id: str, session: Any) -> bool:
        return True


def make_session(sid: str = "sess-ledger", cwd: str = "/tmp/led-ws") -> StudioSession:
    s = StudioSession()
    s.session_id = sid
    s.workspace_dir = cwd
    s.chat_history = []
    return s


@pytest.fixture
def ledger_env(tmp_path, monkeypatch):
    alpha = LedgerRecordingAdapter()
    reg = HarnessRegistry()
    reg.register(alpha)
    store = HandoffStore(str(tmp_path / "handoffs"))
    engine = HandoffEngine(reg, store)
    monkeypatch.setattr(hw, "_registry", reg)
    monkeypatch.setattr(hw, "_engine", engine)
    monkeypatch.setattr(hw, "_inflight_turns", {})
    monkeypatch.delenv("AGX_HARNESS_LEDGER_EVENTS", raising=False)
    root = tmp_path / "sessions"
    root.mkdir()
    return {
        "adapter": alpha,
        "root": root,
        "manager": lambda session: FakeManager(session, str(root)),
    }


def _read_events(root: Path, namespace: str):
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(root)
    runs = ledger.list_runs(namespace)
    assert runs, f"no runs under {namespace}"
    events, _more = ledger.read_events(runs[0].run_id)
    return runs[0], list(events)


def test_external_turn_is_recorded_in_the_ledger_namespace(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok and result.result_text == "alpha reply"
    run, events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "completed"
    assert run.agent_id == "alpha"
    assert [e.type for e in events] == [
        "run_started",
        "user_message",
        "assistant_output_completed",
        "run_completed",
    ]
    user_row = next(e for e in events if e.type == "user_message")
    assert user_row.payload["text"] == "first task"


def test_harness_ledger_never_shadows_the_owner_session(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    from agenticx.runtime.replay_ledger.resume_anchor import find_open_run
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    assert ledger.list_runs("sess-ledger") == []
    assert find_open_run(ledger, "sess-ledger") is None


def test_failed_turn_is_recorded_with_error_event(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    env["adapter"]._status = TURN_STATUS_ERROR

    result = hw.run_external_harness_turn(manager, "sess-ledger", "boom")

    assert not result.ok
    run, events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "failed"
    types = [e.type for e in events]
    assert "error" in types
    assert types[-1] == "run_completed"


def test_timeout_turn_maps_to_interrupted(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    env["adapter"]._status = TURN_STATUS_TIMEOUT

    hw.run_external_harness_turn(manager, "sess-ledger", "slow")

    run, _events = _read_events(env["root"], "sess-ledger:harness")
    assert run.status == "interrupted"


def test_switch_off_keeps_the_ledger_empty(ledger_env, monkeypatch):
    env = ledger_env
    monkeypatch.setenv("AGX_HARNESS_LEDGER_EVENTS", "0")
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok
    assert not (env["root"] / "sess-ledger:harness").exists()
    roles = [m["role"] for m in session.chat_history]
    assert roles == ["user", "assistant"]


def test_bridge_failure_does_not_break_the_turn(ledger_env, monkeypatch):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")
    monkeypatch.setattr(
        "agenticx.harness.ledger_outlet.build_turn_ledger_bridge",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("no ledger")),
    )

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok and result.result_text == "alpha reply"


def test_provider_mismatch_retry_is_recorded_as_a_second_run(
    ledger_env, monkeypatch
):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    calls = {"n": 0}

    def _mismatch_only_once(result):
        calls["n"] += 1
        return calls["n"] == 1

    monkeypatch.setattr(hw, "is_codex_model_provider_mismatch", _mismatch_only_once)

    result = hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    assert result.ok
    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    runs = ledger.list_runs("sess-ledger:harness")
    # The retry runs on a fresh surface session; the sink must move with it
    # so both the failed attempt and the retried turn reach the bridge.
    assert len(runs) == 2
    assert [r.status for r in runs] == ["completed", "completed"]


def test_output_blob_carries_the_result_text(ledger_env):
    env = ledger_env
    session = make_session()
    manager = env["manager"](session)
    manager.set_session_harness("sess-ledger", harness_id="alpha")

    hw.run_external_harness_turn(manager, "sess-ledger", "first task")

    from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

    ledger = ReplayLedgerStore(env["root"])
    run = ledger.list_runs("sess-ledger:harness")[0]
    events, _more = ledger.read_events(run.run_id)
    final = [e for e in events if e.type == "assistant_output_completed"][0]
    # FINAL rows are not truncated summaries (resolve_payload would return
    # the row payload); the full text lives in the content-addressed blob.
    payload = ledger.read_blob(final.run_id, final.payload_ref)
    assert payload["text"] == "alpha reply"
    assert payload["harness"] == "alpha"
```

（`test_bridge_failure_does_not_break_the_turn` 的 monkeypatch 目标是 `ledger_outlet` 模块属性；`_attach_turn_ledger_bridge` 通过 `from ... import build_turn_ledger_bridge` 函数体内导入，monkeypatch 模块属性即可命中。）

#### Task 3 验证

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_ledger_outlet.py -q --no-cov
# 预期：新增用例全部通过
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py
# 预期：5 条规则全部通过（第 5 条 harness-outlet-bypass: 0 line(s), baseline 0）
```

依赖的现有 API（Task 3）：

| API | 出处 | 用法 |
| --- | --- | --- |
| `ReplayLedgerRecorder(store=, session_id=, agent_id=, provider=, model=, enterprise_trace=)` / `start_turn` / `observe` / `finish` | `agenticx/runtime/replay_ledger/recorder.py:58-69, 91-204, 421-576, 581-600` | bridge 写入 |
| `RuntimeEvent(type=, data=)`（`"final"` / `"error"`） | `agenticx/runtime/events.py:58-65`、`EventType`（`:29-55`） | FINAL/ERROR 构造 |
| `ReplayLedgerStore(sessions_root)` / `list_runs` / `read_events` / `resolve_payload` | `agenticx/runtime/replay_ledger/store.py:42, 375-388, 390+, 517+` | 测试断言 |
| `find_open_run(ledger, session_id)` | `agenticx/runtime/replay_ledger/resume_anchor.py:41-52` | 不遮蔽断言 |
| `validate_ledger_id` | `agenticx/runtime/replay_ledger/contracts.py:54-64` | 命名空间预校验 |
| `harden_flags._resolve_bool` | `agenticx/runtime/harden_flags.py:57-64` | 新开关 |
| `_run_external_harness_turn_body` 的接缝（`adapter` / `lease` / `surface_sid` / `session` / `manager`） | `agenticx/studio/harness_wiring.py:1096-1252` | attach/detach |
| `SessionManager.delete` 的清理块 | `agenticx/studio/session_manager.py:1364-1389` | 第三块插入 |
| ratchet 规则 schema（`id/description/exclude/patterns/baseline`） | `scripts/ci/ratchet.py:33, 48-72`；`scripts/ci/ratchet-baseline.json` | 第 5 条规则 |

## 实施后评审处置（2026-11-28）

实施由 sub agent 一次完成三个任务（TDD，与 plan 零偏差）；主会话独立复跑全部验证并另派独立评审员。逐条处置：

| # | 来源 | 问题 | 处置 |
| --- | --- | --- | --- |
| 1 | 实施红灯 | plan 测试代码三处夹具缺陷：`LedgerRecordingAdapter.turn` 未走出口（fake 不 emit，桥零输入）；`_read_events` 把 `read_events` 的 `(list, bool)` 元组当列表迭代；`resolve_payload` 对 FINAL 行不解析 blob（FINAL 行不是 `truncated+digest` 摘要，须直接 `read_blob`）——第三处即假设清单 #1 的读取方向判断错误 | **修夹具、不动断言**：fake 补 `_emit_turn_started/_emit_turn_finished`；改元组解包；blob 断言改 `read_blob(final.run_id, final.payload_ref)`。代码与 plan 同步修订 |
| 2 | 独立评审（中） | provider-mismatch 重试在 `_retry_turn_after_provider_mismatch` 内部的**新** surface sid 上执行，外层 sink 挂在旧 sid：重试回合不进账本、旧注册项泄漏；F-4 的「外层 sink 仍在」假设错误 | **采纳并修**：重试助手加仅关键字参数 `ledger_bridge`，在 lease 后、`adapter.turn` 前把 sink 从旧 sid 搬到新 sid（(j-5)）；第一次尝试放在返回后搬移被探针复现推翻——turn 在助手内部已执行。新增 `test_provider_mismatch_retry_is_recorded_as_a_second_run` 钉死（重试两 run 均 completed） |
| 3 | 独立评审（低） | exec 引擎的 `turn_started` 在 `Popen` 之前发，`FileNotFoundError` 路径留下孤立 started（与 D-3 表「该分支无回合」矛盾） | **采纳**：emit 移到 `session.proc = proc` 之后（代码块 D 同步修订） |
| 4 | 独立评审（低） | 惰性 sink 注册表 check-then-set 有极窄并发窗口（共享单例 adapter 双方首次同时 attach） | **采纳**：`self.__dict__.setdefault(...)`（代码块 B 同步修订） |
| 5 | 独立评审（琐碎） | `ledger_outlet.py` 未用 import（`time` / `Dict`）；`session_manager.delete` 第三块清理无独立测试 | import 清理采纳；清理块与 03 dispatch 清理同模式、次序正确，由冷启动冒烟与 03 的既有模式覆盖，不再单测（记录） |
| 6 | 独立评审 | 其余核实项（无 sink 时四路径逐字等价、异常路径无双 started/孤立 finished、emit+bridge 双层吞异常、状态映射合法、命名空间隔离、一致性检查器对 codebuddy permission 显式拒绝不误报、测试密闭、ratchet 第 5 条基线不虚设） | 全部确认无问题 |

评审结论：可合入。既有环境失败（`test_meta_tools_list_skills_and_mcps`、`test_studio_server.py` 4 例，实施者在干净 HEAD 副本复跑同样失败）与本改动无关。

## 交付约定

- 实施者只改本 plan「Precise landing points」列出的文件，不提交、不推送、不改测试断言。实现与 plan 一致但测试仍失败时停下报告。
- 主会话独立复跑 `## Verification` 的全部命令，审 diff，用脚本把新文件与被替换的代码块同 plan 逐字比对。
- 验收后：plan 从 `.cursor/plans/pending/` 移到 `.cursor/plans/`，`Status` 改为 `implemented`；只 `git add` plan 内列出的文件；提交一个 commit。
- 规划阶段已执行头部清单中的只读探针；`## Verification` 的其余命令待实施时逐条执行并记录输出。

## Suggested impl models

- 实施：GLM-5.4（与 01/02/03 一致）。
- 不建议拆并行子 agent：Task 2 的三个 adapter 文件与 Task 3 的 harness_wiring 存在共享上下文（emit helper 的行为契约），串行最稳。

## Verification

判据对应表：

| 判据 | 自动化验证（测试文件::用例名） | 断言落点 |
| --- | --- | --- |
| AC-1 回合结束账本有结构化事件 | `tests/test_harness_ledger_outlet.py::test_external_turn_is_recorded_in_the_ledger_namespace`；`tests/test_harness_event_outlet.py::test_exec_cli_turn_emits_started_and_finished`、`::test_codex_exec_transport_emits_events`、`::test_codex_app_server_turn_emits_events`、`::test_claude_code_headless_turn_emits_events`、`::test_codebuddy_turn_emits_events` | 事件 type 序列 `[run_started, user_message, assistant_output_completed, run_completed]`；`run.agent_id == <harness_id>`；出口事件 `[turn_started, turn_finished]`（四路径全覆盖） |
| AC-2 不遮蔽既有消费方 | `tests/test_harness_ledger_outlet.py::test_harness_ledger_never_shadows_the_owner_session`；`::test_switch_off_keeps_the_ledger_empty` | `list_runs(owner) == []`；`find_open_run(...) is None`；开关关时无命名空间目录 |
| AC-3 声明与实测不一致测试失败 | `tests/test_harness_capability_consistency.py::test_builtin_adapters_have_no_capability_mismatch`；`::test_mismatched_adapter_is_reported`；`::test_spawned_session_probe_matches_declared_capabilities` | 内置 4 adapter `mismatches == []`；假 adapter 4 条 mismatch；spawn 后 `CapabilityNotSupported` / `ValueError` 行为实测 |
| AC-4 旧行为不回归 | `tests/test_harness_ledger_outlet.py::test_switch_off_keeps_the_ledger_empty`；`::test_bridge_failure_does_not_break_the_turn`；下方全部既有回归命令 | 开关关：`roles == ["user", "assistant"]`、无账本文件；bridge 失败回合照常 `ok`；56 个 harness 基线用例 + 01/03 账本用例全部保持通过 |
| 失败/超时口径 | `tests/test_harness_ledger_outlet.py::test_failed_turn_is_recorded_with_error_event`；`::test_timeout_turn_maps_to_interrupted`；`::test_output_blob_carries_the_result_text` | `error` 事件 + `status == "failed"`；`interrupted`；blob 全文 `text == result_text` |

命令：

```bash
# 新增测试（三个文件）
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_event_outlet.py tests/test_harness_capability_consistency.py tests/test_harness_ledger_outlet.py -q --no-cov

# master plan 基线第 4 条（规划阶段已执行：56 passed）
/opt/miniconda3/bin/python3 -m pytest tests/test_harness_exec_adapters.py tests/test_harness_surface.py -q --no-cov

# harness 面其余既有测试
/opt/miniconda3/bin/python3 -m pytest tests/test_codex_app_server.py tests/test_studio_harness_wiring.py tests/test_harness_handoff.py tests/test_session_harness_binding.py tests/test_smoke_openharness_features.py tests/test_codebuddy_oauth_harness_refresh.py tests/test_harness_turn_error_surface.py tests/test_near_cross_harness_swarm_ui.py -q --no-cov

# 01/03 的账本测试（账本数据模型与 recorder 行为不许回归）
/opt/miniconda3/bin/python3 -m pytest tests/test_replay_ledger_recorder.py tests/test_replay_ledger_store.py tests/test_replay_ledger_upcast.py tests/test_subagent_dispatch_mailbox.py tests/test_dispatch_wake_ledger.py -q --no-cov

# 门禁（02）
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py   # 现基线 243 passed
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py

# 冷启动冒烟（harness_wiring.py / session_manager.py 都在 server.py 的 import 链上）
.venv/bin/agx serve --host 127.0.0.1 --port 8769
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8769/api/health   # 期望 200
```

**ratchet 自查**：新代码（含测试）不含 `RunEvent(` 字面量（bridge 经 recorder 写行）；不含 `run_dir / "events.jsonl"`、`runs/*/events.jsonl`、`save_agent_state(`、`project_resume_anchor(`、`.mailbox.json`、`.context.json`；现有 4 条规则基线一条不调大。

## 风险与回滚

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 回合事件丢失（best-effort 契约） | 出口与 bridge 全程吞异常：磁盘满、recorder 构造失败等情况下回合照常、账本缺行 | 契约写死「账本绝不影响回合」（AC-4）；丢失可接受（闭环判据只要正常路径有事件）；`ledger_append_failed` 的既有 gap 机制在 recorder 内部生效 |
| 孤立/重复事件 | 回退路径与重试路径的 started/finished 边界 | bridge 的 `_run_open` 状态机双防御（重复 started 忽略、孤立 finished 忽略）+ `test_codebuddy_dedup...` 与 emit 用例固化 |
| 命名空间目录 | `<sessions_root>/<owner>:harness/` 是会话目录的兄弟目录 | 与 03 的 dispatch 命名空间同一机制（03 已核实 `list_runs` / `find_open_run` / `/api/runs` 扫不到）；会话删除时第三块清理（代码块 K）；其它枚举代码 03 已核实零命中 |
| 企业 Trace | 外部 CLI 的用户 prompt 与 CLI 输出属用户内容 | `enterprise_trace=False`（03 D-6b 同款决定，需主会话确认） |
| emit 性能 | 每回合两次 dict 构造 + sink 调用 | 无 sink 时 emit 是一次 dict get；有 sink 时微秒级；`_emit_turn_finished` 的 detail 白名单 9 键 |
| 开关默认开 | 所有外部 harness 回合默认多写一个账本 run | `AGX_HARNESS_LEDGER_EVENTS=0` 立即回滚；已写入的命名空间目录无害、随会话删除 |
| `session_manager.py` 触碰 | 边界说「尽量不改」 | 只加 8 行清理块（03 已在同一函数开了先例：`:1380-1385`）；不改任何现有语句 |

**回滚**：运行时回滚 = 设 `AGX_HARNESS_LEDGER_EVENTS=0`（不 attach、不写账本、回合路径回到 04 前逐字行为；已写入的 `<owner>:harness/` 目录留在盘上无害，随会话删除——旧代码不会删它，需手工清理或忽略）。代码回滚 = revert 这一个 commit；`harness-outlet-bypass` 规则随 ratchet-baseline.json 一并回滚。

## 已定案事项

### 规划时在授权范围内定的（主会话审查时可否决）

- **A-1** 出口形状：`HarnessAdapter` 实例上的 `attach_event_sink` / `emit_harness_event`（基类默认实现 + 惰性 sink 注册表），事件词汇表 `HARNESS_EVENT_TYPES = {turn_started, turn_finished}`；不改 `turn()` 签名、不改 `TurnRequest` / `TurnResult`。
- **A-2** emit 调用点：四路径各自定位（D-3 表）；idempotency dedup 分支与 cross-harness 拦截分支不 emit。
- **A-3** 账本命名空间 `<owner_session_id>:harness`，run 的 `agent_id` = harness_id；只记回合级事件（`run_started` / `user_message` / `assistant_output_completed` / `error` / `run_completed`）；工具级 `tool_call` / `tool_result` 刻意不记（假 pending 理由，核实结论 2）。
- **A-4** 状态映射：`success→completed`、`timeout→interrupted`、其余→`failed`。
- **A-5** bridge = `agenticx/harness/ledger_outlet.py`（replay_ledger import 全在函数体内）；接线在 `_run_external_harness_turn_body`；`getattr(manager, "_sessions_root", None)` 容错。
- **A-6** 开关 `AGX_HARNESS_LEDGER_EVENTS` / `runtime.harness_ledger_events`，默认 `True`。
- **A-7** 一致性检查器 `registry.capability_mismatches`：只判 True 侧（声明了却不实现）；`streaming` 接受 `drain_midturn_stream_items` 实现路径；`idempotency` / `turn_snapshots` / `handoff_injection` 不判定（无方法可反射，行为由既有测试钉住）。
- **A-8** 新 ratchet 规则 `harness-outlet-bypass`（pattern `RunEvent(`、exclude replay_ledger、基线 0）。
- **A-9** 新增 3 个测试文件；不改任何既有测试文件。
- **A-10** `session_manager.delete` 补第三块清理（`<sid>:harness`），`http_app.py` / `server.py` 不改。
- **A-11** `enterprise_trace=False`（推荐口径，见下组）。

### 主会话定案（2026-11-28 审查时拍板）

- **D-a 企业 Trace：`False`（按代码块 H 现状）。** 外部 CLI 回合的用户 prompt 与 CLI 输出属用户内容，与 03 D-6b「邮件正文不进企业 outbox」同一口径。
- **D-b 开关默认值：`True`。** 与 01/02/03 一致——闭环判据就是要内化的不变量；`AGX_HARNESS_LEDGER_EVENTS=0` 可立即回滚。
- **D-c Codex streaming 脱节：维持本 plan 的判据**（`iter_stream_chunks` 覆写 **或** `drain_midturn_stream_items` 可调用均算 streaming 实现）。codex 的 app-server 确实在流式输出，这是「声明与实现一致」的合理判定；不改声明、不补覆写，另开 commit 的选项不做。
- **D-d 命名空间不按 harness 细分**：`<owner>:harness` 一个桶，保跨 harness 的回合时序，清理成本最低。
- **D-e handoff 注入回合与 harness-surface HTTP app 回合：不记账本**，维持 Out of scope。

## 未经执行验证的假设清单

以下各点规划阶段无法静态核实，实施者在写实现前先跑对应探针或静态复核：

1. **`RuntimeEvent(type="final", data=...)` 的 `terminal_reason` / 自定义键会整份进 blob 且行内只留 `text_preview` / `terminal_reason`。** 依据是 `recorder.py:536-548` 的 FINAL 分支（`payload_ref = write_blob(run_id, data)`），已读到；但「data 里自定义键（`harness` / `detail`）也被原样写入 blob」未跑过真 recorder 确认（`write_blob` 对 dict 直接 canonical JSON）。若 blob 缺自定义键，只影响 `test_output_blob_carries_the_result_text` 的两条断言。
2. **`recorder.observe(event, session=None)` 对 `session` 为 None 的路径全部安全（无 `session.agent_messages` 访问）。** `_EVENT_MAP` 分支里 `_append(..., session=session)` 传 None → `:317` `if session is not None` 跳过 ✓ 已读；FINAL 分支同理。仅 `finish` 里 `session=self._last_session`（None，同一跳过）✓ 已读。无残余风险，但未跑过真实例。
3. **`FakeManager` 加 `_sessions_root` 后 `_run_external_harness_turn_body` 全程不再触碰其它 manager 方法。** 已对照 `:1096-1252` 逐行（`get` / `get_session_harness` / `set_session_harness` / `_persist_session_state` 四个 + `managed.updated_at`）；`managed.execution_state` 未被该函数读。若实施时出现 AttributeError，按最小补桩处理并报告。
4. **monkeypatch `agenticx.harness.ledger_outlet.build_turn_ledger_bridge` 能命中函数体内的 `from ... import build_turn_ledger_bridge`。** 函数体 import 每次调用重新解析模块属性，monkeypatch.setattr 模块属性有效（`_attach_turn_ledger_bridge` 每次调用都重新 import）。CPython import 系统有模块缓存，`from X import Y` 走 `getattr(module, Y)`——monkeypatch 替换模块属性后生效 ✓；未实测。
5. **`LedgerRecordingAdapter.spawn` 的 view 缺 `describe` 需要的字段时 `ensure_harness_session_lease` 不炸。** `:709-750` 的复用分支读 `view.get("raw")` / `view.get("options")`（dict 兜底）✓；`snapshot_from_session(manager, sid).cwd` 在冷启动分支读 `StudioSession.workspace_dir`（`make_session` 已设）✓。`harness_display_name` 等装饰性调用有 try/except。
6. **`tests/test_harness_ledger_outlet.py` 的用例不会把 `Path.home()` 下的真实目录卷进来。** sessions root 全部来自 `tmp_path`；`ReplayLedgerStore(root)` 显式传参（`store.py:42` 的无参构造才走 `agx_home()`）✓ 已读。`monkeypatch.setenv("HOME")` 不需要。
7. **`StudioSession()` 无参构造可行且 `session_id` / `workspace_dir` / `chat_history` 可直接赋值。** 依据：`tests/test_studio_harness_wiring.py:183-188` 的 `make_session` 同款写法。
8. **app-server fake 的 `turn/completed` 后 `CodexAdapter._finish_app_server_turn` 产出 `status == "success"` 且 detail 带 `transport == "app-server"`。** 依据 `codex.py:499-556`（无 error_text → success；`:522` `detail["transport"] = "app-server"`）；`tests/test_codex_app_server.py:419` 的既有用例断言过增量流，结果状态未直接断言。若 detail 形状有偏，只影响 `test_codex_app_server_turn_emits_events` 的最后一条断言。
9. **冷启动冒烟不受 `harness_wiring` 新增的 `harden_flags` import 影响。** `harness_wiring.py` 顶部 import `agenticx.runtime.harden_flags`——`harden_flags` 已在 server import 链上（03 已验证同类路径），无新依赖边；需冒烟确认。

## Commit trailers

提议的提交标题（英文，`type(scope): subject`）：

```
feat(harness): add a structured turn event outlet and record external turns in the ledger
```

正文结构：`## What & Why`（出口是向后兼容的可选 API：`attach_event_sink` / `emit_harness_event`，事件经 bridge 复用 `ReplayLedgerRecorder` 写入 `<owner>:harness` 命名空间；能力一致性检查器把声明档与实现钉死；为什么工具级事件不落盘——假 pending 风险）+ `## Requirements`（FR-1 事件出口原语与四路径 emit；FR-2 回合记账本（命名空间、状态映射、企业 trace 关闭）；FR-3 能力一致性检查器与失败路径；FR-4 开关与零回归；AC-1 … AC-4 同 `## Goal`）。

trailers：

```
Plan-Id: 2026-11-27-runtime-invariants-04-harness-event-outlet
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-04-harness-event-outlet.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```


