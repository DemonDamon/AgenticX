# GLM 流式收口与协议/模型绑定修复（参考分支重做进 main）

Planned-with: Opus 4.8
Re-evaluated-with: grok 4.5（2026-07-24，基线 `main` @ `55eecd06`）
Suggested-Impl-Model: 见下方「子波次 → 推荐实施模型」表

> **分支约定（2026-07-24）**
> - 旧（待废弃，勿 merge）：`fix/glm-stream-finalization-port`
> - 新（本 plan 落地）：`fix/glm-stream-finalization-rework`（从 `main` @ `55eecd06` 拉出）
>
> 本 plan 由 `/port-from-branch fix/glm-stream-common-finalization` 的核实结论驱动：**不整包 merge 对方分支**，而是以其为「问题清单 + 设计参考 + 测试矿」，在 **最新 main** 上用更瘦、可分主题验收的方式重做。
>
> 参考来源致谢：`origin/fix/glm-stream-common-finalization @ 5bf63d3e`；旧落地参考 `fix/glm-stream-finalization-port @ f525277a`（仅作矿，禁止整包合）。凡 cherry-pick 其纯函数或测例，commit body 注明 `Ported-ref`。

## 可靠性重评（2026-07-24 / main @ 55eecd06）

**总判**：plan **意图可靠、值得按波次落地**；但原文行号多数已漂移（约 +50～120），且 **FR-B3 已被 vision-continue-hardening 以更强形态覆盖**。禁止整包 merge 旧 `port` 分支，否则会回退文本附件 rehydrate / strip metadata / 视觉 `tool_stream` 门控。

| FR | main 现状 | 修法可靠性 | 实施注意 |
|---|---|---|---|
| FR-A1 SSE 反缓冲头 | **仍在**（`server.py` chat/continue 的 `StreamingResponse` 无 headers） | 可靠 | 行号约 `3509`/`3562`/`3590` |
| FR-A2 超时前缀/路由 | **仍在**（精确 `in` 匹配） | 可靠 | `_resolve_llm_*` ~444/472 仍准 |
| FR-B1 waiting 可见 | **仍在**（仍 `TOKEN("⏳")`） | 可靠 | stream ~2860；watchdog 宜补 `first_chunk_at<=0` |
| FR-B2 普通工具 DELTA | **仍在**（仅 show_widget） | 可靠 | 增量区 ~2914+ |
| FR-B3 tool_stream 门控 | **已修（更强）** | **勿按 plan 原文重做** | 保留 vision regex 排除；可只补 `glm-4.5-air→False` 测例 |
| FR-C1 reasoning 单点持久化 | **仍在** | **需改写** | append 前合并 reasoning，且须把 `reasoning_content` 加入 `_LLM_MESSAGE_KEEP_KEYS`（否则 strip 后仍断链） |
| FR-C2 reasoning 安全恢复 | **仍在** | 可靠 | 空 body 回退 ~3785；与 Path D/`tool_turn_empty_fallback` 共存勿打架 |
| FR-C3 fallback 重建 LLM | **仍在** | 可靠 | 注入 `llm_factory`；勿破坏 vision flake retry latch |
| FR-D1 续跑 single-flight | **仍在**（仅有 dedupe） | 可靠 | 加 per-session lock，与现有 `continuation_rejected` 互补 |
| FR-D2 loop reset/file_edit | **仍在** | 可靠 | `run_turn` 起始 `reset()` |
| FR-E1 followups 解耦 | **仍在** | 可靠 | disabled 仍须走 parser |
| FR-E2 孤立 `</think>` | **仍在**（前端） | 可靠 | `reasoning-parser.ts` |
| FR-E3 prose `<` | **仍在/部分** | 可靠 | Python↔TS 同步补测例 |
| FR-E4 history visible_body | **仍在** | 可靠 | `_normalize_messages` 行号已大幅漂移 |
| FR-E5 终态+渲染兜底 | **部分**（后端多已 parse；前端未统一 `assistantVisibleBodyForUi`） | 可靠 | 渲染层接线为主 |
| FR-F1 工具前缀不入库 | **仍在** | 可靠 | 只改 commit 边界；**勿动** `text-attachment`/`sourcePath` |
| FR-F2 final 覆盖临时正文 | **仍在** | 可靠 | 新增 `buildCommittedAssistantPatch` |
| FR-G1/G2 模型绑定 | **仍在/部分**（`addPane` 已有部分 fallback） | 可靠 | 补 `resolveSessionBindingModel` + `sessionModelKnown` |
| FR-H1/H2 工具秒表 | **仍在** | 可靠 | 新文件低耦合 |

