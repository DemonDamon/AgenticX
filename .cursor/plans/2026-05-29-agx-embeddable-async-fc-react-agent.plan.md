# AGX 可嵌入原语二期：真·async + 原生 function-calling + 流式 DI ReAct Agent

> **Date**: 2026-05-29
> **前置**: `.cursor/plans/2026-05-29-agx-absorb-agentscope-v2-p0.plan.md`（P0-0 已交付门面，但范式不达标，见 §1）
> **触发**: AGX vs AgentScope "谁更适合当可嵌入 SDK 底座" 外部辩论 + 南网/AIBOX 真实需求（`南网技术实现需求.md`）
> **Status**: Draft v2（已并入领先性评审优化点：流式/正典命名/多轮/typed 事件/真 provider 验证/取消，见 §4）

---

## 0. 已核实的技术地基（de-risk，2026-05-29）

实现选型 A 依赖的关键能力均已在仓库核实存在，§5 对应风险降级：

- `BaseTool.to_openai_schema()` 存在（`agenticx/tools/base.py:437`）。
- `LiteLLMProvider.ainvoke` 接受 `tools=`（`litellm_provider.py:82`）并把上游 `tool_calls` 真正解析进 `LLMResponse.tool_calls`（L375–420）；kimi/ark/bailian/zhipu provider 亦处理 `tool_calls`。
- 流式 tool-call delta 已有：`BaseLLMProvider.stream_with_tools` + LiteLLM 流式分支（`litellm_provider.py:229/294`）。
- `LLMResponse.tool_calls: Optional[List[Dict]]`（`llms/response.py:35`）为 OpenAI function-calling 格式。

**结论**：FC + async + 流式三件套对真实 provider 可落地，非仅 mock 可跑。

---

## 1. 为什么 P0-0 门面还不够（诚实记录）

P0-0 交付的 `agenticx/agents/react_agent.py` 满足了"import 无 Studio 耦合"，但它是**薄包 `AgentExecutor`**，因此继承了 `AgentExecutor` 的旧范式（已核实代码）：

| 维度 | 现 `ReActAgent` 门面（包 AgentExecutor） | 目标 |
|---|---|---|
| 干净 DI / 零 studio 耦合 | ✅ | ✅ |
| 原生 function calling | ❌ 文本 ReAct + JSON 解析（`prompt_manager.build_prompt("react")` + `ActionParser`，**不传 `tools=`**） | ✅ `tool_calls` |
| 全 async | ❌ `run()` 同步；`arun()` 仅 `asyncio.to_thread(self.run)`，且 `AgentExecutor._execute_loop` 内含 `run_until_complete`（在已运行 loop 中会炸/在 worker 线程中行为不稳） | ✅ 原生 async，可在已运行的 FastAPI event loop 内 `await` |
| 电池可注入 | 部分（memory/knowledge 只是塞进 agent 配置，未真正驱动循环） | ✅ tools 必注入，memory/compaction 可选注入并真正生效 |

**外部辩论的决定性结论正是**："AGX 没有任何一套同时具备 {干净 DI + 原生 FC + 全 async}"——P0-0 没有关上它。要"确保 AGX 底层领先性"，必须补这一项。

南网需求侧亦印证：其 Phase 0–3 明确走 **LLM Function Calling + 全 async FastAPI + 自写薄 loop（仅复用 `BaseTool`/`ToolRegistry`）**（见 `南网技术实现需求.md` L51/L173-174/L228）。本原语正好是他们手写那层 loop 的"可选官方实现"。

---

## 2. 目标与非目标

### 目标
- 交付一个**全新的、最小的** async + 原生 function-calling + **流式** 依赖注入式 ReAct 循环，作为 AGX **唯一正典** 可嵌入原语；**复用** `BaseTool` / `ToolRegistry` / `LoopDetector` / `ContextCompactor` / `Offloader` / 现成 `BaseLLMProvider`，**不包 `AgentExecutor`**、**不改** `AgentExecutor`/`AgentRuntime`/`Agent`/`Task` 既有逻辑。
- **正典命名收敛（高优先级）**：本原语成为对外暴露的正典 `ReActAgent`（FC+async+流式）；P0-0 已交付的文本 ReAct 门面降级——重命名为 `TextReActAgent` 并标 `Legacy`/`deprecated` 文档提示，`agents/__init__.py` 只把"现代范式"作为头牌导出。**对外只有一个 ReAct 头牌**，避免"两个并存 ReAct"的指挥不定观感。
  - 兼容：保留 `TextReActAgent` 类与其测试，旧调用方不破坏；但文档与 README 示例统一指向正典。
