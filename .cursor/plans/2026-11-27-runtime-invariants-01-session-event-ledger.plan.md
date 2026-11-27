# AgenticX 运行时不变量内化 01：账本收敛

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-01-session-event-ledger
Parent-Plan: `.cursor/plans/pending/2026-11-27-runtime-invariants-master.plan.md`

## Goal

让 Replay Ledger（`agenticx/runtime/replay_ledger/`）成为一次会话结构事件的唯一持久源，闭环 master plan 分配给 01 的六条判据：

- AC-1 单机重启后，回合从账本恢复：恢复锚点由账本事件投影得到，不再依赖第二份独立维护的状态。
- AC-2 未完成的工具调用不重放：已发出但没有结果的调用，在恢复后的上下文里被标注为「结果未知」，运行时不重新执行它。
- AC-3 确认门状态不倒退：崩溃前发出、用户尚未应答的确认请求，恢复后仍留在确认门里、仍可应答。
- AC-4 HA 副本接管恢复与改动前一致：HA 模式继续以经存储后端保存的 `CheckpointStore` 锚点为恢复依据，不读本地账本。
- AC-5 会话进行中杀掉后端进程并重启，客户端甲带旧的 `Last-Event-ID` 用同一会话重连，拿到被截断回合的完整结构事件。
- AC-6 客户端乙不带游标并发接入同一会话，读到与甲同源（同一账本 run）的同一份历史。

同时交付三项支撑能力：账本行读时 upcast；大载荷行内只留 head / 长度 / 摘要，全文走 blob 按需取；live seq、ledger seq、总线游标三套编号的桥接规则（写明，并在读路径上实现最小桥接）。

参考依据见 master plan『背景与参考来源』。

## 核实结论

### 1. 恢复锚点能否完全从账本投影

**结论：可以。`round_idx`、`pending_tool_calls`、`confirm_state` 三个字段都能从账本事件投影，且比现有检查点更精确。**

证据与逐字段推导：

- `round_idx`。账本记 `round_started`（`recorder.py:38`），`payload` 就是 `ROUND_START` 的 `data`（含 `round`），`round_idx` 取自 `run_turn` 传入的当前轮次（`agent_runtime.py:4187`）。检查点在三处写出：回合入口 `round_idx = start_round - 1`（`agent_runtime.py:4146`）、每轮顶部 `round_idx - 1`（`agent_runtime.py:4851`）、工具执行前 `round_idx - 1` 加 `pending_tool_calls`（`agent_runtime.py:6583`）；恢复时 `start_round = checkpoint.round_idx + 1`。现有测试 `test_checkpoint_written_per_round_and_cleared_on_final` 固化了三轮回合的写入序列 `[0, 0, 0, 1, 1, 2]`。由此得到投影规则：设 R 为该 run 最后一条 `round_started` 的轮次，则 `round_idx = R - 1`（没有 `round_started` 时为 0）。
- `pending_tool_calls`。账本记 `tool_call`（`payload` 含 `name` 与 `source_tool_call_id`，全量参数在 blob，`recorder.py:427-435`）与 `tool_result`（`recorder.py:454` 用 `tool_call_id` 关联到最近一条 `tool_call` 的 `event_id`）。检查点的 `pending_tool_calls` 是「该批次从助手消息解析出的全部调用」（`agent_runtime.py:6583`），用途只有一个：给仍然悬空的调用挑选 closer 文案（`session_manager.py:1233-1234`）。投影取「最后一条 `round_started` 之后、之后没有 `tool_result` 的 `tool_call`」，即「已发出但未拿到结果」的调用，比检查点更准（尚未发出的调用不会被标成「结果未知」）。
- `confirm_state`。`confirm_required` 的载荷是 `{"id": request_id, "question", "context"}`（`agenticx/cli/agent_tools.py:4517-4526`），`export_state()` 的形状是 `{"pending": [{"request_id", "question", "context"}], "last_request": {...}}`（`agenticx/runtime/confirm.py`）。投影：`pending` 等于其后没有同 `id` 的 `confirm_response` 的 `confirm_required`；`last_request` 等于最后一条 `confirm_required`。
- `status`：`"awaiting_confirm"` 当且仅当投影出的 pending 非空，否则 `"in_progress"`（与 `_write_run_checkpoint` 的取值一致，`agent_runtime.py:3846`）。

边界情况（均已对照代码）：

| 边界 | 账本里的样子 | 投影结果 |
| --- | --- | --- |
| 工具调用已记、结果未落时崩溃 | `round_started(N)`、`tool_call(c)`，没有 `tool_result(c)` | `round_idx = N-1`，`pending = [c]` |
| 确认门已发出、用户未应答时崩溃 | `confirm_required(req)`，没有 `confirm_response(req)` | `status = awaiting_confirm`，`confirm_state.pending = [req]` |
| 同一 `tool_call_id` 重试 | 同 id 的两条 `tool_call`，结果只跟在最新一条之后 | 按 seq 比较：最新一条之后没有结果才算 pending |
| 子智能体事件 | 不在账本里：`_EVENT_MAP`（`recorder.py:37-49`）没有 `subagent_*`，`observe` 只认 TOKEN / TOOL_CALL / TOOL_RESULT / FINAL 与映射表里的类型；现有测试 `test_subagent_runtime_events_do_not_consume_parent_ledger_sequence` 固化 | 对投影无影响；投影也只读 `round_started` / `tool_call` / `tool_result` / `confirm_*` 四类 |
| 澄清 | `clarification_required` / `clarification_response` / `clarification_suspended` 入账（`recorder.py:42-44`） | 投影不读这三类；提出澄清的那个工具调用若没有结果，仍按普通悬空调用处理（与现有检查点路径相同） |

对设计的影响：恢复锚点做成账本的读时投影，返回现有的 `AgentCheckpoint`（`checkpoint.py:45-56`），直接喂给现有的 `_resume_single_session` 流程，不改恢复流程本身。

### 2. HA 模式下跨副本续读以谁为准

**结论：跨副本续读只有协调总线一个来源，账本只在 hosting 副本的本地盘上；现状是进程重启后带整数游标的客户端，在单机模式下什么也拿不到。**

证据：

- SSE 的 `id:` 就是中枢的 live seq（`session_event_hub.py:54` 的 `_seq`，`publish` 与 `publish_done` 各自 `+1`，`session_event_hub.py:87`、`:102`），`replay_since`（`session_event_hub.py:184`）按它重放内存里最多 400 条的缓冲（`DEFAULT_BUFFER_MAXLEN = 400`，`session_event_hub.py:21`）。live seq 只活在内存里，不落盘。
- 总线游标是 Redis 的 `INCR ev:sess:{sid}:seq`（`redis_bus.py:315-322`），日志是每会话封顶的列表（`redis_bus.py:11-12`），`event_read` 用 `lrange` 整表读出后按游标过滤（`redis_bus.py:333-349`）。中枢只把非 token 事件和首/尾 token 写总线，其余 token 聚合后刷（`session_event_hub.py:111-147`）。所以总线游标与 live seq 都是整数，但不是同一个编号。
- 重连端点（`server.py:5566-5620`）：`live_reattach_enabled()` 关闭时直接回 `disabled`（`server.py:5580-5586`）；中枢活跃就走内存重放（`server.py:5622` 起）；中枢不活跃时把 `since` / `Last-Event-ID` 当作总线游标读（`server.py:5599-5607`），有行就回 `replayed_from_store`，没行就回 `done/not_running`（`server.py:5616-5620`）。
- 进程重启后：中枢没了，单机模式的进程内总线日志也是空的，客户端带着 `Last-Event-ID: 57` 重连，得到的就是 `{"type":"done","data":{"reason":"not_running"}}`。被截断回合的结构事件都在本地账本里，但没有任何读路径去读它。

对设计的影响：在「中枢不活跃」分支里、总线读不到行之后，增加一级账本回落；用命名空间化的游标 `ledger:<run_id>:<seq>` 区分编号空间；整数游标解析不了时先回一条 `replay_gap`。

### 3. 大载荷是否已自动转存 blob 并在事件行内留摘要

**结论：部分已经做到，但没有统一的上限，也没有截断策略。**

证据：

- `tool_call` / `tool_result` / `assistant_output_completed` / `artifact` 已经全量进 blob，行内是 500 字符预览：`_preview` 上限 500（`recorder.py:397-403`），`tool_result` 另有 `length` 与 `preview_sha256`（对预览而非全文取摘要）。`write_blob`（`store.py:446-467`）按 canonical JSON 的 sha256 内容寻址，`payload_ref` 就是这个摘要（`contracts.py:243`）。
- 映射事件（`round_started`、`confirm_*`、`clarification_*`、`compaction`、`context_stats`、`stall`、`error`、`tool_progress`）的 `payload` 是整份 `data`，整份写进行内，没有任何上限。`user_message`（`recorder.py:189-192`）、`run_started` / `run_resumed`（`recorder.py:181`、`:186`）同样整份入行。
- 消费方：导出（`export.py:62-72` 的 `_resolved_event` 把 `payload_ref` 解析成 `resolved_payload`，`_summary` 优先读它，`export.py:94-95`）与分支服务（`branch_service.py:160-209` 只读 `checkpoint_ref` / `workspace_ref`）不受行内截断影响。

对设计的影响：在 `_append` 里对 `payload_ref is None` 的事件统一加一道尺寸闸：超过阈值就把整份载荷写 blob、行内换成固定形状的摘要；读侧提供 `store.resolve_payload(event)` 按需取全文。已带 `payload_ref` 的事件（预览已被 500 字符封顶）不重复处理。

### 4. 旧账本行缺版本号时的 upcast 路径

**结论：没有任何版本演进代码；缺版本号的行目前被静默当成「当前版本」读，`SCHEMA_VERSION` 一旦升到 2 就会把 v0 行误读成 v2。**

证据：

- `SCHEMA_VERSION = 1`（`contracts.py:13`）。`RunEvent.from_dict` 对缺省的处理是 `int(data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION)`（`contracts.py:264-266`），即缺失、空串、0 都读成 1；版本不等则 `branchable=False`、`unbranchable_reason="unsupported_schema_version"`（`contracts.py:269-271`）。
- git 历史：`contracts.py` 的首个提交 `9609edc2` 就已经带 `schema_version: int = SCHEMA_VERSION`，之后 `41703887` 只给 `ReplayRunRecord` 加了字段、未改 `RunEvent`。所以已发布版本写出的行都带版本号；缺版本号的行只可能来自首个提交之前的开发构建、手工编辑或外部写入。
- 仓库内 `agenticx/` 下没有任何 `upcast` 字样；`schema_version` 只在 `contracts.py` 内被引用。

对设计的影响：补一条显式的 v0→v1 upcast 链，并把「缺失 = v0」写进读路径；`SCHEMA_VERSION` 保持 1 不升。

### 5. `context_checkpoint.py` 与 `AgentCheckpoint` 的关系

**结论：两者无关。账本里确实已有一份「上下文检查点」，但它是给分支重放用的，不是崩溃恢复锚点。**

证据：`ContextCheckpoint`（`contracts.py:178`）由 recorder 在写入时按「分支稳定性」判定后落到 run 目录（调用点 `recorder.py:317`，写入 `recorder.py:357-364`），记录的是上下文消息摘要与工作区引用，供从稳定步骤分叉时重建上下文；它没有 `round_idx`、`pending_tool_calls`、`confirm_state`，也不表达「续跑哪个 turn / run」。`AgentCheckpoint`（`checkpoint.py:45-56`）是存储后端里每会话一份的崩溃恢复标记，由 `_write_run_checkpoint` 每轮写出（`agent_runtime.py:3824-3865`）。两者各写各的，这正是「双轨」的实体。

对设计的影响：双轨收敛的做法是让单机恢复用的 `AgentCheckpoint` 变成账本 run 事件的投影，而不是把 `ContextCheckpoint` 与 `AgentCheckpoint` 合并（后者是 09-10 系列的数据模型，本 plan 不动）。

### 6. 核实中发现的、与 master plan 假设不同或需要主会话知晓的事实

- **单机模式下崩溃恢复默认是关闭的。** `resume_interrupted_enabled()` 只在 HA 模式默认 True，否则默认 False（`checkpoint.py:124-148`）。所以 AC-1 需要显式开启 `AGX_RESUME_INTERRUPTED=1` 或 `runtime.resume_interrupted: true`。本 plan 只改「锚点从哪来」，不改这个默认值（见已定案事项 2）。
- **HA 模式的判定只看环境变量。** `resume_interrupted_enabled` 用 `AGX_HA_MODE=redis` 或 `AGX_STORAGE_BACKEND=redis` 判定（`checkpoint.py:144-148`）。本 plan 的恢复分层沿用同一条规则。
- **账本根目录不随 `AGX_HOME` 变化。** `SessionManager._sessions_root` 写死为 `~/.agenticx/sessions`（`session_manager.py:674`），`recorder_for_session` 用它建 store（`recorder.py:601`）；而 `ReplayLedgerStore()` 无参构造走 `agx_home()/sessions`（`store.py:42`）。本 plan 的所有账本读取都显式传入 `manager._sessions_root`，不受此差异影响；差异本身不在本 plan 修。
- **`recorder.finish` 失败会让 run 永远停在 `running`。** `_append("run_completed")` 抛错时 `close_run` 不会被调用（`recorder.py:565-585`）。续读回落因此不能只看 `status == "running"`，还要看会话的 `execution_state` 是否仍为 `running` / `interrupted`。
- **包装门下检查点的 `confirm_state` 恒为空。** `RiskAwareAutoConfirmGate` 没有 `export_state` 覆写，`_write_run_checkpoint` 把空导出落成 `confirm_state=None`（`agent_runtime.py:3838-3843`）。账本里有 `confirm_required` 行，检查点里却是空的。
- **冷重启恢复时「结果未知」closer 从不生效（实施 Task 4 时实测发现的既有缺陷）。** `_resume_single_session` 开头的 `self.get(session_id, touch=False)` 走冷加载，`_restore_persisted_state` 读入 `agent_messages.json` 后立刻 `_sanitize_context_messages`（`session_manager.py:2611-2623`），未应答的工具调用所在行被整行丢弃（`agent_runtime.py:1959-1965`）。随后 closer 块拿 `session.agent_messages` 去合成（`session_manager.py:1232-1239`），此时已没有悬空调用，一条 closer 都合不出来。`resume_interrupted_sessions` 只在服务启动时调用（`server.py:1945`），所以崩溃恢复的主路径上 closer 机制一直是死的；`RESUME_SYSTEM_HINT`（`checkpoint.py:39-44`）却告诉模型「被中断轮次的工具调用已在上下文中标注」。现有测试没发现，是因为 `test_resume_from_checkpoint` 只断言「没有悬空 id 残留」，纯函数测试只测 `close_interrupted_tool_calls` 本身。这与锚点从哪来无关，但不修它 AC-2 无法闭环，处置见 Task 4 步骤 (c) 与已定案事项 4。

## Root cause

**现象**：进程被杀后，客户端重连拿不到被截断回合的进度；单机模式下恢复锚点依赖存储后端里另一份独立维护的状态，与账本各写各的；账本行没有版本演进路径；大载荷可以无限写进行内。

**证据链**：

