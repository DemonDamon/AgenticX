# Tool-Turn Premature End（工具轮次提前结束 / "继续"按钮故障）

Planned-with: GLM 5.2

## 背景与问题

Desktop 聊天出现"工具调用完成后模型不输出最终回复，turn 异常结束，UI 弹出「继续」按钮"的故障，**已发生两次**，根因相同。

### 案例 A — `cc9152ab-1e4c-40bb-a65f-511fa77ff378`（2026-06-30 08:09 UTC+8）

- 任务：联网查 Composer 2.5 Fast / GLM 5.2 High / GLM 5.2 Max 官方价格。
- 链路：`web_fetch`×2 失败 → `mcp_connect(basic-web-crawler)` OK → `list_mcps` 返回 26 个 MCP（micro-compact 截断 4707 chars + hint"勿编造名称"）→ 模型下一轮**只输出 reasoning（` Mattis …`），无 tool_call** → turn 结束 → UI 弹"继续"。
- `messages.json` 最后一条 assistant：`content` 为 ` Mattis …` 思考文本，**无 `tool_calls` 字段**。
- 排除项：`max_tool_rounds=120` 实际 round 5；`max_tokens_per_turn=1,000,000` 实际 prompt 18,853；无 supervisor 6h 上限命中；非网络中断（流是正常 `stop` 结束）。
- 时间戳注：发生在 reasoning-chain-persistence 落地（commit `3f355b76` 13:56）之前。

### 案例 B — `e3033b24-4cb7-41c4-a43a-03556ca8d21e`（2026-06-30 17:15 UTC+8）

- 任务：写 Python 连接 QNAP NAS 的完整示例代码并落盘。
- 链路：`list_files` → `file_write(~/Desktop/qnap_nas_client.py)` 返回 OK → **之后无 final assistant 回复** → turn 结束 → UI 弹"继续"。
- `agent_messages.json` 真实轨迹：`#18 assistant[tool_calls=[file_write]]` → `#19 tool(OK)` → **无 #20 final assistant**。
- 新症状：`#18` 的 `content` 出现** reasoning 文本交错重复**（"用户已经看到了我上一轮的 用户已经看到了我上一轮的完整代码示例…"），是流式 reasoning token 拼接错位，非模型主动生成文本。
- 排除项：round 4 / 120；prompt 24,357 / 1,000,000；非触顶、非超时。
- **关键时间戳**：发生在 reasoning-chain-persistence 落地（`3f355b76` 13:56）**之后**、`41f385a8` fix（18:21）**之前**——**证明 reasoning-chain-persistence 落地后本故障仍然复现**。

### 共同根因（已查证）

`agenticx/llms/litellm_provider.py:426-430` 将上游 `reasoning_content` 作为 `{"type": "content", "text": reasoning_delta}` 流式 yield（以 ` Mattis` 标记前缀让前端识别 ReasoningBlock）。因此 runtime 累积的 `response_text` **包含 ` Mattis… Mattis` reasoning 文本**。

`agenticx/runtime/agent_runtime.py:2906-2907` 的 turn 结束判断：

```python
if not tool_calls:
    if response_text.strip():   # 含 Mattis reasoning 文本，strip() 非空
        # 当作最终回答处理，结束 turn
```

当模型在工具返回后**只输出 reasoning、无可见回复、无 tool_call** 时，`response_text.strip()` 因含 reasoning 文本而非空，runtime 误判为"已有最终回答" → 结束 turn → UI 弹"继续"按钮。同时 ` Mattis… Mattis` reasoning 文本被持久化进 `messages.json` 的 `content`（案例 A/B 均可见），并发伴随流式拼接错位（案例 B）。

> 注：`agent_runtime.py:2855` 已有 `force_retry_next_round`（流式 tool_call 截断专用），`2863` 有 `_extract_inline_tool_call`，`2881` 有 widget flow guard，但**均未覆盖"只输出 reasoning 无 tool_call"这一分支**。