**与 vision-continue-hardening（已进 main）冲突边界（强制）**：
- 禁止削弱 `_strip_non_llm_message_fields` / `_zhipu_tool_stream_supported` 视觉排除 / session text rehydrate·materialize。
- 改 `ChatPane.tsx` 时只动 SSE commit/final 路径，不回退文本附件 `sourcePath`。
- 改 `server.py` 必须冷启动 smoke；编辑 import 区禁止整段替换。

**落地分支**：本重评后统一在 `fix/glm-stream-finalization-rework` 上按 A→H 分 commit（可跳过已修的 FR-B3 实现，仅补测）。旧 `fix/glm-stream-finalization-port` 验收全部绿后再删。

## 背景与总目标

GLM（`zhipu` 与公司 `custom_openai_*` 路由）在工具调用期间/结束后存在共性链路问题，且协议清洗、默认模型绑定、工具计时在 main 上仍缺失。逐条已在当前 main 核实为「仍在」，需要修复：

1. GLM 超时映射对 `glm-5.2`/`glm-4.7` 全字匹配失败 → 回落 60s。
2. 首包等待与普通工具增量对用户不可见（仅 `⏳` TOKEN / 仅 `show_widget` 发 delta）。
3. 工具成功但无最终说明时，无法从 `reasoning_content` 安全恢复。
4. `/api/chat` 等 SSE 无反缓冲头，代理下「长时间无动静后突然一堆」。
5. 工具轮 assistant 未持久化 `reasoning_content`，GLM interleaved / 续跑链断裂。
6. provider fallback 后未重建运行中的 `self.llm`。
7. 续跑无 single-flight 锁；`file_edit` 连续失败无熔断、`loop_detector` 跨 turn 状态残留。
8. followups/孤立 `</think>`/prose `<` 协议泄露；工具前缀被误提交为普通气泡；authoritative `final` 未覆盖临时正文；历史 API 未回写 `visible_body`。
9. 默认模型 session 绑定优先级错误（旧全局默认永久压过新默认）。
10. 工具运行无前端独立秒表（依赖后端 progress，断流即像卡死）。

**总验收门槛（Composer 2.5 可独立实施）：** 每个子波次自带精确落点（文件+函数+行锚点）、before/after 意图、可执行 AC（含测试文件名与断言点）；触碰 `agenticx/studio/server.py` 必须 `agx serve` 冷启动 smoke。

## 全局 In scope / Out of scope

**In scope**：上面 1–10 对应的运行时/Studio/Desktop 修复与回归测试。

**Out of scope（no-scope-creep 边界）**：
- 不改 provider 密钥 / Base URL / 公司模型配置值。
- 不改群聊路由、工具目录、工具权限策略、`runtime.max_tool_rounds` 默认值。
- 不改真实工具执行顺序或工具结果内容。
- 不重排 `server.py` 顶部 import（AGENTS.md 敏感区），只改函数体/返回表达式。
- 不迁移或重写既有历史消息文件。
- **禁止**照抄对方 tip 的两处债：工具轮 `session.agent_messages` 双 append（tip `:3913` + `:4152`）、`ChatPane` 的 `streamPhase` thinking→answering 死锁逻辑。
- 不清理工作树中无关的既有改动 / 未跟踪文件。

## 子波次 → 推荐实施模型

