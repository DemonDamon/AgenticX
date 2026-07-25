# reasoning-only 降级轮的思考丢失与上下文污染修复

Planned-with: Opus 5
Suggested-Impl-Model: gpt-5.6-terra-medium（后端 runtime 收口，涉及 reasoning 取值优先级与 `agent_messages` 序列一致性，属跨轮次序敏感改动；不建议用 Composer/Fast 档，也无需顶配）

## 背景与根因（证据链，不依赖对话记忆）

复现会话：`~/.agenticx/sessions/3ad013e9-a301-424f-b11b-199e9cde480d`，最后一轮用户 query 为「在 @/Users/damon/myWork/research-agent/requirements.txt 插入一个torch的版本依赖」。

用户观察到的现象：先有大量流式输出（思考流），随后整段被替换为「本轮模型未能生成完整的可见回复，请重新提问。」，思考内容一并消失。

落盘证据：

| 位置 | 内容 |
|---|---|
| `messages.json[137]` | user query，`client_turn_id=05d5ca03-…` |
| `messages.json[138]` | `metadata.kind=compaction_proactive`，`compacted_count=14` |
| `agent_messages[10]` / `[11]` | 连续两条 assistant，`content` 均为空字符串，无 `tool_calls` |
| `agent_messages[12]` | system：`[runtime-reasoning-only] 上一轮只输出了思考内容…` |
| `messages.json[139]` | assistant，`metadata={"turn_terminal":true,"terminal_reason":"empty_response_fallback"}`，**无 `reasoning` 字段，也无 `model_finish_reason`** |

行为链（当前 `main` @ `434c105d`）：

1. 模型本轮只产出 `<think>…</think>`、无可见正文、无 `tool_calls`。
2. `agenticx/runtime/assistant_output.py:379` / `:439-444`：`AssistantOutputStreamParser` 把 `<think>` 标记与 think 正文都写入 `_safe_stream`，因此思考内容会通过 `EventType.TOKEN` 推给前端 —— 这就是用户先看到的「流式输出」。
3. `agenticx/runtime/agent_runtime.py:3930-3947`：命中 reasoning-only 分支，注入一次 nudge 后 `continue`。
4. 第二轮仍为空 → `authoritative_source_kind == "sync_fallback"`（`:3796-3798`），`sync_fallback` 重试流（`:3949-4031`）也拿不到内容。
5. `:4056-4066`：无 `public_tool_summaries`、无 `executed_tool_names` → `clean_body = _EMPTY_RESPONSE_FALLBACK`，`terminal_reason = "empty_response_fallback"`。
6. `desktop/src/components/ChatPane.tsx:9740-9742`：FINAL 为权威，`full = finalText` 直接替换流式缓冲；`:9873-9880` 的 `reasoningExtras` 只来自 FINAL payload 的 `reasoning`，后端没给 → 前端 Thought 块也没了。

**根因拆成三个独立缺陷（每个都可单独验收）：**

- **D1 上下文污染 + reasoning 丢弃**：`:3922-3928` 已经 append 过 `assistant_message`（`content = ac_clean`，此处为空），`:3945` 又 append 了一条同样为空的 assistant，造成 `agent_messages` 连续两条空 assistant（即 `[10]`/`[11]`）。且这两次 append 都没有携带本轮 reasoning，导致 nudge 后模型看不到自己上一轮想过什么，思考也无法回显。
- **D2 降级轮 reasoning 取值缺口**：`:4041-4050` 中，只有 `authoritative_source_kind == "final_content"` 分支会回落 `_nonstream_reasoning`；`streamed_raw` 分支回落 `_streamed_reasoning`；而 `sync_fallback` 落到 `else: reasoning_text = parsed.reasoning`（对空 raw 恒为 `""`）。于是明明流里有 think、`response.reasoning_content` 里可能也有，最终 `_finish_terminal_reply` 收到的 `reasoning_text` 是空串，`agenticx/runtime/agent_runtime.py:2239-2242` 也就没有任何可写内容。
- **D3 可观测性盲区**：`:4077-4086` 的 `terminal_output_recovered` 日志不含 `model_finish_reason` 与 reasoning 长度；`:4139-4148` 只在 `model_finish_reason` 非空时才写入 terminal metadata。本次 `[139]` 两者皆缺，无法区分「provider 截断（length）」与「模型真的只输出思考」。这是同类问题反复难定位的直接原因。

