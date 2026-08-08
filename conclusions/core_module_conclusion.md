# AgenticX Core 模块完整结构分析

> 结论更新时间：2026-05-29（覆盖 2026-04-14 之后的变更）（新增 offload/ 统一卸载子系统，内化自 AgentScope v2 P0）

## 目录路径
`D:\myWorks\AgenticX\agenticx\core`

## 模块概述

AgenticX Core 模块是整个 AgenticX 框架的核心基础层，实现了多智能体系统的基本抽象、执行引擎和编排能力。该模块遵循"12-Factor Agents"设计原则，提供了事件驱动、状态无关的智能体架构。

## 完整目录结构和文件摘要

### 核心文件结构
```
D:\myWorks\AgenticX\agenticx\core/
├── __init__.py (增强版) [新增：导出 Hooks、Flow、Delegation、SelfRepair]
├── agent.py (增强版) [新增：crewAI 字段 - allow_delegation, hooks, max_iterations]
├── agent_executor.py (增强版) [新增：集成 Hooks 系统、Auth Profile 轮换、Transcript 卫生管线]
├── communication.py (4,567 bytes)
├── code_action_executor.py [新增：受限代码执行器]
├── slave_parallel_executor.py [新增：子任务并行执行器]
├── executor.py [增强：Windows 下可选 POSIX resource，沙箱 setrlimit 与内存回退]
├── component.py (1,234 bytes)
├── context_compiler.py [上下文编译器（参考 ADK），集成 OverflowRecoveryPipeline]
├── discovery.py [新增：发现总线与注册器（参考 AgentScope）]
├── error_handler.py (5,678 bytes)
├── event.py (6,789 bytes) [增强：CompactedEvent、CompactionConfig]
├── execution_lane.py [增强：Generation Counter 热重启隔离（参考 OpenClaw）]
├── graph.py [新增：轻量级图执行引擎（参考 Pydantic AI）]
├── interruption.py [新增：实时中断与状态恢复（参考 AgentScope）]
├── message.py (1,890 bytes)
├── overflow_recovery.py [新增：三级渐进式上下文溢出恢复（参考 OpenClaw）]
├── plan_notebook.py [新增：计划笔记本（参考 AgentScope）]
├── plan_storage.py [新增：计划存储（参考 AgentScope）]
├── platform.py (2,345 bytes)
├── prompt.py (7,890 bytes) [增强：CompiledContextRenderer、PromptMode 分级]
├── self_repair.py [新增：卡死任务/失效工具自动恢复（内化自 IronClaw）]
├── task.py (1,567 bytes)
├── task_validator.py (25,234 bytes)
├── token_counter.py [新增：精确 Token 计数器]
├── tool.py (3,456 bytes)
├── workflow.py (2,678 bytes)
├── workflow_engine.py (34,567 bytes)
├── guiderails.py [新增：输出验证系统（参考 AIGNE Framework）]
├── handoff.py [增强：Agent 切换机制 + Subagent 深度/数量限制 + PromptMode 传递（参考 AIGNE + OpenClaw）]
├── stream_accumulator.py [增强：跨 chunk 的 <thinking> 标签解析（参考 OpenClaw）]
├── memory_extraction.py [新增：记忆提取管道（参考 AIGNE Framework）]
└── offload/ [新增：统一卸载子系统（内化自 AgentScope v2 P0）]
    ├── __init__.py        # 导出 Offloader / Reference / FileOffloader / should_offload 等
    ├── protocol.py        # Offloader 协议 + Reference 句柄 + should_offload/compute_handle 等工具
    └── file_offloader.py  # 文件系统后端 FileOffloader（落盘 ~/.agenticx/offload/<session>/）
```

### 新增模块（参考 crewAI）

#### hooks/ 目录（新增，参考 crewAI）
**模块功能**：提供 LLM 和 Tool 调用的可定制钩子机制，支持自动事件通知和执行流程定制
**技术实现**：全局钩子注册表 + Agent 级别钩子，支持 before/after 执行点，支持链式执行和提前返回
**关键组件**：
- `types.py` - 钩子上下文定义：
  - `LLMCallHookContext`：LLM 调用上下文，包含 agent_id、task_id、messages、model、temperature、max_tokens、iteration、timestamp；after call 时包含 response、tokens_used、cost、duration_ms、error
  - `ToolCallHookContext`：工具调用上下文，包含 agent_id、task_id、tool_name、tool_args、iteration、timestamp；after call 时包含 result、success、duration_ms、error
- `llm_hooks.py` - LLM 钩子管理：
  - `register_before_llm_call_hook()`：注册全局 LLM 调用前 hook
  - `register_after_llm_call_hook()`：注册全局 LLM 调用后 hook
  - `execute_before_llm_call_hooks()`：执行钩子链（支持全局和 Agent 级别），允许修改消息或返回 False 阻止执行
  - `execute_after_llm_call_hooks()`：执行后续钩子链，可访问响应、成本、耗时等信息
  - `clear_llm_hooks()`：清除所有 LLM hooks
- `tool_hooks.py` - Tool 钩子管理：
  - `register_before_tool_call_hook()`：注册全局 Tool 调用前 hook
  - `register_after_tool_call_hook()`：注册全局 Tool 调用后 hook
  - `execute_before_tool_call_hooks()`：执行钩子链（支持全局和 Agent 级别），允许修改参数或返回 False 阻止执行
  - `execute_after_tool_call_hooks()`：执行后续钩子链，可访问执行结果、耗时等信息
  - `clear_tool_hooks()`：清除所有 Tool hooks
**业务逻辑**：
- 支持全局钩子和 Agent 级别钩子的两层管理
- before hooks 支持修改执行参数或通过返回 False 阻止执行
- after hooks 用于获取执行结果、收集指标、触发事件等
- 与 WorkforceEventBus 集成，自动发送 Agent/Toolkit 激活/停止事件
**依赖关系**：被 `agent_executor.py` 在 LLM 调用和 Tool 调用时自动调用，支持全局事件监听和执行流程定制

#### flow/ 目录（新增）
**模块功能**：提供事件驱动的工作流编排能力，支持装饰器定义工作流拓扑
**技术实现**：基于元类的装饰器注册机制，支持条件触发和状态管理
**关键组件**：
- `Flow` 基类：工作流基类，支持泛型状态类型（dict 或 Pydantic Model）
- `FlowMeta` 元类：在类创建时扫描并注册 Flow 方法
- `@start` 装饰器：标记起始方法
- `@listen` 装饰器：标记监听方法，响应其他方法完成
- `@router` 装饰器：标记路由方法，根据返回值决定执行路径
- `or_()` / `and_()`：条件组合器，支持嵌套条件
- `FlowState`：状态基类，所有 Flow 状态的基类
- `FlowExecutionState`：执行状态追踪器，追踪已完成方法、输出、待处理监听器
**业务逻辑**：通过装饰器定义工作流拓扑，自动处理条件触发和执行顺序，支持同步和异步执行
**依赖关系**：独立模块，可被工作流引擎或其他编排系统使用

**新增：ExecutionPlan 协议（参考 Refly）**
**模块功能**：提供显式进度计划、动态重规划和人类干预能力，支持可干预智能体（Intervenable Agent）
**技术实现**：基于 Pydantic 的数据模型，支持 Mermaid 流程图序列化和执行摘要生成
**关键组件**：
- `ExecutionPlan`：执行计划主类，包含阶段列表、当前阶段索引、干预状态等
- `ExecutionStage`：执行阶段，包含多个子任务和阶段状态
- `Subtask`：子任务定义，最小可执行单元，支持状态转换（pending/executing/completed/failed）
- `InterventionState`：干预状态枚举（RUNNING/PAUSED/RESUMING/RESETTING）
- `ExecutionPlanManager`：计划生命周期管理器，支持 CRUD 操作、持久化、事件通知
- `InMemoryPlanStorage` / `FilePlanStorage`：存储后端实现
**核心能力**：
- 计划序列化：`to_mermaid()` 生成 Mermaid 流程图，`to_execution_summary()` 生成执行摘要
- 干预操作：`pause()` / `resume()` / `reset_node()` 支持执行中干预
- 计划修改：`add_subtask()` / `delete_subtask()` / `advance_stage()` / `advance_epoch()` 支持动态调整
- 进度追踪：自动计算阶段进度和整体进度百分比
**业务逻辑**：支持复杂、长时任务的可控性和可观测性，允许用户暂停、修改 Agent 状态并无缝恢复
**依赖关系**：独立于 Flow 基础系统，可被工作流引擎、智能体执行器等使用