## 与 reasoning-chain-persistence 的关系（重要）

`2026-06-30-reasoning-chain-persistence.plan.md` 已实施（commits `3f355b76` + `41f385a8`），但**未覆盖本故障**：

- **已落地（本 plan 复用，不重复）**：
  - `_split_reasoning_and_body(text)` 函数（`agent_runtime.py:1213-1234`）—— 已能剥离 ` Mattis… Mattis` 块返回 `(reasoning, body)`，支持 closed 块 + unclosed trailing，镜像前端 `parseReasoningContent` 契约。
  - reasoning 持久化字段：`_hist_assistant["reasoning"]` / `_final_data["reasoning"]`（`agent_runtime.py:3008-3053`）+ `session_manager.py:1987-1996` 落盘 `row["reasoning"]` / `row["reasoning_seconds"]`。
  - 流式时间戳 `_stream_reasoning_start_ts` / `_stream_body_start_ts`（`agent_runtime.py:2162-2264`），用于 `reasoning_seconds`。
- **仍未修复（本 plan 核心修复点）**：
  - `agent_runtime.py:2906-2907` turn 结束判断仍用 `response_text.strip()`（含 Mattis）。
  - `agent_runtime.py:2990` 补救逻辑 `if not str(final_text).strip() and executed_tool_names:` 仍用 `final_text.strip()`——含 Mattis 时非空，**补救不触发**。
  - `agent_runtime.py:3012` content 回退 `_hist_assistant["content"] = _clean_body or final_text`——`_clean_body` 为空时**回退到含 Mattis 的 `final_text`**，污染 `messages.json`。
- **互补但不同**：
  - `session_manager.py:113` `_messages_last_turn_promised_action_without_followthrough` 是**下一轮补救**路径：用户下次发消息时检测上一轮是否"reasoning 承诺动作但无 tool_calls"，由 `server.py:423` 调用。
  - 本 plan 是**当轮 retry**：工具返回后当轮 nudge 一次让模型给出最终回复或 tool_call。两者互补不冲突。

## 目标

让"工具调用完成后模型只输出 reasoning、无可见回复、无 tool_call"这一分支**不再被误判为正常 turn 结束**：runtime 识别该分支并触发一次 nudge/retry；同时修复 content 回退污染与补救逻辑误判。次生目标：定位并修复 reasoning 流式拼接错位。

## 设计要点（决策）

1. **复用已有 `_split_reasoning_and_body()`**：不新建 `strip_reasoning_blocks`，直接用 `agent_runtime.py:1213` 的函数（已支持 closed ` Mattis… Mattis` + unclosed trailing ` Mattis…`）。
2. **runtime 侧识别"reasoning-only 空 turn"**：在 `agent_runtime.py:2906` 的 `if not tool_calls:` 分支，先用 `_split_reasoning_and_body(response_text)` 得到 `visible_text`，若 `visible_text.strip()` 为空 → 触发 `force_retry_next_round=True` 走重试路径，注入简短 system 提示引导模型给出最终回复或显式 tool_call。
3. **修 2990 补救逻辑触发条件**：`if not str(final_text).strip() and executed_tool_names:` 改用 `visible_text` 判断，确保 reasoning-only 时补救能触发（双保险：FR-2 retry 优先，补救逻辑兜底）。
4. **修 3012 content 回退逻辑**：`_hist_assistant["content"] = _clean_body or final_text` 改为 `_hist_assistant["content"] = _clean_body`（空就空，不回退到含 Mattis 的 `final_text`），避免 Mattis 污染 `messages.json`。需 Phase 0 取证确认 `_clean_body` 为空只发生在 reasoning-only 场景（正常 turn 的 stream-fallback 路径 `_clean_body` 应非空）。
5. **重试上限与防循环**：单 turn 内 reasoning-only retry 上限 1 次（单独计数 `reason_only_retry`，不消耗 `max_tool_rounds` 配额）；若 retry 后仍 reasoning-only，则按"模型确实无话可说"正常结束 turn 并落盘空 `content`（不写 Mattis 文本）。
6. **持久化复用**：reasoning 字段已由 reasoning-chain-persistence 落地，本 plan 不重复；仅修 3012 回退保证 content 干净。
7. **次生：reasoning 拼接错位**：Phase 0 取证 `_iter_reasoning_delta_texts`（`litellm_provider.py:426`）与 `kimi_provider.py:366-403` 流式组装，定位交错重复根因（候选：reasoning_content 与 content 双字段都被 yield、SSE chunk 重叠、buffer 重置时机错误）。若与主修复同源则合并修；否则单独 Phase 处理。
8. **范围隔离**：仅改 `agenticx/runtime/agent_runtime.py` turn 结束判断（2906/2990/3012）+ 必要时的 `litellm_provider.py`/`kimi_provider.py` 流式组装。不动 enterprise、不动 Desktop 前端、不动 `session_manager.py` 持久化（已落地）。

