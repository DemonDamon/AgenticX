# AgenticX Agents 模块总结

> 结论更新时间：2026-05-29（覆盖 2026-01-02 之后的变更）（新增可嵌入的规范 ReActAgent SDK 原语与 legacy 文本门面）

## 模块概述

AgenticX Agents 模块提供专门化的智能体实现，封装特定领域的智能体能力。该模块基于 core.agent.Agent 基类，实现具有特定功能的智能体。**模块同时提供可作为 SDK 原语直接嵌入的规范 ReActAgent（原生函数调用 + 全异步 + 流式事件，零 Studio/CLI 耦合）。**

## 目录结构

```
agenticx/agents/
├── __init__.py                    # 模块导出接口（规范 ReActAgent 为首选导出，TextReActAgent 为 legacy 别名）
├── react_agent_async.py (NEW)     # 规范异步 FC ReActAgent（可嵌入 SDK 原语）
├── agent_events.py (NEW)          # ReActAgent 流式事件类型联合（<=6 类）
├── react_agent.py (NEW)           # legacy 文本-JSON ReAct 门面（AgentExecutor 薄封装，内化自 AgentScope v2 P0）
├── mining_planner_agent.py        # 智能挖掘规划器（DeerFlow + AgentScope 内化）
├── mining_graph.py (NEW)          # 基于图驱动的挖掘工作流（内化自 Pydantic AI）
├── spawn_worker.py (NEW)          # 递归 Worker 生成器（内化自 AgentScope）
└── query_optimizer_agent_plan.md  # 查询优化器Agent设计文档
```

## 核心组件分析

### ReActAgent (react_agent_async.py, 新增)

**文件功能**：规范的异步函数调用（Function Calling）ReAct 智能体，作为可嵌入的 SDK 原语对外提供，**不依赖 `AgentExecutor` 或任何 Studio/CLI 运行时**。

**技术实现**：基于 `LLMResponse.tool_calls` 的原生工具调用循环（无文本解析），全异步 + 类型化事件流，支持多轮历史进出。

**关键组件**：
- `ReActAgent` 类：核心循环
  - `astream(query, history)`：运行 FC 循环并产出类型化 `AgentEvent` 事件流（作为唯一事实来源 NFR-4）
  - `arun(query, history)`：聚合 `astream` 为 `ReActResult`
  - `run(query, history)`：同步便捷封装，在已有事件循环中调用时明确报错引导改用 `arun`
  - `add_tool()` / `stop()`：动态注册工具 / 请求优雅中断
  - 工具调度：`asyncio.gather` + `run_in_executor` 并行执行同一轮的多个 `tool_calls`（避免 `BaseTool._is_running` 串行化）
  - 可选注入：`compactor`（上下文压缩）、`offloader`（超阈值工具结果落盘并回填占位符，依赖 `core.offload`）、`loop_detector`（`runtime.loop_detector.LoopDetector`，循环检测后注入 nudge system 消息）
- `ReActResult` 数据类：`success` / `output` / `error` / `messages`（历史进出）/ `iterations` / `events`
- 取消语义：透传 `asyncio.CancelledError`，并在事件流中产出不可恢复 `ErrorEvent`

**业务逻辑**：作为对外 SDK 的「一等公民」ReAct 原语，覆盖原生工具调用、流式可观测、循环检测、上下文压缩/卸载等能力，且与产品运行时解耦，便于在 FastAPI SSE、嵌入式集成等场景复用。

**依赖关系**：依赖 `core.agent_executor.ToolRegistry`、`core.offload.protocol`（Offloader/should_offload）、`llms.base.BaseLLMProvider`、`runtime.loop_detector.LoopDetector`、`tools.base.BaseTool` 与本模块 `agent_events`。

### AgentEvent 事件类型 (agent_events.py, 新增)

**文件功能**：为规范 ReActAgent 流式输出定义最小化（≤6 类）的类型化事件联合，服务于 FastAPI SSE、可观测性与 `arun`/`astream` 一致性。