### 详细文件分析

#### __init__.py (增强版)
**文件功能**：定义 AgenticX 框架的核心抽象和数据结构的统一导出接口
**技术实现**：通过 `__all__` 列表明确定义模块的公共 API，导出所有核心组件类和函数；**新增对可选模块（如 marketplace）的 lazy import 支持以增强沙箱兼容性**
**关键组件**：导出 `Agent`、`Task`、`BaseTool`、`Workflow`、`Message`、`Component` 等核心实体类，以及 `Event`、`PromptManager`、`ErrorHandler`、`CommunicationInterface`、`AgentExecutor`、`TaskOutputParser`、`WorkflowEngine` 等功能组件
**新增导出（参考 JoyAgent & crewAI & AIGNE）**：
- **Hooks 系统**：`LLMCallHookContext`、`ToolCallHookContext`、`register_before_llm_call_hook`、`register_after_llm_call_hook`、`register_before_tool_call_hook`、`register_after_tool_call_hook`、`execute_before_llm_call_hooks`、`execute_after_llm_call_hooks`、`execute_before_tool_call_hooks`、`execute_after_tool_call_hooks`、`clear_llm_hooks`、`clear_tool_hooks`
- **Flow 系统**：`Flow`、`FlowState`、`start`、`listen` 等
- **Delegation 工具**：`DelegateWorkTool`、`AskQuestionTool` 等
- **代码执行 (JoyAgent 内化)**：`CodeActionExecutor`、`CodeActionResult`
- **并行执行 (JoyAgent 内化)**：`SlaveParallelExecutor`、`ParallelTaskResult`
- **GuideRails (AIGNE 内化)**：`GuideRails`、`GuideRailsAction`、`GuideRailsResult`、`GuideRailsConfig`、`GuideRailsAbortError` 等
- **Handoff 机制 (AIGNE 内化)**：`HandoffOutput`、`AgentHandoffEvent`、`AgentHandoffError`、`is_handoff_output`、`create_handoff_event` 等
- **记忆提取管道 (AIGNE 内化)**：`MemoryFact`、`MemoryScope`、`MemoryExtractionConfig`、`SessionMemoryManager`、`UserMemoryManager`、`create_memory_extractor` 等
- **SelfRepair (IronClaw 内化)**：`SelfRepair`、`DefaultSelfRepair`、`SelfRepairConfig`、`RepairResult`、`StuckTask`、`BrokenTool`
**业务逻辑**：作为框架的统一入口点，支持核心能力的集中导出与环境适配
**依赖关系**：依赖模块内所有其他文件，为上层应用提供统一接口

#### code_action_executor.py (新增，内化自 JoyAgent)
**文件功能**：实现受限的 Python 代码执行器，支持“代码即行动”
**技术实现**：基于 `ThreadPoolExecutor` 的线程池隔离执行，支持超时控制与内置函数白名单
**关键组件**：
- `CodeActionExecutor` 类：核心执行器，支持注入工具表
- `SAFE_BUILTINS`：内置安全函数白名单（abs, min, max, len 等）
- `execute()` / `execute_async()`：支持同步/异步双接口，内置超时防护
**安全逻辑**：拦截 `import`、`__`、`eval/exec` 等危险关键字；通过 `_basic_guard` 校验代码长度与关键字
**依赖关系**：独立模块，可被 AgentExecutor 或特定智能体使用

#### slave_parallel_executor.py (新增，内化自 JoyAgent)
**文件功能**：实现任务级的并行执行器（Slave Executor）
**技术实现**：基于 `asyncio.Semaphore` 的并发控制，支持 `fail_fast` 模式
**关键组件**：
- `SlaveParallelExecutor` 类：并发管理器
- `ParallelTaskResult` 类：封装任务执行结果，包含 `duration_ms` 统计
**业务逻辑**：允许将多个独立的子任务分发到并行 worker 执行，并实时追踪每个任务的耗时与成功状态
**依赖关系**：被 `MiningPlannerAgent` 用于加速计划执行流程

#### executor.py（增强）
**文件功能**：提供沙箱代码执行相关的资源监控与 POSIX 资源限制（`setrlimit`），供受限执行路径使用。  
**技术实现（2026-03-24）**：
- `resource` 改为 `try/import`：在 Windows 等无 POSIX `resource` 模块的环境下 `_posix_resource = None`，避免模块级导入即失败；
- `ResourceMonitor`：优先 `psutil` 读 RSS；无 `psutil` 时若存在 `_posix_resource` 则回退 `getrusage(RUSAGE_SELF).ru_maxrss`；二者皆不可用时返回 `0` 而非崩溃；
- `SandboxedEnvironment._setup_resource_limits()`：当 `_posix_resource` 不可用时直接跳过 `setrlimit` 并打 debug 日志，内存/CPU 上限依赖 `ResourceMonitor` 等行为不变；Unix 且模块可用时行为与原先一致（`RLIMIT_AS` / `RLIMIT_CPU` / `RLIMIT_NOFILE`）。  
**依赖关系**：独立工具模块，与 `code_action_executor.py` 等同属「执行隔离」相关能力。

#### agent.py (增强版，参考 crewAI + AIGNE)
**文件功能**：定义 AgenticX 框架中智能体的核心数据结构和基本行为
**技术实现**：使用 Pydantic BaseModel 定义数据模型，支持类型验证和序列化，包含异步执行方法
**关键组件**：
- `Agent` 类：智能体核心实体，包含 ID、名称、版本、角色、目标、背景故事、LLM 配置、记忆配置、工具列表等属性
  - **新增字段（参考 crewAI）**：
    - `allow_delegation`：是否允许委派任务给其他 Agent
    - `llm_hooks`：Agent 级别的 LLM 调用钩子（before/after）
    - `tool_hooks`：Agent 级别的工具调用钩子（before/after）
    - `max_iterations`：最大迭代次数（默认 25）
    - `max_retry_limit`：最大重试次数（默认 2）
  - **新增字段（参考 AIGNE Framework）**：
    - `guiderails`：GuideRails 验证链，用于输出后验证和修正
    - `guiderails_config`：GuideRails 配置参数
- `AgentContext` 类：智能体执行上下文，包含智能体 ID、任务 ID、会话 ID、变量、元数据和时间戳
- `AgentResult` 类：智能体执行结果，包含执行状态、输出、错误信息、执行时间等
**业务逻辑**：提供智能体的完整生命周期管理，从定义到执行再到结果收集的全流程支持，**支持任务委派、钩子定制和输出验证**
**依赖关系**：被 `agent_executor.py` 和 `workflow_engine.py` 依赖，为智能体执行提供数据模型基础