| 子波次 | 内容 | Suggested-Impl-Model | 理由 |
|---|---|---|---|
| A | SSE 反缓冲头 + GLM 超时前缀/路由匹配 | Composer 2.5 | 常量注入 + 表匹配，机械、低风险 |
| B | 首包等待 `TOOL_PROGRESS` + 普通工具 `TOOL_CALL_DELTA` + `tool_stream` 门控 | Grok 4.5 | 触碰 stream 状态机与事件契约 |
| C | 工具轮 reasoning **单点**持久化 + 成功后 reasoning 安全恢复 + fallback 重建 LLM | Grok 4.5 | 跨轮上下文/协议一致性、高回归风险 |
| D | 续跑 single-flight 锁 + `loop_detector.reset`/file_edit 熔断 | Grok 4.5 | 会话状态机与终止语义 |
| E | 协议双端对齐（followups/孤立 `</think>`/prose `<` + history 回写 + 渲染兜底） | Grok 4.5 | Python↔TS 双端一致、用户可见正确性 |
| F | 工具前缀不入库 + authoritative `final` 覆盖 | Composer 2.5 | 主要接线纯函数，落点清晰 |
| G | 默认模型 session 绑定优先级（纯函数 + store 接线） | Composer 2.5 | 已有纯函数样式，测例明确 |
| H | 工具前端独立秒表 | Composer 2.5 | 独立低耦合新组件 |

> 上表为建议；最终 `Impl-Model` 以实际使用为准、由用户确认。执行时若需 subagent 拆 subplan/并行落地，遵循 `/port-from-branch` 约束（默认仅 Composer 2.5 / Grok 4.5）。

分支命名：统一在 `fix/glm-stream-finalization-rework` 上落地（A→H 分 commit；可跳过已修的 FR-B3 实现）。旧 `fix/glm-stream-finalization-port` 仅作参考矿。一次一主题，逐段 `typecheck/build/pytest` 绿再进下一段。

---

## 子波次 A：SSE 反缓冲头 + GLM 超时前缀/路由匹配

### FR-A1：/api/chat 等 SSE 反缓冲头

- 落点：`agenticx/studio/server.py`。在模块内新增常量（放在函数区，**不动顶部 import**）：
  ```python
  _STREAMING_SSE_HEADERS = {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
  }
  ```
- Before：`return StreamingResponse(_event_stream(), media_type="text/event-stream")`（main `:3451`）；续跑 `_deduped()`（`:3504`）与 `_wrapped_stream()`（`:3532`）同样无 headers。
- After：这三处（`:3451` / `:3504` / `:3532`）改为 `StreamingResponse(..., media_type="text/event-stream", headers=_STREAMING_SSE_HEADERS)`。其余 `_dup_noop_stream`/`_subagent_message_stream` 等本波次不动（避免 scope 膨胀）。
- AC：扩展 `tests/test_studio_server.py`，用 `create_studio_app()` 的 TestClient 断言 `/api/chat` 响应含 `cache-control: no-cache, no-transform`、`connection: keep-alive`、`x-accel-buffering: no`。
- **强制**：改了 `server.py` 后跑 `agx serve --host 127.0.0.1 --port <临时端口>` 冷启动，确认 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200。

### FR-A2：GLM 超时前缀 + 公司路由匹配

- 落点：`agenticx/runtime/agent_runtime.py:_resolve_llm_invoke_timeout_seconds`（`:444`）、`_resolve_llm_first_feedback_seconds`（`:472`）。
- Before：`if model_name and model_name in MODEL_INVOKE_TIMEOUT_SECONDS: return ...`（精确相等匹配）；provider 亦精确匹配。`glm-5.2`/`glm-4.7` 不命中 `glm-5`，`custom_openai_glm` 不命中 `zhipu`，回落默认 60s。
- After：
  - 模型匹配改为 `model == key or model.startswith(key + "-")`（保留 env/config 最高优先级不变）。
  - GLM 路由归桶：当 `provider_name == "zhipu"` **或** `provider_name.startswith("custom_openai")` 且 `model_name.startswith("glm-")` 时，复用 zhipu 的调用/首包窗口与首反馈（10s）。
- AC：新增/扩展 `tests/test_llm_timeout_resolution.py`：构造 `provider=custom_openai_glm, model=glm-5.2` 与 `glm-4.7`，断言 invoke timeout ≠ 60s、first_feedback = 10s；未知 provider/model 仍断言默认值；env/config 覆盖仍生效。

**参考片段**：对方 tip `_resolve_llm_invoke_timeout_seconds`（`446-482`）、`_resolve_llm_first_feedback_seconds`（`485-503`）、`_STREAMING_SSE_HEADERS`（`server.py:328-332`）。

---