1. 结构事件的唯一持久落点是 `ReplayLedgerRecorder`，它在 `run_turn` 的消费循环里观察每个 `RuntimeEvent`（`agent_runtime.py:4172-4187`）。但除了导出、回放 API、分支、企业 Trace 之外，没有任何读路径在崩溃后去读账本：重连端点在中枢不活跃时只读总线（`server.py:5599-5620`），恢复路径只读检查点（`session_manager.py:1186-1189`）。
2. 中枢缓冲与 live seq 只在内存（`session_event_hub.py:54-55`），进程重启即丢；总线日志封顶且游标与 live seq 不同号（`redis_bus.py:11-12`、`:333-349`）；账本事件行虽有 `seq`，却从未暴露给客户端作为续读游标。
3. 检查点（`AgentCheckpoint`）在 `run_turn` 的三个写入点（`agent_runtime.py:4146`、`:4851`、`:6583`）独立于账本维护 `round_idx` / `pending_tool_calls` / `confirm_state`。账本能区分「已发出未返回」与「尚未发出」，检查点不能；包装门下检查点的 `confirm_state` 为空，账本里有 `confirm_required` 行。
4. 恢复分层没有写明：单机模式下恢复默认关闭（`checkpoint.py:124-148`），HA 模式恢复锚点在 Redis，两者之间没有任何文字说明「账本在哪、以谁为准」。
5. 读路径把缺版本号读成当前版本（`contracts.py:264-266`），没有任何 upcast 代码；映射事件与 `user_message` 的载荷整份写进行内，没有上限（`recorder.py:181-192`、`recorder.py:376-379`）。

实施者可以用这条链自行判断改动是否对症：每一环都对应下文一个任务，任务做完后对应的那一环应当不再成立。

## Design

每个决定写清选了什么、备选是什么、为什么。

### D1 读时 upcast：注册表驱动的逐级升级，不升 `SCHEMA_VERSION`

- **选择**：新增 `agenticx/runtime/replay_ledger/upcast.py`，提供 `upcast_event_row(row, *, target_version)` 与注册表 `UPGCAST_STEPS = {0: _upcast_v0_to_v1}`；`RunEvent.from_dict` 的第一句调用它。缺失、空串、0 的版本读成 v0，逐级升到当前版本；某个版本没有注册升级步骤，或行版本比当前新，就停在原地原样返回（仍可读基础字段，但 `branchable=False`）。
- **备选 A（放弃）**：在 `contracts.py` 内联升级函数。没有循环导入问题，但版本演进逻辑没有独立归属，链完整性只能绕着 `from_dict` 测。
- **备选 B（放弃）**：把 `SCHEMA_VERSION` 升到 2，让 v1→v2 升级器是恒等映射。会让老二进制把新行判成 `unsupported_schema_version`，与「不改数据模型」冲突。
- **为什么**：注册表让「升版本必须配升级器」成为可测试的约束；行永不被回写（`read_events` 只读）；已发布版本写出的行不受影响。
- **不变量**：`ReplayRunRecord.from_dict` 与 `ContextCheckpoint.from_dict` 不改。它们的 `schema_version` 会被 `run.json` 的回写带出去，改成「缺失 = 0」会把 0 写回磁盘，违反「永不回写」；且它们不是追加型的事件行。

### D2 大载荷：行内摘要加 blob 全文，统一尺寸闸

- **选择**：在 `ReplayLedgerRecorder._append` 的落盘前一刻（分支稳定性判定之后、`store.append_event` 之前）对 `payload_ref is None` 的事件做尺寸闸：canonical JSON 字节数大于 `MAX_INLINE_PAYLOAD_BYTES = 4096` 时，整份载荷 `write_blob`，行内 `payload` 改为固定形状的摘要，`payload_ref` 为 blob 摘要值。
- **行内摘要的形状（固定）**：`{"truncated": true, "head": <canonical JSON 的前 256 字节，按 UTF-8 解码，丢弃不完整尾字节>, "length": <canonical JSON 字节数>, "digest": <canonical JSON 的 sha256 十六进制>}`。`digest` 与 `payload_ref` 由构造相等（`write_blob` 用同样的 `json.dumps(..., ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()`，`store.py:451-454`）。
- **位置在稳定性判定之后的理由**：`context_is_branch_stable` 在写入时读 `payload["id"]` 判断确认应答是否在上下文里（`recorder.py:317`）。若先截断，超过阈值的确认事件会被误判为不稳定。
- **读侧**：`ReplayLedgerStore.resolve_payload(event)`，行内是摘要且有 `payload_ref` 就读 blob，否则原样返回行内 `payload`。导出无需改动（已走 `resolved_payload`，`export.py:94-95`）。
- **备选 A（放弃）**：按事件类型给 `user_message` 与映射事件单独加预览。按类型枚举会漏掉未来新增的事件类型，也没有统一口径。
- **备选 B（放弃）**：阈值设为 16 KiB 以上。`user_message` 粘贴整份文档时仍会写出几十 KB 的单行，而 `read_events` 每翻一页都全文件扫描，单行体积直接决定读成本。
- **已带 `payload_ref` 的结构化载荷不过闸**：`tool_call` / `tool_result` / `assistant_output_completed` 的预览被 500 字符封顶，最大约 2.2KB，低于阈值。

### D3 恢复锚点：账本 run 事件的读时投影

- **选择**：新增 `agenticx/runtime/replay_ledger/resume_anchor.py`，`project_resume_anchor(store, session_id)` 只看该会话最新的 run 且其 `status == "running"`，按下表返回 `AgentCheckpoint`，没有这样的 run 则返回 `None`。
- **备选 A（放弃）**：让 recorder 在每轮顶部再追加一条「检查点事件」到账本。这等于把第二份状态搬进账本，且要给 `EVENT_TYPES` 加类型（改数据模型）。
- **备选 B（放弃）**：`round_idx` 取「该轮全部调用都有结果则推进到 R」。它只在「最后一轮最后一个结果已入账、下一轮顶部检查点尚未写出」这个窗口里比 R-1 规则更贴轮次，但会让起始轮超过 `max_tool_rounds` 时直接以轮次耗尽收尾（`_LiveRoundIterator` 在起始轮大于上限时立即 `StopIteration`），与改动前的检查点路径不一致。

投影规则（固定；整个 run 扫描，不按 `run_resumed` 切窗）：

| 量 | 规则 |
| --- | --- |
| `round_idx` | R 为该 run 最后一条 `round_started` 的轮次（取 `event.round_idx`，为 None 时取 `payload.round`）；`round_idx = max(0, R - 1)`；没有 `round_started` 则为 0 |
| `pending_tool_calls` | seq 大于最后一条 `round_started` 的 `tool_call`，且其后没有同 `tool_call_id` 的 `tool_result`；每项重建为 `{"id", "type": "function", "function": {"name", "arguments": <JSON 字符串>}}`，参数从 blob 取 |
| `confirm_state` | `pending` 为其后没有同 `id` 的 `confirm_response` 的 `confirm_required`；`last_request` 为最后一条 `confirm_required`；run 里从没有过 `confirm_required` 则为 `None`。载荷经 `store.resolve_payload` 解析，支持被截断的确认上下文 |
| `status` | `pending` 非空为 `"awaiting_confirm"`，否则 `"in_progress"` |
| `run_id` / `turn_id` / `session_id` | 取自 run 记录 |

与检查点写入点的对照（让实施者知道两种语义何时一致）：

| 崩溃时刻 | 检查点会说 | 账本投影会说 |
| --- | --- | --- |
| 回合入口、第一条 `ROUND_START` 被观察到之前 | `round_idx = 0` | `round_idx = 0` |
| 某轮顶部检查点已写、该轮 `ROUND_START` 尚未被观察 | `round_idx = N-1` | `round_idx = N-2`（唯一不一致的窗口，仅几条同步语句） |
| `ROUND_START(N)` 已观察、模型调用进行中 | `N-1`，pending 为空 | `N-1`，pending 为空 |
| 部分调用已发出、结果未全 | `N-1`，pending 为该批全部调用 | `N-1`，pending 只含已发出未返回的调用 |
| 该轮全部结果已入账、下一轮顶部检查点未写 | `N-1`，pending 为该批全部调用（都已应答，closer 无动作） | `N-1`，pending 为空 |

**有缺口的 run 不投影**：`project_resume_anchor` 读完事件后重新取一次 run 记录，`completeness != "complete"` 或 `gap_reason` 非空就返回 `None`，由调用方回落到检查点。账本一旦记过缺口，就可能缺行（例如写盘失败时丢掉的正是刚发出的 `tool_call`，或崩溃留下的半行），这时投影分不清「已发出」与「尚未发出」，会把一次已发出的写入标成「尚未开始执行」，模型可能重做。回落到的检查点路径把整批调用都标成「结果未知」，不会更差。重新取记录而不是沿用 `find_open_run` 的那份，是因为 `read_events` 要读到坏行才把 run 标成 `partial`（`store.py:424-430`）。

### D4 恢复分层与开关

- **选择**：`agenticx/runtime/checkpoint.py` 新增 `load_resume_anchor(session_id, *, sessions_root=None, checkpoint_store=None)`，按下列顺序决定锚点来源；`SessionManager.resume_interrupted_sessions` 改为调用它，其余恢复流程不变。
  1. HA 模式（`AGX_HA_MODE=redis` 或 `AGX_STORAGE_BACKEND=redis`，与 `resume_interrupted_enabled` 共用同一个 `_redis_ha_mode()`）：直接 `checkpoint_store.load(session_id)`，不读账本。理由是账本只落本地盘（`recorder.py:601`），换副本读不到。
  2. 开关关闭：同上，回到现有检查点路径。
  3. 单机且开关开启：先 `project_resume_anchor`；投影失败或为 `None` 时回落到 `checkpoint_store.load(session_id)`。回落保证「账本不可用」时不比改动前更差（例如 recorder 启动失败时只有检查点）。
- **开关**：环境变量 `AGX_RESUME_FROM_LEDGER`，配置键 `runtime.resume_from_ledger`，默认 True，经 `harden_flags._resolve_bool` 解析（环境变量优先于配置，与 `resume_interrupted_enabled` 同序）。该开关独立于 `AGX_RESUME_INTERRUPTED`：后者决定是否恢复，前者决定恢复时锚点从哪来。
- **备选 A（放弃）**：单机模式下账本给不出锚点就直接跳过、不回落。会把「用户主动停止的回合」这类账本已关闭但检查点仍在的情况改成不再恢复，属于产品行为变更，不在本 plan 范围（见已定案事项 3）。
- **备选 B（放弃）**：复用 `AGX_RESUME_INTERRUPTED` 一个开关。关闭它会同时关掉恢复本身，无法单独回滚「锚点来源」这一项。

### D5 续读回落到账本与三套游标的桥接规则

- **选择**：新增 `agenticx/runtime/replay_ledger/reattach.py`；`server.py` 的重连端点在中枢不活跃分支里、总线读不到行之后，调用它回放被崩溃截断的回合。
- **三套编号的桥接规则（写明）**：
  1. live seq：`SessionEventHub._seq`（`session_event_hub.py:54`、`:87`、`:102`）。纯整数，作为实时路径与中枢重放路径的 SSE `id:` 下发。只在一个中枢实例的生命期内有效（一个回合、一个进程），不落盘。
  2. 总线游标：Redis `INCR ev:sess:{sid}:seq`（`redis_bus.py:315-322`）。纯整数，重启与换副本后只要封顶日志还留着行就有效。在中枢不活跃的路径上，纯整数先被当作总线游标读（`server.py:5599-5607`，现有行为，本 plan 不改）。
  3. ledger seq：run 的 `events.jsonl` 序号。永久有效。只以命名空间形式 `ledger:<run_id>:<seq>` 暴露给客户端。
  4. 游标只在它自己的编号空间里有意义；三个空间之间没有、也不承诺任何数值换算。
  5. 中枢重新活跃后客户端带着 `ledger:` 游标重连：`_parse_sse_since_seq` 解析不出整数，按 0 处理（`server.py:1270`），从头重放中枢缓冲，与「不带游标接入」等价。
- **读路径上的最小桥接**：端点识别 `ledger:` 前缀的游标并在账本里按 seq 续读；纯整数游标在中枢与总线都解析不了时，先下发一条 `replay_gap`，再从账本回放。
- **回落条件（两者同时满足才回放，否则维持 `not_running`）**：会话 `execution_state` 为 `running` 或 `interrupted`；该会话最新的 run 存在且其 `status == "running"`。第二个条件单独不够，因为 `recorder.finish` 失败会让 run 永远停在 `running`（核实结论 6）。
- **顺序**：总线优先（现有行为不变），总线无行才轮到账本。HA 模式下跨副本续读仍以总线为准；账本只在 hosting 副本上存在，其它副本读不到则回到 `not_running`。
- **协议字段（固定）**：
  - 回放事件的 SSE `id:` 为 `ledger:<run_id>:<seq>`；`data:` 行与实时路径同形（经 `_runtime_event_to_sse_lines`，`server.py:1120`）。
  - 游标无法映射时先下发 `data: {"type":"replay_gap","data":{"since": <客户端游标原文>, "oldest_buffered": <第一条回放事件的 id 或 null>, "source": "ledger"}}`。触发条件：客户端带了游标，且它不是指向当前未关闭 run 的 `ledger:` 游标。
  - 结束行 `data: {"type":"done","data":{"reason":"replayed_from_ledger"}}`。
  - 游标正则：`^ledger:([A-Za-z0-9._:-]{1,128}):(\d{1,18})$`。
- **账本事件到 SSE 的映射（固定）**：

| 账本类型 | SSE `type` | `data` |
| --- | --- | --- |
| `round_started` | `round_start` | 解析后的 `payload` |
| `tool_call` | `tool_call` | `{"name", "arguments": <blob 里的字典>, "tool_call_id"}` |
| `tool_result` | `tool_result` | `{"name", "result", "tool_call_id"}`，blob 含 `structured` 时带上 |
| `assistant_output_completed` | `final` | 整份 blob |
| `confirm_required`、`confirm_response`、`clarification_required`、`clarification_response`、`clarification_suspended`、`compaction`、`context_stats`、`stall`、`error`、`tool_progress` | 同名 | 解析后的 `payload` |
| `run_started`、`run_resumed`、`user_message`、`assistant_output_started`、`artifact`、`run_completed`、`ledger_gap` | 不回放 | 文本增量按设计不入账，`assistant_output_started` 没有 SSE 对应物 |

- **开关**：环境变量 `AGX_LEDGER_REATTACH`，配置键 `runtime.ledger_reattach`，默认 True。关闭后端点维持改动前的 `not_running`。
- **备选 A（放弃）**：持久化 live seq 到 ledger seq 的映射表。recorder 在事件被 yield 之前观察事件，中枢在其后才分配 seq，两者之间还夹着不入账的 token，没有可靠的写入时机；而且这是新增一份持久状态。
- **备选 B（放弃）**：账本优先于总线。HA 模式下总线才是跨副本来源，调换顺序会改变 HA 的现有行为。

### 仓库对新 Python 文件的惯例（新代码遵守）

- 包内库模块：文件首行是 docstring，不加 shebang；docstring 末尾一行 `Author: Damon Li`；`from __future__ import annotations`；绝对导入；注释与 docstring 用英文（`contracts.py:1-11`、`recorder.py:2-33`、`store.py`）。
- 测试文件：首行是 docstring（说明覆盖什么），docstring 末尾 `Author: Damon Li`；`from __future__ import annotations`；绝对导入；类与夹具以下划线开头的辅助函数组织（`tests/test_replay_ledger_recorder.py:1-50`）。
- 环境变量前缀 `AGX_`，配置键在 `runtime.*` 下，布尔开关经 `harden_flags._resolve_bool(env_name, config_key, default)` 解析（`harden_flags.py:57`、`:88`）。
- 运行命令统一为 `.venv/bin/python -m pytest <文件> -q`（`pyproject.toml` 的 `[tool.pytest.ini_options]`：asyncio auto，importlib 导入模式）。
- **本机注意**：`.venv` 是打包用的精简环境，没有装 pytest 与 redis，不能用它跑测试。本机实际可用的解释器是 `/opt/miniconda3/bin/python3`（Python 3.13，pytest 9.1.0、pytest-asyncio 1.4.0，`agenticx` 从工作树导入）。下文所有 `.venv/bin/python -m pytest` 在本机一律替换为 `/opt/miniconda3/bin/python3 -m pytest`。该环境没有 fakeredis，`tests/test_ha_checkpoint_resume.py` 里的 redis 用例按原有写法 `importorskip` 跳过。冷启动冒烟仍用 `.venv/bin/agx`，那是运行时环境。