#### agent_executor.py (增强版)
**文件功能**：实现 AgenticX 框架的核心执行引擎，负责智能体的实际运行逻辑
**技术实现**：实现"Own Your Control Flow"原则，**新增上下文编译能力、Hooks 集成（参考 crewAI）、GuideRails 验证（参考 AIGNE）、流式响应累积（参考 CAMEL）、Auth Profile 轮换和 Transcript 卫生管线（参考 OpenClaw）**
**关键组件**：
- `ToolRegistry` 类：工具管理器，负责工具的注册、查找和调用
- `ActionParser` 类：动作解析器，从 LLM 响应中提取结构化动作
- `AgentExecutor` 类：核心执行引擎，**新增特性**：
  - **自动上下文压缩**：在每次 LLM 调用前自动检查并执行压缩
  - `compaction_config`：压缩配置参数
  - `enable_context_compilation`：上下文编译开关
  - `context_compiler`：集成的 ContextCompiler 实例
  - `_maybe_compact_context()`：异步压缩检查方法
  - `set_compaction_config()`：动态调整压缩配置
  - **LLM Hooks 集成**：在 `_get_next_action()` 中集成 before/after LLM call hooks
  - **Tool Hooks 集成**：在 `_execute_tool_call()` 中集成 before/after tool call hooks
  - 支持全局 hooks 和 Agent 级别 hooks，允许修改消息、输入、结果或阻止执行
  - **GuideRails 集成**：在 `_execute_finish_task()` 中集成输出验证，支持 PASS/MODIFY/ABORT 三种决策
  - **StreamContentAccumulator 集成**：在 `_get_next_action()` 中集成流式响应累积，支持增量内容和累积内容两种模式，确保响应包含完整的累积内容
  - **工具调用追踪**：在 `_execute_tool_call()` 中传递 `agent_id` 和 `task_id` 给 ToolExecutor，支持工具调用历史追踪
  - **Auth Profile 轮换（新增，参考 OpenClaw）**：`auth_profile_manager` 参数接收 `AuthProfileManager` 实例；新增 `_invoke_llm_with_auth_rotation()` 方法，在 LLM 调用失败时自动切换到下一个可用 Profile，根据错误类型（rate_limit / billing / auth）设置不同冷却策略
  - **Transcript 卫生管线（新增，参考 OpenClaw）**：`transcript_sanitizer` 参数接收 `TranscriptSanitizer` 实例（默认自动创建）；在 `_get_next_action()` 中，LLM 调用前自动对 messages 执行 `sanitize()`，按 provider 策略处理 turn 交替、连续用户消息合并、拒绝触发词剥离等
**业务逻辑**：实现智能体的完整执行循环，**支持长周期任务的 Token 成本优化、通过 Hooks 实现执行流程的定制化、通过 GuideRails 确保输出质量、通过 StreamContentAccumulator 管理流式响应内容、通过 Auth Profile 轮换提升多 Key 场景下的可用性、通过 Transcript 卫生管线确保不同 Provider 的消息格式合规性**
**依赖关系**：依赖 `agent.py`、`tool.py`、`prompt.py`、`error_handler.py`、`communication.py`、**`context_compiler.py`**、**`hooks/llm_hooks.py` 和 `hooks/tool_hooks.py`**、**`guiderails.py`**、**`stream_accumulator.py`**、**`agenticx.llms.auth_profile` (新增)**、**`agenticx.llms.transcript_sanitizer` (新增)**，为工作流引擎提供执行能力

#### communication.py (4,567 bytes)
**文件功能**：实现智能体间的通信系统，支持消息传递和协作机制
**技术实现**：定义通信接口和协议，支持同步和异步通信模式，包含广播和点对点通信
**关键组件**：
- `CommunicationInterface` 类：通信接口，提供消息发送、接收、处理和历史记录管理功能
- `MessageHandler` 协议：消息处理器接口定义
- `BroadcastCommunication` 类：广播通信实现
- `AsyncCommunicationInterface` 类：异步通信接口
**业务逻辑**：实现多智能体系统中的消息路由、传递和处理机制，支持复杂的协作场景
**依赖关系**：依赖 `message.py` 定义的消息结构，被 `agent_executor.py` 和 `workflow_engine.py` 使用

#### component.py (1,234 bytes)
**文件功能**：定义 AgenticX 框架中所有组件的基础抽象类
**技术实现**：使用抽象基类模式，提供组件的通用生命周期管理接口
**关键组件**：
- `Component` 抽象基类：所有 AgenticX 组件的基类，提供组件名称、配置管理、初始化和资源清理等通用功能
**业务逻辑**：为框架中的所有组件提供统一的接口规范和生命周期管理
**依赖关系**：被框架中的其他组件类继承，如 `PromptManager`、`ErrorHandler` 等

#### error_handler.py (增强版)
**文件功能**：实现智能体执行过程中的错误分类、处理和恢复机制
**技术实现**：包含错误分类器和熔断器模式，支持错误的自动分类和恢复策略
**关键组件**：
- `ErrorClassifier` 类：错误分类器，将错误分类为工具错误、解析错误、LLM 错误、网络错误、验证错误、权限错误等
  - **新增分类**：`guiderails_abort` - GuideRails 中止错误（参考 AIGNE Framework）
- `CircuitBreaker` 类：熔断器实现，包含 `closed`、`open`、`half_open` 三种状态，防止无限错误循环
**业务逻辑**：提供智能体执行过程中的错误容错和恢复能力，确保系统的稳定性和可靠性，**新增对 GuideRails 中止错误的专门处理**
**依赖关系**：被 `agent_executor.py` 使用，为智能体执行提供错误处理能力

#### tool_system.py
**文件功能**：提供统一的工具系统管理器
**技术实现**：整合注册、执行、安全与适配器；**新增对可选模块（如 marketplace）的 lazy import 支持**
**关键组件**：`ToolSystem`、`ToolSystemConfig`
**业务逻辑**：作为工具系统的总入口，确保工具在安全受控的环境下运行
**依赖关系**：依赖核心工具模块与安全管理器

#### event.py (增强版)
**文件功能**：实现 AgenticX 框架的事件系统，支持事件驱动的状态管理
**技术实现**：基于事件溯源模式，定义多种事件类型和事件日志管理，**新增压缩事件和配置**
**关键组件**：
- `Event` 基类：所有事件的基础类
- 多种特定事件类型：`TaskStartEvent`、`ToolCallEvent`、`ErrorEvent`、`LLMCallEvent`、`HumanRequestEvent` 等
- **`CompactedEvent` (新增)**：压缩事件，存储对一段原始事件的语义摘要，包含覆盖范围、压缩率等元数据
- **`CompactionConfig` (新增)**：压缩配置模型，定义压缩触发阈值、重叠大小、Token 上限等参数
- `EventLog` 类：事件日志管理器，**新增压缩辅助方法**：
  - `get_last_compaction()`：获取最后一个压缩事件
  - `get_events_since_last_compaction()`：获取自上次压缩以来的新事件
  - `estimate_token_count()`：估算 EventLog 的 Token 数
  - `should_compact()`：根据配置判断是否需要压缩
**业务逻辑**：实现智能体执行过程的完整事件记录，**支持长对话的语义压缩和 Token 优化**
**依赖关系**：被 `agent_executor.py`、`workflow_engine.py`、`prompt.py` 和 `context_compiler.py` 使用

#### execution_lane.py (增强版，内化自 OpenClaw)
**文件功能**：实现基于信号量的执行车道，确保同一 session 内 LLM 调用的串行化；**新增 Generation Counter 机制**
**技术实现**：基于 `asyncio.Semaphore` 实现全局并发控制，通过 `ExecutionLaneGuard` 上下文管理器自动获取/释放
**关键组件**：
- `ExecutionLaneGuard` 类：执行车道守卫，支持 `async with` 用法
  - 新增 `_generation` 属性：记录获取时的世代号，`__aexit__` 时将其传递给 `release()`
- `ExecutionLane` 类：核心车道管理器
  - `_generation` 属性（新增）：全局世代计数器，初始为 0
  - `acquire(session_key)` 方法：获取车道，返回 `ExecutionLaneGuard`（绑定当前 `_generation`）
  - `release(session_key, generation)` 方法（增强版）：释放车道时校验 `generation` 是否匹配当前世代；若不匹配则视为过期回调，仅释放信号量但不执行后续逻辑，并记录 `stale release` 日志
  - `bump_generation()` 方法（新增）：递增 `_generation` 计数器，使所有旧世代的 Guard 在释放时自动失效
  - `max_concurrent` 属性：最大并发数