- 单轮与**多轮**并重：原语既支持一次性 `arun(query)`，也支持携带/累积对话历史的多轮（见 FR-7）。

### 非目标
- 不改 `runtime/agent_runtime.py`（Studio 产品运行时保持不动）。
- 不引入新依赖。
- 不做 Desktop/Studio 接线（本期只交付可被外部 `import` 的 SDK 原语 + 冒烟）。
- 不在本期做包根 eager-import 惰性化（P0-0 已记录的 `agenticx.cli.config_manager` 残留另开议题）。

---

## 3. 实现选型（待用户拍板）

| 方案 | 描述 | 取舍 |
|---|---|---|
| **A（推荐）** | 全新薄循环 `agenticx/agents/react_agent_async.py`（导出为正典 `ReActAgent`）：核心是 `astream(query)` 异步生成器——`ainvoke(messages, tools=[t.to_openai_schema()], tool_choice="auto")` → 读 `LLMResponse.tool_calls` → `ToolRegistry` 并行派发 → 回填 `role=tool` → 循环；产出 typed `AgentEvent`；`arun` 聚合 `astream`；接 `LoopDetector` 回灌 `nudge`；可选注入 `ContextCompactor`/`Offloader`；支持 `history` 多轮与取消 | 复用度高、范式正确（FC+async+流式）、契合南网；新增 ~450–600 行 |
| B | 从 `AgentRuntime` 抽 FC+async 内核、剥 `StudioSession` | 复用最多但拆解风险大、波及面广，违背"不动产品运行时" |
| C | 不做，仅文档标注门面局限 | 不关短板，否决 |

推荐 **A**：它正是南网已自证可行的范式，且最小侵入。

---

## 4. 需求（FR / NFR / AC）

### FR
- **FR-1**: `ReActAgent(llm, tools=[...], system_prompt=..., max_iterations=...)` 构造即用；`await agent.arun(query) -> ReActResult`；同步 `run()` 仅在无运行 loop 时提供便捷封装（检测到运行中的 loop 时抛清晰错误，引导用 `arun`）。
- **FR-2**: 循环用**原生 function calling**：每轮 `ainvoke(messages, tools=schemas, tool_choice="auto")`，依据 `LLMResponse.tool_calls` 决定行动；无 tool_calls 即终止并返回 `content`。
- **FR-3**: 工具派发复用 `ToolRegistry`；多 `tool_calls` 支持并发执行（`asyncio.gather`）；sync 工具 `_run` 用 `asyncio.to_thread` 包裹避免阻塞 loop；工具异常包成 `role=tool` 错误消息回填，不崩溃。
- **FR-4**: 接 `LoopDetector`，命中重复/饱和时把 `nudge` 作为 system 提示回灌（补上现状只 `warning` 不回灌的缺口）。
- **FR-5**: 可选注入 `ContextCompactor`：开启时每轮 `ainvoke` 前 `await maybe_compact(messages, model=...)`；不注入则行为等同关闭。
- **FR-6**: 可选注入 `Offloader`（复用本仓 `agenticx/core/offload`）：超阈值 tool result 外置为 `Reference` 占位符。本原语作为 Offloader 的首个真实消费者。
- **FR-7（多轮，高优先级）**: 支持多轮对话——`arun(query, history=[...]) -> ReActResult`（`ReActResult.messages` 回传新的完整历史供下一轮传入）；或可选内部 `memory` 自动累积。单轮为多轮的退化形式。
- **FR-8（流式，高优先级）**: 一等流式 API `async def astream(query, history=None) -> AsyncIterator[AgentEvent]`，逐步产出 token/推理/工具调用/工具结果/最终事件，可直接落进 FastAPI SSE。`arun` 内部复用 `astream` 聚合，保证两条路径语义一致。
- **FR-9（typed 事件）**: 定义最小 typed 事件 union `AgentEvent = ReasoningEvent | ToolCallEvent | ToolResultEvent | FinalEvent`（必要时加 `TokenEvent`/`ErrorEvent`）。`astream` 产出它；同一事件流天然衔接 observability/usage 与 FR-6 的 Offloader。不过度设计，≤6 类。
- **FR-10（取消/中断）**: 全链路可取消——`arun`/`astream` 能干净响应 `asyncio.CancelledError`；提供可选 cancel token/`stop()` 语义，承接"中途打断"类需求。已发出的工具调用尽力安全收尾。