## In scope

- `RunEvent` 读时 upcast 链（v0→v1），缺失版本号按 v0 处理，永不回写。
- 账本写入时的载荷尺寸闸：超过 4096 字节的载荷整份进 blob，行内只留 `truncated` / `head` / `length` / `digest`。
- `ReplayLedgerStore.resolve_payload`：按需取全文。
- `project_resume_anchor`：从账本 run 事件投影 `AgentCheckpoint`。
- `load_resume_anchor`：恢复分层（HA 用检查点，单机账本优先、检查点回落）与开关 `AGX_RESUME_FROM_LEDGER`。
- `SessionManager.resume_interrupted_sessions` 改用 `load_resume_anchor`。
- 冷重启恢复时 closer 以持久化行为底合成，让「结果未知 / 未开始」标注真正进入上下文（Task 4 步骤 (c)，既有缺陷修复）。
- 重连端点的账本回落、`ledger:` 游标、`replay_gap`、开关 `AGX_LEDGER_REATTACH`。
- SDK 层验证：两个 HTTP 客户端直接调 `/api/sessions/{sid}/stream`。

## Out of scope

- `agenticx/sessions/`、`agenticx/protocols/agui.py`：不许碰。
- `agenticx/studio/session_event_hub.py`：不许碰。master plan 落点表列了它，但核实后桥接点在端点与账本读路径，中枢的发布订阅与重放语义不变，所以本 plan 不改它。
- `agenticx/runtime/coordination/redis_bus.py`、`agenticx/studio/storage/`：不许碰。不新增 Redis append API（09-10 冻结决定），不改总线日志结构。
- `agenticx/runtime/agent_runtime.py`：不许碰。检查点写入点、recorder 观察点都不变；恢复流程只在 Task 4 步骤 (c) 修 closer 的取底（`session_manager.py` 内），其余不变。
- `agenticx/runtime/replay_ledger/context_checkpoint.py`、`branch_service.py`、`workspace_snapshot.py`、`effects.py`：不许碰。
- `contracts.py` 的数据模型：不改 `SCHEMA_VERSION`、`EVENT_TYPES`、任何 dataclass 的字段；只加读时逻辑与载荷摘要辅助函数。
- 不迁移历史数据：已有的 `events.jsonl`、`run.json` 一行都不重写。
- 不新建事件总线，不给 `SessionEventHub` 另加落点。
- 不在 `agenticx/runtime/replay_ledger/` 之外直接读 `events.jsonl`；不在 `agenticx/runtime/checkpoint.py` 之外新增 `save_agent_state(` 调用。
- `ReplayRunRecord.from_dict` 与 `ContextCheckpoint.from_dict` 的版本缺省处理不改（理由见 D1）。
- `enterprise_trace.py` 不改（见风险 4）。
- 不做 Desktop 与移动端 UI，不改任何客户端。
- 文本增量不入账（持久化粒度不变）。
- `resume_interrupted_enabled` 的默认值不变（单机默认关闭）。

## Precise landing points

| 文件 | 类型 | 落点 |
| --- | --- | --- |
| `agenticx/runtime/replay_ledger/upcast.py` | Create | 整个文件 |
| `agenticx/runtime/replay_ledger/contracts.py` | Modify | import 区（`contracts.py:9-11`）加 `hashlib`、`json` 与 `upcast_event_row`；`RunEvent.from_dict` docstring 之后（`contracts.py:257` 与 `:258` 之间）插入一行；文件末尾追加载荷摘要常量与三个函数 |
| `agenticx/runtime/replay_ledger/store.py` | Modify | contracts 导入块（`store.py:35-41`）加 `is_payload_summary`；`read_blob` 之后、`write_checkpoint` 之前（`store.py:517` 与 `:518` 之间）加 `resolve_payload` 方法 |
| `agenticx/runtime/replay_ledger/recorder.py` | Modify | contracts 导入块（`recorder.py:19-24`）加三个名字；`_append` 里 `try: stored = self.store.append_event(...)` 之前（`recorder.py:378`）插入尺寸闸 |
| `agenticx/runtime/replay_ledger/resume_anchor.py` | Create | 整个文件 |
| `agenticx/runtime/replay_ledger/reattach.py` | Create | 整个文件 |
| `agenticx/runtime/harden_flags.py` | Modify | `cancelled_prefix_finalize_enabled`（`harden_flags.py:147`）之后追加两个开关函数 |
| `agenticx/runtime/checkpoint.py` | Modify | import 区（`checkpoint.py:24-33`）加 `Path` 与 `resume_from_ledger_enabled`；`resume_interrupted_enabled` 之后（`checkpoint.py:148` 之后，文件末尾）追加 `_redis_ha_mode` 与 `load_resume_anchor`；`resume_interrupted_enabled` 末尾的 HA 判定（`checkpoint.py:144-148`）改为 `return _redis_ha_mode()` |
| `agenticx/studio/session_manager.py` | Modify | `resume_interrupted_sessions` 内的延迟导入（`session_manager.py:1173`）与 `checkpoint = store.load(sid)`（`session_manager.py:1187`）；`_resume_single_session` 的 closer 基底（`session_manager.py:1238`，改读持久化行）；`_restore_persisted_state` 里「读快照 + 解析附件」的三步抽成 `_load_agent_messages_for_context`（放在 `_load_agent_messages_snapshot` 之后，`session_manager.py:2987` 之后）供两处共用 |
| `agenticx/studio/server.py` | Modify | 顶部 import 区只加一行（`server.py:84` 之后）；重连端点 `_reattach_stream` 里 `server.py:5619` 之前插入账本回落块 |
| `tests/test_replay_ledger_upcast.py` | Create（Test） | 整个文件 |
| `tests/test_replay_ledger_payload_summary.py` | Create（Test） | 整个文件 |
| `tests/test_replay_ledger_resume_anchor.py` | Create（Test） | 整个文件 |
| `tests/test_ledger_resume_recovery.py` | Create（Test） | 整个文件 |
| `tests/test_ledger_reattach_stream.py` | Create（Test） | 整个文件 |

`tests/` 下现有触及 replay_ledger / checkpoint / session_event_hub 的测试文件（回归时全部要跑）：

- `tests/test_replay_ledger_store.py`、`tests/test_replay_ledger_recorder.py`、`tests/test_run_context_checkpoint.py`、`tests/test_run_replay_api.py`、`tests/test_run_replay_export.py`、`tests/test_run_branch_service.py`、`tests/test_run_branch_api.py`、`tests/test_run_workspace_snapshot.py`
- `tests/test_ha_checkpoint_resume.py`、`tests/test_smoke_interrupted_closers.py`、`tests/test_runtime_interrupted_stream.py`
- `tests/test_smoke_session_event_hub.py`、`tests/test_smoke_group_reattach_hub.py`
- `tests/test_session_manager_persistence.py`、`tests/test_enterprise_trace.py`

实施已于 2026-11-28 完成，复跑结果见 Task 6 与 Verification 开头；下文步骤里的「待实施时执行」是计划原文，保留未改。

## Tasks

### Task 1 — FR-1 读时 upcast

文件：
- `agenticx/runtime/replay_ledger/upcast.py`（Create）
- `agenticx/runtime/replay_ledger/contracts.py`（Modify）
- `tests/test_replay_ledger_upcast.py`（Create，Test）

步骤：

- [ ] 写失败的测试 `tests/test_replay_ledger_upcast.py`（完整内容）：

```python
"""Tests for read-time upcast of persisted replay ledger event rows.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import agenticx.runtime.replay_ledger.upcast as upcast_module
from agenticx.runtime.replay_ledger import ReplayLedgerStore, ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.contracts import SCHEMA_VERSION
from agenticx.runtime.replay_ledger.upcast import UPGCAST_STEPS, upcast_event_row


def _store_with_run(tmp_path: Path) -> tuple[ReplayLedgerStore, ReplayRunRecord]:
    store = ReplayLedgerStore(tmp_path)
    record = store.open_run(
        ReplayRunRecord(
            run_id="run-upcast",
            session_id="session-upcast",
            turn_id="turn-upcast",
            agent_id="meta",
            status="running",
            created_at=1.0,
            updated_at=1.0,
        )
    )
    return store, record


def _row(record: ReplayRunRecord) -> RunEvent:
    return RunEvent(
        event_id="evt-1",
        run_id=record.run_id,
        session_id=record.session_id,
        turn_id=record.turn_id,
        seq=1,
        ts=1.0,
        type="round_started",
        agent_id="meta",
        payload={"round": 1},
        branchable=True,
    )


@pytest.mark.parametrize("raw_version", [None, "", "  ", 0])
def test_missing_or_zero_version_is_upcast_to_current(raw_version) -> None:
    row = {"seq": 1, "type": "round_started", "branchable": True}
    if raw_version is not None:
        row["schema_version"] = raw_version

    upgraded = upcast_event_row(row, target_version=SCHEMA_VERSION)

    assert upgraded["schema_version"] == SCHEMA_VERSION
    assert upgraded["branchable"] is True


def test_versionless_row_on_disk_is_upcast_at_read_and_never_rewritten(tmp_path: Path) -> None:
    store, record = _store_with_run(tmp_path)
    stored = store.append_event(record.run_id, _row(record))
    events_path = next(tmp_path.rglob("events.jsonl"))
    raw_row = json.loads(events_path.read_text(encoding="utf-8").splitlines()[0])
    assert raw_row["schema_version"] == SCHEMA_VERSION  # the writer always stamps the version
    del raw_row["schema_version"]
    events_path.write_text(json.dumps(raw_row, ensure_ascii=False) + "\n", encoding="utf-8")
    before = events_path.read_bytes()

    events, _has_more = store.read_events(record.run_id)

    assert [event.event_id for event in events] == [stored.event_id]
    assert events[0].schema_version == SCHEMA_VERSION
    assert events[0].branchable is True
    assert events[0].unbranchable_reason is None
    assert events_path.read_bytes() == before


def test_newer_version_is_returned_untouched() -> None:
    row = {"seq": 1, "schema_version": SCHEMA_VERSION + 5, "payload": {"k": "v"}}

    assert upcast_event_row(row, target_version=SCHEMA_VERSION) == row


def test_missing_step_stops_the_chain_and_keeps_the_row_readable() -> None:
    # The registry stays empty for the whole test: with the real {0: step} in
    # place a v0 row would be upgraded to v1 on read.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(upcast_module, "UPGCAST_STEPS", {})
        upgraded = upcast_event_row({"seq": 1}, target_version=SCHEMA_VERSION)
        assert upgraded["schema_version"] == 0

        event = RunEvent.from_dict(
            dict(
                upgraded,
                event_id="evt-1",
                run_id="run-1",
                session_id="session-1",
                turn_id="turn-1",
                type="round_started",
            )
        )
    assert event.schema_version == 0
    assert event.branchable is False
    assert event.unbranchable_reason == "unsupported_schema_version"


def test_every_version_below_current_has_an_upcast_step() -> None:
    assert set(UPGCAST_STEPS) == set(range(SCHEMA_VERSION))


def test_chain_runs_every_step_in_order() -> None:
    seen: list[int] = []

    def step_from_v1(row):
        seen.append(row["schema_version"])
        row["saw_v1"] = True
        return row

    with pytest.MonkeyPatch.context() as patch:
        patch.setitem(UPGCAST_STEPS, SCHEMA_VERSION, step_from_v1)
        upgraded = upcast_event_row({"seq": 1}, target_version=SCHEMA_VERSION + 1)

    assert seen == [SCHEMA_VERSION]
    assert upgraded["schema_version"] == SCHEMA_VERSION + 1
    assert upgraded["saw_v1"] is True


def test_non_object_row_is_rejected() -> None:
    with pytest.raises(ValueError):
        upcast_event_row(["not", "an", "object"], target_version=SCHEMA_VERSION)
```

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_upcast.py -q`。预期失败：收集阶段报 `ModuleNotFoundError: No module named 'agenticx.runtime.replay_ledger.upcast'`。
- [ ] 新建 `agenticx/runtime/replay_ledger/upcast.py`（完整内容）：

```python
"""Read-time upcasters for persisted replay ledger event rows.

Ledger rows are append-only and are never rewritten on disk. A row written
by an older schema is upgraded in memory on every read, one registered step
at a time, until it reaches the current schema version. A row that cannot be
upgraded (no step registered for its version, or newer than this build) is
returned with its version untouched so callers can still read its base
fields.

Rule: bumping ``SCHEMA_VERSION`` is only allowed together with a step that
upgrades the previous version.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Callable

UpcastStep = Callable[[dict[str, Any]], dict[str, Any]]


def row_schema_version(row: dict[str, Any]) -> int:
    """Return the version a persisted row declares; missing or blank means v0."""
    raw = row.get("schema_version")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return 0
    return max(0, int(raw))


def upcast_event_row(row: dict[str, Any], *, target_version: int) -> dict[str, Any]:
    """Upgrade one persisted row in memory up to ``target_version``."""
    if not isinstance(row, dict):
        raise ValueError("event row must be a JSON object")
    upgraded = dict(row)
    version = row_schema_version(upgraded)
    target = int(target_version)
    while version < target:
        step = UPGCAST_STEPS.get(version)
        if step is None:
            break
        upgraded = dict(step(upgraded))
        version += 1
    upgraded["schema_version"] = version
    return upgraded


def _upcast_v0_to_v1(row: dict[str, Any]) -> dict[str, Any]:
    """v0 rows predate the version stamp; their field set already matches v1."""
    row["schema_version"] = 1
    return row


# Key: the row's version BEFORE the step. Value: the step to version + 1.
UPGCAST_STEPS: dict[int, UpcastStep] = {0: _upcast_v0_to_v1}
```

- [ ] 改 `agenticx/runtime/replay_ledger/contracts.py`，共两处。只精确增删目标行。

  (a) import 区。before（`contracts.py:9-11`）：

```python
import re
from dataclasses import asdict, dataclass, field
from typing import Any
```

  after：

```python
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from agenticx.runtime.replay_ledger.upcast import upcast_event_row
```

  (b) `RunEvent.from_dict`。before（`contracts.py:255-266`）：

```python
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RunEvent":
        """Deserialize and validate a persisted event."""
        seq = int(data.get("seq", 0) or 0)
        if seq < 1:
            raise ValueError("seq must be at least 1")
        effect_class = str(data.get("effect_class", "none") or "none").strip()
        if effect_class not in EFFECT_CLASSES:
            effect_class = "unknown"
        schema_version = int(
            data.get("schema_version", SCHEMA_VERSION) or SCHEMA_VERSION
        )
```

  after：

```python
    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RunEvent":
        """Deserialize and validate a persisted event."""
        data = upcast_event_row(data, target_version=SCHEMA_VERSION)
        seq = int(data.get("seq", 0) or 0)
        if seq < 1:
            raise ValueError("seq must be at least 1")
        effect_class = str(data.get("effect_class", "none") or "none").strip()
        if effect_class not in EFFECT_CLASSES:
            effect_class = "unknown"
        schema_version = int(data["schema_version"])
```

  说明：upcast 之后 `schema_version` 一定存在，所以去掉 `or SCHEMA_VERSION` 这个回退。原来的回退会把「停在 v0 的行」重新读成 1，让链中断的行重新变成可分支。

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_upcast.py tests/test_replay_ledger_store.py -q`。预期全部通过。`tests/test_replay_ledger_store.py` 里的 `test_future_schema_event_is_readable_but_not_branchable` 必须保持通过。
- [ ] 不升 `SCHEMA_VERSION`。以后升版本的规则：在 `UPGCAST_STEPS` 里加一条「旧版本号 → 升级函数」，再把 `SCHEMA_VERSION` 加 1；`test_every_version_below_current_has_an_upcast_step` 会挡住只升版本不加升级器的改动。

### Task 2 — FR-2 大载荷行内摘要，全文走 blob

文件：
- `agenticx/runtime/replay_ledger/contracts.py`（Modify）
- `agenticx/runtime/replay_ledger/store.py`（Modify）
- `agenticx/runtime/replay_ledger/recorder.py`（Modify）
- `tests/test_replay_ledger_payload_summary.py`（Create，Test）

步骤：

- [ ] 写失败的测试 `tests/test_replay_ledger_payload_summary.py`（完整内容）：

```python
"""Tests for inline payload summaries of large replay ledger events.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.contracts import (
    MAX_INLINE_PAYLOAD_BYTES,
    PAYLOAD_SUMMARY_HEAD_BYTES,
    canonical_json_bytes,
    is_payload_summary,
)
from agenticx.runtime.replay_ledger.export import export_run_markdown
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder


def _recorder(tmp_path: Path) -> tuple[ReplayLedgerStore, ReplayLedgerRecorder]:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store,
        session_id="session-payload",
        agent_id="meta",
        provider="test",
        model="test-model",
    )
    return store, recorder


def _events_jsonl(tmp_path: Path) -> Path:
    return next(tmp_path.rglob("events.jsonl"))


def test_oversized_mapped_event_keeps_only_summary_inline(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-payload", user_input="go")
    text = "x" * (MAX_INLINE_PAYLOAD_BYTES + 1)
    recorder.observe(RuntimeEvent("error", {"text": text}), session=StudioSession())

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "error")

    assert is_payload_summary(event.payload) is True
    assert set(event.payload) == {"truncated", "head", "length", "digest"}
    assert event.payload["length"] == MAX_INLINE_PAYLOAD_BYTES + 1 + len('{"text":""}')
    assert event.payload["head"] == '{"text":"' + "x" * (
        PAYLOAD_SUMMARY_HEAD_BYTES - len('{"text":"')
    )
    assert event.payload_ref == event.payload["digest"]
    assert store.resolve_payload(event) == {"text": text}
    line = _events_jsonl(tmp_path).read_text(encoding="utf-8").splitlines()[-1]
    assert len(line.encode("utf-8")) < MAX_INLINE_PAYLOAD_BYTES


def test_small_payload_stays_inline_without_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-small", user_input="go")
    recorder.observe(RuntimeEvent("error", {"text": "boom"}), session=StudioSession())

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "error")

    assert event.payload == {"text": "boom"}
    assert event.payload_ref is None
    assert store.resolve_payload(event) == {"text": "boom"}


def test_large_user_message_moves_full_text_to_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    long_input = "需求说明。" * 2000
    run_id = recorder.start_turn(turn_id="turn-user", user_input=long_input)

    events, _has_more = store.read_events(run_id)
    event = next(item for item in events if item.type == "user_message")

    assert is_payload_summary(event.payload) is True
    resolved = store.resolve_payload(event)
    assert resolved["text"] == long_input
    assert event.payload["length"] == len(canonical_json_bytes(resolved))