**业务逻辑**：Generation Counter 解决热重启/会话重建场景下旧回调干扰新会话的问题——重启时调用 `bump_generation()`，所有来自旧世代的 `release()` 调用会被安全忽略，避免信号量状态混乱
**依赖关系**：被 `agent_executor.py` 使用

#### graph.py (新增，内化自 Pydantic AI)
**文件功能**：实现轻量级图执行引擎，支持基于状态机的 Agent 工作流编排
**技术实现**：基于类型驱动的边定义（通过 `run()` 返回类型推断），支持异步执行与状态共享
**关键组件**：
- `Graph` 类：图定义与执行器，管理节点定义（NodeDef）与执行循环
- `BaseNode` 抽象基类：所有图节点的基类，其 `run()` 方法定义了状态转移逻辑
- `End` 类：哨兵节点，用于终止图执行并返回最终结果
- `GraphRunContext` 类：运行时上下文，封装跨节点共享的 `state` 与 `deps`
- `GraphRunResult` 类：执行结果包装器，包含最终产出、步骤计数与执行轨迹
**业务逻辑**：为复杂的“探索-验证-反馈”循环提供标准化的编排模式，支持从节点返回类型自动推断图拓扑
**依赖关系**：被 `mining_graph.py` 使用

#### message.py (1,890 bytes)
**文件功能**：定义智能体间通信的消息数据结构
**技术实现**：使用 Pydantic 模型定义消息格式，支持不同通信协议的消息封装
**关键组件**：
- `Message` 类：基础消息类，包含 ID、发送者 ID、接收者 ID、内容和元数据
- `ProtocolMessage` 类：协议消息封装，支持不同通信协议，包含协议类型、核心消息和协议特定头部信息
**业务逻辑**：为智能体间的通信提供标准化的消息格式和协议支持
**依赖关系**：被 `communication.py` 使用，为通信系统提供消息数据结构

#### platform.py (2,345 bytes)
**文件功能**：定义 AgenticX 平台的用户和组织实体模型
**技术实现**：使用 Pydantic 模型定义平台实体，支持多租户隔离和用户管理
**关键组件**：
- `User` 类：用户实体，包含用户 ID、用户名、邮箱、全名、所属组织 ID、活跃状态、角色、创建/更新时间和元数据
- `Organization` 类：组织实体，包含组织 ID、名称、显示名称、描述、活跃状态、设置、创建/更新时间和元数据
**业务逻辑**：为多租户 SaaS 平台提供用户和组织管理的基础数据模型
**依赖关系**：被上层应用模块使用，为平台级功能提供实体定义

#### prompt.py (增强版)
**文件功能**：实现 AgenticX 框架的提示工程和上下文管理系统
**技术实现**：实现"Own Your Prompts"和"Own Your Context Window"原则，**新增编译视图渲染机制（内化自 ADK）和 PromptMode 分级（内化自 OpenClaw）**
**关键组件**：
- `ContextRenderer` 抽象基类及其 `XMLContextRenderer` 实现：将事件日志渲染为高信息密度的 XML 格式上下文
- **`CompiledContextRenderer` (新增)**：编译视图渲染器，实现 ADK 的逆序编译算法，自动跳过被 `CompactedEvent` 覆盖的原始事件
- **`PromptMode` 枚举 (新增)**：`FULL`（完整上下文）、`MINIMAL`（仅当前状态摘要）、`NONE`（空上下文），用于子代理在不同场景下按需裁剪上下文量
- `PromptTemplate` 类：提示模板，支持占位符和动态内容生成
- `PromptManager` 类：核心提示管理器，负责上下文工程和提示管理，注册默认的 ReAct 风格模板和错误恢复模板
  - 新增 `prompt_mode` 参数支持：`generate_prompt()` 接受 `PromptMode`，内部调用 `_build_context_by_mode()` 按模式构建上下文
  - `_build_context_by_mode()`：FULL 模式走完整渲染、MINIMAL 模式仅提取 `event_log.get_current_state()` 摘要、NONE 模式返回空字符串
**业务逻辑**：为智能体提供高质量的提示工程能力，**通过编译视图大幅降低长对话的 Token 成本**；PromptMode 分级允许 Handoff 目标 Agent 接收精简上下文，避免不必要的 Token 消耗
**依赖关系**：依赖 `event.py` 的事件系统和新增的 `CompactedEvent`，被 `agent_executor.py` 和 `handoff.py` 使用

#### overflow_recovery.py (新增，内化自 OpenClaw)
**文件功能**：实现三级渐进式上下文溢出恢复管线，按成本从低到高逐级尝试恢复
**技术实现**：基于 `RecoveryLevel` 枚举定义 L1/L2/L3 三个恢复等级，通过 `OverflowRecoveryPipeline` 顺序执行
**关键组件**：
- `RecoveryLevel` 枚举（IntEnum）：`L1_TRUNCATE_TOOL_RESULTS`（截断超大工具结果）、`L2_EXPLICIT_COMPACTION`（显式压缩）、`L3_FAST_HEURISTIC`（快速启发式压缩）
- `OverflowRecoveryConfig` 数据类：恢复配置，包含 `l1_enabled`、`l1_max_result_tokens`（默认 4000）、`l2_max_attempts`（默认 3）、`l3_enabled` 等参数
- `OverflowRecoveryPipeline` 类：核心恢复管线
  - `recover(event_log)` 异步方法：按 L1→L2→L3 顺序尝试恢复，返回是否成功
  - `reset()`：重置每次溢出的尝试状态
  - `_truncate_oversized_tool_results()`：原地截断超过阈值的 `ToolResultEvent.result`
**业务逻辑**：L1 成本最低（仅截断文本），L2 有限次调用 LLM 做压缩，L3 为零 LLM 调用的快速降级，确保在不同场景下尽最大努力恢复而不丢失关键上下文
**依赖关系**：依赖 event.py（EventLog、ToolResultEvent），被 context_compiler.py 集成

#### context_compiler.py (增强版，内化自 ADK + DeerFlow + OpenClaw)
**文件功能**：实现上下文的语义压缩和编译，将长事件流转换为高效的 LLM Prompt
**技术实现**：融合 Google ADK 和 DeerFlow 的压缩策略，支持语义摘要和快速截断双模式；**新增集成 OverflowRecoveryPipeline（参考 OpenClaw）**
**关键组件**：
- `EventSummarizer` 抽象基类：事件摘要生成器接口
- `LLMEventSummarizer` 类：基于 LLM 的高质量摘要生成，支持多种任务类型专用 Prompt
- `SimpleEventSummarizer` 类：基于规则的快速摘要（不调用 LLM）
- `FastHeuristicCompressor` 类（DeerFlow内化）：零 LLM 调用的快速压缩器，启发式 token 估算（英文 4 char/token，中文 1 char/token），保留前缀+尾部截断策略
- `ContextCompiler` 类（增强版）：核心编译器，支持多策略和自动切换
  - 新增 `enable_fast_fallback` 参数：启用快速压缩降级
  - 新增 `overflow_recovery_config` 参数：配置溢出恢复管线
  - 新增 `overflow_recovery_pipeline` 属性：`OverflowRecoveryPipeline` 实例，在 `maybe_compact()` 中检测 `token_overflow` 原因时自动触发三级恢复
  - 新增 `_is_emergency()` 方法：检测紧急情况（95% token 阈值）
  - 新增 `_fast_compress()` 方法：执行快速压缩（无 LLM 调用）
  - `compare_views()` 方法：对比原始视图和编译视图的 Token 统计，用于评估压缩效果
  - 自动切换：紧急情况下自动切换到 FastHeuristicCompressor
