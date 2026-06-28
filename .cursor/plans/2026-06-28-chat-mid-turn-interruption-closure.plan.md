# Chat 工具链中途断流的「兜底收尾」与可见性修复

Planned-with: claude-opus-4.7

## 背景与问题定位

排查 session `3444b820-9137-429f-9baa-cb35faa23f38` 后确认：用户发「继续」触发的验证轮次（07:28:07–07:28:19，约 12s）只跑了 3 个 `bash_exec`（探测 Python 环境），随后**既没有 `final` 事件、也没有 `error` 事件、磁盘也没写任何中断说明**就结束了。

可复现的「断到一半」体感来自三段链路缺陷：

1. **后端 finally 没有把 `had_runtime_failure` / 客户端断开 / `runtime_task.cancel()` 等终止路径持久化为可见的 tool 消息**——只调 `_finalize_chat_runtime` 设置 `execution_state`，UI 看不到任何「为什么停了」。`_finalize_partial_assistant_if_needed` 仅在有 partial 文本时落盘，工具刚返回、模型还没出 token 的场景完全没有兜底。
2. **前端 SSE 流末尾的 `⚠️ 本轮请求已中断（未收到模型最终响应）` 提示只走 `addPaneMessageIfSessionActive` 入内存**，不写后端 `messages.json`；紧随其后的 `mergeTailFromDisk` 用磁盘快照重建消息列表，把这条提示直接覆盖掉，用户刷新或切回会话就再也看不到。
3. **会话 `execution_state` 仍是早前 6 小时无人值守 wall-clock 触发的 `failed`**，而本轮「继续」其实只是普通手动续跑，结束时落入 `_resolve_chat_end_execution_state` 的 idle 分支，但 `failed` 标记不会被刷新——主聊天区 + 历史侧栏 + sticky 任务条三处状态来源不一致，叠加 commit `6dadb123` 的修复仍然无法掩盖「为什么这里就停了」。

## 修复目标（FR / NFR / AC）

### FR（功能需求）

- **FR-1**：`/api/chat` SSE 流在 `_event_stream` finally 阶段，若 `not saw_final`，必须向 `session.chat_history` 追加一条 `role="tool"`、`metadata.kind="turn_interrupted"` 的中断说明（包含触发原因：`client_disconnect` / `runtime_failure` / `cancelled` / `unknown`），并保证 `persist_async` 落盘。
- **FR-2**：当后端检测到本轮以「工具结果」结尾（最后一条 `chat_history` role=`tool` 且无后续 assistant）时，中断说明的文案要明确告诉用户「上一步工具执行后未收到模型回复」，而非泛化的「请求失败」。
- **FR-3**：前端 `sendChat` 在 `!receivedFinalEvent` 分支不再仅写内存消息——改为只显示一次性 toast/inline 提示，**实际的「已中断」消息来自后端落盘**，从而与 `mergeTailFromDisk` 完全兼容、不会被覆盖。
- **FR-4**：若 session 在请求开始时 `execution_state === "failed"` 但用户手动发起「继续」并成功收到至少一个 SSE 事件，`_finalize_chat_runtime` 结束态由当前 `_resolve_chat_end_execution_state` 决定（idle/interrupted），不得回退或保留旧 `failed`。

### NFR（非功能）

- **NFR-1**：兜底消息**严格幂等**——同一 turn 不重复追加；以最后一条 `chat_history` 是否已是 `turn_interrupted` 元数据为判定（参考既有 `_has_supervisor_notice` 模式）。
- **NFR-2**：不破坏 `live_reattach`（event_hub）路径——hub 分支也要走相同兜底逻辑（位置：`_produce_meta_events` 的 `finally`，已在 `await event_hub.publish_done()` 后调用 `_finalize_chat_runtime`，需要在那里同样追加 `turn_interrupted` 消息）。
- **NFR-3**：兜底消息不能进入 `chat_history` 给后续 LLM 上下文造成噪声——`metadata.kind="turn_interrupted"` 由 `agent_runtime` 的上下文清洗逻辑（`_sanitize_context_messages` / `chat_history` → `agent_messages` 同步阶段）过滤，**仅 UI 可见**。
- **NFR-4**：前端 toast 文案统一收敛到一处（建议新建 `desktop/src/utils/turn-interruption-notice.ts`），避免和 `stallState`、`budget_exceeded`、supervisor `⛔` 等通知重复展示。

