# LLM 流式超时看门狗加固与“一直转圈”根因修复

Plan-Id: 2026-06-12-llm-stream-watchdog-hardening
Status: draft
Owner: Damon Li

## 背景与问题（Why）

用户在 Desktop 用 `qwen-plus` 发送消息后“一直转圈”，且无法逃生；前端侧的发送锁卡死已在另一改动修复（`desktop/src/components/ChatPane.tsx`，本 plan 不重复处理）。本 plan 处理**后端**侧“转圈不结束”的根因。

经代码核查（行号为撰写时位置，实施前必须用 `rg`/Read 复核，不可盲信）：

- 主聊天流式路径 `AgentRuntime` 的 `stream_with_tools` 分支**已有 idle 看门狗**：
  - `agenticx/runtime/agent_runtime.py:1873-1911`：首字节前用 `invoke_timeout_seconds`、首字节后用 `heartbeat_timeout_seconds` 做 inter-token idle 超时，`hard_timeout_seconds` 做整轮硬上限；超时 `raise asyncio.TimeoutError()`。
  - 超时后进入 `except`（约 `:2037`）→ 回退到非流式 `self.llm.invoke(...)` 再跑一轮（约 `:2056` `_invoke_once_with_fallback`）。

- 默认超时值（`agenticx/runtime/agent_runtime.py:262-285`）：
  - `DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS = 120.0`（首字节前；volcengine/bailian=180、zhipu=150）
  - `DEFAULT_LLM_HEARTBEAT_TIMEOUT_SECONDS = 60.0`（首字节后 inter-token）
  - `DEFAULT_LLM_HARD_TIMEOUT_SECONDS = 300.0`，但 `_resolve_llm_hard_timeout_seconds` 用 `min(.., round_cap=180)` ⇒ 实际 180s
  - `DEFAULT_LLM_FIRST_FEEDBACK_SECONDS = 8.0`（仅发 `⏳`，不算结束）

### 三个真正的根因/盲区

1. **裸 `self.llm.stream(...)` 补偿路径没有看门狗**：
   - `agenticx/runtime/agent_runtime.py:2499`（`response_text` 为空时的二次流式补偿）与 `:3300`（另一处 `self.llm.stream(`）只有 `_check_should_stop` + `0.05s` 队列轮询，**没有 idle/hard 超时**。provider 在这两条路径 hang 会真正无限转圈，对应用户“一直转圈”。

2. **超时后体感等待叠加过长**：首字节前 120s（部分 provider 180s）→ 超时 → fallback `invoke` 再等最多 `request_timeout_seconds`（= `max(invoke, heartbeat, hard)`）。最坏单轮可干等约 300s 才有反馈或报错。对话交互场景首字节阈值过宽松。

3. **终止事件可达性需保证**：当所有超时/重试耗尽后，必须**确保**向前端 SSE 发出明确的终止事件（`final` 或 `error`），否则前端只能干等。需与前端逃生改动互补，形成“后端必发终止 + 前端不卡死”的双保险。

## 目标（What）

在不改变正常流式行为的前提下：
1. 给两条裸 `self.llm.stream(...)` 补偿路径补齐与 `stream_with_tools` 同款的 idle/hard 看门狗。
2. 抽取统一的“流式看门狗”辅助，避免三处逻辑各写各的、未来再漂移。
3. 保证任意超时/失败路径最终都向 SSE 发出终止事件（`final` 或 `error`），不让前端干等。
4. 调优默认首字节超时，使对话场景更快给出失败反馈（保守、可配置、不破坏 tool-heavy 长 round）。

## 非目标（Out of Scope，禁止顺手做）

- 不改 `desktop/` 前端（前端发送锁/逃生已单独修）。
- 不引入 OpenAI Responses API（当前国产/兼容网关均走 chat completions，另议）。
- 不重构 `AgentRuntime.run_turn` 的整体控制流，只在既有流式循环内加固。
- 不改 `litellm_provider.py` 的 provider 选择/usage 解析逻辑。
- 不新增 Desktop 设置 GUI（列为 P1 可选，见末尾，需单独确认后再做）。

## 需求（Requirements）

### FR-1 抽取统一流式看门狗 helper
- 在 `agenticx/runtime/agent_runtime.py` 内新增一个模块级辅助（如 `_iter_sync_stream_with_watchdog(...)` 或一个小类），封装现有 `stream_with_tools` 分支（`:1873-1911`）的看门狗语义：
  - 线程跑 sync generator + `asyncio.Queue` 桥接 + `threading.Event` stop（沿用现有模式）。
  - 参数：`first_feedback_seconds` / `invoke_timeout_seconds`（首字节前 idle）/ `heartbeat_timeout_seconds`（首字节后 idle）/ `hard_timeout_seconds`（整轮硬上限）。
  - 行为：首字节前 idle 超 `invoke_timeout` → 超时；首字节后 inter-token idle 超 `heartbeat` → 超时；总时长超 `hard_timeout` → 超时；`_check_should_stop()` 命中 → 停止。
  - 超时统一 `raise asyncio.TimeoutError`，并 `stop_stream.set()` 确保后台线程可退出。
- **AC-1**：`stream_with_tools` 分支重构为调用该 helper，行为与当前一致（回归通过）。