- `CompactionStrategy` 枚举：滑动窗口、主题分块、时间窗口、紧急压缩、混合策略
- 专用 Prompt 模板库：MINING_TASK_PROMPT、CONVERSATION_PROMPT、TOOL_SEQUENCE_PROMPT
- 工厂函数：create_context_compiler()、create_mining_compiler()
**业务逻辑**：通过语义压缩实现长周期任务的 Token 成本控制，紧急情况下自动降级到快速截断避免溢出；**溢出场景下先走三级恢复管线（截断→压缩→启发式），恢复后再判断是否需要额外压缩**
**依赖关系**：依赖 event.py、token_counter.py、overflow_recovery.py，被 agent_executor.py 集成

#### discovery.py (新增，内化自 AgentScope)
**文件功能**：实现动态能力发现机制（Discovery Loop），支持 Worker 发现并上报新能力
**技术实现**：事件驱动的发现总线架构，支持异步订阅与发布
**关键组件**：
- `Discovery` 基类及其子类：`DiscoveredTool`、`DiscoveredAPI`、`DiscoveredInsight`、`DiscoveredResource`、`DiscoveredError`
- `DiscoveryBus` 类：实现发布/订阅模式的中央总线，支持按类型和优先级过滤
- `DiscoveryRegistry` 类：管理本地发现项的存储与检索
- `DiscoveryPriority` 与 `DiscoveryStatus` 枚举：定义发现项的重要程度和处理状态
**业务逻辑**：构建智能体系统内的"信息反馈环"，允许子 Worker 在执行过程中探测到的环境变化、新工具、新知识实时反馈给 Planner，实现计划的动态调整
**依赖关系**：被 `spawn_worker.py` 和 `mining_planner_agent.py` 使用

#### interruption.py (新增，内化自 AgentScope)
**文件功能**：实现长周期任务的实时中断与状态恢复机制
**技术实现**：基于元数据标记的 Steering 机制，支持异步信号拦截与执行状态快照
**关键组件**：
- `InterruptSignal` 类：定义中断原因（用户、超时、错误等）和策略（立即、优雅、检查点）
- `ExecutionSnapshot` 类：执行状态快照，保存任务执行进度、上下文和中断位点
- `InterruptionManager` 类：管理活跃任务的中断信号分发与快照持久化
- `InterruptibleTask` 类：可中断任务包装器，提供便捷的 `check_interrupt()` 检查点机制
**业务逻辑**：为大规模、长时间运行的任务提供"可控性"，支持在任意阶段由用户或系统介入中断，并能在之后通过快照恢复执行，避免资源浪费
**依赖关系**：被 `spawn_worker.py` 和 `mining_planner_agent.py` 使用

#### plan_notebook.py (新增，内化自 AgentScope)
**文件功能**：实现"计划即工具"（Plan-as-a-Tool）机制，让智能体具备主动管理执行计划的能力
**技术实现**：将计划操作封装为标准的智能体工具，并提供状态感知的 Prompt 注入
**关键组件**：
- `PlanNotebook` 类：核心管理器，将 `create_plan`、`revise_current_plan`、`update_subtask_state` 等操作注册为工具
- `DefaultPlanToHint` 类：根据当前计划状态（已完成、进行中、待办）自动生成引导性 Prompt 提示
**业务逻辑**：打破静态计划的限制，允许 LLM 在执行过程中根据实际情况通过工具调用自行修正、更新计划状态，提升复杂任务的完成率
**依赖关系**：依赖 `plan_storage.py`，被 `mining_planner_agent.py` 集集

#### plan_storage.py (新增，内化自 AgentScope)
**文件功能**：提供执行计划的多样化持久化方案
**技术实现**：基于抽象基类的存储适配器模式
**关键组件**：
- `Plan` 与 `SubTask` 数据模型：定义结构化的任务分解体系
- `PlanStorageBase` 抽象基类：定义计划存取的统一接口
- `InMemoryPlanStorage` 类：高效的内存存储实现
- `SQLitePlanStorage` 类：基于 SQLite 的持久化存储实现
**业务逻辑**：解耦计划的业务逻辑与物理存储，支持任务状态的跨会话保存与恢复
**依赖关系**：被 `plan_notebook.py` 使用

#### token_counter.py (新增)
**文件功能**：提供精确的 Token 计数和成本估算能力
**技术实现**：集成 `tiktoken` 库，支持多种模型的精确分词规则，包含降级机制
**关键组件**：
- `TokenCounter` 类：核心计数器，支持 GPT-4/4o/3.5、Claude、Gemini、通义千问、DeepSeek 等主流模型
- `ModelFamily` 枚举：支持的模型家族
- `TokenStats` 类：Token 使用统计收集器
- **模型定价表**：内置各主流模型的最新定价信息
- **CJK 字符处理**：针对中日韩字符的特殊 token 计算逻辑
- 便捷函数：`count_tokens()`、`estimate_cost()`、`truncate_text()`
**业务逻辑**：为上下文编译器提供精确的 Token 度量，支持成本优化决策
**依赖关系**：被 `context_compiler.py` 使用，独立的工具模块

#### stream_accumulator.py (增强版，内化自 CAMEL-AI + OpenClaw)
**文件功能**：实现流式响应内容累积器，管理流式 LLM 响应内容的累积；**新增跨 chunk 的 `<thinking>` 标签解析**
**技术实现**：参考 CAMEL-AI 的 StreamContentAccumulator 实现，支持增量内容和累积内容两种模式；**新增状态机解析器处理被 chunk 边界切分的 `<thinking>`/`</thinking>` 标签**
**关键组件**：
- `StreamContentAccumulator` 类：核心累积器
  - `base_content`：基础内容（工具调用前的内容）
  - `current_content`：累积的流式内容片段列表
  - `tool_status_messages`：工具状态消息列表
  - `reasoning_content`：推理内容列表
  - `is_reasoning_phase`：是否处于推理阶段
  - **`_pending_buffer`（新增）**：未决文本缓冲区，用于跨 chunk 标签匹配
  - **`_in_thinking_block`（新增）**：当前是否在 `<thinking>` 块内
  - `set_base_content()`：设置基础内容
  - `add_streaming_content()`：添加流式内容块，**内部调用 `_consume_pending_buffer()` 进行标签解析**
  - `add_reasoning_content()`：添加推理内容
  - `add_tool_status()`：添加工具状态消息
  - `get_full_content()`：获取完整累积内容
  - `get_full_reasoning_content()`：获取完整推理内容
  - `get_content_with_new_status()`：获取带新状态消息的内容（不修改状态）
  - `reset_streaming_content()`：重置流式内容（保留基础和工具状态），**同时重置 `_pending_buffer` 和 `_in_thinking_block`**
  - `reset_all()`：重置所有内容
  - **`_consume_pending_buffer()`（新增）**：核心解析方法，循环扫描 `_pending_buffer`：在非思考态查找 `<thinking>` 开标签，在思考态查找 `</thinking>` 闭标签；开标签前的文本路由到 `current_content`，标签内文本路由到 `reasoning_content`
  - **`_split_for_partial_tag()`（新增）**：处理标签被 chunk 边界截断的情况，将内容拆分为安全文本和可能的标签尾部，避免误输出不完整标签
**业务逻辑**：确保所有响应包含完整的累积内容，**即使 `<thinking>` 标签被流式 chunk 边界切分也能正确分离推理内容和可见内容，避免原始标签泄露到最终输出**
**依赖关系**：被 `agent_executor.py` 集成使用，在 LLM 响应处理时自动累积内容