## 子波次 B：等待可见 + 普通工具增量 + tool_stream 门控

### FR-B1：首包等待发 TOOL_PROGRESS

- 落点：`agent_runtime.py` 两处 `_STREAM_WAITING_HINT` 消费点：stream 路径 `:2740`、invoke 路径 `:3019` 附近（`waiting_hint_emitted` 逻辑）。watchdog 侧 `_STREAM_WAITING_HINT` 定义 `:599`，产出条件 `:649-654`（`emit_waiting_hint and first_feedback_seconds>0 and elapsed>=first_feedback_seconds`）。
- Before：等待仅 `yield TOKEN("⏳")`，前端过滤 → 无感知。
- After：消费到 `_STREAM_WAITING_HINT` 时改 `yield RuntimeEvent(type=TOOL_PROGRESS, data={"name":"模型响应","phase":"waiting_for_model","tool_call_id":""})`。**不改 watchdog 的门控语义**（首包前才发；`first_chunk_at` 逻辑保持）。若发现对方 tip 的等待条件未按首包门控，本 plan 明确要求：等待仅在 `first_chunk_at <= 0` 时发出——若 watchdog 现状已满足则无需改，否则在产出条件补 `and first_chunk_at <= 0`。
- AC：`tests/test_agent_runtime.py` 新增用例：模拟首包延迟，断言产出至少一个 `TOOL_PROGRESS{phase:"waiting_for_model"}`，且首包到达后不再产出 waiting。

### FR-B2：普通工具 TOOL_CALL_DELTA

- 落点：`agent_runtime.py` stream 工具增量分支（`tool_calls_acc` 累计处 `:2797-2860`；现仅 `show_widget` 走 `_should_emit_show_widget_delta` → `TOOL_CALL_DELTA`，`:2814-2848`）。
- Before：普通工具 delta 仅内存累计，整个模型流结束后才发 `TOOL_CALL`。
- After：普通工具在收到有效 name + arguments 增量时，发 `TOOL_CALL_DELTA`，payload 含稳定 `tool_call_id`、`name`、`arguments_raw`、`partial=true`；`show_widget` 保持既有节流，避免重复。
- AC：`tests/test_agent_runtime.py` 断言普通工具增量产生 `TOOL_CALL_DELTA` 且带稳定 `tool_call_id`；同一 call id 的 delta→最终 `tool_call` 不产生两条工具卡（后端只发事件，前端合并在 Desktop 侧另测）。

### FR-B3：tool_stream 仅对受支持 GLM 开启

- 落点：新增纯函数 `_zhipu_tool_stream_supported(provider_name: str, model_name: str) -> bool`（参考 tip `agent_runtime.py:1523-1533`）；在构建 `stream` 调用 kwargs 处（`_run_sync_stream_with_tools`，`:2668`/`:2732` 附近）条件注入 `tool_stream=True`。
- 规则：`provider==zhipu` 或 `provider.startswith("custom_openai")`，且 `model` 以 `glm-4.7`/`glm-5`/`glm-5.1`/`glm-5.2` 开头（tuple `startswith`）；**GLM-4.5-Air 不发** `tool_stream`。
- AC：`tests/test_agent_runtime.py` 参数化断言：`glm-5.2`/`glm-4.7` → True，`glm-4.5-air` → False，未知 provider → False。

**参考片段**：tip 普通工具 delta（`3165-3178`）、waiting 改造（`3056-3064`/`3368-3376`）、`_zhipu_tool_stream_supported`（`1523-1533`）。

---

## 子波次 C：reasoning 单点持久化 + 安全恢复 + fallback 重建

### FR-C1：工具轮 reasoning **单点**持久化（禁止双 append）