### AC（验收）

- **AC-1**：复现脚本：本机起 `agx serve`，发一句会触发 `bash_exec` 的 prompt，待 `tool_result` 后立刻 `kill -SIGTERM` 模型 provider 或断开网络。`messages.json` 末尾必须出现 `{"role":"tool","metadata":{"kind":"turn_interrupted","cause":...}}`，且 UI 关闭重开会话仍可见。
- **AC-2**：同一 session 连续两次触发上述场景，`messages.json` 只追加两条 `turn_interrupted`（每 turn 一条），不重复。
- **AC-3**：用户主动按「停止」按钮（`stopCurrentRun` → `interruptSession`）走 `should_interrupt=True` 路径，结束态是 `interrupted`，对应 tool 消息文案区分为「已按用户请求中断」，不与「未收到模型响应」混用。
- **AC-4**：session `3444b820-…` 类场景，sticky 任务条不再误标 3/3 completed（已由 `6dadb123` 覆盖，本 plan 回归测试需复跑 `streaming-stop-policy.test.ts` 全绿）。
- **AC-5**：单元测试：新增 `tests/test_chat_turn_interruption_notice.py`，模拟 `_finalize_chat_runtime` 在 `saw_final=False` + `had_runtime_failure=True/False` + cancelled 三组合下生成正确 `turn_interrupted` 消息且幂等。

## 实施步骤

### Step 1 · 后端兜底落盘（agenticx/studio/server.py）

- 文件：`agenticx/studio/server.py`
- 函数：`_finalize_chat_runtime`（~line 360）扩展签名，新增可选参数 `interruption_cause: str | None = None`
- 新增 helper：`_append_turn_interruption_notice(session, *, cause: str, saw_final: bool) -> bool`
  - 当 `saw_final=True` 返回 False 不写
  - 当末尾一条 `chat_history` 已是 `turn_interrupted` 返回 False（幂等）
  - 否则追加：
    ```python
    {
      "id": uuid.uuid4().hex,
      "role": "tool",
      "content": <按 cause 选择的中文提示>,
      "agent_id": "meta",
      "metadata": {"kind": "turn_interrupted", "cause": cause, "source": "runtime"},
    }
    ```
- 在两处 finally（`event_hub` 与 legacy `event_queue` 分支）调用：
  - `had_runtime_failure and not saw_final` → cause=`"runtime_failure"`
  - `client_disconnected and runtime_task.cancelled and not saw_final` → cause=`"client_disconnect"`
  - `runtime_task.cancel()` 后 `not saw_final` → cause=`"cancelled"`
  - `manager.should_interrupt(session_id)` 且 `not saw_final` → cause=`"user_interrupt"`（文案：「已按用户请求中断当前生成」）
  - 其他兜底（流自然结束但 `not saw_final` 且 `not had_runtime_failure`） → cause=`"no_final"`（文案：「上一步工具执行后未收到模型最终响应。可点「恢复执行」继续。」）
- 写入后调用 `await manager.persist_async(session_id)`（`_finalize_chat_runtime` 自身已 persist，但兜底 helper 须保证消息在 persist 之前追加）。

### Step 2 · 上下文清洗过滤（agenticx/runtime/agent_runtime.py）

- 文件：`agenticx/runtime/agent_runtime.py`
- 函数：`_sanitize_context_messages`（或紧邻的 chat_history → agent_messages 同步入口）
- 规则：跳过 `metadata.kind == "turn_interrupted"` 的 tool 消息，避免污染后续轮次的 LLM 上下文。

### Step 3 · 前端去重 + 让磁盘兜底接管（desktop/src/components/ChatPane.tsx）