#### guiderails.py (新增，内化自 AIGNE Framework)
**文件功能**：实现输出后验证和修正管道，确保 Agent 输出符合预期规范
**技术实现**：基于验证器链的设计模式，支持 PASS/MODIFY/ABORT 三种决策结果
**关键组件**：
- `GuideRailsAction` 枚举：验证决策结果（PASS、MODIFY、ABORT）
- `GuideRailsResult` 类：单个验证器的结果，包含 action、output、reason、metadata
- `GuideRailsConfig` 类：验证配置，支持启用/禁用、允许修改、最大修改次数等参数
- `GuideRailsContext` 类：验证上下文，包含 agent_id、task_id、metadata
- `GuideRailsAbortError` 异常：当验证器决定中止输出时抛出
- `GuideRailsRunResult` 类：验证链执行结果，包含最终 action、output、reasons、validator_count、modified 标志
- `GuideRailsValidator` 协议：验证器接口，支持函数、类、Protocol 多种实现方式
- `BaseGuideRailsValidator` 抽象基类：验证器基类
- `GuideRails` 类：验证链执行器，按顺序执行验证器，支持修改输出和提前中止
**业务逻辑**：在 Agent 完成任务时自动验证输出，支持链式验证器、输出修正、中止执行等能力，确保输出质量和合规性
**依赖关系**：被 `agent.py` 和 `agent_executor.py` 集成，在任务完成时自动触发验证

#### handoff.py (增强版，内化自 AIGNE Framework + OpenClaw)
**文件功能**：实现 Agent 间切换机制，支持智能体主动将任务转交给其他 Agent；**新增 Subagent 深度/数量限制和 PromptMode 传递**
**技术实现**：基于特殊返回类型和事件系统的设计，支持循环检测、目标验证和资源限制
**关键组件**：
- `HandoffOutput` 类：触发 Agent 切换的特殊返回类型，包含 target_agent_id/name、reason、payload、metadata
  - 新增 `get_prompt_mode()` 方法：从 metadata 中解析目标 Agent 的 `PromptMode`（默认 MINIMAL）
- `AgentHandoffEvent` 类：Handoff 事件，继承自 Event，用于 EventBus 发布和订阅；新增 `data.prompt_mode` 字段
- `AgentHandoffError` 异常：Handoff 相关异常的基类
- `HandoffCycleError` 异常：检测到 Handoff 循环时抛出
- `HandoffTargetNotFoundError` 异常：目标 Agent 不存在时抛出
- **`HandoffLimitError` 异常 (新增)**：Handoff 深度或子代理数量超限时抛出
- `is_handoff_output()` 函数：检查值是否为 HandoffOutput 实例
- `parse_handoff_output()` 函数：解析值到 HandoffOutput（支持多种格式）
- `create_handoff_event()` 函数：从 HandoffOutput 创建 AgentHandoffEvent
- `check_handoff_cycle()` 函数（增强版）：检查 Handoff 循环和链长度限制
  - 新增 `max_spawn_depth` 参数：限制 Handoff 链最大深度
  - 新增 `max_children_per_agent` / `current_children_count` 参数：限制单个 Agent 可派生的子代理数量
  - 超限时抛出 `HandoffLimitError`
**业务逻辑**：允许 Agent 在执行过程中判断需要其他 Agent 的专业能力，主动触发切换，支持事件追踪、循环检测、目标验证等安全机制；**Subagent 限制防止递归派生失控导致资源耗尽，PromptMode 传递控制子代理接收的上下文量**
**依赖关系**：依赖 `prompt.py`（PromptMode），被 `agent_executor.py` 和 `workflow_engine.py` 使用，与 Event 系统集成

#### memory_extraction.py (新增，内化自 AIGNE Framework)
**文件功能**：从对话中自动提取事实性记忆，支持 session 和 user 级别的记忆管理
**技术实现**：基于 LLM 的语义提取和规则匹配双模式，支持异步执行和去重机制
**关键组件**：
- `MemoryScope` 枚举：记忆作用域（SESSION、USER、GLOBAL）
- `MemoryFact` 数据类：提取的事实，包含 label、fact、confidence、source_turn_id、scope、extracted_at、metadata
- `MemoryExtractionConfig` 数据类：提取配置，包含启用开关、异步模式、Token 预算、最大事实数、提取间隔、去重阈值等
- `ExtractionResult` 数据类：提取结果，包含 new_facts、updated_facts、removed_facts、extraction_time、success、error
- `BaseMemoryExtractor` 抽象基类：提取器接口
- `LLMMemoryExtractor` 类：基于 LLM 的高质量提取器，使用专用 Prompt 模板提取事实
- `SimpleMemoryExtractor` 类：基于规则的简单提取器，使用关键词匹配（适用于测试或低成本场景）
- `SessionMemoryManager` 类：Session 级别记忆管理器，负责触发提取、管理 session 事实、与 KnowledgeBase 交互
- `UserMemoryManager` 类：用户级别记忆管理器，负责跨 session 的持久化记忆、整合 session 记忆
- `create_memory_extractor()` 工厂函数：创建提取器实例
- `create_session_memory_manager()` 工厂函数：创建 Session 记忆管理器
**业务逻辑**：在对话过程中自动提取用户偏好、重要决策、关键信息等事实，支持 session 临时记忆和 user 持久记忆的分层管理，与 KnowledgeBase 集成实现持久化
**依赖关系**：与 `knowledge/` 模块的 KnowledgeBase 集成，可被 `sessions/` 模块使用

#### task.py (1,567 bytes)
**文件功能**：定义智能体执行的任务数据结构
**技术实现**：使用 Pydantic 模型定义任务实体，支持任务依赖和输出验证
**关键组件**：
- `Task` 类：任务实体，包含任务 ID、描述、分配的智能体 ID、预期输出、上下文信息、依赖任务 ID 列表和预期输出的模式定义
**业务逻辑**：为工作流系统提供任务定义和管理的基础数据结构
**依赖关系**：被 `workflow.py`、`workflow_engine.py` 和 `task_validator.py` 使用

#### self_repair.py (新增，内化自 IronClaw)
**文件功能**：实现后台自动恢复系统，周期性检测卡死任务和失效工具，并在可配置次数内自动修复，超限后上报 MANUAL_REQUIRED。
**技术实现**：抽象接口 + 默认实现分离；利用 `asyncio` 进行异步检测循环。
**关键组件**：
- `RepairResult` (Enum)：SUCCESS / RETRY / FAILED / MANUAL_REQUIRED
- `SelfRepairConfig` (dataclass)：`check_interval=60.0`（秒）、`max_repair_attempts=3`、`stuck_threshold=300.0`（秒，任务超时判定阈值）、`broken_tool_failure_threshold=5`（工具连续失败次数阈值）
- `StuckTask` (dataclass)：`task_id`、`last_activity`、`stuck_duration`、`last_error`、`repair_attempts`
- `BrokenTool` (dataclass)：`name`、`failure_count`、`last_error`、`repair_attempts`
- `SelfRepair` (ABC)：抽象接口，定义 `detect_stuck_tasks()`、`repair_stuck_task(task)`、`detect_broken_tools()`、`repair_broken_tool(tool)`、`run_check_cycle()` 五个抽象方法
- `DefaultSelfRepair`：`SelfRepair` 的默认实现；通过构造参数注入 `detect_tasks_fn`（`Callable[[], Awaitable[list[StuckTask]]]`）、`repair_task_fn`、`detect_tools_fn`、`repair_tool_fn` 四个异步回调，使检测与修复逻辑完全外部化；`run_check_cycle()` 对每个 stuck task / broken tool 调用对应修复函数，达到 `max_repair_attempts` 后记录 MANUAL_REQUIRED 并停止重试
**业务逻辑**：提供 Agent 系统"稳健性兜底层"，保证长期运行中因环境异常导致的卡死/失效问题能在用户无感知的情况下自动恢复，降低运维成本
**依赖关系**：独立模块，无外部依赖；被 `agenticx/core/__init__.py` 导出，外部可通过注入回调直接使用