**关键组件**：`TokenEvent`（文本增量）、`ReasoningEvent`（一次推理/模型调用迭代起点）、`ToolCallEvent`（模型请求工具调用）、`ToolResultEvent`（工具执行结果）、`FinalEvent`（终态：最终产出 + 消息历史 + 迭代数）、`ErrorEvent`（可恢复/终态错误）；`AgentEvent = Union[...]`。

**依赖关系**：被 `react_agent_async.ReActAgent.astream` 消费。

### TextReActAgent (react_agent.py, 新增 / legacy 门面，内化自 AgentScope v2 P0)

**文件功能**：legacy 文本-JSON ReAct 门面，作为 `AgentExecutor` 的薄封装（依赖注入式），**零产品耦合（不导入 `agenticx.cli` / `studio` / `StudioSession`）**。已标注 `.. deprecated::`，新代码应优先使用规范 `ReActAgent`。

**技术实现**：仅组合既有原语——一个 `core.agent.Agent` 描述 + 一个 `AgentExecutor`，不修改 `AgentExecutor` 或核心 `Agent`/`Task` 模型。

**关键组件**：
- `TextReActAgent` 类：构造时接收 `llm` / `tools` / `role` / `goal` / `memory` / `knowledge` / `plan` / `compaction_config` / `enable_context_compilation` 等；`run()` / `arun()` 构建 `Task` 并驱动 executor 的 reason→act 循环（`arun` 经 `asyncio.to_thread` 封装）
- `ReActResult` 数据类（本文件局部）：`success` / `output` / `error` / `steps` / `stats` / `event_log`

**业务逻辑**：为存量调用提供向后兼容的一行式可嵌入 ReAct 入口；冒烟测试断言「导入本模块不会拖入产品运行时依赖」。

**依赖关系**：依赖 `core.agent.Agent`、`core.agent_executor.AgentExecutor`、`core.event.CompactionConfig`、`core.task.Task`、`llms.base.BaseLLMProvider`、`tools.base.BaseTool`。

### MiningPlannerAgent (mining_planner_agent.py)

**文件功能**：智能挖掘规划器，生成结构化的探索/挖掘计划，并管理子 Worker 的执行

**技术实现**：内化自 DeerFlow Planner + AgentScope Plan Module，集成 LLM 驱动的计划生成、Plan-as-a-Tool 机制与动态发现集成

**核心组件分析**：
- MiningPlannerAgent 类：继承自 core.agent.Agent
- 核心方法：
  - `plan()`: 生成挖掘计划，支持同步到 PlanNotebook，获取状态感知提示；**支持 `run_parallel` 参数触发子任务并行执行**
  - `_clarify_goal()`: 多轮澄清机制
  - `execute_plan_in_parallel()`: **[新增] 并行执行当前计划的所有子任务，并同步状态至 PlanNotebook**
  - `auto_integrate_discoveries()`: 自动集成来自子 Worker 的高优先级发现
  - `spawn_worker_for_step()`: 为计划中的特定步骤生成并运行递归 Worker
- 集成组件：
  - `PlanNotebook`: 负责计划的状态追踪与工具化管理
  - `SOPRegistry`: **[新增] 轻量 SOP 召回，注入标准作业程序引导 Prompt**
  - `DiscoveryBus`: 接收来自整个系统的动态发现通知
  - `WorkerSpawner`: 负责递归子智能体的生命周期管理

**业务逻辑**：
1. 澄清模糊目标，生成结构化初始计划
2. **SOP 引导**：在计划生成阶段自动召回相关 SOP，引导 LLM 生成标准化的任务步骤
3. **计划动态演进**：通过 Plan-as-a-Tool 允许 LLM 根据执行结果实时修订计划
4. **子任务并行化**：支持对独立子任务进行并行分发（Slave Parallelism），提升执行效率
5. **能力闭环**：通过 Discovery Loop 实时获取子 Worker 发现的新能力并集成
6. **递归执行**：将复杂步骤委派给专门的子 Worker，实现任务的层级化分解

**依赖关系**：
- 依赖 core.plan_notebook.PlanNotebook
- 依赖 memory.sop_registry.SOPRegistry
- 依赖 core.slave_parallel_executor.SlaveParallelExecutor
- 依赖 core.discovery.DiscoveryBus
- 依赖 agents.spawn_worker.WorkerSpawner