**明确不作为本次根因的推测**：`compaction_proactive` 与本次空回复的因果关系没有证据支撑，本 plan 不据此改压缩策略。D3 落地后若再复现，可用 `model_finish_reason` 判定后另开 plan。

## In scope

- `agenticx/runtime/agent_runtime.py`：nudge 分支的 append 序列与 reasoning 透传（D1）；降级轮 `reasoning_text` 取值优先级（D2）；降级终局的日志与 terminal metadata（D3）。
- `tests/test_reasoning_only_turn_retry.py`：新增断言与用例。

## Out of scope（no-scope-creep 边界）

- 不改 `_EMPTY_RESPONSE_FALLBACK` / `_TOOL_TURN_EMPTY_FALLBACK` 文案本身。
- 不改前端（`ChatPane.tsx` / `ChatView.tsx`）。后端把 `reasoning` 带进 FINAL 后，前端 `:9717-9724` 现有逻辑会自动渲染 Thought 块，无需改动；若验收发现前端仍不显示，另开子任务，不在本次顺手改。
- 不改上下文压缩（`compaction_*`）策略、阈值或触发时机。
- 不改 `reason_only_retry` 上限（保持 1 次），不改 nudge 提示文案 `_REASONING_ONLY_NUDGE_HINT`。
- 不改 `_LLM_MESSAGE_KEEP_KEYS`（`reasoning_content` 已在其中，见 `:1161-1172`），不改 `_sanitize_context_messages`。
- 不改工具沙箱可写根 / 路径白名单逻辑（上一轮的 `path escapes workspace` 是另一议题）。
- 不清理工作树中其他既有改动或未跟踪文件。

## FR-1（D1）：nudge 分支只 append 一次，并携带本轮 reasoning

**落点**：`agenticx/runtime/agent_runtime.py`，`_run_agent_turn` 内 `:3922-3947`。

**现状**（锚点代码）：

```python
            assistant_message: Dict[str, Any] = {"role": "assistant", "content": ac_clean}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
                if isinstance(reasoning_for_tool_call, str) and reasoning_for_tool_call:
                    assistant_message["reasoning_content"] = reasoning_for_tool_call
            session.agent_messages.append(assistant_message)
            synced_session_message_count = len(session.agent_messages)

            if not tool_calls:
                if (
                    not parsed.visible_body.strip()
                    and not _is_system_trigger
                    and reason_only_retry < 1
                ):
                    reason_only_retry += 1
                    logger.info(...)
                    messages.append({"role": "assistant", "content": parsed.visible_body})
                    messages.append({"role": "system", "content": _REASONING_ONLY_NUDGE_HINT})
                    session.agent_messages.append({"role": "assistant", "content": parsed.visible_body})
                    session.agent_messages.append({"role": "system", "content": _REASONING_ONLY_NUDGE_HINT})
                    continue
```

**改成**：

1. 在 nudge 分支内**删除** `session.agent_messages.append({"role": "assistant", "content": parsed.visible_body})` 这一行。`:3927` 已经 append 过等价的 assistant 行，重复 append 是纯污染。
2. nudge 分支内改为就地补齐 `:3927` 刚 append 的那条 assistant 的 `reasoning_content`：取 `reasoning_for_tool_call`（已在 `:3917-3921` 计算为 `_streamed_reasoning or _nonstream_reasoning or parsed.reasoning`），非空则写入该条 dict 的 `reasoning_content` 键。注意 `reasoning_for_tool_call` 当前只在 `tool_calls` 为真时才被使用，本次要在无 tool_calls 的 nudge 路径也用上它。
3. `messages`（发给 provider 的列表）侧同样只保留一条 assistant，并对齐带上 `reasoning_content`，保证 nudge 后模型能看到自己上一轮的思考。`messages.append({"role": "system", ...})` 与 `session.agent_messages.append({"role": "system", ...})` 保留不动。
4. `synced_session_message_count` 在本分支不再需要因二次 append 而变化；确认 `continue` 之后的同步逻辑仍以 `:3928` 的取值为准。