#### task_validator.py (25,234 bytes)
**文件功能**：实现任务输出的解析、验证和自修复功能，确保任务产出符合预定义契约
**技术实现**：实现 M6 模块的核心功能，包含输出解析、业务规则校验和自修复机制，将"执行过程"与"成果验收"分离
**关键组件**：
- `TaskOutputParser` 类：任务输出解析器，从 Agent 响应中解析结构化数据，支持 JSON 提取和模糊解析
- `TaskResultValidator` 类：任务结果验证器，对解析结果进行业务规则校验
- `OutputRepairLoop` 类：输出修复循环，当解析/校验失败时的自修复机制
- 多种解析和验证策略：支持直接 JSON 解析、片段提取、结构化文本解析等
**业务逻辑**：充当工作流中每个任务节点的"质量守门员"，确保任务输出的质量和一致性
**依赖关系**：依赖 `task.py` 和 `agent.py`，被 `workflow_engine.py` 使用

#### tool.py (增强版，内化自 Pydantic AI)
**文件功能**：定义 AgenticX 框架的工具系统，支持工具的定义、封装和具有“自愈能力”的执行
**技术实现**：基于 Pydantic 的参数校验与错误拦截机制，实现自动化重试反馈环
**关键组件**：
- `BaseTool` 抽象基类：新增 `aexecute_with_retry` 方法，支持校验失败后的 LLM 自动修正
- `ValidationFeedback` 类：结构化校验反馈，封装 Pydantic 错误详情与原始参数
- `ValidationErrorHandler` 类：拦截 Pydantic `ValidationError` 并转换为结构化反馈
- `ValidationErrorTranslator` 类：将结构化错误翻译为 LLM 可理解的自然语言 Prompt
**业务逻辑**：通过“检测 -> 翻译 -> 反馈 -> 修正”闭环，显著提升智能体调用工具的稳健性，降低因微小参数错误导致的任务中断
**依赖关系**：被 `agent_executor.py` 和 `mining_graph.py` 使用

#### workflow.py (2,678 bytes)
**文件功能**：定义基于图结构的工作流数据模型
**技术实现**：使用 Pydantic 模型定义工作流图的节点、边和整体结构
**关键组件**：
- `WorkflowNode` 类：工作流图中的节点，包含 ID、类型、名称和配置
- `WorkflowEdge` 类：工作流图中的边，包含源节点、目标节点、可选条件和元数据
- `Workflow` 类：工作流实体，包含 ID、名称、版本、组织 ID、节点列表、边列表和元数据
**业务逻辑**：为复杂的多智能体协作提供工作流定义和管理能力
**依赖关系**：被 `workflow_engine.py` 使用，为工作流执行提供数据模型基础

#### workflow_engine.py (34,567 bytes)
**文件功能**：实现 AgenticX 框架的工作流编排和路由引擎，支持事件驱动的工作流执行
**技术实现**：实现 M7 模块的核心功能，基于事件溯源思想，实现健壮、可恢复的工作流执行，支持并发执行和状态管理
**关键组件**：
- `WorkflowEngine` 类：编排引擎主入口，支持工作流的运行、暂停、恢复和取消
- `WorkflowGraph` 类：工作流图定义，支持静态和动态工作流，提供节点和边的管理功能
- `TriggerService` 类：事件触发器服务，支持定时触发和事件驱动触发
- `ExecutionContext` 类：执行上下文，包含工作流状态、变量、节点结果和事件日志
- 多种触发器：`ScheduledTrigger`、`EventDrivenTrigger` 等
**业务逻辑**：实现复杂的多智能体工作流编排，支持条件分支、并发执行、人工审批等高级功能
**依赖关系**：依赖 `workflow.py`、`agent.py`、`agent_executor.py`、`tool.py`、`event.py` 等多个模块，为上层应用提供完整的工作流执行能力

#### offload/ 目录（新增，内化自 AgentScope v2 P0）
**模块功能**：提供统一的「卸载（offload）」抽象，将大体积工具结果与压缩后的上下文移出实时会话历史——调用方只在历史中保留一个轻量 `Reference` 占位符，完整内容按句柄（handle）按需取回，从而控制长对话的 Token 占用。
**技术实现**：选择性内化自 AgentScope 2.0 `workspace/_offload_protocol.py`（Apache-2.0, commit `6d7189c`）；区别在于 AgentScope 返回裸字符串句柄，AGX 返回结构化 `Reference`（携带 size/summary/content_type 等元数据，并能渲染可写入聊天历史的内联占位符、支持 `to_dict`/`from_dict` 往返）。
**关键组件**：
- `protocol.py`：
  - `Offloader`（`@runtime_checkable` Protocol）：定义 `offload_context()` / `offload_tool_result()` / `retrieve()` 三个异步方法
  - `Reference`（dataclass）：卸载内容句柄，含 `handle`（payload 的 sha256 hex）/ `size` / `kind`（context|tool_result）/ `session_id` / `summary` / `content_type` / `tool_name` / `created_at`；`to_placeholder()` 渲染紧凑自描述占位符（前缀 `@offload-ref`），`to_dict`/`from_dict` 序列化
  - `OffloadError` 异常
  - 工具函数：`compute_handle()`（sha256）、`should_offload(text, threshold=4096)`（按 UTF-8 字节数严格超阈值判定，空串/小结果保持内联以维持原行为）、`stringify_messages()` / `stringify_tool_result()`（将消息/工具结果拍平为可取回的文本载荷）
- `file_offloader.py`：
  - `FileOffloader`：默认文件系统后端，将记录持久化到 `<root>/<session_id>/<handle>.json`（默认 root `~/.agenticx/offload`，支持 `~` 与环境变量展开），写入走临时文件 + `os.replace` 原子替换并对 session_id 做路径穿越防护；同步 IO 经 `asyncio.to_thread` 异步化；`retrieve()` 未命中或读失败时抛 `OffloadError`
**业务逻辑**：默认实现为文件后端，进程重启后仍可按句柄取回；协议化设计便于后续提供 KB 后端等同构实现。被 `agents/react_agent_async.ReActAgent` 在工具结果超阈值时调用以回填占位符。
**依赖关系**：独立子模块，无核心强依赖；被 `agenticx/agents/react_agent_async.py` 使用。

## 模块架构特点

### 1. 分层架构设计
- **数据模型层**：`agent.py`、`task.py`、`message.py`、`workflow.py`、`platform.py` 定义核心数据结构
- **组件服务层**：`component.py`、`tool.py`、`communication.py`、`prompt.py`、`error_handler.py` 提供基础服务
- **执行引擎层**：`agent_executor.py`、`workflow_engine.py`、`task_validator.py` 实现核心执行逻辑
- **事件系统层**：`event.py` 提供事件驱动的状态管理

### 2. 设计原则遵循
- **12-Factor Agents**：通过事件溯源实现状态无关的智能体设计
- **Own Your Control Flow**：`agent_executor.py` 实现完全可控的执行流程
- **Own Your Prompts**：`prompt.py` 提供专业的提示工程能力
- **Own Your Context Window**：通过 `XMLContextRenderer` 实现高效的上下文管理

### 3. 核心功能模块
- **M5 - Agent 核心组件**：事件系统、提示管理、错误处理、通信、Agent 执行
- **M6 - 任务契约与结果验证**：`task_validator.py` 实现完整的输出验证和修复机制
- **M7 - 编排与路由引擎**：`workflow_engine.py` 实现强大的工作流编排能力
- **M15 - 上下文编译引擎**：`context_compiler.py` 和 `token_counter.py` 实现长对话的语义压缩，**参考 Google ADK 的 Compiled View 机制**
- **Hooks 系统 (新增)**：`hooks/` 模块提供 LLM 和 Tool 调用的可定制钩子机制，**参考 crewAI Hooks 系统**
- **Flow 工作流系统 (新增)**：`flow/` 模块提供装饰器驱动的事件驱动工作流编排，**参考 crewAI Flow 系统**
- **GuideRails 输出验证 (新增)**：`guiderails.py` 实现输出后验证和修正管道，**参考 AIGNE Framework 的 GuideRails 机制**
- **Handoff 切换机制 (新增)**：`handoff.py` 实现 Agent 间任务切换，**参考 AIGNE Framework 的 Agent Handoff 机制**
- **记忆提取管道 (新增)**：`memory_extraction.py` 实现从对话中自动提取事实性记忆，**参考 AIGNE Framework 的 Memory Extraction 机制**
- **流式响应累积 (新增)**：`stream_accumulator.py` 实现流式响应内容累积，**参考 CAMEL-AI 的 StreamContentAccumulator 机制**

