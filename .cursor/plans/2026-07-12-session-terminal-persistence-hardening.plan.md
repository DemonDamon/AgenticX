# 会话终态持久化加固实施计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: GPT-5.6 Sol（会话终态、兼容迁移与失败语义耦合较强，属于高回归风险收口，不建议交给低推理模型）

## 目标

彻底修复普通聊天在工具执行成功、模型已生成最终答复后，`messages.json` / SQLite 元数据仍停在中途快照，导致 Desktop 看起来“断尾”的生产级问题。修复必须与模型供应商解耦：模型可以产生 reasoning-only、流式工具参数截断或无 FINAL，但框架必须保证已产生的用户消息、工具结果、最终答复或中断说明可靠落盘，并对任何持久化失败给出可观测证据。

## 根因与证据链

事故 session `335a6079-0499-4bb7-92f5-943ef3816f15` 的证据：

- `messages.json` 最后修改于 23:24:57，仅保存到第三次工具 `meeting create --help`。
- 第四次工具归档于 23:25:05，返回腾讯会议创建成功。
- `SessionSummaryHook` 于 23:25:13 写入包含“会议已订好”的最终答复，证明模型 final 已生成。
- SQLite 最新 session metadata 仍是旧的 `execution_state=interrupted`、`chat_messages=1`。
- 该轮出现 `streamed_tool_call_truncated`；`agenticx/studio/server.py::_record_last_turn_failure()` 将一个 dict 写入 `session.scratchpad["__last_turn_failure__"]`。
- `agenticx/memory/session_store.py::_save_scratchpad_sync()` 直接把 scratchpad value 绑定到 SQLite，仅支持标量字符串；dict 会稳定抛出 `sqlite3.ProgrammingError: Error binding parameter 3: type 'dict' is not supported`。
- `agenticx/studio/session_manager.py::_persist_session_state()` 在写 todos 后、写消息快照前调用 scratchpad 保存，并用无日志的宽泛 `except Exception: return` 吞掉异常；`persist()` 随后无条件返回 `True`。
- 最小复现已确认：scratchpad 为字符串时 `messages.json` 存在；为 dict/list 时 `persist()` 返回 True 但 `messages.json` 不存在。

结论：模型差异只影响流式工具截断等异常的触发概率；数据丢失根因是 scratchpad 运行时类型与存储协议不匹配，加上辅助状态先于核心消息、异常静默吞噬和缺少 FINAL 前强制检查点。

## In scope

- `agenticx/memory/session_store.py`
  - scratchpad JSON 类型安全编码与向后兼容解码。
- `agenticx/studio/session_manager.py`
  - 核心消息优先持久化、分阶段异常隔离、真实成功/失败返回值和结构化日志。
- `agenticx/runtime/agent_runtime.py`
  - 在所有 Meta/普通 Agent FINAL 事件发出前强制执行一次核心会话检查点。
- `tests/test_session_store.py`
- `tests/test_session_manager_persistence.py`
- `tests/test_agent_runtime.py`
- `tests/test_studio_continuation.py` 及与中断/会话终态相关回归测试。

## Out of scope

- 不调整 `runtime.live_reattach_enabled` 默认值；该功能仍是独立灰度能力。
- 不修改腾讯会议连接器业务逻辑。
- 不重构 Desktop 消息 UI、群聊、自动化或子智能体协议。
- 不修改 `agenticx/studio/server.py` 的 import 区。
- 不补写历史 session 数据；本修复保证新轮次可靠，历史事故数据恢复另行执行。

## 方案取舍

### 采用：类型安全 codec + 核心优先 + FINAL 前检查点

1. scratchpad 所有新值统一编码为带版本前缀的 JSON；旧无前缀行继续按字符串读取。
2. `messages.json` 与 `agent_messages.json` 作为核心真相源，必须先于 todos、scratchpad、summary、FTS、context refs 写入。
3. 辅助存储失败只记录异常，不得阻断核心消息；核心快照失败必须令 `persist()` 返回 False。
4. `AgentRuntime.run_turn()` 在每条 FINAL 事件 yield 前无条件调用已有 `mid_turn_persist` 回调，形成“先落盘、后发 FINAL”的检查点。

### 不采用：仅把 dict 转成 `str(dict)`