**意图**：nudge 后的上下文形如 `assistant(content="", reasoning_content="<本轮思考>") → system(nudge)`，而不是当前的 `assistant("") → assistant("") → system(nudge)`。

**AC-1**（`tests/test_reasoning_only_turn_retry.py`）：

- 新增 `test_nudge_round_appends_single_assistant_with_reasoning`：用现有 `_ReasoningInContentThenReply` 造 1 次 reasoning-only + 1 次正常回复；断言 nudge 触发后 `session.agent_messages` 中**不存在**两条相邻的 `role=="assistant" and not content and not tool_calls`；且 nudge 前那条 assistant 的 `reasoning_content` 包含 `"需要继续"`。
- 现有 `test_reasoning_in_content_triggers_nudge_then_real_reply`、`test_reasoning_in_separate_field_triggers_nudge_then_real_reply`、`test_normal_reasoning_plus_body_does_not_trigger_nudge` 必须保持绿（`llm.calls` 断言不变）。

## FR-2（D2）：降级终局必须带上可得的 reasoning

**落点**：`agenticx/runtime/agent_runtime.py:4041-4050`。

**现状**：

```python
                if reasoning_field_final_recovered:
                    reasoning_text = ""
                elif parsed.malformed:
                    reasoning_text = ""
                elif authoritative_source_kind == "final_content":
                    reasoning_text = parsed.reasoning or _nonstream_reasoning
                elif authoritative_source_kind == "streamed_raw":
                    reasoning_text = parsed.reasoning or _streamed_reasoning
                else:
                    reasoning_text = parsed.reasoning
```

**改成**：保留前两个分支（`reasoning_field_final_recovered` 与 `parsed.malformed` 仍必须清空，避免把已被提升为正文的内容或畸形协议残片当思考落盘），其余分支统一按 `parsed.reasoning or _streamed_reasoning or _nonstream_reasoning` 取值。即 `sync_fallback` 分支不再返回空串，`final_content` / `streamed_raw` 分支也各自多一层回落。

**意图**：只要本轮从任一来源拿到过思考（流式 `<think>` 或 provider 的 `reasoning_content` 字段），`empty_response_fallback` / `tool_turn_empty_fallback` 这类降级终局也要把它持久化并随 FINAL 下发，让用户至少能看到「模型想了什么、但没给结论」，而不是流式内容凭空消失。

**注意**：`_finish_terminal_reply`（`:2239-2242`）会对 `reasoning_text` 走 `_dedupe_reasoning_against_body`；由于降级正文是固定文案，不会与思考重复，无需额外处理。不要改 `_finish_terminal_reply` 本身。

**AC-2**（`tests/test_reasoning_only_turn_retry.py`）：

- 扩展现有 `test_reasoning_only_exhausts_nudge_emits_visible_retry_fallback`：除已有断言外，新增 `session.chat_history[-1].get("reasoning")` 非空且包含 `"只会思考"`；`metadata.terminal_reason == "empty_response_fallback"`。
- 新增 `test_sync_fallback_empty_turn_still_persists_reasoning_field`：伪 LLM 的 `invoke` 返回 `content=""` 且 `reasoning_content="我在想"`，`stream` 不产出任何 chunk（触发 `sync_fallback` 路径）；断言最终 `chat_history[-1]["reasoning"]` 包含 `"我在想"`，正文为 `_EMPTY_RESPONSE_FALLBACK`。
- 断言 `<think>` 字面量不出现在 `chat_history[-1]["content"]` 中（沿用现有 `_THINK_OPEN` 断言风格）。

## FR-3（D3）：降级终局补齐 finish_reason 与 reasoning 观测

**落点**：`agenticx/runtime/agent_runtime.py:4077-4086`（`terminal_output_recovered` 日志）与 `:4139-4148`（`terminal_metadata` 构造）。