- 落点：`agent_runtime.py` 工具轮 assistant 写入。main 现状：`assistant_message`（`:3494`）`session.agent_messages.append(assistant_message)`（`:3497`）**不含** `reasoning_content`；后续 `assistant_tool_message`（`:3704`）仅 `messages.append`（`:3709`），**不**再写 `agent_messages`。
- Before：`agent_messages` 里的工具轮 assistant 无 `reasoning_content` → 下一轮/续跑重建时 GLM interleaved 链缺失。
- After：在 **唯一的** `:3497` append 前，若 `tool_calls` 且本轮存在 reasoning（`_streamed_reasoning` / `_nonstream_reasoning` / `parsed.reasoning`），把 `reasoning_content` 合并进 `assistant_message` 再 append。
- **硬约束**：**不得**新增第二次 `session.agent_messages.append(dict(assistant_tool_message))`（对方 tip `:4152` 的做法）；`assistant_tool_message` 仍只 `messages.append` 供当轮 in-memory 使用。
- AC：`tests/test_agent_runtime.py`：
  - `test_runtime_preserves_reasoning_content_for_tool_round`：工具轮 assistant 带 `reasoning_content`。
  - **新增** `test_runtime_tool_round_appends_single_assistant`：断言 `len([r for r in session.agent_messages if r.get("role")=="assistant" and r.get("tool_calls")]) == 1`，且其后紧跟对应 `tool` 行。

### FR-C2：工具成功后从 reasoning 安全恢复最终说明

- 落点：新增纯函数 `_recover_public_completion_from_reasoning(...)`（参考 tip `1553-1598`）；调用点在空 body 回退区（main `:3624-3628`，`public_tool_summaries` / `_TOOL_TURN_EMPTY_FALLBACK` 分支之前）。
- Before：仅 `has_successful_file_write` 才恢复；非文件工具成功时收口被当纯思考 → `_TOOL_TURN_EMPTY_FALLBACK`。
- After：恢复条件改为「本轮至少一个成功工具（`successful_tool_names` 非空）、最后工具结果非 failed/pending、finish_reason 非 length/error」；保留 `<tool_code>`/`reasoning:`/内部思考开头逐行过滤 + 公开完成信号校验（补中英文完成信号）。恢复成功时 `terminal_reason="reasoning_field_final_recovered"`，且产出不得含 `<think>`。
- 需要 `finish_reason`：新增 `_response_finish_reason(response)`（参考 tip `1536-1550`），stream/invoke 统一读取。
- AC：`tests/test_reasoning_only_turn_retry.py` 新增：非文件工具成功 + 收口在 reasoning → 断言最终文本保留、`terminal_reason` 正确、无 `<think>`；`finish_reason="length"` 或纯内部思考 → 仍走安全 fallback。

### FR-C3：fallback 后重建运行中的 LLM

- 落点：`AgentRuntime.__init__` 增加可选 `llm_factory: Callable[[], Any] | None`；`maybe_apply_provider_fallback` 命中后（main `:3211`）调用新增 `_reload_llm_for_session()`：用 `llm_factory()` 重建 `self.llm` 与 `compactor.llm`，并重算下一轮超时参数。`create_studio_app()` 构造 `AgentRuntime` 处传 `llm_factory=_resolve_llm`（server 内已有 `_resolve_llm`，见 `:2646`/`:2906` 用法）。
- Before：fallback 只改 `session.provider_name`/`model_name` 并 yield notice，`self.llm` 仍是超时 provider。
- After：运行实例与 compactor 均替换为回退后 provider。
- AC：`tests/test_agent_runtime.py:test_runtime_can_replace_active_llm_after_fallback`：注入 `llm_factory` 返回替身，触发 fallback 后断言 `runtime.llm` 与 `compactor.llm` 均为替身。

**参考片段**：tip `_recover_public_completion_from_reasoning`（`1553-1598`）、`_response_finish_reason`（`1536-1550`）、`_reload_llm_for_session`（`2092-2118` + 调用 `3562-3590`）、server `llm_factory` 注入（`2958`）。**不要**照抄 tip 的 `:4152` 第二次 append。

---

## 子波次 D：续跑 single-flight + loop_detector 熔断/reset

### FR-D1：续跑 single-flight 锁

- 落点：`agenticx/studio/session_manager.py` 新增 `get_continuation_lock(session_id) -> asyncio.Lock`（每 session 唯一，参考 tip `677-682`）；`server.py:continue_session`（`:3454`）在进入 `interrupt_running_for_continue`/`prepare_continue`（`:3477`/`:3487`）前 `acquire`，若已 `locked()` 直接返回一段 `continuation_rejected` 的 SSE；`finally` 释放。
- Before：连点续跑可 interrupt 刚起的新 run，叠加 notice。
- After：同 session 续跑串行化，重复请求被礼貌拒绝。
- AC：`tests/test_studio_continuation.py:test_manual_continue_single_flight_lock_is_per_session`：并发两次续跑，第二次得到 rejected；不同 session 互不阻塞。
- **强制**：改了 `server.py`，冷启动 smoke 同 FR-A1。