### 4. 技术实现亮点
- **异步支持**：全面支持异步执行，提高并发性能
- **类型安全**：大量使用 Pydantic 模型确保类型安全和数据验证
- **自愈式验证 (新增)**：通过 `ValidationErrorHandler` 实现工具调用的自愈能力，**内化自 Pydantic AI 的 RetryPrompt 机制**
- **可扩展性**：通过抽象基类和接口设计支持功能扩展
- **图驱动编排 (新增)**：通过 `graph.py` 提供轻量级状态机，支持基于类型提示的动态边推断
- **错误处理**：完善的错误分类、处理和恢复机制
- **事件驱动**：基于事件的状态管理和执行控制
- **编译视图 (新增)**：将上下文视为对 Event Log 的"编译"结果，而非简单拼接，**实现 50%+ 的 Token 节省**
- **精确计量 (新增)**：集成 tiktoken 进行精确 Token 计数和成本估算，支持多种主流 LLM 模型
- **可定制化钩子系统 (新增, 参考 crewAI)**：Hooks 系统支持全局和 Agent 级别的 before/after 钩子，允许在 LLM 和 Tool 调用处插入自定义逻辑、修改参数或阻止执行

## 总结

AgenticX Core 模块是一个设计精良、功能完整的多智能体框架核心。它不仅提供了智能体的基本抽象和执行能力，还实现了复杂的工作流编排、任务验证、错误处理等高级功能。

**最新增强**：
- **上下文编译引擎（参考 Google ADK）**：通过"编译视图"机制实现长对话的语义压缩，解决了传统简单截断导致的信息丢失问题
- **精确 Token 计量**：支持主流 LLM 模型的精确 Token 计数和成本估算，为成本优化提供数据支撑
- **挖掘任务优化**：专用 Prompt 模板保留失败路径和探索线索，特别适合"智能体自动挖掘"场景
- **Hooks 系统（参考 crewAI）**：提供 LLM 和 Tool 调用的可定制钩子机制，支持全局和 Agent 级别 hooks，允许修改执行流程或阻止执行，实现事件监听、日志记录、指标收集等高级定制
- **Flow 工作流系统（参考 crewAI）**：提供装饰器驱动的事件驱动工作流编排，支持条件触发、状态管理和路由决策
- **Agent 委派能力（参考 crewAI）**：Agent 支持 `allow_delegation` 字段，可委派任务给其他 Agent
- **GuideRails 输出验证（参考 AIGNE Framework）**：实现输出后验证和修正管道，支持 PASS/MODIFY/ABORT 三种决策，确保输出质量和合规性
- **Handoff 切换机制（参考 AIGNE Framework + OpenClaw）**：实现 Agent 间任务切换，支持循环检测和目标验证，允许智能体主动将任务转交给其他 Agent；新增 Subagent 深度/数量限制（`max_spawn_depth`/`max_children_per_agent`）和 PromptMode 传递机制
- **记忆提取管道（参考 AIGNE Framework）**：从对话中自动提取事实性记忆，支持 session 和 user 级别的分层记忆管理，与 KnowledgeBase 集成实现持久化
- **流式响应累积（参考 CAMEL-AI + OpenClaw）**：StreamContentAccumulator 管理流式响应内容，支持增量内容和累积内容两种模式，确保响应包含完整的累积内容；新增跨 chunk 的 `<thinking>` 标签解析状态机，正确分离推理内容和可见内容
- **Reflector 自反思模块（参考 VeADK）**：`reflector.py` 新增 `ReflectionResult`、`BaseReflector`、`LLMReflector`、`ReflectionLoop`，支持 Agent 执行后自动分析 traces 生成优化后的 prompt（P1-1）
- **Agent 声明式构建（参考 VeADK）**：`agent_builder.py` 新增 `AgentBuilder`、`AgentBuilderConfig`、`create_agent_from_config`，支持通过 YAML/dict 配置声明式构建 Agent 拓扑，零代码定义多 Agent 系统（P2-2）
- **三级渐进式溢出恢复（参考 OpenClaw）**：`overflow_recovery.py` 新增 `OverflowRecoveryPipeline`，按 L1 截断工具结果 → L2 显式压缩 → L3 快速启发式三个等级逐级尝试恢复，集成到 `ContextCompiler.maybe_compact()` 的 `token_overflow` 路径中
- **SelfRepair 自动恢复（内化自 IronClaw）**：`self_repair.py` 新增 `SelfRepair` 抽象接口和 `DefaultSelfRepair` 实现，通过外部注入的异步回调检测卡死任务和失效工具，达到 `max_repair_attempts` 后上报 MANUAL_REQUIRED；`__init__.py` 导出 `SelfRepair`、`DefaultSelfRepair`、`SelfRepairConfig`、`RepairResult`、`StuckTask`、`BrokenTool`
- **PromptMode 分级（参考 OpenClaw）**：`prompt.py` 新增 `PromptMode` 枚举（FULL/MINIMAL/NONE），`PromptManager.generate_prompt()` 按模式裁剪上下文量，子代理可通过 Handoff metadata 指定接收的上下文级别
- **Execution Lane Generation Counter（参考 OpenClaw）**：`execution_lane.py` 新增世代计数器，`bump_generation()` 使旧世代的 Guard 在释放时自动失效，解决热重启场景下过期回调的干扰问题
- **Auth Profile 轮换（参考 OpenClaw）**：`agent_executor.py` 新增 `_invoke_llm_with_auth_rotation()` 方法，与 `agenticx.llms.auth_profile.AuthProfileManager` 集成，LLM 调用失败时自动轮换到下一个可用 API Key
- **Transcript 卫生管线（参考 OpenClaw）**：`agent_executor.py` 集成 `agenticx.llms.transcript_sanitizer.TranscriptSanitizer`，在 LLM 调用前按 provider 策略执行 turn 交替、连续消息合并、拒绝触发词剥离等清洗操作
- **executor 跨平台资源模块（Windows）**：`executor.py` 将标准库 `resource` 改为可选导入；无 POSIX 时跳过 `setrlimit`，`ResourceMonitor` 在无 `psutil` 且无 `resource` 时安全返回 `0`，保证 `import agenticx.core.executor` 在 Windows 上可用（commit `96b5e4c`）
- **统一卸载子系统（内化自 AgentScope v2 P0）**：`core/offload/` 新增 `Offloader` 协议、结构化 `Reference` 句柄与默认文件后端 `FileOffloader`（落盘 `~/.agenticx/offload/<session>/<handle>.json`），将大体积工具结果/压缩上下文移出实时历史、仅保留内联占位符按需取回；`should_offload(threshold=4096)` 控制触发，被规范 `ReActAgent` 集成（commit `f8234a92`）

该模块的设计充分体现了现代软件架构的最佳实践，**同时参考了 Google ADK 在上下文工程、crewAI 在 Hooks 和 Flow 编排、AIGNE Framework 在输出验证和记忆管理、CAMEL-AI 在流式响应累积、VeADK 在自反思和声明式构建、OpenClaw 在溢出恢复/Auth 轮换/Transcript 卫生/PromptMode 分级/Subagent 限制/Generation Counter 方面的先进理念**，为构建大规模、高可靠性、低成本、可定制的多智能体系统提供了坚实的基础。