### MiningGraph (mining_graph.py, 新增)

**文件功能**：实现基于图驱动的自动化挖掘工作流

**技术实现**：内化自 Pydantic AI 的图执行理念，采用“探索-验证-反馈”三节点循环架构

**关键组件**：
- `ExploreNode`: 负责环境探测，发现新 API 或工具，并将其加入待验证队列
- `ValidateNode`: 核心验证节点，集成 `core.tool_v2` 的校验能力，支持拦截校验异常
- `FeedbackNode`: 反馈生成节点，利用 LLM 对校验错误进行语义分析并生成修正建议
- `MiningState`: 持久化执行状态，记录已发现 API、已验证工具、重试计数及消息历史
- `MiningGraphRunner`: 高级运行器，封装图构建与执行细节，提供同步/异步双接口

**业务逻辑**：通过确定性的图拓扑（Explore -> Validate <-> Feedback）管理不确定的挖掘过程，确保每个发现的能力都经过严格的自愈式验证
**依赖关系**：依赖 `core.graph` (执行引擎) 和 `core.tool_v2` (自愈校验)

### WorkerSpawner (spawn_worker.py, 新增)

**文件功能**：实现递归智能体（Sub-worker）的生成与生命周期管理

**技术实现**：内化自 AgentScope 的元规划思想，支持结构化输出、流式响应与上下文共享

**关键组件**：
- `WorkerSpawner` 类：核心生成器，管理并发 Worker 数量与状态
- `WorkerConfig` 与 `WorkerContext`：定义子 Worker 的运行参数与上下文环境
- `spawn_worker()`: 异步生成方法，支持工具动态绑定与 Discovery Loop 接入
**业务逻辑**：支持"智能体生智能体"模式，子 Worker 在执行时会自动向父 Agent 的发现总线上报新发现，并共享父 Agent 的上下文编译能力以优化 Token 消耗
**依赖关系**：被 `mining_planner_agent.py` 使用

## 设计模式

### 1. 策略模式
- 多种探索策略（breadth_first、depth_first、adaptive）
- 多种停止条件（max_steps、cost_limit、confidence_threshold）

### 2. 模板方法模式
- `plan()` 方法定义标准流程：澄清 -> 生成 -> 验证 -> 审查
- 子类可覆盖特定步骤实现定制化

### 3. 降级模式
- LLM 不可用时自动切换到预定义计划模板
- 确保系统在各种环境下都能运行

## 技术亮点

1. **防止 LLM 幻觉**：强制至少一个步骤需要外部信息（need_external_info）
2. **成本控制**：max_total_cost 硬限制，实时成本追踪
3. **人工协作**：澄清机制和计划审查，平衡自动化和人工监督
4. **可观测性**：统计信息收集，支持性能分析和优化

## 应用场景

1. **开源框架挖掘**：自动发现和评估 GitHub 上的新 AI 框架
2. **API 接口探索**：探索未知 RESTful API 并生成调用示例
3. **长周期探索**：复杂领域的深度探索（如量子计算进展）
4. **知识发现**：自动挖掘和验证新知识、新工具、新策略

## 总结

AgenticX Agents 模块通过 MiningPlannerAgent 引入了 DeerFlow 的核心机制，实现了从自由探索到结构化计划的转变。该模块为智能体自动挖掘提供了强大的规划能力，平衡了探索效率和成本控制，是 AgenticX 在智能探索领域的重要增强。

**最新增强（2026-05-29）**：新增规范的可嵌入 ReActAgent SDK 原语（`react_agent_async.py`）——原生函数调用循环、`arun`/`astream` 双接口、类型化 `AgentEvent` 流（`agent_events.py`）、多轮历史进出、`asyncio.gather` 并行工具执行，并可选注入 `LoopDetector` / 上下文压缩器 / `Offloader`，全程零 Studio/CLI 耦合；同时新增 legacy 文本-JSON `TextReActAgent` 门面（`react_agent.py`，内化自 AgentScope v2 P0）作为向后兼容入口，`TextReActAgent` 与其 `ReActResult` 在 `__init__.py` 以别名导出（`TextReActResult`）。