会丢失类型，重启后 continuation 代码无法读取 `detector` / `ts`，并把 Python repr 当协议，不能作为生产方案。

### 不采用：只把 `messages.json` 调到 scratchpad 前面

能掩盖当前样本，但 scratchpad 仍永久不可恢复，`persist()` 仍假成功，未来任一辅助步骤仍可能造成状态漂移。

## FR / NFR / AC

### FR-1：scratchpad JSON 类型往返

- 在 `agenticx/memory/session_store.py` 的 `SessionStore` 邻近 scratchpad 方法处新增：
  - `_encode_scratchpad_value(value: Any) -> str`
  - `_decode_scratchpad_value(raw: str) -> Any`
- 新写值格式：`__agx_json_v1__:` + `json.dumps(value, ensure_ascii=False, separators=(",", ":"))`。
- 字符串也统一编码，避免用户字符串与前缀碰撞。
- 旧数据库中无前缀值原样返回字符串。
- JSON 不可序列化值抛出带 key 上下文的 `TypeError`，交由分阶段持久化日志记录；不得阻塞核心消息。

AC：
- `tests/test_session_store.py::test_session_store_round_trips_typed_scratchpad_values` 覆盖 str/dict/list/int/float/bool/None。
- `test_session_store_loads_legacy_plain_scratchpad_as_string` 直接插入旧行并断言兼容。

### FR-2：核心消息优先且不再假成功

- 修改 `agenticx/studio/session_manager.py::persist()`：返回 `_persist_session_state()` 的真实 bool。
- 修改 `_persist_session_state()` 返回 `bool`，按以下顺序：
  1. best-effort 附件物化；
  2. `_save_messages_snapshot()`；
  3. `_save_agent_messages_snapshot()`；
  4. todos；
  5. scratchpad；
  6. session summary metadata；
  7. FTS；
  8. context refs。
- 核心步骤 2/3 任一失败：`logger.exception` 含 `session_id`、stage，最终返回 False。
- 空 `agent_messages` 也必须原子写入 `[]`，禁止旧 `agent_messages.json` 残留并在重启后污染模型上下文。
- full persist 为缺少 timestamp 的消息使用 `managed.updated_at` 作为默认时间，避免快照写入顺序把历史会话活动时间推进到当前时刻。
- 辅助步骤 4–8 独立 try/except + `logger.exception`；不得阻断后续步骤，若核心成功则返回 True。
- 删除当前无信息的 `except Exception: return`。

AC：
- 嵌套 scratchpad 下 `persist()` 返回 True，`messages.json` 含最终 assistant，重建 manager 后 dict 类型保持。
- monkeypatch scratchpad 保存抛错，`messages.json` 仍存在且日志含 `stage=scratchpad`。
- monkeypatch `_save_messages_snapshot` 抛错，`persist()` 返回 False，不得假成功。

### FR-3：FINAL 发出前强制核心检查点

- 在 `agenticx/runtime/agent_runtime.py::AgentRuntime` 新增私有 helper `_persist_final_checkpoint()`，无条件调用 `self._mid_turn_persist`，异常继续由 SessionManager 记录，不重复实现存储。
- 在 `run_turn()` 所有 `yield RuntimeEvent(type=EventType.FINAL...)` 之前调用一次。
- 状态查询预算/冷却等合成 FINAL 必须先通过 `_append_terminal_assistant()` 同步追加到 `chat_history` 与 `agent_messages`，再执行 checkpoint；禁止只发 SSE、不入历史。
- FINAL checkpoint 不受 30 秒 / 3 工具阈值限制；用户消息检查点和工具中途检查点保持现有节流。

AC：
- 扩展 `tests/test_agent_runtime.py::test_skip_user_history_still_persists_display_user` 或新增独立测试，回调记录应从当前 `[1]` 变为“用户行检查点 + FINAL 检查点”，最后一次调用时 `chat_history` 已包含最终 assistant。
- 工具后 FINAL 场景断言最后检查点包含 tool result 与 final assistant。

### NFR-1：模型无关

- 回归 `_TextOnlyLLM`、tool-then-final、reasoning-only retry、streamed-tool truncation。
- 不增加 provider/model 名称分支。

### NFR-2：可观测性