### FR-D2：loop_detector reset + file_edit 熔断

- 落点：`agenticx/runtime/loop_detector.py`（main `class LoopDetector` `:25`，**无** `reset`）新增：`reset()`（清 `_calls`/`_progress_marks`/`_guard_rejections`/`_last_success_fingerprint`/`_file_edit_failures` 等，不改阈值）、`_detect_file_edit_failure()`（同文件同一 turn 内累计 2 次 `file_edit` 失败 → critical + 重新读取 nudge）；`agent_runtime.run_turn` 每 turn 起始调用 `self.loop_detector.reset()`。
- Before：跨 turn 状态残留；不同 `old_text` 的重复失败不同签名，无法及时熔断。
- After：turn 级干净起点；同文件两次编辑失败即熔断并给终态说明。
- AC：`tests/test_loop_detector.py`（参考 tip 段）：两次 file_edit 失败触发 critical；`reset()` 后计数清零；正常成功不误伤。

**参考片段**：tip `loop_detector.py:46-215`、`agent_runtime.py:2310` 的 `reset()`、`continuation.py:281-360` 的成功工具指纹（可选一并 port 以减少无进展误拒）。

---

## 子波次 E：协议双端对齐（Critical）

### FR-E1：followups 解析与推荐问题开关解耦

- 落点：`agenticx/runtime/followup_stream.py:FollowupStreamEmitter.feed_append`（main `:75`）与 `finalize_text`（`:89`）。main Before：`if not self._enabled: return _raw`（`:80`）直接透传，绕过 parser，孤立 `</think>` 进 SSE 正文。
- After：始终 `self._parser.feed()` / `finalize()`；`_enabled` 只决定 `finalize_text()` 是否返回 suggestions，不再影响协议清洗。
- AC：`tests/test_assistant_output_parser.py` 覆盖 disabled 模式下成对 think、孤立关闭标签、followups 隐藏。

### FR-E2：前端清理孤立 `</think>`

- 落点：`desktop/src/components/messages/reasoning-parser.ts:parseReasoningContent`。
- After：扫描下一个开/闭标签；孤立 close 跳过、不进 response；合法 think 块仍进 reasoning。
- AC：新增 `reasoning-parser.test.ts`：正文中连续 `</think>` 不可见；合法块不回归。

### FR-E3：prose `<` 不吞后续协议标签（Python↔TS 对齐）

- 落点：`agenticx/runtime/assistant_output.py` 的流式解析器；`desktop/src/utils/assistant-output.ts` 对应 StreamParser。
- After：散文里的裸 `<`（后随空格/非标签字符）当普通文本，不进入协议标签状态，避免吞掉后续真 `<followups>`/`</think>`。两端逻辑保持一致。
- AC：`tests/test_assistant_output_parser.py` + `desktop/src/utils/assistant-output.test.ts` 各加「距离 < 120px … `<followups>`」类样例，断言正文保留且协议标签仍被正确识别。

### FR-E4：历史 API 回写 visible_body

- 落点：`agenticx/studio/session_manager.py:_normalize_messages`（`:727` 区，已解析 SQ 但未改写 content，`:750`/`:767` 有 `parsed.visible_body`）。
- After：assistant row 的 `content` 替换为 `parse_assistant_output(content).visible_body`；原始历史文件不动，全量/分页/恢复路径不再返回协议尾巴。
- AC：`tests/test_session_manager_persistence.py` 断言含未闭合 `<followups>` 的历史 row 经归一化后 `content` 无协议尾巴。

### FR-E5：终态与渲染双重阻断 + 渲染兜底