### NFR
- **NFR-1**: `import` 本原语模块不得拉入 `agenticx.studio` / `cli.agent_tools` / `cli.studio_mcp` / `cli.studio_skill` / `runtime.agent_runtime`。
- **NFR-2**: 全链路 async，可在已运行的 event loop 内 `await arun()` / `async for ... in astream()` 不抛 `event loop is already running`。
- **NFR-3**: 零新增依赖。
- **NFR-4**: `arun` 与 `astream` 行为一致性——同输入下 `arun` 的最终结果 == 聚合 `astream` 的 `FinalEvent`。

### AC（冒烟测试 `tests/test_smoke_agx_fc_react_agent.py`）
- **AC-1**: 注入 mock FC provider（首轮返回 `tool_calls`，次轮返回最终 `content`）+ 一个 echo `BaseTool`，`await arun("...")` 跑通，结果含工具产出。（happy path，原生 FC）
- **AC-2**: 在**已运行的 event loop** 内 `await arun()` / `astream()` 正常返回（验证真 async，对照旧门面的 `run_until_complete` 缺陷）。
- **AC-3**: 工具抛异常时回填错误消息且循环可继续/优雅终止（失败路径）。
- **AC-4**: import 纯净性断言（NFR-1）。
- **AC-5**: 并发多 tool_calls 一轮内全部执行（边界）。
- **AC-6（流式）**: `astream` 产出有序事件序列，末位为 `FinalEvent`；其内容 == 同输入 `arun` 结果（NFR-4 一致性）。
- **AC-7（多轮）**: 两次 `arun` 携带 `history` 接力，第二轮能引用第一轮上下文。
- **AC-8（取消）**: 在 `astream` 迭代中途取消任务，不挂起、不吞异常、可观测到中断。
- **AC-9（真 provider，可选）**: `@pytest.mark.skipif(无 OPENAI/兼容 key)` 的端到端用例，对真实 OpenAI 兼容端点跑通一次 FC 工具调用闭环，防"mock 全绿、真模型空心"。

---

## 5. 风险
- ~~`to_openai_schema()` / `LLMResponse.tool_calls` schema 是否存在~~ → **已在 §0 核实存在，降级**。mock provider 仍需对齐该结构（参照 `litellm_provider.py:375-420` 的 `raw_tool_calls` 构造）。
- `ToolRegistry` 工具执行的 sync/async 边界：sync `_run` 需 `asyncio.to_thread` 包裹（已落入 FR-3）。
- **命名收敛风险**：正典定为 `ReActAgent`（FC+async+流式），P0-0 旧类重命名 `TextReActAgent` 并标 legacy。需同步更新 `agents/__init__.py` 导出、P0-0 plan 引用与既有冒烟测试的 import；务必保证旧测试仍绿（兼容别名或同步改测试）。
- 流式与非流式一致性（NFR-4）：`arun` 必须复用 `astream` 聚合，避免两套循环逻辑漂移。
- 取消语义跨工具并发（FR-10）：`asyncio.gather` 取消时需 `return_exceptions` + 收尾，避免悬挂任务。

---

## 6. 与既有工作关系
- 与 P0-0 plan 衔接：P0-0 解决"可发现性/无 studio 耦合"并验证 `AgentExecutor` 可干净嵌入；本 plan 把头牌升级为"现代范式（FC + async + 流式 + 多轮）"并收敛为单一正典 `ReActAgent`——合起来才真正反转外部辩论结论。
- Offloader（已交付）作为 FR-6 的可选注入件被本原语首个真实消费。
- 南网/AIBOX：本原语正是其手写 async-FC loop 的"官方可选实现"，`astream` 直供其 FastAPI SSE。

## 7. 反转辩论的最小充分集（领先性判定）
仅"FC + async 非流式单轮"**不足以**反转辩论。关上短板的最小充分集 = **FC + 原生 async + 流式事件（FR-8/9）+ 单一正典命名（§2）+ 多轮（FR-7）**，并以真 provider 用例（AC-9）证明非空心。五者齐备，本原语方配称"AGX 头牌、确保领先"。