- 任何持久化阶段异常必须带 session id 和 stage 输出异常栈。
- 正常路径不得新增用户可见噪音。

### NFR-3：兼容性与性能

- 旧 scratchpad 字符串无需迁移即可读取。
- FINAL 仅增加一次轻量核心快照；FTS/summary 仍在正常终态 full persist 中执行。
- 原有 mid-turn 30 秒 / 3 工具策略不变。

## TDD 实施步骤

### Task 1：锁定 scratchpad 根因

Files:
- Modify: `tests/test_session_store.py`
- Modify: `tests/test_session_manager_persistence.py`

Steps:
1. 添加 FR-1 / FR-2 失败测试。
2. 运行：
   - `.venv/bin/python -m pytest tests/test_session_store.py tests/test_session_manager_persistence.py -q`
3. 预期 RED：
   - dict/list SQLite binding error或无法 round-trip；
   - nested scratchpad 下 `messages.json` 缺失但 persist 假 True；
   - auxiliary failure 阻断核心快照。

### Task 2：实现 scratchpad codec

Files:
- Modify: `agenticx/memory/session_store.py::_save_scratchpad_sync`
- Modify: `agenticx/memory/session_store.py::_load_scratchpad_sync`

Before:
```python
rows = [(session_id, key, value, now) for key, value in data.items()]
return {str(row["key"]): str(row["value"]) for row in rows}
```

After intent:
```python
rows = [(session_id, str(key), _encode_scratchpad_value(value), now) ...]
return {str(row["key"]): _decode_scratchpad_value(str(row["value"])) ...}
```

Run Task 1 tests，确认 codec 用例 GREEN；SessionManager 隔离用例仍应 RED。

### Task 3：重排并隔离 SessionManager 持久化阶段

Files:
- Modify: `agenticx/studio/session_manager.py::persist`
- Modify: `agenticx/studio/session_manager.py::_persist_session_state`

Steps:
1. 先写核心消息。
2. 每个辅助步骤独立捕获并记录。
3. 返回真实核心写入状态。
4. 运行 Task 1 全部测试，确认 GREEN。

### Task 4：增加 FINAL 前检查点

Files:
- Modify: `tests/test_agent_runtime.py`
- Modify: `agenticx/runtime/agent_runtime.py::AgentRuntime.run_turn`

Steps:
1. 先添加失败断言：FINAL 前 callback 已看到最终 assistant。
2. 运行单测并确认 RED。
3. 实现 `_persist_final_checkpoint()`，在所有 FINAL yield 前调用。
4. 运行并确认 GREEN。

## 验证矩阵

专项：
```bash
.venv/bin/python -m pytest \
  tests/test_session_store.py \
  tests/test_session_manager_persistence.py \
  tests/test_agent_runtime.py \
  tests/test_studio_continuation.py \
  tests/test_chat_turn_interruption_notice.py \
  tests/test_smoke_streaming_tool_truncation.py \
  tests/test_reasoning_only_turn_retry.py -q
```

相关回归：
```bash
.venv/bin/python -m pytest \
  tests/test_smoke_session_turn_completion.py \
  tests/test_completeness_truth.py \
  tests/test_smoke_session_execution_state_interrupted.py \
  tests/test_smoke_session_event_hub.py -q
```

静态检查：
```bash
.venv/bin/python -m ruff check \
  agenticx/memory/session_store.py \
  agenticx/studio/session_manager.py \
  agenticx/runtime/agent_runtime.py \
  tests/test_session_store.py \
  tests/test_session_manager_persistence.py \
  tests/test_agent_runtime.py
```

端到端验收：
1. 用 fake LLM 或真实模型构造：工具参数截断 → retry → 工具成功 → FINAL。
2. FINAL 到达 UI 时，立即读取 session API，必须已包含最后 assistant。
3. 完全退出并重启 Near，重新进入会话，最终 assistant 与工具结果仍存在。
4. 在 scratchpad 注入 dict/list 后重复，结果一致。

## 完成标准

- 事故最小复现由“persist=True 但 messages 不存在”变为完整落盘。
- 任意 scratchpad JSON 值不会阻断会话历史。
- 任意辅助持久化失败不会丢核心消息，并产生高信号日志。
- FINAL 事件不会早于核心快照。
- 专项与相关回归全部通过。