- 落点：`agent_runtime.py:_finish_terminal_reply` 在写 sinks/发 FINAL 前对 `clean_body` 再 `parse_assistant_output()`（malformed 不产 suggestions、不写控制标签）；`desktop/src/components/messages/ImBubble.tsx`/`TerminalLine.tsx`/`CleanBlock.tsx` 的 assistant `bodyText` 派生统一走 `assistantVisibleBodyForUi`（main 已存在于 `assistant-output.ts:358`）。
- AC：`ImBubble.test.tsx` 断言协议尾巴不渲染；Python 侧断言 `_finish_terminal_reply` 不把控制标签写入 `agent_messages`/`chat_history`。

**参考片段**：tip `followup_stream.py:56-88`、`reasoning-parser.ts`（+ test）、`assistant_output.py`/`assistant-output.ts` nested-`<`、`session_manager._normalize_messages` 一行回写。

---

## 子波次 F：工具前缀不入库 + authoritative final 覆盖

### FR-F1：工具前缀不提交为普通气泡

- 落点：`desktop/src/components/ChatPane.tsx` 收到 `tool_call`/首个 `tool_call_delta` 时的 `commitCurrentStreamIfNeeded()`（`:8934`/`:8943`，已有 `resetTurnSegment` 于 `:8937`/`:8946`）；`ChatView.tsx` 对应 `tool_call` 分支（`:951`/`:1467`，`commitCurrentStreamIfNeeded` `:1223`）。
- After：收到工具事件时只 `resetTurnSegment`（清当前非终结 stream），**不** commit 成 assistant 气泡；执行状态由 ToolCallCard 承载。clarification 同策略。
- AC：手测「我来读取…/现在添加…」不再出现独立气泡；补/复用 Desktop 单测覆盖 commit 边界。

### FR-F2：authoritative final 覆盖已提交临时正文

- 落点：新增 `desktop/src/utils/assistant-output.ts:buildCommittedAssistantPatch(final)`（纯函数）；`ChatPane.tsx` SSE 收尾 `isCommitted(requestSessionId)` 分支（`:9823`）与 `ChatView.tsx` `streamCommittedRef` 收尾（`:1236`/`:1254`）统一调用。
- After：收到 `final` 且公开正文非空时，向已提交消息 patch `content`；reasoning/引用/推荐问题/terminal metadata 一并合并；非 final 阶段不得覆盖临时正文。
- AC：`assistant-output.test.ts` 断言 final 正文覆盖临时内容、reasoning 独立保留；非 final patch 不带 `content`。`npm run build` 通过。

**参考片段**：tip `buildCommittedAssistantPatch`（`assistant-output.ts` + `.test.ts`）。

---

## 子波次 G：默认模型 session 绑定优先级

### FR-G1：resolveSessionBindingModel 纯函数

- 落点：`desktop/src/utils/model-options.ts` 新增 `resolveSessionBindingModel(input)`（参考 tip `154-189`）。
- 优先级：显式 session model →（仅 `sessionModelKnown=false` 时）pane 手动选择 → avatar default → global default → active fallback。`sessionModelKnown=true` 且 session 空时**禁用** pane 布局快照（避免旧全局默认继承副本压过新默认）。
- AC：`model-options.test.ts` 三例：空 session metadata 从 `glm-4.5-air` 迁到 `glm-5.2`；懒创建（`sessionModelKnown=false`）保留手动 `glm-4.5-air`；显式 session `glm-4.5-air` 不被全局 `glm-5.2` 覆盖。

### FR-G2：store 接线

- 落点：`desktop/src/store.ts:addPane`（`:593`）、`setPaneSessionId`（`:685`，签名已带 `modelHint?`）。
- After：`addPane` 用 avatar default → global default → active fallback，不再直接继承其他 active pane（现状继承 `activeProvider/activeModel`，见 `:1419-1420` 区）。`setPaneSessionId` 以 `modelHint !== undefined` 表示调用方已查询 session metadata（空 hint = 该 session 无专属模型，走全局默认）；省略 hint = 懒创建，保留当前 pane 手动模型。两者内部改用 `resolveSessionBindingModel`。
- AC：启动恢复无专属模型的旧 Meta session 显示 `glm-5.2`；打开显式保存 `glm-4.5-air` 的历史 session 仍显示 `glm-4.5-air`；新对话请求用 UI 当前显示模型。`npx vitest run src/utils/model-options.test.ts` + `npm run build`。