- 文件：`desktop/src/components/ChatPane.tsx` ~line 7987-7997
- 当前逻辑：
  ```ts
  } else if (!abortController.signal.aborted && !receivedFinalEvent) {
    addPaneMessageIfSessionActive(pane.id, "tool", "⚠️ 本轮请求已中断…", "meta");
  }
  ```
- 改造：
  - 移除直接 `addPaneMessageIfSessionActive` 调用（避免被 `mergeTailFromDisk` 覆盖）
  - 改为：
    1. 展示一次性 `setStallHintToast(...)` 短提示（已有机制）
    2. 触发立即一次 `await mergeTailFromDisk(requestSessionId)`，让后端写入的 `turn_interrupted` 消息进入 UI
- 新增 UI 渲染：`MessageRow` / `ImBubble` 识别 `metadata.kind === "turn_interrupted"`，渲染为带「恢复执行」按钮的提示卡（复用 `stallCard` 视觉），点按钮调用 `resumeCurrentTask`。

### Step 4 · execution_state 一致性（FR-4 回归）

- 文件：`agenticx/studio/server.py` 入口处（POST `/api/chat`，~line 2410 与 line 2588 的 `set_execution_state(..., "running")`）
- 验证：进入 chat 时把旧 `failed` 直接覆盖为 `running`（已是当前行为）；`_finalize_chat_runtime` 末尾根据 saw_final / 中断原因决定 idle / interrupted / failed，**禁止保留之前轮次的 failed**。
- 在 `set_execution_state(sid, "running")` 之前，主动 `scratchpad.pop("__unattended_failure__", None)`，避免新一轮成功后 supervisor failure_reason 残留误导前端。

### Step 5 · 测试

- 新增：`tests/test_chat_turn_interruption_notice.py`
  - 用 `pytest` + `unittest.mock` 构造 fake `SessionManager` / `session.chat_history`，断言 `_append_turn_interruption_notice` 各 cause 的文案与幂等。
- 回归：
  - `pytest tests/test_smoke_*.py -k "session"` （若已有相关 smoke）
  - `cd desktop && npm test -- streaming-stop-policy.test.ts`（需仍 14 条全绿）
  - 手动跑 AC-1 / AC-2 / AC-3

## 不在本 plan 范围内（避免 scope creep）

- 不动 `agenticx/studio/supervisor.py` 的 6 小时 wall-clock 逻辑（用户手动「继续」是否应重算 wall-clock，单独立项）
- 不调整 `live_reattach_enabled` 默认值
- 不改 `StickyTaskBar` 的 todo promote 启发式（已在 `6dadb123` 修过）
- 不动 `messages.json` 历史 schema，仅新增 `metadata.kind`

## 关键文件索引

```
agenticx/studio/server.py             # _finalize_chat_runtime / _event_stream finally
agenticx/studio/supervisor.py          # 参考 _has_supervisor_notice 幂等模式（不改）
agenticx/runtime/agent_runtime.py      # _sanitize_context_messages 过滤新 kind
desktop/src/components/ChatPane.tsx    # sendChat finally / receivedFinalEvent 分支 / MessageRow
desktop/src/utils/turn-interruption-notice.ts   # 新建：toast 文案 + cause→文案 mapping
tests/test_chat_turn_interruption_notice.py     # 新建：后端单测
~/.agenticx/sessions/<sid>/messages.json        # 验证产物
```

## Commit 计划

单一 commit（用户可拆为两个，但建议合并便于回溯）：

```
fix(chat): persist turn-interruption notice when SSE ends without final

- 后端 _finalize_chat_runtime 兜底写入 turn_interrupted tool 消息（幂等）
- agent_runtime 上下文清洗过滤该 kind，避免污染后续轮次
- 前端 ChatPane 不再仅内存写中断提示，依赖后端落盘 + mergeTailFromDisk
- 清理上一轮残留的 __unattended_failure__ scratchpad

Plan-Id: 2026-06-28-chat-mid-turn-interruption-closure
Plan-File: .cursor/plans/2026-06-28-chat-mid-turn-interruption-closure.plan.md
Plan-Model: claude-opus-4.7
Impl-Model: <由实施者填写>
Made-with: Damon Li
```