**改成**：

1. `logger.warning("terminal_output_recovered …")` 的格式串与参数中增加两项：`finish_reason=%s`（取 `model_finish_reason or "unknown"`）与 `reasoning_chars=%s`（取 `len(reasoning_text or "")`）。不要删除或重排既有的 `session` / `round` / `reason` / `protocol_errors` / `tools` 字段。
2. `terminal_metadata` 中，当 `terminal_reason` 属于降级集合 `{"empty_response_fallback", "tool_turn_empty_fallback", "tool_result_fallback"}` 时，即使 `model_finish_reason` 为空也写入 `"model_finish_reason": model_finish_reason or "unknown"`，使排障时能从 `messages.json` 直接读出 provider 是否给了 finish_reason。其他 `terminal_reason` 保持现状（仅非空时写入），避免给正常轮次的历史消息平添字段。
3. 同一降级集合下，把本轮累计的协议错误写入 `"protocol_errors": list(...)`（沿用 `:4084` 已在用的 `parsed.protocol_errors`；为空时写空列表或省略该键均可，实施者择一并在测试中固定）。**这是区分「流被截断」与「模型只输出思考」的直接指纹**：`<think>` 未闭合会产出 `unclosed_think`（见 `agenticx/runtime/assistant_output.py:41-52` 与 `:64-66` 的 `malformed` 定义）。注意 nudge 前后是两个不同 round，末轮 `parsed` 来自空 raw 因而无错误码；若要覆盖 nudge 轮的错误码，需在 nudge 分支（FR-1 落点）把该轮 `parsed.protocol_errors` 暂存到局部变量，并在终局 metadata 中合并写出。

**意图**：下次同类问题可直接从落盘 metadata 区分三种情况——provider 截断（有 `unclosed_think` / `finish_reason=length`）、provider 正常返回空（`finish_reason=stop` 且无协议错误）、模型只输出思考（有 reasoning 但无正文）——不必再逐层猜。

**已知观测缺口（本次不修，仅记录）**：`agx serve` 的 stdout 未落盘为日志文件，上述 `logger.warning` 在本次事故中无法事后追溯。若后续仍需排障，可另开 plan 讨论 runtime 日志落盘策略；本 plan 通过把关键字段写入 `messages.json` metadata 来绕开该缺口。

**AC-3**：

- 新增 `test_degraded_terminal_records_finish_reason_metadata`：reasoning-only 耗尽后，断言 `chat_history[-1]["metadata"]["model_finish_reason"]` 存在（伪 response 无 finish_reason 时为 `"unknown"`）。
- 正常回复轮次的 `chat_history[-1]["metadata"]` **不得**新增 `model_finish_reason` 键（伪 response 未提供时）。

## 实施顺序与验收命令

按 FR-1 → FR-2 → FR-3 顺序改，每步跑一次测试再进下一步。

```bash
cd /Users/damon/myWork/AgenticX
python -m pytest -q --disable-warnings \
  tests/test_reasoning_only_turn_retry.py \
  tests/test_agent_runtime.py \
  tests/test_assistant_output_parser.py \
  tests/test_strip_llm_message_fields.py \
  tests/test_session_manager_persistence.py
```

全绿后做一次真实回归：在 Desktop 里对同一分身发一条会触发长思考的 query，确认

1. 若模型正常回复 → 行为与修复前一致（无回归）；
2. 若再次落入 `empty_response_fallback` → 气泡下方仍保留可展开的 Thought 块，且 `messages.json` 该条含 `reasoning` 与 `model_finish_reason`。

本次不触碰 `agenticx/studio/server.py`，因此无需 `agx serve` 冷启动 smoke。

## 提交约定

单个 commit 即可（三个 FR 同属一个缺陷簇），或按 FR 分三个 commit。trailer：

```
Plan-Id: 2026-07-25-reasoning-only-fallback-reasoning-loss
Plan-File: .cursor/plans/2026-07-25-reasoning-only-fallback-reasoning-loss.plan.md
Plan-Model: <待用户确认>
Impl-Model: <待用户确认>
Made-with: Damon Li
```