## 需求（FR / NFR / AC）

**FR-1 复用 `_split_reasoning_and_body`**：直接调用 `agent_runtime.py:1213` 已有函数，不新增纯函数。Phase 0 验证它对案例 B 交错重复 reasoning 也能正确剥离。
**FR-2 runtime 识别 reasoning-only 空 turn**：`agent_runtime.py:2906` 分支改用 `_, visible_text = _split_reasoning_and_body(response_text)`；若 `not tool_calls and not visible_text.strip()` → 触发 `force_retry_next_round=True`（新增 `reason_only_retry` 计数，上限 1）。
**FR-2a 修 2990 补救逻辑**：`if not str(final_text).strip() and executed_tool_names:` 改为 `if not visible_text.strip() and executed_tool_names:`，确保 reasoning-only 时补救逻辑能触发（兜底）。
**FR-3 retry nudge 提示**：retry 时向 `messages` 追加一条 system 提示（中文，简短）："上一轮只输出了思考内容，没有给出用户可见的回复或工具调用。请基于已有工具结果，直接给出最终回复，或发出明确的 tool_call；不要只输出思考。" 不重复注入。
**FR-4 修 3012 content 回退**：`_hist_assistant["content"] = _clean_body or final_text` 改为 `_hist_assistant["content"] = _clean_body`（空就空）。reasoning 字段持久化已由 reasoning-chain-persistence 落地，不重复。
**FR-5 次生修复（视 Phase 0 取证结果）**：修复 `_iter_reasoning_delta_texts` / reasoning 流式组装的交错重复，保证 `response_text` 累积的 reasoning 文本字符顺序正确、不重复。

**NFR-1 一致性**：正常 turn（有可见回复或有 tool_call）行为零变化；仅"reasoning-only 空 turn"分支行为改变。
**NFR-2 无回退**：不得引入重复 assistant 行、references 丢失、tool_call 配对断裂（`_repair_history_for_strict_providers` 保持绿）；不得把 reasoning 误塞回 `content` 持久化。
**NFR-3 配额安全**：`reason_only_retry` 不消耗 `max_tool_rounds` 配额（单独计数，上限 1），避免长任务被误杀。
**NFR-4 兼容旧数据**：旧 `messages.json`（content 含残留 Mattis）加载时不报错；FR-4 仅对新增/新完成 turn 生效，不回填历史。
**NFR-5 范围**：不动 enterprise / Desktop 前端 / IM gateway / `session_manager.py` 持久化；不改 `max_tool_rounds` 默认值。
**NFR-6 不破坏 reasoning-chain-persistence 成果**：reasoning 字段持久化与 `reasoning_seconds` 计算逻辑保持现状，本 plan 只修 content 回退与 turn 结束判断。