### FR-2 给裸 stream 补偿路径接入看门狗
- 将 `agenticx/runtime/agent_runtime.py:2499` 与 `:3300` 两处 `self.llm.stream(...)` 的手写循环替换为 FR-1 的 helper（或等价地加上同款 idle/hard 超时）。
- **AC-2**：构造一个“建连后长时间不吐 token”的假 provider（见 FR-5 测试），这两条路径在 `heartbeat_timeout` 内必定抛超时并退出，不再无限等待。

### FR-3 终止事件可达性保证
- 在 run_turn 的最外层流式逻辑确保：无论 `TimeoutError` / provider 异常 / fallback 全部失败，最终都会 `yield` 一个明确终止事件——`EventType.FINAL`（带降级文案）或 `EventType.ERROR`，并清理执行态（与现有 `set_execution_state("idle"/"interrupted")` 对齐）。
- 终止文案要可读，建议复用 `agenticx/llms/provider_fault.py` 的 `classify_provider_fault` + `human_hint_for_fault`，区分 `transient`/`billing`/`auth` 等给出对应提示。
- **AC-3**：模拟 provider 始终超时（含 fallback invoke 也超时），SSE 流必须以一条 `final` 或 `error` 事件收尾，不得静默断流。

### FR-4 默认首字节超时调优（保守、可配置）
- 将对话默认首字节 idle（`DEFAULT_LLM_INVOKE_TIMEOUT_SECONDS`）从 120s 收紧到一个更适合交互的值（建议 **60s**），同时**保留**现有 provider/model 覆盖表（volcengine/bailian/zhipu、glm-5 等长延迟模型不受影响）与 env/config 覆盖优先级。
- `heartbeat`（60s）/`hard`（180s）默认保持不变（已合理）。
- **AC-4**：`runtime.llm_invoke_timeout_seconds` / `AGX_LLM_INVOKE_TIMEOUT_SECONDS` 覆盖仍生效；未配置时默认值为新值；provider/model 覆盖表仍命中。

### FR-5 冒烟测试
- 新增 `tests/test_llm_stream_watchdog.py`：
  - 用一个可注入延迟的假 LLM（`stream` / `stream_with_tools` 产出可控：首字节延迟、token 间隔、永不结束三种）验证：
    - 首字节前超 `invoke_timeout` → 抛超时；
    - 首字节后 inter-token 超 `heartbeat` → 抛超时；
    - 总时长超 `hard_timeout` → 抛超时；
    - 裸 stream 补偿路径同样受控（FR-2）。
  - 测试用极小的超时值（如 0.1/0.2/0.3s）避免拖慢 CI，不真实 sleep 长时间。
- **AC-5**：`pytest tests/test_llm_stream_watchdog.py -q` 全绿。

### NFR
- 正常流式（持续吐字）不得被新看门狗误杀：测试需含“稳定吐字”用例验证不超时。
- 不得新增对 provider 的额外网络往返；看门狗纯本地计时。
- 所有新代码遵循 `.cursor/rules/google-python-style.mdc`：英文注释/docstring、`Author: Damon Li`、全包名导入、无 emoji（用户可见 print 除外）。

## 实施步骤（建议顺序）

1. 复核行号与现状：`rg "self.llm.stream\(" agenticx/runtime/agent_runtime.py`、`rg "stream_with_tools" agenticx/runtime/agent_runtime.py`，确认 `:2499` / `:3300` / `:1831` 现状与本 plan 描述一致；不一致以代码为准并在 plan 注记。
2. FR-1：抽 helper（先不改调用点，helper 与现有内联逻辑等价）。
3. FR-1 收尾：把 `stream_with_tools` 分支切到 helper，跑现有相关测试确认无回归。
4. FR-2：把 `:2499` / `:3300` 两处切到 helper。
5. FR-3：在最外层补“终止事件兜底”，复用 `provider_fault` 文案。
6. FR-4：调默认值常量 + 确认覆盖链。
7. FR-5：写冒烟测试，全绿。
8. 自检：`python -c "import agenticx.runtime.agent_runtime"` 可导入；`pytest tests/test_llm_stream_watchdog.py -q`。

## 验收清单（Definition of Done）

- [ ] AC-1 `stream_with_tools` 重构后行为不变，相关回归通过
- [ ] AC-2 裸 stream 两路径接入看门狗，hang 场景必超时退出
- [ ] AC-3 任意失败路径 SSE 必发 `final`/`error` 收尾
- [ ] AC-4 默认首字节超时收紧且覆盖链生效
- [ ] AC-5 `tests/test_llm_stream_watchdog.py` 全绿
- [ ] NFR 稳定吐字不被误杀
- [ ] 代码符合 google-python-style 规则

## 提交规范

- 仅 `git add` 本任务直接改动文件：`agenticx/runtime/agent_runtime.py`、新增 `tests/test_llm_stream_watchdog.py`、本 plan 文件。
- commit 走 `/commit --spec=.cursor/plans/2026-06-12-llm-stream-watchdog-hardening.plan.md`，自动注入：
  - `Plan-Id: 2026-06-12-llm-stream-watchdog-hardening`
  - `Plan-File: .cursor/plans/2026-06-12-llm-stream-watchdog-hardening.plan.md`
  - `Made-with: Damon Li`

## P1（可选，需单独确认后另起 plan，本次不做）

- 将 `runtime.llm_invoke_timeout_seconds` / `llm_heartbeat_timeout_seconds` / `llm_hard_timeout_seconds` 暴露到 Desktop 设置（Runtime/Automation 区）并持久化到 `~/.agenticx/config.yaml`，附真实数值输入，避免只能手改 YAML。