**参考片段**：tip `resolveSessionBindingModel`（`model-options.ts:154-189` + test）。可选一并吸收 `resolveRequestModelIdentity`/`resolveStatusModelIdentity`（`model-display.ts`）作独立小步。

---

## 子波次 H：工具前端独立秒表

### FR-H1：共享计时器

- 落点：新增 `desktop/src/components/messages/tool-elapsed-timer.ts`，导出 `normalizeToolElapsedSeconds`、`formatToolElapsedSeconds`、hook `useLiveToolElapsedSeconds`（`pending/running` 每秒自增；tool id 变化重置；收到后端 elapsed 取本地与上报最大值，不倒退）。
- AC：新增 `tool-elapsed-timer.test.ts` 覆盖秒数归一化与分钟格式。

### FR-H2：单卡与折叠组常驻展示

- 落点：`ToolCallCard.tsx`（标题右侧「运行中 · Ns」，不要求展开）；`TurnToolGroupCard.tsx`（折叠标题「正在调用 <tool>」+ 右侧「运行中 · Ns」；并行取最后一个运行工具并显示数量）。
- AC：Vitest 通过；`npm run build` 通过；折叠组在无新 `tool_progress` 事件时秒数仍递增。

**参考片段**：tip `tool-elapsed-timer.ts` 整文件 + `.test.ts`、`ToolCallCard`/`TurnToolGroupCard` 接线。

---

## 验收命令汇总

后端（A–D、E/后端部分）：
```bash
pytest -q tests/test_llm_timeout_resolution.py tests/test_agent_runtime.py \
  tests/test_reasoning_only_turn_retry.py tests/test_loop_detector.py \
  tests/test_studio_continuation.py tests/test_studio_server.py \
  tests/test_assistant_output_parser.py tests/test_session_manager_persistence.py \
  --disable-warnings --maxfail=1
# 若改 server.py：agx serve --host 127.0.0.1 --port <临时端口> 冷启动
#   并 curl /api/session /api/avatars /api/sessions 断言 200
```

Desktop（E/前端、F、G、H）：
```bash
cd desktop && npx vitest run \
  src/utils/assistant-output.test.ts \
  src/components/messages/reasoning-parser.test.ts \
  src/utils/model-options.test.ts \
  src/components/messages/tool-elapsed-timer.test.ts \
  src/components/messages/ImBubble.test.tsx && npm run build
```

## 落地顺序与提交

1. 在 `fix/glm-stream-finalization-rework`：后端 A → B（跳过 B3 实现）→ C → D，每段独立 commit + 绿测。
2. 同分支继续 Desktop：E → F → G → H，每段独立 commit + 绿测/build。
3. 每个 commit 关联本 plan：`/commit --spec=.cursor/plans/2026-07-23-glm-stream-finalization-port.plan.md`，注入 `Plan-Id: 2026-07-23-glm-stream-finalization-port` / `Plan-File`；trailer 顺序 `Plan-Id → Plan-File → Plan-Model → Impl-Model → Made-with: Damon Li`。
4. `Plan-Model`/`Impl-Model` 取值由用户提供（未提供先问，不编造）；cherry-pick 对方片段的 commit body 加 `Ported-ref: fix/glm-stream-common-finalization@5bf63d3e`（或 `fix/glm-stream-finalization-port@f525277a`）。
5. 全部落地并合入 main 后，再删本地/远端 `fix/glm-stream-finalization-port`；`/update-conclusion --plan=.cursor/plans/2026-07-23-glm-stream-finalization-port.plan.md` 更新相关模块 conclusion。

## 反面清单（禁止）

- 禁止 `git merge origin/fix/glm-stream-common-finalization` 或 `git merge fix/glm-stream-finalization-port`。
- 禁止照抄 tip `:4152` 的第二次 `agent_messages.append`（FR-C1 硬约束）。
- 禁止照抄 tip `ChatPane` 的 `streamPhase` thinking→answering 死锁逻辑；若要内容相位机则**重写**（否则维持现有 `silenceTier`，本 plan 默认不引入相位机）。
- 禁止重排 `server.py` 顶部 import；禁止回退 vision-continue（strip / rehydrate / 视觉 tool_stream 门控 / text-attachment sourcePath）。
- 禁止顺手改无关逻辑 / 清理无关工作树改动（no-scope-creep）。