**AC-1**：复现案例 A 场景（`list_mcps` 返回后模型只输出 reasoning）→ runtime 自动 nudge 一次 → 模型在下一轮发出 `mcp_call` 或给出可见回复 → 不再弹"继续"按钮。
**AC-2**：复现案例 B 场景（`file_write` 返回后模型只输出 reasoning）→ runtime 自动 nudge → 模型给出"已保存到 X 路径，以下是代码…"可见回复 → 不再弹"继续"按钮。
**AC-3**：正常 turn（含可见回复 + tool_call / 仅可见回复 / 仅 tool_call）行为与现状一致，不触发 nudge、不丢内容、不误触发 2990 补救。
**AC-4**：`messages.json` 新完成 turn 的 assistant `content` 不含 Mattis 文本（验收：跑一轮思考模型对话，磁盘 content 干净；reasoning 在独立字段）。
**AC-5**：`tests/test_smoke_*` 与新增 `tests/test_reasoning_only_turn_retry.py` 全绿；`_repair_history_for_strict_providers` 既有用例不回归；reasoning-chain-persistence 既有用例不回归。
**AC-6**：`reason_only_retry` 上限 1 命中后，turn 正常结束且 `content` 为空字符串（不写 Mattis），不无限循环。

## 实施阶段

### Phase 0 — 取证与基线（read-only）
- [ ] 验证 `_split_reasoning_and_body()`（`agent_runtime.py:1213`）对案例 B 交错重复 reasoning 的剥离效果（构造测试输入 + 单测）。
- [ ] 写最小复现脚本：mock provider 在 tool 返回后只 yield ` Mattis… Mattis` reasoning、无 content、无 tool_call，确认当前代码走 2906-2907 → 2990 补救不触发 → 3012 回退到含 Mattis 的 final_text → turn 结束。
- [ ] 取证 3012 回退边界：确认 `_clean_body` 为空只发生在 reasoning-only 场景；正常 turn 的 stream-fallback 路径 `_clean_body` 应非空（若有反例需调整 FR-4 方案）。
- [ ] 取证 `_iter_reasoning_delta_texts`（`litellm_provider.py:426`）与 `kimi_provider.py:366-403`：检查是否对同一 reasoning chunk 重复 yield、`reasoning_started`/`reasoning_closed` 状态机在 tool-result 后重置是否正确，定位案例 B 交错重复根因。
- [ ] 记录案例 B `messages.json` assistant 样本，确认 content 含 Mattis 且交错重复。

### Phase 1 — runtime 修复（FR-1/FR-2/FR-2a/FR-3/FR-4/NFR-3/6）
- [ ] `agent_runtime.py:2906` 分支：`_, visible_text = _split_reasoning_and_body(response_text)`；`if not tool_calls and not visible_text.strip() and reason_only_retry < 1:` → 注入 nudge system 提示，`reason_only_retry += 1`，`continue`（不增 `round_idx` 的工具轮次配额）。
- [ ] `if not tool_calls and not visible_text.strip() and reason_only_retry >= 1:` → 正常结束 turn，`ac_clean = ""`（不写 Mattis），落盘空 content。
- [ ] `agent_runtime.py:2990` 补救逻辑：改用 `visible_text.strip()` 判断（FR-2a）。
- [ ] `agent_runtime.py:3012`：`_hist_assistant["content"] = _clean_body`（不回退 final_text，FR-4）。
- [ ] 单测 `tests/test_reasoning_only_turn_retry.py`：① reasoning-only → nudge → tool_call；② reasoning-only → nudge → 仍 reasoning-only → 空结束；③ 正常 turn 不触发 nudge；④ 补救逻辑在 reasoning-only 时触发；⑤ 3012 回退改为 _clean_body 后正常 turn 的 stream-fallback 路径 content 仍正确。
- [ ] 验证：`python -m pytest tests/test_reasoning_only_turn_retry.py -v` + `_repair_history_for_strict_providers` 既有用例 + reasoning-chain-persistence 既有用例。