def test_capped_structured_payloads_are_never_summarized(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    run_id = recorder.start_turn(turn_id="turn-structured", user_input="go")
    preview = "结" * 500
    recorder.observe(
        RuntimeEvent(
            "tool_call",
            {"name": "file_read", "arguments": {"path": "a"}, "tool_call_id": "c1"},
        ),
        session=StudioSession(),
    )
    recorder.observe(
        RuntimeEvent("tool_result", {"name": "file_read", "result": preview, "tool_call_id": "c1"}),
        session=StudioSession(),
    )

    events, _has_more = store.read_events(run_id)
    call = next(item for item in events if item.type == "tool_call")
    result = next(item for item in events if item.type == "tool_result")

    assert call.payload["name"] == "file_read"
    assert call.payload["source_tool_call_id"] == "c1"
    assert result.payload["name"] == "file_read"
    assert "preview" in result.payload and "status" in result.payload
    assert is_payload_summary(call.payload) is False
    assert is_payload_summary(result.payload) is False


def test_markdown_export_reads_large_user_message_from_blob(tmp_path: Path) -> None:
    store, recorder = _recorder(tmp_path)
    long_input = "需求说明。" * 2000
    run_id = recorder.start_turn(turn_id="turn-export", user_input=long_input)
    recorder.finish("completed")
    events, _has_more = store.read_events(run_id, limit=10)

    markdown = export_run_markdown(
        store.get_run(run_id),
        events,
        resolve_payload=lambda blob_ref: store.read_blob(run_id, blob_ref),
    )

    # The row only holds a summary envelope; the exporter must render the
    # text stored in the blob, never the envelope itself.
    assert "需求说明。" * 100 in markdown
    assert "truncated" not in markdown
```

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_payload_summary.py -q`。预期失败：`ImportError: cannot import name 'MAX_INLINE_PAYLOAD_BYTES'`。
- [ ] 改 `agenticx/runtime/replay_ledger/contracts.py`，一处。import 区不需要再动：Task 1 已经加了 `hashlib` 与 `json`。在 `RunEvent` 类之后（文件末尾）追加：

```python
MAX_INLINE_PAYLOAD_BYTES = 4096
PAYLOAD_SUMMARY_HEAD_BYTES = 256


def canonical_json_bytes(value: Any) -> bytes | None:
    """Encode a JSON value exactly like ``write_blob`` does; None if unserializable."""
    try:
        return json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError):
        return None


def summarize_payload(raw: bytes) -> dict[str, Any]:
    """Build the inline summary kept on the row when the full payload moves to a blob."""
    return {
        "truncated": True,
        "head": raw[:PAYLOAD_SUMMARY_HEAD_BYTES].decode("utf-8", errors="ignore"),
        "length": len(raw),
        "digest": hashlib.sha256(raw).hexdigest(),
    }


def is_payload_summary(payload: Any) -> bool:
    """Whether an inline payload is a summary whose full value lives in a blob."""
    return (
        isinstance(payload, dict)
        and payload.get("truncated") is True
        and isinstance(payload.get("digest"), str)
    )
```

- [ ] 改 `agenticx/runtime/replay_ledger/store.py`，两处。

  (a) contracts 导入块（`store.py:35-41`）的导入名列表里加 `is_payload_summary`。

  (b) 在 `read_blob` 之后、`write_checkpoint`（`store.py:518`）之前新增方法：

```python
    def resolve_payload(self, event: RunEvent) -> Any:
        """Return the full event payload, following the blob when the row holds a summary."""
        if not is_payload_summary(event.payload) or not event.payload_ref:
            return event.payload
        resolved = self.read_blob(event.run_id, event.payload_ref)
        return resolved if resolved is not None else event.payload
```

- [ ] 改 `agenticx/runtime/replay_ledger/recorder.py`，两处。

  (a) contracts 导入块（`recorder.py:19-24`）的导入名列表里加 `MAX_INLINE_PAYLOAD_BYTES`、`canonical_json_bytes`、`summarize_payload`。

  (b) `_append` 里 `try: stored = self.store.append_event(self.current_run_id, event)`（`recorder.py:378-379`）之前插入：

```python
        if event.payload_ref is None:
            raw_payload = canonical_json_bytes(event.payload)
            if raw_payload is not None and len(raw_payload) > MAX_INLINE_PAYLOAD_BYTES:
                try:
                    event.payload_ref = self.store.write_blob(
                        self.current_run_id, event.payload
                    )
                except Exception:
                    event.payload_ref = None
                else:
                    event.payload = summarize_payload(raw_payload)
```

  插入位置必须在 `recorder.py:376-377`（`elif not event.unbranchable_reason` 分支）之后。blob 写失败时保持整份载荷入行（与改动前一致），不让尺寸闸引入新的失败面。

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_payload_summary.py tests/test_replay_ledger_recorder.py tests/test_run_replay_export.py tests/test_run_replay_api.py tests/test_enterprise_trace.py -q`。预期全部通过。

### Task 3 — FR-3 恢复锚点的账本投影

文件：
- `agenticx/runtime/replay_ledger/resume_anchor.py`（Create）
- `tests/test_replay_ledger_resume_anchor.py`（Create，Test）

依赖 Task 2（`test_large_confirm_context_is_restored_from_blob` 需要尺寸闸与 `resolve_payload`）。

步骤：

- [ ] 写失败的测试 `tests/test_replay_ledger_resume_anchor.py`（完整内容）：

```python
"""Tests for projecting the crash-resume anchor from the replay ledger.

Author: Damon Li
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.contracts import MAX_INLINE_PAYLOAD_BYTES
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.runtime.replay_ledger.resume_anchor import project_resume_anchor

SID = "session-anchor"


def _recorder(store: ReplayLedgerStore) -> ReplayLedgerRecorder:
    return ReplayLedgerRecorder(
        store=store,
        session_id=SID,
        agent_id="meta",
        provider="test",
        model="test-model",
    )


def _observe(
    recorder: ReplayLedgerRecorder, event_type: str, data: dict, round_idx: int | None = None
) -> None:
    recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)


def _open_crashed_run(store: ReplayLedgerStore) -> tuple[str, ReplayLedgerRecorder]:
    """Reach round 3, dispatch c2, then "crash": the run is never finished."""
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-anchor", user_input="帮我完成两步任务")
    _observe(recorder, "round_start", {"round": 1}, 1)
    _observe(
        recorder,
        "tool_call",
        {"name": "todo_write", "arguments": {"todos": []}, "tool_call_id": "c1"},
        1,
    )
    _observe(recorder, "tool_result", {"name": "todo_write", "result": "ok", "tool_call_id": "c1"}, 1)
    _observe(recorder, "round_start", {"round": 2}, 2)
    _observe(recorder, "round_start", {"round": 3}, 3)
    _observe(
        recorder,
        "tool_call",
        {"name": "file_write", "arguments": {"path": "a.txt", "content": "x"}, "tool_call_id": "c2"},
        3,
    )
    return run_id, recorder


def test_dispatched_tool_call_without_result_is_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, _recorder_after_crash = _open_crashed_run(store)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.turn_id == "turn-anchor"
    assert checkpoint.session_id == SID
    assert checkpoint.round_idx == 2  # the resumed turn re-enters at round 3
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state is None
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    call = checkpoint.pending_tool_calls[0]
    assert call["type"] == "function"
    assert call["function"]["name"] == "file_write"
    assert json.loads(call["function"]["arguments"]) == {"path": "a.txt", "content": "x"}


def test_unanswered_confirm_is_projected_as_awaiting_confirm(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "file_write", "request_id": "req-9"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-9", "question": "允许写入吗？", "context": context},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.status == "awaiting_confirm"
    assert checkpoint.confirm_state == {
        "pending": [{"request_id": "req-9", "question": "允许写入吗？", "context": context}],
        "last_request": {"id": "req-9", "question": "允许写入吗？", "context": context},
    }


def test_answered_confirm_leaves_no_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "file_write", "request_id": "req-9"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-9", "question": "允许写入吗？", "context": context},
        3,
    )
    _observe(recorder, "confirm_response", {"id": "req-9", "approved": True}, 3)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state == {
        "pending": [],
        "last_request": {"id": "req-9", "question": "允许写入吗？", "context": context},
    }


def test_retried_tool_call_with_same_id_follows_the_latest_attempt(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-retry", user_input="go")
    _observe(recorder, "round_start", {"round": 1}, 1)
    _observe(recorder, "tool_call", {"name": "file_read", "arguments": {"path": "a"}, "tool_call_id": "c1"}, 1)
    _observe(recorder, "tool_result", {"name": "file_read", "result": "a", "tool_call_id": "c1"}, 1)
    _observe(recorder, "tool_call", {"name": "file_read", "arguments": {"path": "b"}, "tool_call_id": "c1"}, 1)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c1"]
    assert json.loads(checkpoint.pending_tool_calls[0]["function"]["arguments"]) == {"path": "b"}


def test_all_results_recorded_resumes_at_the_next_round_with_no_pending(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    _observe(recorder, "tool_result", {"name": "file_write", "result": "done", "tool_call_id": "c2"}, 3)

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.round_idx == 2
    assert checkpoint.pending_tool_calls == []


def test_crash_before_first_round_resumes_at_round_one(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = _recorder(store)
    run_id = recorder.start_turn(turn_id="turn-early", user_input="go")

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.round_idx == 0
    assert checkpoint.pending_tool_calls == []


def test_closed_runs_and_missing_ledgers_are_not_resumable(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    assert project_resume_anchor(store, SID) is None  # no ledger at all

    _run_id, recorder = _open_crashed_run(store)
    recorder.finish("interrupted")
    assert project_resume_anchor(store, SID) is None  # the run was closed


def test_clarification_and_subagent_events_do_not_change_the_anchor(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, recorder = _open_crashed_run(store)
    recorded_before = len(store.read_events(run_id)[0])
    _observe(recorder, "subagent_started", {"agent_id": "sub-1", "task": "x"}, 3)
    assert len(store.read_events(run_id)[0]) == recorded_before  # never recorded
    _observe(
        recorder,
        "clarification_required",
        {"id": "clar-1", "question": "哪个文件？", "options": ["a", "b"]},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.round_idx == 2
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    assert checkpoint.status == "in_progress"
    assert checkpoint.confirm_state is None


def test_large_confirm_context_is_restored_from_blob(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _run_id, recorder = _open_crashed_run(store)
    context = {"tool": "bash", "command": "echo " + "y" * MAX_INLINE_PAYLOAD_BYTES, "request_id": "req-big"}
    _observe(
        recorder,
        "confirm_required",
        {"id": "req-big", "question": "允许执行吗？", "context": context},
        3,
    )

    checkpoint = project_resume_anchor(store, SID)

    assert checkpoint is not None
    assert checkpoint.confirm_state["pending"][0]["context"] == context


def test_gapped_run_is_not_projected(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    run_id, _recorder = _open_crashed_run(store)
    store.mark_partial(run_id, "ledger_append_failed")

    # Rows may be missing, so "dispatched" cannot be told from "not started".
    assert project_resume_anchor(store, SID) is None


def test_stale_open_run_does_not_shadow_a_newer_turn(tmp_path: Path) -> None:
    store = ReplayLedgerStore(tmp_path)
    _stale_run_id, _stale_recorder = _open_crashed_run(store)  # never closed
    time.sleep(0.01)  # make the newer run strictly newer than the stale one
    newer = _recorder(store)
    newer.start_turn(turn_id="turn-newer", user_input="继续")
    newer.finish("interrupted")

    assert project_resume_anchor(store, SID) is None
```

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_resume_anchor.py -q`。预期失败：`ModuleNotFoundError: No module named 'agenticx.runtime.replay_ledger.resume_anchor'`。
- [ ] 新建 `agenticx/runtime/replay_ledger/resume_anchor.py`（完整内容）：

```python
"""Project the crash-resume anchor from the durable replay ledger.

The anchor that crash recovery needs (which round to re-enter, which tool
calls were dispatched but never answered, which confirmation questions are
still open) is a pure function of a run's persisted events. It is computed on
read and never stored as a second copy.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from typing import Any

from agenticx.runtime.checkpoint import AgentCheckpoint
from agenticx.runtime.replay_ledger.contracts import ReplayRunRecord, RunEvent
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

logger = logging.getLogger(__name__)

READ_PAGE_SIZE = 500


def read_run_events(store: ReplayLedgerStore, run_id: str) -> list[RunEvent]:
    """Read every event of one run in seq order."""
    events: list[RunEvent] = []
    after_seq = 0
    while True:
        page, has_more = store.read_events(run_id, after_seq=after_seq, limit=READ_PAGE_SIZE)
        if not page:
            break
        events.extend(page)
        after_seq = int(page[-1].seq)
        if not has_more:
            break
    return events


def find_open_run(store: ReplayLedgerStore, session_id: str) -> ReplayRunRecord | None:
    """Return the session's newest run if it was never closed, else None.

    Only the latest run of a session can be the interrupted one. An older run
    left open by an earlier crash or by a failed ``finish`` must not shadow a
    newer turn, whose checkpoint then stays the recovery source.
    """
    runs = store.list_runs(session_id)
    if not runs:
        return None
    latest = max(runs, key=lambda run: (float(run.created_at or 0.0), str(run.run_id)))
    return latest if latest.status == "running" else None


def _round_of(event: RunEvent) -> int:
    if event.round_idx is not None:
        return int(event.round_idx)
    try:
        return int((event.payload or {}).get("round", 0) or 0)
    except (AttributeError, TypeError, ValueError):
        return 0


def _pending_tool_call(store: ReplayLedgerStore, event: RunEvent) -> dict[str, Any]:
    arguments: Any = {}
    name = ""
    if event.payload_ref:
        blob = store.read_blob(event.run_id, event.payload_ref)
        if isinstance(blob, dict):
            name = str(blob.get("name") or "")
            if isinstance(blob.get("arguments"), dict):
                arguments = blob["arguments"]
    return {
        "id": str(event.tool_call_id or ""),
        "type": "function",
        "function": {
            "name": name or str((event.payload or {}).get("name") or ""),
            "arguments": json.dumps(arguments, ensure_ascii=False),
        },
    }


def project_resume_anchor(
    store: ReplayLedgerStore, session_id: str
) -> AgentCheckpoint | None:
    """Project the resume anchor of the session's open run, or return None."""
    record = find_open_run(store, session_id)
    if record is None:
        return None
    events = read_run_events(store, record.run_id)
    refreshed = store.get_run(record.run_id)
    if refreshed is None or refreshed.completeness != "complete" or refreshed.gap_reason:
        # A run with a recorded gap may be missing rows (for example the
        # tool_call written just before a failed append). The projection then
        # cannot tell dispatched from not-dispatched; returning None makes the
        # caller fall back to the stored checkpoint, which marks the whole
        # batch as dispatched.
        return None

    last_round_start = None
    for event in events:
        if event.type == "round_started":
            last_round_start = event
    round_idx = 0 if last_round_start is None else max(0, _round_of(last_round_start) - 1)
    boundary_seq = 0 if last_round_start is None else int(last_round_start.seq)

    latest_result_seq: dict[str, int] = {}
    for event in events:
        if event.type == "tool_result" and event.tool_call_id:
            latest_result_seq[event.tool_call_id] = int(event.seq)
    pending_tool_calls: list[dict[str, Any]] = []
    for event in events:
        if event.type != "tool_call" or not event.tool_call_id:
            continue
        if int(event.seq) <= boundary_seq:
            continue  # belongs to an earlier round
        if latest_result_seq.get(event.tool_call_id, 0) > int(event.seq):
            continue  # answered after this call
        pending_tool_calls.append(_pending_tool_call(store, event))

    confirm_requests: list[dict[str, Any]] = []
    responded: set[str] = set()
    for event in events:
        if event.type not in ("confirm_required", "confirm_response"):
            continue
        payload = store.resolve_payload(event)
        if not isinstance(payload, dict):
            continue
        request_id = str(payload.get("id") or "").strip()
        if not request_id:
            continue
        if event.type == "confirm_response":
            responded.add(request_id)
            continue
        context = payload.get("context")
        confirm_requests.append(
            {
                "request_id": request_id,
                "question": payload.get("question"),
                "context": context if isinstance(context, dict) else {},
            }
        )
    pending_confirms = [item for item in confirm_requests if item["request_id"] not in responded]
    last_request = None
    if confirm_requests:
        last_request = dict(confirm_requests[-1], id=confirm_requests[-1]["request_id"])
        last_request.pop("request_id", None)

    return AgentCheckpoint(
        session_id=record.session_id,
        turn_id=record.turn_id,
        run_id=record.run_id,
        round_idx=round_idx,
        status="awaiting_confirm" if pending_confirms else "in_progress",
        pending_tool_calls=pending_tool_calls,
        confirm_state={"pending": pending_confirms, "last_request": last_request} if confirm_requests else None,
        created_at=float(record.created_at or 0.0),
        updated_at=float(record.updated_at or 0.0),
    )
```

- 循环导入说明：`resume_anchor.py` 在模块顶层导入 `agenticx.runtime.checkpoint`；`checkpoint.py` 对 `resume_anchor` 只做函数内延迟导入（见 Task 4），所以没有环。
- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_replay_ledger_resume_anchor.py -q`。预期 11 个测试全部通过。

### Task 4 — FR-4 恢复分层与开关

文件：
- `agenticx/runtime/harden_flags.py`（Modify）
- `agenticx/runtime/checkpoint.py`（Modify）
- `agenticx/studio/session_manager.py`（Modify）
- `tests/test_ledger_resume_recovery.py`（Create，Test）

依赖 Task 3。

步骤：

- [ ] 写失败的测试 `tests/test_ledger_resume_recovery.py`（完整内容）：

```python
"""Tests for recovery layering: ledger-projected anchors in standalone mode,
checkpoint anchors in HA mode and when the switch is off.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime.checkpoint import AgentCheckpoint, CheckpointStore, load_resume_anchor
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.studio.session_manager import SessionManager
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.local_file import LocalFileBackend

SID = "crash-ledger-1"


def _checkpoint_store(tmp_path: Path) -> CheckpointStore:
    backend = LocalFileBackend(
        sessions_root=tmp_path / "sessions",
        config_dir=tmp_path / "cfg",
    )
    return CheckpointStore(SyncStorageFacade(backend))


def _no_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep config and env from leaking the developer's shell into the test."""
    monkeypatch.setattr(ConfigManager, "get_value", lambda key, default=None: None)
    for name in ("AGX_RESUME_FROM_LEDGER", "AGX_HA_MODE", "AGX_STORAGE_BACKEND"):
        monkeypatch.delenv(name, raising=False)


def _open_ledger_run(sessions_root: Path, sid: str = SID, finish: str | None = None) -> str:
    """Round 3 dispatched c2 and asked for confirmation; then the process "crashed"."""
    sessions_root.mkdir(parents=True, exist_ok=True)
    store = ReplayLedgerStore(sessions_root)
    recorder = ReplayLedgerRecorder(
        store=store, session_id=sid, agent_id="meta", provider="test", model="test-model"
    )
    run_id = recorder.start_turn(turn_id="t-crash", user_input="帮我完成两步任务")
    for event_type, data, round_idx in (
        ("round_start", {"round": 1}, 1),
        ("tool_call", {"name": "todo_write", "arguments": {}, "tool_call_id": "c1"}, 1),
        ("tool_result", {"name": "todo_write", "result": "ok", "tool_call_id": "c1"}, 1),
        ("round_start", {"round": 2}, 2),
        ("round_start", {"round": 3}, 3),
        ("tool_call", {"name": "file_write", "arguments": {"path": "a.txt"}, "tool_call_id": "c2"}, 3),
        (
            "confirm_required",
            {"id": "req-9", "question": "允许写入吗？", "context": {"tool": "file_write", "request_id": "req-9"}},
            3,
        ),
    ):
        recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)
    if finish is not None:
        recorder.finish(finish)
    return run_id


def _legacy_checkpoint(sid: str = SID) -> AgentCheckpoint:
    return AgentCheckpoint(session_id=sid, turn_id="t-legacy", round_idx=7, status="in_progress")


def _seed_crashed_session(tmp_path: Path, sid: str = SID) -> tuple[SessionStore, Path]:
    """Same on-disk shape as tests/test_ha_checkpoint_resume.py: a dangling c2 call."""
    store = SessionStore(tmp_path / "sessions.sqlite")
    sessions_root = tmp_path / "sessions"
    session_dir = sessions_root / sid
    session_dir.mkdir(parents=True)
    (session_dir / "messages.json").write_text(
        json.dumps([{"role": "user", "content": "帮我完成两步任务"}], ensure_ascii=False),
        encoding="utf-8",
    )
    agent_messages = [
        {"role": "user", "content": "帮我完成两步任务"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "todo_write", "arguments": "{}"}}],
        },
        {"role": "tool", "tool_call_id": "c1", "name": "todo_write", "content": "ok"},
        {
            "role": "assistant",
            "content": " ",
            "tool_calls": [{"id": "c2", "type": "function", "function": {"name": "file_write", "arguments": "{}"}}],
        },
    ]
    (session_dir / "agent_messages.json").write_text(
        json.dumps(agent_messages, ensure_ascii=False), encoding="utf-8"
    )
    store._save_session_summary_sync(
        sid,
        "帮我完成两步任务",
        {"execution_state": "running", "created_at": 1.0, "updated_at": 1.0},
    )
    return store, sessions_root


def test_load_resume_anchor_prefers_the_open_ledger_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    sessions_root = tmp_path / "sessions"
    run_id = _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.run_id == run_id
    assert checkpoint.turn_id == "t-crash"
    assert checkpoint.round_idx == 2
    assert [call["id"] for call in checkpoint.pending_tool_calls] == ["c2"]
    assert checkpoint.status == "awaiting_confirm"


def test_load_resume_anchor_falls_back_to_checkpoint_without_open_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root, finish="interrupted")  # closed: nothing to project
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7

    cp_store.clear(SID)
    empty_root = tmp_path / "elsewhere"
    assert load_resume_anchor(SID, sessions_root=empty_root, checkpoint_store=cp_store) is None


def test_switch_off_restores_the_checkpoint_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_FROM_LEDGER", "0")
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7


def test_ha_mode_keeps_the_checkpoint_store_as_recovery_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_HA_MODE", "redis")
    sessions_root = tmp_path / "sessions"
    _open_ledger_run(sessions_root)
    cp_store = _checkpoint_store(tmp_path)
    cp_store.save(_legacy_checkpoint())

    checkpoint = load_resume_anchor(SID, sessions_root=sessions_root, checkpoint_store=cp_store)

    assert checkpoint is not None
    assert checkpoint.turn_id == "t-legacy"
    assert checkpoint.round_idx == 7


async def test_resume_interrupted_sessions_recovers_from_the_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    session_store, sessions_root = _seed_crashed_session(tmp_path)
    run_id = _open_ledger_run(sessions_root)

    manager = SessionManager()
    manager._session_store = session_store
    manager._sessions_root = str(sessions_root)

    # Route the manager's CheckpointStore (constructed internally) to a tmp backend.
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()

    seen: dict[str, Any] = {}

    async def _fake_runner(session_id: str, managed, checkpoint) -> bool:
        seen["round_idx"] = checkpoint.round_idx
        seen["run_id"] = checkpoint.run_id
        seen["turn_id"] = checkpoint.turn_id
        seen["pending_ids"] = [call["id"] for call in checkpoint.pending_tool_calls]
        # AC-3: the open confirmation question is back in the gate.
        pending = managed.confirm_gate.export_state()["pending"]
        seen["pending_confirms"] = [item["request_id"] for item in pending]
        # AC-2: the dispatched call is closed as "outcome unknown", not re-executed.
        closers = [
            message
            for message in managed.studio_session.agent_messages
            if message.get("role") == "tool" and message.get("tool_call_id") == "c2"
        ]
        seen["closer_contents"] = [str(message.get("content")) for message in closers]
        return True

    # No checkpoint is saved anywhere: the ledger alone drives the resume.
    resumed = await manager.resume_interrupted_sessions(runtime_runner=_fake_runner)

    assert resumed == [SID]
    assert seen["round_idx"] == 2  # re-enters at round 3, exactly like the checkpoint path
    assert seen["run_id"] == run_id
    assert seen["turn_id"] == "t-crash"
    assert seen["pending_ids"] == ["c2"]
    assert seen["pending_confirms"] == ["req-9"]
    assert len(seen["closer_contents"]) == 1
    assert "执行结果未知" in seen["closer_contents"][0]
    assert "尚未开始执行" not in seen["closer_contents"][0]
    managed = manager.get(SID, touch=False)
    assert managed is not None
    assert managed.execution_state == "idle"


async def test_in_flight_turn_is_not_overwritten_by_persisted_rows(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_flags(monkeypatch)
    monkeypatch.setenv("AGX_RESUME_INTERRUPTED", "1")
    session_store, sessions_root = _seed_crashed_session(tmp_path)
    _open_ledger_run(sessions_root)

    manager = SessionManager()
    manager._session_store = session_store
    manager._sessions_root = str(sessions_root)
    monkeypatch.setenv("AGX_STORAGE_BACKEND", "local")
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: sessions_root)
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()

    # A newer turn is already in flight in memory: one row the disk does not have.
    managed = manager.get(SID, touch=False)
    assert managed is not None
    in_flight = list(managed.studio_session.agent_messages) + [
        {"role": "user", "content": "新的一轮"}
    ]
    managed.studio_session.agent_messages = list(in_flight)
    seen: dict[str, Any] = {}

    async def _fake_runner(session_id: str, managed, checkpoint) -> bool:
        seen["rows"] = list(managed.studio_session.agent_messages)
        return True

    resumed = await manager.resume_interrupted_sessions(runtime_runner=_fake_runner)

    assert resumed == [SID]
    assert seen["rows"] == in_flight  # nothing lost, no closer synthesized
```

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_ledger_resume_recovery.py -q`。预期失败：前四个测试 `ImportError: cannot import name 'load_resume_anchor'`；端到端测试里 `resumed == []`（没有检查点，旧路径跳过了该会话）。
- [ ] 改 `agenticx/runtime/harden_flags.py`：在 `cancelled_prefix_finalize_enabled`（`harden_flags.py:147`）函数体之后追加：

```python
def resume_from_ledger_enabled() -> bool:
    """``AGX_RESUME_FROM_LEDGER`` / ``runtime.resume_from_ledger``. Default True.

    When on, standalone crash recovery projects its anchor from the replay
    ledger and only falls back to the stored checkpoint when the ledger has no
    open run. When off, recovery reads the checkpoint alone. HA mode always
    reads the checkpoint and ignores this switch.
    """
    return _resolve_bool("AGX_RESUME_FROM_LEDGER", "runtime.resume_from_ledger", True)


def ledger_reattach_enabled() -> bool:
    """``AGX_LEDGER_REATTACH`` / ``runtime.ledger_reattach``. Default True.

    When on, the read-only session stream falls back to the local replay
    ledger when neither the event hub nor the coordination bus can serve a
    reconnecting client. When off, the endpoint answers ``not_running`` as before.
    """
    return _resolve_bool("AGX_LEDGER_REATTACH", "runtime.ledger_reattach", True)
```

- [ ] 改 `agenticx/runtime/checkpoint.py`，三处。

  (a) import 区。before（`checkpoint.py:24-33`）：

```python
import logging
import os
import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.factory import get_sync_storage
```

  after：

```python
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from agenticx.runtime.harden_flags import resume_from_ledger_enabled
from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.factory import get_sync_storage
```

  (b) 在 `resume_interrupted_enabled`（`checkpoint.py:124-148`）之后、文件末尾追加：

```python
def _redis_ha_mode() -> bool:
    """Whether checkpoints are shared across replicas (same rule as ``resume_interrupted_enabled``)."""
    if os.environ.get("AGX_HA_MODE", "").strip().lower() == "redis":
        return True
    return os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower() == "redis"


def load_resume_anchor(
    session_id: str,
    *,
    sessions_root: Any | None = None,
    checkpoint_store: Optional[CheckpointStore] = None,
) -> Optional[AgentCheckpoint]:
    """Load the crash-resume anchor for one session (recovery layering).

    - HA mode: the anchor comes from the checkpoint stored through the storage
      backend, because the ledger only lives on the local disk of the replica
      that hosted the turn.
    - Standalone mode: the anchor is projected from the replay ledger; the
      stored checkpoint is only used when the ledger yields no anchor.
    - ``AGX_RESUME_FROM_LEDGER=0`` restores the checkpoint-only path.
    """
    store = checkpoint_store if checkpoint_store is not None else CheckpointStore()
    if _redis_ha_mode() or not resume_from_ledger_enabled():
        return store.load(session_id)
    try:
        from agenticx.runtime.replay_ledger.resume_anchor import project_resume_anchor
        from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

        ledger = ReplayLedgerStore(Path(sessions_root)) if sessions_root is not None else ReplayLedgerStore()
        projected = project_resume_anchor(ledger, session_id)
    except Exception:
        logger.warning("ledger resume anchor failed session=%s", session_id, exc_info=True)
        projected = None
    if projected is not None:
        return projected
    return store.load(session_id)
```

  (c) `resume_interrupted_enabled` 末尾的 HA 判定（`checkpoint.py:144-148`）改为调用同一个函数，两条路径共用一份规则，不再各写一遍。before：

```python
    ha_mode = os.environ.get("AGX_HA_MODE", "").strip().lower()
    if ha_mode == "redis":
        return True
    storage_kind = os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower()
    return storage_kind == "redis"
```

  after：

```python
    return _redis_ha_mode()
```

  行为不变；`tests/test_ha_checkpoint_resume.py::test_resume_disabled_by_default` 保持通过。

- [ ] 改 `agenticx/studio/session_manager.py`，三处，只精确增删目标行。

  (a) before（`session_manager.py:1173`）：

```python
        from agenticx.runtime.checkpoint import CheckpointStore, resume_interrupted_enabled
```

  after：

```python
        from agenticx.runtime.checkpoint import (
            CheckpointStore,
            load_resume_anchor,
            resume_interrupted_enabled,
        )
```

  (b) before（`session_manager.py:1186-1187`）：

```python
        for sid in interrupted:
            checkpoint = store.load(sid)
```

  after：

```python
        for sid in interrupted:
            checkpoint = load_resume_anchor(
                sid, sessions_root=self._sessions_root, checkpoint_store=store
            )
```

  `resume_interrupted_enabled` 的门控（`session_manager.py:1175`）与 `status == "completed"` 的跳过（`session_manager.py:1188`）不动。

  (c) 修掉「核实结论」第 6 节末条记录的既有缺陷：让 closer 以持久化行为底合成。`self.get(...)` 的冷加载已经把未应答的工具调用从内存副本里 sanitize 掉了，closer 块必须在 sanitize 之前拿到那些行；而持久化行还要先过与加载路径相同的两步附件解析（`materialize_message_lists_image_uploads` 会把 `data:image` 落盘并改写 `attachments`，`sync_agent_messages_attachments_from_chat_history` 会把图片附件补到 user 行上），否则恢复后的上下文会丢图。所以把「读快照 + 解析附件」抽成一个方法，加载路径与恢复路径共用一份，不在恢复路径里重复抄一遍。

  (c-1) `_restore_persisted_state`（`session_manager.py:2610-2625`）。before：

```python
        try:
            raw = self._load_agent_messages_snapshot(session_id)
            if raw:
                from agenticx.runtime.agent_runtime import _sanitize_context_messages
                from agenticx.studio.chat_attachments import (
                    materialize_message_lists_image_uploads,
                    sync_agent_messages_attachments_from_chat_history,
                )

                materialize_message_lists_image_uploads(session_id, [raw])
                sync_agent_messages_attachments_from_chat_history(
                    raw, getattr(session, "chat_history", None) or []
                )
                session.agent_messages = _sanitize_context_messages(raw)
        except Exception:
            pass
```

  after（纯抽取，行为不变）：

```python
        try:
            raw = self._load_agent_messages_for_context(session_id, session)
            if raw:
                from agenticx.runtime.agent_runtime import _sanitize_context_messages

                session.agent_messages = _sanitize_context_messages(raw)
        except Exception:
            pass
```

  (c-2) 紧跟在 `_load_agent_messages_snapshot`（`session_manager.py:2987-2988`）之后新增方法：

```python
    def _load_agent_messages_for_context(
        self, session_id: str, session: StudioSession
    ) -> list[dict]:
        """Persisted agent messages with attachments resolved, before sanitizing."""
        raw = self._load_agent_messages_snapshot(session_id)
        if not raw:
            return []
        from agenticx.studio.chat_attachments import (
            materialize_message_lists_image_uploads,
            sync_agent_messages_attachments_from_chat_history,
        )

        materialize_message_lists_image_uploads(session_id, [raw])
        sync_agent_messages_attachments_from_chat_history(
            raw, getattr(session, "chat_history", None) or []
        )
        return raw
```

  (c-3) `_resume_single_session` 的 closer 块（`session_manager.py:1238-1245`）。before：

```python
            raw = getattr(session, "agent_messages", None) or []
            if interrupted_closers_enabled():
                dispatched = [
                    str(c.get("id", "")).strip()
                    for c in (getattr(checkpoint, "pending_tool_calls", None) or [])
                    if isinstance(c, dict) and str(c.get("id", "")).strip()
                ]
                raw = close_interrupted_tool_calls(raw, dispatched_call_ids=dispatched)
```

  after（多一段守卫，替换原来的取底行；守卫的由来见「实施后评审处置」第 2 行）：

```python
            raw = getattr(session, "agent_messages", None) or []
            if interrupted_closers_enabled():
                dispatched = [
                    str(c.get("id", "")).strip()
                    for c in (getattr(checkpoint, "pending_tool_calls", None) or [])
                    if isinstance(c, dict) and str(c.get("id", "")).strip()
                ]
                # Use the persisted rows only while the in-memory copy is still
                # the pristine cold load: sanitizing the persisted rows must
                # reproduce it exactly. Otherwise a newer turn is in flight and
                # its in-memory rows win.
                persisted = self._load_agent_messages_for_context(session_id, session)
                if persisted and _sanitize_context_messages(persisted) == raw:
                    raw = persisted
                raw = close_interrupted_tool_calls(raw, dispatched_call_ids=dispatched)
```

  什么时候以持久化行为准：仅当内存副本仍是冷加载的原样，即把持久化行再 sanitize 一遍能逐行还原出内存副本时。冷加载时内存副本就是这样得来的，所以崩溃后直接恢复的常规场景一定相等。启动扫描是逐会话 `await` 整轮的，排在后面的会话可能已被用户先发了消息，内存里多出持久化行没有的新行，这时不相等，内存副本胜出：不合成 closer，也不丢数据，行为与改动前一致（`test_in_flight_turn_is_not_overwritten_by_persisted_rows`）。closer 合成之后仍然过 `_sanitize_context_messages`：被标注的调用现在有了应答，所在的 assistant 行得以保留，上下文对 provider 合法。closer 行的 `metadata.kind` 不在 sanitize 的过滤名单里，恢复成功后随 `persist_async` 落盘，之后正常加载也不会被丢。开关 `AGX_INTERRUPTED_CLOSERS=0` 时不走这一支，行为与改动前完全一致。

  这一处修复对三条恢复路径同时生效：账本投影、检查点回落（含开关关闭）、HA。它是 bug 修复而不是新的行为：closer 机制本来就为此设计，只是从未在冷重启路径上起过作用。`agenticx/runtime/agent_runtime.py` 与 `agenticx/runtime/interrupted_closers.py` 都不改。

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_ledger_resume_recovery.py tests/test_ha_checkpoint_resume.py tests/test_smoke_interrupted_closers.py tests/test_runtime_interrupted_stream.py tests/test_session_manager_persistence.py -q`。预期全部通过。`tests/test_ha_checkpoint_resume.py::test_resume_from_checkpoint`（没有账本、只有检查点）必须保持通过，它就是回落路径的回归；它的 runner 会用真实的 `AgentRuntime.run_turn` 消费恢复后的上下文，等于顺带验证带 closer 的上下文能被运行时接受。加了 `tests/test_session_manager_persistence.py` 是因为步骤 (c-1) 动了 `_restore_persisted_state`。

  `tests/test_ledger_resume_recovery.py::test_resume_interrupted_sessions_recovers_from_the_ledger` 里关于 closer 的三条断言（恰好一条、含「执行结果未知」、不含「尚未开始执行」）依赖步骤 (c)：不做 (c) 时它在 `len(seen["closer_contents"]) == 1` 处失败（实测 `0 == 1`）。不要为了让它通过去删这三条断言，那是 AC-2 的落点。

### Task 5 — FR-5 重连回落到账本与游标桥接

文件：
- `agenticx/runtime/replay_ledger/reattach.py`（Create）
- `agenticx/studio/server.py`（Modify）
- `tests/test_ledger_reattach_stream.py`（Create，Test）

依赖 Task 3（复用 `find_open_run`、`read_run_events`）与 Task 4（`ledger_reattach_enabled` 开关）。

**改 `agenticx/studio/server.py` 的纪律**：顶部 import 区极其敏感。只精确增删目标行，禁止整段替换相邻无关行。本任务对 `server.py` 只有两处改动，每一处都要在 diff 里确认只有计划内的行发生变化。`agx serve` 冷启动冒烟是本任务的强制验收步骤（见步骤末尾与 Verification）。

步骤：

- [ ] 写失败的测试 `tests/test_ledger_reattach_stream.py`（完整内容）：

```python
"""Tests for the session stream reattach fallback to the replay ledger.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
import pytest

import agenticx.studio.server as server_module
from agenticx.cli.config_manager import ConfigManager
from agenticx.cli.studio import StudioSession
from agenticx.memory.session_store import SessionStore
from agenticx.runtime.events import RuntimeEvent
from agenticx.runtime.replay_ledger import ReplayLedgerStore
from agenticx.runtime.replay_ledger.reattach import format_ledger_cursor, parse_ledger_cursor, read_reattach_replay
from agenticx.runtime.replay_ledger.recorder import ReplayLedgerRecorder
from agenticx.studio.server import create_studio_app

SID = "ledger-reattach-1"


def _parse_sse(text: str) -> tuple[list[dict], list[str]]:
    events: list[dict] = []
    ids: list[str] = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("id: "):
                ids.append(line[4:].strip())
            elif line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events, ids


async def _app_with_crashed_turn(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> tuple[object, str, ReplayLedgerRecorder]:
    """A session whose turn was cut by a crash: no live hub, an open run in the ledger."""
    monkeypatch.setattr(ConfigManager, "get_value", lambda key, default=None: None)
    for name in ("AGX_LEDGER_REATTACH", "AGX_HA_MODE", "AGX_STORAGE_BACKEND"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(server_module, "live_reattach_enabled", lambda: True)

    app = create_studio_app()
    manager = app.state.session_manager
    manager._sessions_root = str(tmp_path / "sessions")
    manager._session_store = SessionStore(tmp_path / "sessions.sqlite")
    # Keep the session files written by create() inside tmp_path as well.
    from agenticx.studio.storage import factory as storage_factory

    monkeypatch.setattr(storage_factory, "_default_sessions_root", lambda: tmp_path / "sessions")
    monkeypatch.setattr(storage_factory, "_default_config_dir", lambda: tmp_path / "cfg")
    storage_factory.reset_storage_backend_for_testing()
    manager.create(session_id=SID)
    manager.set_execution_state(SID, "running")

    store = ReplayLedgerStore(Path(manager._sessions_root))
    recorder = ReplayLedgerRecorder(
        store=store, session_id=SID, agent_id="meta", provider="test", model="test-model"
    )
    run_id = recorder.start_turn(turn_id="turn-reattach", user_input="帮我完成两步任务")
    for event_type, data, round_idx in (
        ("round_start", {"round": 3}, 3),
        ("tool_call", {"name": "todo_write", "arguments": {"todos": []}, "tool_call_id": "c2"}, 3),
        (
            "confirm_required",
            {"id": "req-9", "question": "允许写入吗？", "context": {"tool": "todo_write", "request_id": "req-9"}},
            3,
        ),
    ):
        recorder.observe(RuntimeEvent(event_type, data), session=StudioSession(), round_idx=round_idx)
    # seq 1 = run_started, 2 = user_message (both skipped on replay), 3..5 = the turn's structure
    return app, run_id, recorder


async def _stream(app: object, headers: dict | None = None) -> str:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        response = await ac.get(f"/api/sessions/{SID}/stream", headers=headers)
        assert response.status_code == 200
        return response.text


def test_ledger_cursor_roundtrip_and_plain_integers_are_not_ledger_cursors() -> None:
    cursor = format_ledger_cursor("run-abc", 12)

    assert cursor == "ledger:run-abc:12"
    assert parse_ledger_cursor(cursor) == ("run-abc", 12)
    assert parse_ledger_cursor("57") is None
    assert parse_ledger_cursor("ledger:run-abc") is None
    assert parse_ledger_cursor(None, "57", cursor) == ("run-abc", 12)  # first match wins


async def test_stale_live_seq_after_restart_replays_the_crashed_turn_from_the_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    events, ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events[0]["type"] == "replay_gap"
    assert events[0]["data"] == {
        "since": "57",
        "oldest_buffered": format_ledger_cursor(run_id, 3),
        "source": "ledger",
    }
    assert [event["type"] for event in events[1:-1]] == ["round_start", "tool_call", "confirm_required"]
    assert events[1]["data"]["round"] == 3
    assert events[2]["data"]["name"] == "todo_write"
    assert events[2]["data"]["tool_call_id"] == "c2"
    assert events[3]["data"]["id"] == "req-9"
    assert events[-1] == {"type": "done", "data": {"reason": "replayed_from_ledger"}}
    assert ids == [format_ledger_cursor(run_id, seq) for seq in (3, 4, 5)]


async def test_second_client_without_cursor_reads_the_same_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    first, _ = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))
    second_text, third_text = await asyncio.gather(_stream(app), _stream(app))
    second, second_ids = _parse_sse(second_text)
    third, third_ids = _parse_sse(third_text)

    assert second[0]["type"] == "round_start"  # no cursor, no gap notice
    assert second_ids == third_ids == [format_ledger_cursor(run_id, seq) for seq in (3, 4, 5)]
    assert second[0] == first[1]
    assert second[1] == first[2]
    assert second[2] == first[3]
    assert second[-1]["data"]["reason"] == "replayed_from_ledger"


async def test_ledger_cursor_resumes_after_that_event(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    events, ids = _parse_sse(
        await _stream(app, headers={"Last-Event-ID": format_ledger_cursor(run_id, 3)})
    )

    assert [event["type"] for event in events] == ["tool_call", "confirm_required", "done"]
    assert ids == [format_ledger_cursor(run_id, 4), format_ledger_cursor(run_id, 5)]


async def test_switch_off_keeps_the_not_running_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    monkeypatch.setenv("AGX_LEDGER_REATTACH", "0")

    events, ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]
    assert ids == []


async def test_closed_run_is_not_replayed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    recorder.finish("completed")

    events, _ids = _parse_sse(await _stream(app))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


async def test_open_run_with_idle_session_is_not_replayed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)
    app.state.session_manager.set_execution_state(SID, "idle")

    events, _ids = _parse_sse(await _stream(app))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


async def test_ledger_read_failure_answers_not_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app, _run_id, _recorder = await _app_with_crashed_turn(tmp_path, monkeypatch)

    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("ledger unreadable")

    monkeypatch.setattr(server_module, "read_reattach_replay", _boom)
    events, _ids = _parse_sse(await _stream(app, headers={"Last-Event-ID": "57"}))

    assert events == [{"type": "done", "data": {"reason": "not_running"}}]


def test_summarized_event_whose_blob_is_missing_is_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ReplayLedgerStore(tmp_path)
    recorder = ReplayLedgerRecorder(
        store=store, session_id=SID, agent_id="meta", provider="test", model="test-model"
    )
    recorder.start_turn(turn_id="turn-blob", user_input="go")
    big = {"command": "echo " + "y" * 5000}
    recorder.observe(
        RuntimeEvent("confirm_required", {"id": "req-big", "question": "?", "context": big}),
        session=StudioSession(),
        round_idx=1,
    )
    monkeypatch.setattr(ReplayLedgerStore, "read_blob", lambda self, run_id, ref: None)

    replay = read_reattach_replay(str(tmp_path), SID, "running")

    assert replay is not None
    assert replay["rows"] == []
```

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_ledger_reattach_stream.py -q`。预期失败：收集阶段报 `ModuleNotFoundError: No module named 'agenticx.runtime.replay_ledger.reattach'`。
- [ ] 新建 `agenticx/runtime/replay_ledger/reattach.py`（完整内容）：

```python
"""Read-only reattach fallback that replays a crash-interrupted turn from the
local replay ledger, plus the cursor bridge between the three sequence spaces.

Cursor bridge (three numbering spaces that are deliberately not unified):

* live seq   -- ``SessionEventHub._seq``. A plain integer emitted as the SSE
                ``id:`` on the live path. Lives only as long as one hub
                instance (one turn, one process); never persisted.
* bus cursor -- Redis ``INCR ev:sess:{sid}:seq``. A plain integer that
                survives restarts and replicas while the capped log keeps the
                row. On the inactive-hub path the reader treats a plain integer
                as a bus cursor first.
* ledger seq -- the run's ``events.jsonl`` sequence. Durable forever. Exposed
                to clients only in the namespaced form
                ``ledger:<run_id>:<seq>``.

A cursor is only valid in its own space; no numeric conversion between spaces
exists or is promised. A plain-integer cursor that resolves against neither a
live hub nor the bus is reported to the client as a ``replay_gap`` before the
ledger replay starts.

Author: Damon Li
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.replay_ledger.contracts import RunEvent, is_payload_summary
from agenticx.runtime.replay_ledger.resume_anchor import find_open_run, read_run_events
from agenticx.runtime.replay_ledger.store import ReplayLedgerStore

LEDGER_CURSOR_PREFIX = "ledger:"
LEDGER_CURSOR_PATTERN = re.compile(r"^ledger:([A-Za-z0-9._:-]{1,128}):(\d{1,18})$")

# Ledger event types whose payload was persisted as-is and whose SSE shape is
# the ledger payload itself.
_PASSTHROUGH_TYPES = frozenset(
    {
        EventType.CONFIRM_REQUIRED.value,
        EventType.CONFIRM_RESPONSE.value,
        EventType.CLARIFICATION_REQUIRED.value,
        EventType.CLARIFICATION_RESPONSE.value,
        EventType.CLARIFICATION_SUSPENDED.value,
        EventType.COMPACTION.value,
        EventType.CONTEXT_STATS.value,
        EventType.STALL.value,
        EventType.ERROR.value,
        EventType.TOOL_PROGRESS.value,
    }
)
_INTERRUPTED_STATES = frozenset({"running", "interrupted"})


def parse_ledger_cursor(*raw_values: str | None) -> tuple[str, int] | None:
    """Return ``(run_id, seq)`` from the first value shaped like a ledger cursor."""
    for raw in raw_values:
        match = LEDGER_CURSOR_PATTERN.fullmatch(str(raw or "").strip())
        if match:
            return match.group(1), int(match.group(2))
    return None


def format_ledger_cursor(run_id: str, seq: int) -> str:
    """Format the namespaced SSE id of one ledger event."""
    return f"{LEDGER_CURSOR_PREFIX}{run_id}:{int(seq)}"


def ledger_event_to_runtime_event(store: ReplayLedgerStore, event: RunEvent) -> RuntimeEvent | None:
    """Rebuild the runtime event behind one ledger event, or None if it has no SSE form."""
    if event.type == "round_started":
        payload = store.resolve_payload(event)
        if is_payload_summary(payload):
            return None  # the full payload lived in a blob that is no longer readable
        return RuntimeEvent(
            type=EventType.ROUND_START.value,
            data=dict(payload) if isinstance(payload, dict) else {},
            agent_id=event.agent_id,
        )
    if event.type in _PASSTHROUGH_TYPES:
        payload = store.resolve_payload(event)
        if is_payload_summary(payload):
            return None  # the full payload lived in a blob that is no longer readable
        return RuntimeEvent(
            type=event.type,
            data=dict(payload) if isinstance(payload, dict) else {},
            agent_id=event.agent_id,
        )
    if not event.payload_ref:
        return None
    blob = store.read_blob(event.run_id, event.payload_ref)
    if not isinstance(blob, dict):
        return None
    if event.type == "tool_call":
        arguments = blob.get("arguments")
        return RuntimeEvent(
            type=EventType.TOOL_CALL.value,
            data={
                "name": str(blob.get("name") or ""),
                "arguments": arguments if isinstance(arguments, dict) else {},
                "tool_call_id": str(event.tool_call_id or ""),
            },
            agent_id=event.agent_id,
        )
    if event.type == "tool_result":
        data = {
            "name": str(blob.get("name") or ""),
            "result": blob.get("result"),
            "tool_call_id": str(event.tool_call_id or ""),
        }
        if "structured" in blob:
            data["structured"] = blob["structured"]
        return RuntimeEvent(type=EventType.TOOL_RESULT.value, data=data, agent_id=event.agent_id)
    if event.type == "assistant_output_completed":
        return RuntimeEvent(type=EventType.FINAL.value, data=dict(blob), agent_id=event.agent_id)
    return None


def read_reattach_replay(
    sessions_root: Path | str,
    session_id: str,
    execution_state: str,
    *,
    after: tuple[str, int] | None = None,
) -> dict[str, Any] | None:
    """Read the SSE-replayable events of the session's crash-interrupted turn.

    Returns ``{"run_id": str, "rows": [(cursor, RuntimeEvent), ...]}``, or None
    when the ledger has nothing to replay for this session.
    """
    if str(execution_state or "").strip() not in _INTERRUPTED_STATES:
        return None
    store = ReplayLedgerStore(Path(sessions_root))
    record = find_open_run(store, session_id)
    if record is None:
        return None
    start_seq = 0
    if after is not None and after[0] == record.run_id:
        start_seq = int(after[1])
    rows: list[tuple[str, RuntimeEvent]] = []
    for event in read_run_events(store, record.run_id):
        if int(event.seq) <= start_seq:
            continue
        runtime_event = ledger_event_to_runtime_event(store, event)
        if runtime_event is None:
            continue
        rows.append((format_ledger_cursor(record.run_id, int(event.seq)), runtime_event))
    return {"run_id": record.run_id, "rows": rows}
```

- [ ] 改 `agenticx/studio/server.py`，两处。只精确增删目标行，禁止整段替换相邻无关行。

  (a) 顶部 import 区。在 `server.py:84` 这一行之后精确插入一行：

```python
from agenticx.runtime.replay_ledger.reattach import parse_ledger_cursor, read_reattach_replay
```

  (b) 重连端点 `_reattach_stream`。before（`server.py:5616-5620`）：

```python
                    if rows:
                        yield 'data: {"type":"done","data":{"reason":"replayed_from_store"}}\n\n'
                        return
                yield 'data: {"type":"done","data":{"reason":"not_running"}}\n\n'
                return
```

  after：

```python
                    if rows:
                        yield 'data: {"type":"done","data":{"reason":"replayed_from_store"}}\n\n'
                        return
                # Ledger fallback: a turn cut by a crash leaves its run open in
                # the local replay ledger, which the in-memory hub and the
                # in-process bus do not survive. Replay it with namespaced cursors.
                from agenticx.runtime.harden_flags import ledger_reattach_enabled

                if ledger_reattach_enabled():
                    ledger_cursor = parse_ledger_cursor(since, last_event_id)
                    try:
                        replay = await asyncio.to_thread(
                            read_reattach_replay,
                            str(manager._sessions_root),
                            sid,
                            str(getattr(managed, "execution_state", "") or ""),
                            after=ledger_cursor,
                        )
                    except Exception:
                        replay = None
                    if replay is not None:
                        client_cursor = str(since or last_event_id or "").strip()
                        if client_cursor and (
                            ledger_cursor is None or ledger_cursor[0] != replay["run_id"]
                        ):
                            gap = SseEvent(
                                type="replay_gap",
                                data={
                                    "since": client_cursor,
                                    "oldest_buffered": replay["rows"][0][0] if replay["rows"] else None,
                                    "source": "ledger",
                                },
                            )
                            yield f"data: {json.dumps(gap.model_dump(), ensure_ascii=False)}\n\n"
                        for cursor, ledger_event in replay["rows"]:
                            yield f"id: {cursor}\n"
                            for line in _runtime_event_to_sse_lines(ledger_event):
                                yield line
                        yield 'data: {"type":"done","data":{"reason":"replayed_from_ledger"}}\n\n'
                        return
                yield 'data: {"type":"done","data":{"reason":"not_running"}}\n\n'
                return
```

  说明：`asyncio`（`server.py:9`）、`json`（`server.py:13`）、`SseEvent`（`server.py:103-110` 的导入块）、`_runtime_event_to_sse_lines`（`server.py:1120`）、`manager._sessions_root`、`since` / `last_event_id`（`server.py:5604-5606` 已在用）都是现有名字，不需要再引入。`ledger_reattach_enabled` 按该文件对 `harden_flags` 的既有做法做函数内延迟导入。总线块（`server.py:5601-5618`）一个字符都不改。

- [ ] 运行（待实施时执行）：`.venv/bin/python -m pytest tests/test_ledger_reattach_stream.py tests/test_smoke_group_reattach_hub.py tests/test_smoke_session_event_hub.py -q`。预期全部通过。
- [ ] **冷启动冒烟（强制）**（待实施时执行）：

```bash
.venv/bin/agx serve --host 127.0.0.1 --port 8769
```

  启动后另开终端执行 `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8769/api/health`，预期输出 `200`。然后 Ctrl-C 结束进程。任何 import 错误、循环导入或启动失败都算本任务不通过。`/api/health` 的定义在 `server.py:5704`。

### Task 6 — 回归

文件：无新增，无修改。

- [x] 基线（2026-11-28 在 `main` @ `90a53345`、分支 `feat/runtime-invariants` 起点上实测）：`.venv/bin/python -m pytest tests/test_replay_ledger_store.py tests/test_replay_ledger_recorder.py tests/test_run_context_checkpoint.py tests/test_run_replay_api.py tests/test_run_replay_export.py tests/test_run_branch_service.py tests/test_run_branch_api.py tests/test_run_workspace_snapshot.py tests/test_ha_checkpoint_resume.py tests/test_smoke_interrupted_closers.py tests/test_runtime_interrupted_stream.py tests/test_smoke_session_event_hub.py tests/test_smoke_group_reattach_hub.py tests/test_session_manager_persistence.py tests/test_enterprise_trace.py -q`。结果：283 passed, 1 skipped, 0 failed，42 秒。跳过的 1 个是缺 fakeredis 的 redis 用例。
- [x] 全量回归（2026-11-28 实施后实测，结果与预期一致）：同一条命令，加上五个新测试文件：`tests/test_replay_ledger_upcast.py tests/test_replay_ledger_payload_summary.py tests/test_replay_ledger_resume_anchor.py tests/test_ledger_resume_recovery.py tests/test_ledger_reattach_stream.py`。预期：通过数等于基线通过数加 41（新测试文件共 41 个用例：10 + 5 + 11 + 6 + 9；upcast 文件里的参数化用例按 4 个计），失败数为 0，即 324 passed, 1 skipped。
- [x] 门禁自检（2026-11-28 实施后实测，结果与预期一致）：

```bash
git grep -n -F -e 'run_dir / "events.jsonl"' -e 'runs/*/events.jsonl' -- agenticx | grep -v "agenticx/runtime/replay_ledger/"
git grep -n "save_agent_state(" -- agenticx | grep -v -e "agenticx/runtime/checkpoint.py" -e "agenticx/studio/storage/"
```

  预期：第一条输出恰好 2 行（`agenticx/runtime/session_perf.py:37`、`agenticx/skills/agenticx-agent-obs/scripts/diagnose_traces.py:42`），第二条输出为空（`save_agent_state(` 只允许出现在 `agenticx/runtime/checkpoint.py` 与 `agenticx/studio/storage/`）。两条都在 `main` @ `90a53345` 上实测过：前一条 2 行、后一条 0 行。

  匹配口径与 master plan 02 的规则（1）一致：按这两段字面精确匹配。不要换成宽匹配 `events.jsonl`，那样会把 `agenticx/runtime/studio_safety.py:14,41,332` 的安全审计日志同名算进来（实测 5 行）。

## 实施后评审处置

实施完成、主会话独立验收通过后，由一位独立评审员做代码质量评审，主会话逐条核实后处置如下。

| 评审意见 | 处置 | 落点 |
| --- | --- | --- |
| 账本回放没有异常兜底，出错会在响应头发出后打断 SSE 流 | 采纳：读取包进 try/except，出错落到 `not_running`，与总线分支一致 | `server.py` 回落块；`test_ledger_read_failure_answers_not_running` |
| closer 以持久化行为底，会覆盖更新的内存副本（启动扫描逐会话 await，排队中的会话可能已被用户先发消息） | 采纳，但不用评审员建议的「复查 interrupted」：崩溃会话在盘上就是 `running`，那样会把正常场景全跳过。改为仅当持久化行 sanitize 后与内存副本完全相等（仍是冷加载原样）才取持久化行 | `session_manager.py` closer 块；`test_in_flight_turn_is_not_overwritten_by_persisted_rows` |
| blob 丢失时透传类型会把摘要信封当作 SSE data 发出 | 采纳：解析后仍是摘要就跳过该事件 | `reattach.py`；`test_summarized_event_whose_blob_is_missing_is_skipped` |
| `find_open_run` 只在未关闭的 run 里取最新，旧的未关闭 run 会盖住新回合的检查点（评审员列为 Minor，主会话升级为必须修：它让风险表里「开始新回合后旧 run 不再是最新且未关闭」这句话不成立） | 采纳：只有会话最新的 run 自身未关闭才投影 | `resume_anchor.py`；`test_stale_open_run_does_not_shadow_a_newer_turn` |
| 新代码用 `Any` 标注事件类型 | 采纳：改为 `RunEvent` / `ReplayRunRecord` | `resume_anchor.py`、`reattach.py` |
| `enterprise_trace.py` 仍直读 `event.payload["text"]`，超限的 `error` 事件摘要为空 | 不采纳：这是风险表已明示接受的一项，且该文件在本 plan 范围之外；需要时另开任务改用 `resolve_payload` | 无 |
| 新增行有超过 88 列的 | 不采纳：仓库没有 lint 门禁，周边既有代码同样超宽 | 无 |

## 交付约定

- 实施者（subagent）只改本 plan 列出的文件，不提交、不推送、不动分支；每条验证命令连同实际输出原样贴回。
- 主会话独立复跑 Verification 的命令、审 diff、核对范围：`git status --short` 里不得出现本 plan 之外的文件。
- 验收通过后由主会话把本文件从 `.cursor/plans/pending/` 移到 `.cursor/plans/`，`Status` 改为 `implemented`，只 `git add` 本 plan 的文件，提交一个 commit。提交标题用 `feat(replay-ledger): converge crash resume and reattach onto the event ledger`，trailer 见文末。

## Suggested impl models

- GLM-5.4：落点全部精确到行、代码全部给全、测试沿用现有夹具写法，属于按图施工的中等体量改动；唯一的敏感点是 `server.py` 的 import 区，已用「只加一行 + 冷启动冒烟」约束住。

## Verification

实施后复跑（2026-11-28，解释器 `/opt/miniconda3/bin/python3`）：Task 1–5 各命令全部通过；全量回归 324 passed, 1 skipped，15 秒；门禁第一条 2 行、第二条为空；`server.py` 冷启动冒烟 `/api/health` 返回 200，无 import 错误。下文保留计划原文的命令与预期。

**基线**（待实施时执行，改代码之前）：

```bash
.venv/bin/python -m pytest tests/test_replay_ledger_store.py tests/test_replay_ledger_recorder.py tests/test_run_context_checkpoint.py tests/test_run_replay_api.py tests/test_run_replay_export.py tests/test_run_branch_service.py tests/test_run_branch_api.py tests/test_run_workspace_snapshot.py tests/test_ha_checkpoint_resume.py tests/test_smoke_interrupted_closers.py tests/test_runtime_interrupted_stream.py tests/test_smoke_session_event_hub.py tests/test_smoke_group_reattach_hub.py tests/test_session_manager_persistence.py tests/test_enterprise_trace.py -q
```

**各任务命令**（待实施时执行）：

| 任务 | 命令 |
| --- | --- |
| Task 1 | `.venv/bin/python -m pytest tests/test_replay_ledger_upcast.py tests/test_replay_ledger_store.py -q` |
| Task 2 | `.venv/bin/python -m pytest tests/test_replay_ledger_payload_summary.py tests/test_replay_ledger_recorder.py tests/test_run_replay_export.py tests/test_run_replay_api.py tests/test_enterprise_trace.py -q` |
| Task 3 | `.venv/bin/python -m pytest tests/test_replay_ledger_resume_anchor.py -q` |
| Task 4 | `.venv/bin/python -m pytest tests/test_ledger_resume_recovery.py tests/test_ha_checkpoint_resume.py tests/test_smoke_interrupted_closers.py tests/test_runtime_interrupted_stream.py tests/test_session_manager_persistence.py -q` |
| Task 5 | `.venv/bin/python -m pytest tests/test_ledger_reattach_stream.py tests/test_smoke_group_reattach_hub.py tests/test_smoke_session_event_hub.py -q` |
| Task 6 | 基线命令加五个新测试文件；预期通过数 = 基线通过数 + 41 |

**闭环判据逐条对应**（master plan 总览表 01 的「闭环」列与 Verification 第 1、2 条）：

| 判据 | 自动化验证 | 断言落点 |
| --- | --- | --- |
| AC-1 单机重启后回合从账本恢复 | `tests/test_ledger_resume_recovery.py::test_resume_interrupted_sessions_recovers_from_the_ledger` | 磁盘上没有保存任何检查点，`resumed == [SID]`，runner 拿到账本 run 的 `run_id` / `turn_id`，`round_idx == 2` |
| AC-2 未完成的工具调用不重放 | 同上；`tests/test_replay_ledger_resume_anchor.py::test_gapped_run_is_not_projected` | 上下文里 `c2` 恰好有一条 closer，内容含「执行结果未知」、不含「尚未开始执行」；runner 只被调用一次。账本有缺口时不投影、回落检查点。closer 能出现在上下文里依赖 Task 4 步骤 (c) 对既有缺陷的修复 |
| AC-3 确认门状态不倒退 | 同上；`tests/test_replay_ledger_resume_anchor.py::test_unanswered_confirm_is_projected_as_awaiting_confirm` | 恢复后 `managed.confirm_gate.export_state()["pending"]` 含 `req-9` |
| AC-4 HA 副本接管恢复与改动前一致 | `tests/test_ledger_resume_recovery.py::test_ha_mode_keeps_the_checkpoint_store_as_recovery_source`；`tests/test_ha_checkpoint_resume.py` 全文件不改且保持通过 | HA 模式下锚点来自检查点（`turn_id == "t-legacy"`），即使账本里有未关闭的 run |
| AC-5 客户端甲带旧 `Last-Event-ID` 重连，历史完整 | `tests/test_ledger_reattach_stream.py::test_stale_live_seq_after_restart_replays_the_crashed_turn_from_the_ledger` | 先收到 `replay_gap`，再收到该回合全部结构事件（`round_start`、`tool_call`、`confirm_required`），最后 `replayed_from_ledger` |
| AC-6 客户端乙并发接入读到同一份历史 | `tests/test_ledger_reattach_stream.py::test_second_client_without_cursor_reads_the_same_history` | 两个并发客户端的 `id:` 序列相同，事件逐条等于甲收到的对应事件 |

**开关关闭时回到旧路径**（待实施时执行）：

- `AGX_RESUME_FROM_LEDGER=0`：`tests/test_ledger_resume_recovery.py::test_switch_off_restores_the_checkpoint_path` 断言恢复读取检查点（`turn_id == "t-legacy"`，`round_idx == 7`），即使账本里有未关闭的 run。
- `AGX_LEDGER_REATTACH=0`：`tests/test_ledger_reattach_stream.py::test_switch_off_keeps_the_not_running_answer` 断言响应恰好是 `{"type":"done","data":{"reason":"not_running"}}`。
- 两个开关都不影响 upcast 与载荷尺寸闸：upcast 对已带版本号的行是恒等的；尺寸闸只作用于新写入的超限行，旧行原样可读。

**`server.py` 冷启动冒烟**（待实施时执行，Task 5 强制）：

```bash
.venv/bin/agx serve --host 127.0.0.1 --port 8769
```

另开终端：`curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8769/api/health`，预期 `200`（端点定义在 `server.py:5704`）。若设置了 `AGX_DESKTOP_TOKEN`，请求要带 `X-AGX-Desktop-Token` 头（`server.py:2107`、`server.py:2320-2324`）。

**SDK 层真机验收**（本 plan 未执行，留到 master plan 的端到端验收；自动化覆盖见上表。两个客户端直接调 HTTP 与 SSE，不做 UI）：

已核实的事实：会话创建端点是 `GET /api/session`（`server.py:2939`，响应里的 `session_id` 即新会话）；发起对话的端点是 `POST /api/chat`（`server.py:3751`，JSON 请求体带 `session_id` 与 `user_input`，用法见 `tests/test_smoke_group_reattach_hub.py:167-174`）；只读重连端点是 `GET /api/sessions/{session_id}/stream`（`server.py:5566`），它受 `live_reattach_enabled()` 门控（`server.py:5580`，默认关闭，开关解析在 `agenticx/studio/continuation.py`），可选请求头 `Last-Event-ID` 与查询参数 `since`（`server.py:5569-5571`）。

步骤：

1. 开启实时重连开关，启动 `agx serve`，创建会话并记下 `session_id`。
2. 客户端甲接入该会话的事件流，用 `POST /api/chat` 发起一次会进入多轮工具调用的对话，记下甲收到的最后一条 `id:`。
3. 回合进行中对服务进程 `kill -9`。
4. 重新启动 `agx serve`。甲带 `Last-Event-ID: <最后一条 id>` 请求 `/api/sessions/<session_id>/stream`。预期：首条是 `replay_gap`，随后是被截断回合的全部结构事件，`id:` 形如 `ledger:<run_id>:<seq>`，末条是 `done/replayed_from_ledger`。
5. 客户端乙不带游标并发请求同一端点。预期：没有 `replay_gap`，事件与甲收到的结构事件逐条一致，`id:` 序列相同。
6. 若同时开启了 `AGX_RESUME_INTERRUPTED=1`，重启后会话应自动续跑（AC-1），续跑完成后再次重连应回到 `not_running`，不再回放。

## 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| `server.py` import 区被误改 | 服务冷启动失败，全部接口不可用 | 只加一行；Task 5 与 Verification 都把冷启动冒烟列为强制步骤 |
| R-1 规则在「轮次顶部检查点已写、`ROUND_START` 尚未被观察」的窗口内比起检查点路径早一轮 | 恢复后的回合多一轮标签、多一轮预算；窗口只有几条同步语句 | 接受。备选规则会让起始轮超过 `max_tool_rounds` 时直接耗尽，更差（D3 备选 B） |
| 有缺口的 run 仍会被重连端点回放 | 客户端拿到的历史可能少事件，且没有提示 | 接受。回放是只读的，比改动前的「什么都收不到」更接近完整；恢复路径不受影响，它对有缺口的 run 回落检查点 |
| 账本优先于检查点：两者指向不同 turn 时以账本为准 | 检查点因清理失败而残留时，恢复的是账本里真正未关闭的那个回合 | 这是期望行为；账本给不出锚点时仍回落检查点 |
| 超过 4096 字节的 `error` 事件，行内只剩 head | `enterprise_trace` 的错误摘要只能取到 head；回放 API 的 events 端点不带 `include_payload=true` 时也只看到摘要 | 接受。全文在 blob 里可取；`enterprise_trace.py` 不在本 plan 改动范围 |
| 带旧 live seq 的客户端会收到整个未关闭回合 | 不做去重的客户端会看到一次重复 | 先下发 `replay_gap` 明示游标无法映射；比改动前的「什么都收不到」更接近「历史完整」 |
| 单机模式下扫描不运行（恢复默认关闭），`execution_state` 重启后仍是 `running` | 每次重连都会回放同一个未关闭回合，直到新回合开始 | 这是预期：历史始终完整；开始新回合后旧 run 不再是「最新且未关闭」 |
| 账本读取在 `asyncio.to_thread` 里执行 | 阻塞事件循环的风险 | `ReplayLedgerStore` 每个 run 有独立的线程锁；`server.py:486-516` 已有同样的用法 |
| 导出端点 `/api/runs/{run_id}/export` 的已解析字节上限，现在也会计入被转存的映射事件与 `user_message`（`run_replay_routes.py:204-235`） | 粘贴过多份大文档的 run 更早触发 `413 export_too_large` | 接受。改动前这些载荷行内导出、不计入上限；全文仍在 blob 里，回放 API 按需取 |
| 会话停在 `running`（单机恢复默认关闭）时每次重连都会调 `list_runs`，它对该会话每个 run 整文件读一次 `events.jsonl` 做统计对账（`store.py:374-387`） | 历史多、体量大的会话，单次重连多花读盘时间 | 读取在 `asyncio.to_thread` 里，不阻塞事件循环；会话回到 `idle` 后在状态判断处直接返回，不再读账本 |
| Task 4 步骤 (c) 让 closer 在冷重启恢复时真正生效，HA 与检查点回落路径也随之改变 | 这三条路径恢复后的上下文多出「未开始 / 结果未知」的标注行，模型会据此先核验再重做，而不是像以前那样看不到这次调用 | 这是 closer 机制的设计本意，也是 `RESUME_SYSTEM_HINT` 早已承诺的行为；`AGX_INTERRUPTED_CLOSERS=0` 可整支关掉。`test_resume_from_checkpoint` 用真实运行时消费带 closer 的上下文，保持通过 |
| Task 4 步骤 (c-3) 以持久化行为底合成 closer；启动扫描逐会话 `await`，排队中的会话可能已被用户先发消息，内存副本比持久化行新 | 若不加守卫，该会话内存里未落盘的新行会被持久化行取代 | 守卫：仅当持久化行 sanitize 后与内存副本逐行相等（仍是冷加载原样）才取持久化行，否则内存副本胜出；有测试守护 |

回滚：

- 运行时回滚：`AGX_RESUME_FROM_LEDGER=0` 让恢复只读检查点；`AGX_LEDGER_REATTACH=0` 让重连端点回到 `not_running`。两者都回到改动前的路径，有测试覆盖。
- 代码回滚：回退本 plan 的提交即可。没有数据迁移需要撤销：历史 `events.jsonl` 与 `run.json` 一行未改；新写入的摘要行在回退后仍能被旧代码读取（旧代码把 `payload` 当不透明字典）。

## 已定案事项

规划时提出的三条未决事项，主会话已拍板，实施时不再询问：

1. **HA 两副本真机验收如何隔离两份本地账本。** `SessionManager._sessions_root` 写死为 `~/.agenticx/sessions`（`session_manager.py:674`），取自 `expanduser("~")`，所以同机起两个副本时给各自设不同的 `HOME` 就能隔离，不需要容器。本 plan 不做这项真机验收：HA 路径由 `tests/test_ledger_resume_recovery.py::test_ha_mode_keeps_the_checkpoint_store_as_recovery_source` 与保持通过的 `tests/test_ha_checkpoint_resume.py` 覆盖；两副本真机检查留到 master plan 的端到端验收。
2. **单机模式是否把崩溃恢复改为默认开启。** 现状默认关闭（`checkpoint.py:124-148`），所以 AC-1 在单机上需要显式设置 `AGX_RESUME_INTERRUPTED=1` 或 `runtime.resume_interrupted: true`。本 plan 的建议是不在本 plan 改默认值：01 只改「锚点从哪来」，改默认值是独立的产品决定。**定案：不在本 plan 改默认值。**
3. **用户主动停止的回合，重启后是否应当恢复。** 现状：主动停止会保留检查点，恢复开关开启时重启会自动续跑。按本 plan 的设计，账本里该 run 已关闭（`interrupted`），投影为空，于是回落到检查点，行为与改动前一致。改成「账本说 run 已关闭就不恢复」是行为变更。**定案：维持现状。**
4. **实施 Task 4 时发现冷重启恢复的 closer 从不生效（见「核实结论」第 6 节末条）。** 两个方向：把它当成测试期望写错、删掉 closer 断言另开任务修；或者在本 plan 内修掉。**定案：在本 plan 内修掉（Task 4 步骤 (c)）。** 理由：AC-2 明确要求「已发出但没有结果的调用，在恢复后的上下文里被标注为结果未知」，不修就无法闭环；删断言等于悄悄放弃一条验收判据。改动收敛在 `session_manager.py` 一个文件，约二十行，不动 `agent_runtime.py` 与 `interrupted_closers.py`，可用 `AGX_INTERRUPTED_CLOSERS=0` 整支关掉。这是对已评审 plan 的范围修订，最终汇报时单独说明。

## Commit trailers

```
Plan-Id: 2026-11-27-runtime-invariants-01-session-event-ledger
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-01-session-event-ledger.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```