### Phase 2 — 次生：reasoning 流式拼接错位（FR-5，视 Phase 0 取证结果）
- [ ] 若 Phase 0 确认交错重复源于 `_iter_reasoning_delta_texts` 重复 yield 或状态机错误 → 修复 `litellm_provider.py:426` / `kimi_provider.py:366-403`，加单测 `tests/test_reasoning_stream_assembly.py`。
- [ ] 若源于上游 provider 本身（SSE chunk 重叠）→ 在累积层做去重/顺序守卫，加注释说明。
- [ ] 若与主修复同源（reasoning 被误塞 content 导致看似重复）→ 在 Phase 1 修复中一并验证关闭，本 Phase 仅补回归用例。

### Phase 3 — 端到端验收（AC-1..6）
- [ ] 手动复现案例 A、案例 B 场景，确认不再弹"继续"按钮、`messages.json` content 干净、reasoning 在独立字段。
- [ ] 正常思考模型对话（DeepSeek-R1/Qwen3/Kimi/GLM 思考态）一轮 → 可见回复与 reasoning 展示正常，不误触发 nudge；reasoning-chain-persistence 的"思考了 X 秒"持久化仍正常（AC-1..3 of that plan 不回归）。
- [ ] 回归：`tests/test_smoke_*` 全绿；`_repair_history_for_strict_providers` 用例不回归；旧 `messages.json` 加载无报错。

## 风险与回滚
- 风险：触及 `agent_runtime` turn 主循环与持久化高回归区。缓解：复用已有 `_split_reasoning_and_body` 纯函数；retry 单独计数不消耗 `max_tool_rounds`；3012 回退改动需 Phase 0 取证边界。
- 风险：3012 回退改动可能影响"stream-fallback 路径 final_text 含有效 body 但 _clean_body 为空"的边界 → 需在 Phase 0 取证确认 `_clean_body` 为空只发生在 reasoning-only 场景；若有反例，FR-4 改为"仅当 `_clean_body` 为空且 `_split_reasoning_and_body(final_text)[0]` 非空（即 final_text 纯 reasoning）时才不回退"。
- 风险：nudge system 提示可能被某些模型当作"用户追问"导致语义漂移。缓解：提示文案明确"基于已有工具结果给出最终回复"，且上限 1 次。
- 回滚：移除 `agent_runtime.py:2906` 分支的 `visible_text` 改造与 nudge 注入、恢复 2990/3012 原判断即恢复当前行为；不引入新字段，对 reasoning-chain-persistence 成果零影响。

## 关联
- reasoning-chain-persistence 已落地 commits：`3f355b76`（2026-06-30 13:56）+ `41f385a8`（2026-06-30 18:21）。
- 复用函数：`agenticx/runtime/agent_runtime.py:1213` `_split_reasoning_and_body()`。
- 复用字段：`_hist_assistant["reasoning"]` / `_final_data["reasoning"]`（`agent_runtime.py:3008-3053`）+ `session_manager.py:1987-1996` `row["reasoning"]` / `row["reasoning_seconds"]`。
- 互补路径：`session_manager.py:113` `_messages_last_turn_promised_action_without_followthrough`（下一轮补救，由 `server.py:423` 调用）；本 plan 是当轮 retry，两者互补。
- 案例 A 会话：`~/.agenticx/sessions/cc9152ab-1e4c-40bb-a65f-511fa77ff378/`。
- 案例 B 会话：`~/.agenticx/sessions/e3033b24-4cb7-41c4-a43a-03556ca8d21e/`（发生在 reasoning-chain-persistence 落地之后，证明该 plan 未覆盖本故障）。
- 前序相关：`agenticx/llms/litellm_provider.py:423-459`（reasoning 流式 yield）、`agenticx/llms/kimi_provider.py:366-403`、`agenticx/runtime/agent_runtime.py:2855/2862-2920/2990/3012`（turn 结束判断与 force_retry、补救逻辑、content 回退）、`_repair_history_for_strict_providers`（tool_call 配对修复）。
- 并行 plan：`.cursor/plans/2026-06-30-reasoning-chain-persistence.plan.md`（已落地，本 plan 复用其成果，不冲突）。
