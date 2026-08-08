# AgenticX Collaboration 模块完整结构分析

> 结论更新时间：2026-05-29（覆盖 2026-01-17 之后的变更）
>
> 自上次更新以来，该模块的代码变更集中在 Eigent 内化收尾：新增 `task_lock.py`（项目级状态容器），并补齐 `conversation.py`、`workforce/{events,hooks,context_manager}.py`（均已在下文记录）。其余多为版本号 bump（`__init__.py`）。

## 目录路径
`D:\myWorks\AgenticX\agenticx\collaboration`

## 完整目录结构和文件摘要

### 根目录文件

#### delegation.py (新增，参考 crewAI)
**文件功能**：实现 Agent 之间的任务委派和问答机制
**技术实现**：基于角色的模糊匹配查找目标 Agent，支持自定义执行函数
**关键组件**：
- `DelegateWorkTool`：委派任务工具
- `AskQuestionTool`：提问工具
- `DelegationContext`：委派上下文追踪
- `sanitize_agent_name()` / `find_agent_by_role()`：Agent 匹配工具函数
**业务逻辑**：实现 Agent 之间的动态任务委派和协作
**依赖关系**：依赖 `core/agent.py`，被 AgentExecutor 集成使用

#### README.md (15,234 bytes)
**文件功能**：AgenticX M8.5 多智能体协作框架的完整技术文档和使用指南
**技术实现**：详细介绍了8种核心协作模式的设计原理、实现方式和使用场景，包括主从层次模式、反思模式、辩论模式、群聊模式、并行模式、嵌套模式、动态模式和异步模式
**关键组件**：核心组件包括 enums.py（枚举定义）、config.py（配置管理）、base.py（基础抽象）、patterns.py（协作模式实现）、manager.py（协作管理器）、memory.py（记忆系统）、metrics.py（指标收集）
**业务逻辑**：提供了完整的多智能体协作解决方案，支持模块化设计、配置驱动、事件驱动、可观测性和错误恢复等设计原则，每种协作模式都有详细的适用场景、特点和代码示例
**依赖关系**：作为框架的入口文档，指导用户理解和使用整个协作模块的功能

#### __init__.py (1,234 bytes)
**文件功能**：AgenticX M8.5 多智能体协作框架模块的统一导出接口
**技术实现**：通过 __all__ 列表导出所有核心组件，包括枚举类、配置类、基础抽象类、协作模式类和管理服务类
**关键组件**：导出 CollaborationMode、ConflictResolutionStrategy、RepairStrategy 等枚举，CollaborationConfig、CollaborationManagerConfig、RolePlayingConfig 等配置类，BaseCollaborationPattern、CollaborationResult 等基础类，以及包括 RolePlayingPattern 在内的各种协作模式和管理器
**业务逻辑**：作为模块的统一入口，简化用户导入和使用协作框架的各个组件
**依赖关系**：依赖模块内的所有核心文件，为外部提供统一的访问接口

#### enums.py (2,456 bytes)
**文件功能**：定义协作框架中所有枚举类型，提供标准化的常量定义
**技术实现**：使用 Python Enum 类定义了6个核心枚举类型，包括协作模式、冲突解决策略、修复策略、协作状态、消息类型和智能体角色
**关键组件**：CollaborationMode（10种协作模式，包括新增的 ROLE_PLAYING 和 WORKFORCE）、ConflictResolutionStrategy（5种冲突解决策略）、RepairStrategy（6种修复策略）、CollaborationStatus（7种协作状态）、MessageType（8种消息类型）、AgentRole（10种智能体角色）
**业务逻辑**：为整个协作框架提供标准化的枚举值，确保系统中使用统一的状态和类型定义，支持类型安全和代码可读性。WORKFORCE 模式支持 CAMEL-AI 的 Workforce 编排系统
**依赖关系**：被框架内所有其他模块引用，作为基础的类型定义层

#### config.py (4,567 bytes)
**文件功能**：定义协作框架的完整配置模型，支持灵活的参数配置和模式特定设置
**技术实现**：使用 Pydantic BaseModel 定义了多层次的配置类，包括通用协作配置、管理器配置、记忆系统配置和各种协作模式的专用配置
**关键组件**：CollaborationConfig（通用配置）、CollaborationManagerConfig（管理器配置）、CollaborationMemoryConfig（记忆配置）、以及10种协作模式的专用配置类（如 MasterSlaveConfig、ReflectionConfig、RolePlayingConfig、WorkforceConfig 等）
**业务逻辑**：提供配置驱动的协作框架设计，支持超时控制、并发限制、冲突解决、指标收集、记忆管理等功能的灵活配置，并为每种协作模式提供专门的参数设置。RolePlayingConfig 支持 User/Assistant 角色配置、轮次限制、上下文注入和终止检测等参数。WorkforceConfig 支持 coordinator-planner-worker 三层架构配置、执行模式、故障处理配置、任务超时等参数
**依赖关系**：依赖 enums.py 中的枚举定义，被 patterns.py、manager.py 等核心模块使用

#### base.py (6,789 bytes)
**文件功能**：定义协作框架的基础数据模型和抽象基类，提供核心的数据结构和接口规范
**技术实现**：使用 Pydantic BaseModel 定义了20多个数据模型，包括协作事件、协作结果、协作状态、任务相关模型、消息模型等，以及 BaseCollaborationPattern 抽象基类
**关键组件**：CollaborationEvent（协作事件）、CollaborationResult（协作结果）、CollaborationState（协作状态）、SubTask（子任务）、Message（消息）、BaseCollaborationPattern（抽象基类）等
**业务逻辑**：为整个协作框架提供统一的数据模型和接口规范，BaseCollaborationPattern 定义了所有协作模式必须实现的核心方法，包括智能体管理、任务执行、状态更新等
**依赖关系**：依赖 enums.py 和 config.py，被 patterns.py、manager.py、memory.py 等模块继承和使用

#### patterns.py (2,398 lines, ~95,920 bytes)
**文件功能**：实现8种核心协作模式的具体逻辑，是协作框架的核心实现文件
**技术实现**：每种协作模式都继承自 BaseCollaborationPattern，实现了完整的协作流程，包括任务分解、智能体协调、结果聚合等，使用 AgentExecutor 与 LLM 交互
**关键组件**：MasterSlavePattern（主从模式）、ReflectionPattern（反思模式）、DebatePattern（辩论模式）、GroupChatPattern（群聊模式）、ParallelPattern（并行模式）、NestedPattern（嵌套模式）、DynamicPattern（动态模式）、AsyncPattern（异步模式）
**业务逻辑**：每种模式都有独特的协作逻辑，如主从模式的任务分解和层次管理、反思模式的迭代改进、辩论模式的多轮论证、并行模式的负载均衡等，支持复杂的多智能体协作场景
**依赖关系**：依赖 base.py、config.py、enums.py，以及核心的 Agent、AgentExecutor、Task 类

#### workforce/ 子目录（新增，内化自 CAMEL-AI + Eigent）
**文件功能**：实现 Workforce 编排模式，支持 coordinator-planner-worker 三层架构，任务分解和执行分离，多轮对话，事件通知，工作流内存
**技术实现**：内化自 CAMEL-AI 的 Workforce 编排系统和 Eigent 的增强特性，实现完整的任务分解、分配、执行和恢复流程，及前端事件推送能力
**关键组件**：
- `workforce_pattern.py`：WorkforcePattern 主类，继承 BaseCollaborationPattern，支持：
  - `decompose_task()`：异步任务分解（返回子任务列表），支持 coordinator_context 注入和流式回调
  - `start_execution()`：异步任务执行（处理子任务分配和并行执行）
  - `is_simple_question()`：判断是否为简单问题（LLM 或关键词判断）
  - `answer_simple_question()`：直接回答简单问题
- `coordinator.py`：CoordinatorAgent 类，负责任务分配，优先使用 CollaborationIntelligence，回退到 LLM 驱动分配
- `task_planner.py`：TaskPlannerAgent 类，负责任务分解和结果组合
- `worker.py`：Worker 抽象基类和 SingleAgentWorker 实现，支持：
  - 工作流内存（enable_workflow_memory）：通过 deque 维护任务执行历史，自动注入 task.context
  - 尝试追踪（worker_attempts）：记录每次任务执行的尝试信息
  - `get_conversation_accumulator()`：获取工作流内存累积的对话
  - `get_attempt_count()` / `get_attempt_history()`：查询尝试统计
- `events.py`：WorkforceEventBus 类，支持：
  - `WorkforceAction` 枚举：包含分解、分配、执行、Agent/Toolkit 激活等 30+ 事件类型
  - `WorkforceEvent` 模型：与 EventLog 兼容的事件定义
  - `publish()`：事件发布
  - `subscribe()`：事件订阅（前端监听）
  - `get_next_event()`：异步获取下一个事件（SSE 推送用）
  - `get_event_history()`：检索事件历史
- `context_manager.py`：ContextManager 类，支持：
  - `build_coordinator_context()`：为 Coordinator 构建上下文（含历史信息和语义压缩）
  - `build_worker_context()`：为 Worker 构建上下文（仅含当前任务）
  - Token 限制和优化
- `hooks.py`：Workforce 事件通知钩子，支持：
  - `create_workforce_event_hooks()`：注册自动事件通知 hooks（LLM/Tool 调用时自动发送激活/停止事件）
  - `remove_workforce_event_hooks()`：取消注册 hooks
  - 与 core/hooks.py 集成，实现 ListenAgent 模式
- `conversation.py`：ConversationManager 类（协作模块顶层），支持：
  - `add_conversation()`：记录对话条目（role, content, timestamp, metadata）
  - `get_conversation_context()`：构建对话上下文（支持角色过滤和长度限制）
  - `get_history_stats()`：获取对话统计信息
  - 与 EventLog 和 Memory 系统集成
- `task_decomposer.py`：TaskDecomposer 类，使用 LLM 动态分解复杂任务为自包含的子任务，结构化输出（Pydantic 模型）
- `task_assigner.py`：TaskAssigner 类，将任务分配给合适的 Worker，优先使用 CollaborationIntelligence
- `failure_analyzer.py`：FailureAnalyzer 类，分析任务失败原因并推荐恢复策略
- `recovery_strategies.py`：RecoveryStrategyExecutor 类，实现 RETRY、REASSIGN、DECOMPOSE、REPLAN、CREATE_WORKER 五种恢复策略
- `worker_factory.py`：WorkerFactory 类，根据任务需求动态创建新的 Worker，集成 DiscoveryBus 发布新 Worker 发现事件
- `prompts.py`：Prompt 模板，包含任务分解、任务分配、故障分析、Worker 创建等 LLM Prompt 模板
- `utils.py`：工具类和枚举，包括 RecoveryStrategy、WorkforceMode、FailureHandlingConfig、TaskAnalysisResult 等
**业务逻辑**：
- 任务分解和执行分离：支持异步分解任务再分发执行，适用于前端需要显示分解进度的场景
- 多轮对话支持：通过 ConversationManager 维护对话历史，Coordinator 可基于历史上下文做出更好决策
- 工作流内存：Worker 自动累积任务执行历史，后续任务可访问前任的执行结果
- 事件驱动通知：WorkforceEventBus + Hooks 实现 Agent/Toolkit 执行时的自动事件推送，支持前端 SSE 实时订阅
- 故障恢复：FailureAnalyzer 和 RecoveryStrategyExecutor 实现自动故障分析和恢复策略执行
**依赖关系**：依赖 base.py、config.py、enums.py，复用 AgentExecutor、AdaptivePlanner、CollaborationIntelligence、DiscoveryBus 等核心组件，与 core/hooks.py、core/context_compiler.py、core/token_counter.py、memory/ 系统深度集成

#### role_playing.py (384 lines, ~15KB)
**文件功能**：实现角色扮演模式（OWL 增强机制），支持 User Agent 和 Assistant Agent 的双向对话和显式任务分解
**技术实现**：RolePlayingPattern 类继承自 BaseCollaborationPattern，实现 User/Assistant 交替对话循环，使用 RolePlayingPrompts 生成系统 Prompt，通过 AgentExecutor 执行任务
**关键组件**：
- `RolePlayingPattern` 类：核心协作模式实现
  - `execute(task: str, **kwargs) -> CollaborationResult`：执行角色扮演协作任务
  - `_inject_task_context(message_content: str, is_task_done: bool) -> str`：注入任务上下文到消息
  - `_check_termination(user_response: str) -> bool`：检测 TASK_DONE 终止标记
  - `_extract_result_content(result: Dict) -> str`：从 AgentExecutor 结果中提取内容
  - `_extract_tool_calls(result: Dict) -> List[Dict]`：提取工具调用记录
**业务逻辑**：User Agent 负责任务分解并生成指令（格式：`Instruction: ...`），Assistant Agent 负责工具调用和执行。每轮对话注入任务上下文防止偏离目标，通过 TASK_DONE 标记检测任务完成。支持最大轮次限制和上下文注入开关
**依赖关系**：依赖 base.py、config.py、enums.py、prompts/role_playing_prompts.py，以及核心的 Agent、AgentExecutor、Task 类
**设计来源**：内化自 OWL (Optimized Workforce Learning) 的增强角色扮演机制

#### prompts/ 子目录
**文件功能**：角色扮演模式的 Prompt 模板模块
**技术实现**：RolePlayingPrompts 类提供静态方法生成 User/Assistant 系统 Prompt，以及上下文注入和后续指令提示方法
**关键组件**：
- `prompts/__init__.py`：模块导出接口
- `prompts/role_playing_prompts.py`：Prompt 模板实现
  - `get_user_system_prompt(task_prompt: str) -> str`：生成 User Agent 系统 Prompt
  - `get_assistant_system_prompt(task_prompt: str) -> str`：生成 Assistant Agent 系统 Prompt
  - `inject_task_context(message_content: str, task_prompt: str, is_task_done: bool) -> str`：注入任务上下文
  - `inject_user_followup(message_content: str, task_prompt: str) -> str`：注入 User Agent 后续指令提示
**业务逻辑**：提供精心设计的系统 Prompt 模板，包含角色规则、任务上下文、工具使用提示和终止检测规则，确保 User/Assistant 角色不翻转，支持显式任务分解
**依赖关系**：被 role_playing.py 使用

#### manager.py (354 lines, ~14,160 bytes)
**文件功能**：协作管理器，负责创建、监控和优化协作模式的生命周期管理
**技术实现**：CollaborationManager 类提供了协作模式的工厂方法、状态监控、性能优化和冲突解决功能，支持并发协作管理和历史记录
**关键组件**：create_collaboration（创建协作）、monitor_collaboration（监控协作）、optimize_collaboration（优化协作）、resolve_collaboration_conflicts（解决冲突）等方法。`_create_pattern_instance()` 方法支持创建包括 RolePlayingPattern 和 WorkforcePattern 在内的10种协作模式
**业务逻辑**：作为协作框架的中央控制器，管理多个并发协作会话，提供统一的协作生命周期管理、性能监控和优化建议，支持动态调整和故障恢复。支持通过 `create_collaboration(pattern=CollaborationMode.ROLE_PLAYING, ...)` 创建角色扮演模式，通过 `create_collaboration(pattern=CollaborationMode.WORKFORCE, ...)` 创建 Workforce 模式
**依赖关系**：依赖 patterns.py 中的所有协作模式类、role_playing.py 的 RolePlayingPattern、workforce/workforce_pattern.py 的 WorkforcePattern，以及 base.py、config.py、enums.py

#### memory.py (361 lines, ~14,440 bytes)
**文件功能**：协作记忆系统，负责存储和检索协作事件，分析协作模式和优化策略
**技术实现**：CollaborationMemory 类实现了事件存储、历史检索、模式分析和策略优化功能，支持智能体记忆管理和协作数据挖掘
**关键组件**：store_collaboration_event（存储事件）、retrieve_collaboration_history（检索历史）、analyze_collaboration_patterns（分析模式）、optimize_collaboration_strategy（优化策略）等方法
**业务逻辑**：为协作框架提供记忆和学习能力，通过分析历史协作数据识别模式、优化策略，支持智能体个性化记忆和协作效率提升
**依赖关系**：依赖 base.py 中的数据模型和 config.py 中的配置类

#### metrics.py (339 lines, ~13,560 bytes)
**文件功能**：协作指标收集器，负责追踪协作效率和智能体贡献，生成性能报告
**技术实现**：定义了多个指标模型（EfficiencyMetrics、ContributionMetrics、CommunicationPatterns、CollaborationReport）和 CollaborationMetrics 收集器类
**关键组件**：track_collaboration_efficiency（追踪效率）、measure_agent_contribution（测量贡献）、analyze_communication_patterns（分析通信）、generate_collaboration_report（生成报告）等方法
**业务逻辑**：提供全面的协作性能监控和分析能力，包括执行时间、成功率、通信开销、智能体贡献度等指标，支持性能优化和决策支持
**依赖关系**：依赖 base.py 中的数据模型，为 manager.py 提供指标支持

### intelligence/ 子目录

#### intelligence/__init__.py (234 bytes)
**文件功能**：协作智能模块的导出接口
**技术实现**：导出协作智能相关的核心类和模型
**关键组件**：CollaborationIntelligence、MessageRouter、RoleAssigner 等
**业务逻辑**：为协作智能功能提供统一的访问入口
**依赖关系**：依赖子模块中的各个组件

#### intelligence/collaboration_intelligence.py (790 lines, ~31,600 bytes)
**文件功能**：协作智能调度引擎，提供智能体协作的核心调度和优化功能
**技术实现**：CollaborationIntelligence 类实现了智能任务分配、协作模式识别、性能监控、冲突检测和自适应调整等高级功能
**关键组件**：register_agent（注册智能体）、create_collaboration_session（创建协作会话）、allocate_tasks（智能任务分配）、monitor_collaboration（监控协作）、optimize_collaboration（优化协作）、detect_and_resolve_conflicts（冲突检测解决）等方法
**业务逻辑**：作为协作框架的智能大脑，提供基于机器学习的协作优化，包括负载均衡、通信优化、角色调整、瓶颈检测等，支持自适应协作和持续改进
**依赖关系**：依赖 models.py 中的数据模型，为整个协作框架提供智能化支持

#### intelligence/message_router.py (456 bytes)
**文件功能**：消息路由器，负责智能体间的消息传递和路由优化
**技术实现**：实现消息路由算法和通信优化策略
**关键组件**：消息路由、通信优化、负载均衡等功能
**业务逻辑**：优化智能体间的通信效率，减少通信开销
**依赖关系**：被 collaboration_intelligence.py 使用

#### intelligence/models.py (567 bytes)
**文件功能**：协作智能模块的数据模型定义
**技术实现**：定义智能体档案、协作上下文、任务分配等数据模型
**关键组件**：AgentProfile、CollaborationContext、TaskAllocation、PerformanceMetrics 等模型
**业务逻辑**：为协作智能功能提供标准化的数据结构
**依赖关系**：被 collaboration_intelligence.py 等模块使用

#### intelligence/role_assigner.py (345 bytes)
**文件功能**：角色分配器，负责动态分配和调整智能体角色
**技术实现**：实现基于能力和负载的角色分配算法
**关键组件**：角色分配、能力评估、负载均衡等功能
**业务逻辑**：根据任务需求和智能体能力动态分配最优角色
**依赖关系**：被 collaboration_intelligence.py 使用

#### delegation.py (新增，参考 crewAI)
**文件功能**：实现 Agent 之间的任务委派和问答机制
**技术实现**：基于角色的模糊匹配查找目标 Agent，支持自定义执行函数
**关键组件**：
- `DelegateWorkTool` 类：委派任务工具，允许 Agent 将任务委派给其他 Agent 执行
  - 支持基于角色名称的模糊匹配（精确匹配、部分匹配、词级别匹配）
  - 支持自定义任务执行函数
  - 提供详细的委派上下文追踪（DelegationContext）
- `AskQuestionTool` 类：向同事提问工具，允许 Agent 向其他 Agent 提问并获取答案
  - 与 DelegateWorkTool 的区别：委派是完整任务执行，提问是信息获取
- `DelegationContext` 类：委派执行上下文，记录委派过程中的所有信息
- `sanitize_agent_name()`：标准化 Agent 名称用于匹配（Unicode 规范化、移除变音符号）
- `find_agent_by_role()`：根据角色查找 Agent（支持精确匹配、模糊匹配、严格模式）
- `create_delegation_tools()`：便捷函数，一次性创建 DelegateWorkTool 和 AskQuestionTool
**业务逻辑**：实现 Agent 之间的动态任务委派和协作，支持基于角色的智能匹配，提供完整的委派追踪和错误处理
**依赖关系**：依赖 `core/agent.py` 的 Agent 类，被 AgentExecutor 集成使用（当 Agent.allow_delegation=True 时）

#### conversation.py (新增，内化自 Eigent)
**文件功能**：多轮对话管理，支持对话历史保留和上下文构建
**技术实现**：集成 EventLog 和 Memory 系统，自动清理超长历史
**关键组件**：
- `ConversationEntry` 模型：对话条目，包含 role、content、timestamp、metadata
- `ConversationManager` 类，支持：
  - `add_conversation()`：添加对话条目（支持用户消息、助手消息、任务结果、系统消息）
  - `get_conversation_context()`：构建对话上下文字符串（支持角色过滤、长度限制、时间范围过滤）
  - `get_history()`：获取对话历史条目
  - `clear_history()`：清除历史记录
  - `get_history_stats()`：获取对话统计（条目数、字符数、角色分布等）
  - 自动删除策略：当历史超过字符限制或条目数限制时自动清理最旧的条目
**业务逻辑**：为多轮对话提供完整的历史管理，Coordinator 可基于完整对话历史做出更好的决策，Worker 可查询历史结果避免重复工作
**依赖关系**：依赖 EventLog、ShortTermMemory/EpisodicMemory 系统

#### task_lock.py (NEW，内化自 Eigent TaskLock)
**文件功能**：项目级别状态管理器，维护 Action Queue、对话历史与最后任务结果，是 Workforce 群聊桥接的项目级状态容器
**技术实现**：基于 Pydantic BaseModel + asyncio，参考 Eigent `backend/app/service/task.py`
**关键组件**：
- `TaskStatus` 枚举：`confirming` / `confirmed` / `processing` / `done` / `paused` / `failed`
- `Action` 枚举：双向动作类型——User→Backend（`improve`/`update_task`/`start`/`stop`/`supplement`/`pause`/`resume`/`new_agent`/`add_task`/`remove_task`/`skip_task`）与 Backend→User（`task_state`/`decompose_progress`/`create_agent`/`activate_agent`/`assign_task`/`activate_toolkit`/`write_file`/`ask` 等）
- `TaskLock` 容器：持有 Action Queue、对话历史与任务状态，供前端 UI 动作注入与状态回放
**业务逻辑**：作为 Workforce 群聊的项目级状态单一来源，Studio `POST /api/groups/{id}/action`（ADD_TASK/PAUSE/RESUME/STOP）与 `GET /api/groups/{id}/events`（SSE）据此驱动；Runtime `group_router._run_team_turn()` 在执行层读写它
**依赖关系**：被 `agenticx/runtime/group_router.py` 的 Workforce 桥接路径使用；与 `workforce/events.py:WorkforceEventBus` 协同
**导出**：`__init__.py` 通过 `export TaskLock components`（commit `c0e923f7`）对外暴露

## 模块架构特点

### 1. 模块化设计
- **分层架构**：基础层（enums、config、base）、实现层（patterns、manager、memory、metrics）、智能层（intelligence）、Eigent 增强层（conversation、workforce/events、workforce/context_manager、workforce/hooks）
- **职责分离**：每个模块都有明确的职责边界，支持独立开发和测试
- **接口标准化**：通过抽象基类和统一接口确保模块间的协调性
- **功能整合**：Eigent 增强特性与现有 WorkforcePattern、CollaborationManager 深度整合

### 2. 现代化技术栈
- **类型安全**：大量使用 Pydantic 模型和类型注解，确保数据结构的类型安全
- **配置驱动**：支持灵活的配置管理，适应不同的协作场景
- **异步支持**：内置异步协作模式，支持长时间运行的协作任务

### 3. 完整工具链
- **生命周期管理**：从协作创建到监控、优化、清理的完整生命周期支持
- **性能监控**：全面的指标收集和性能分析能力
- **智能优化**：基于历史数据的协作模式识别和策略优化

## 核心功能

### 1. 多样化协作模式
- **10种协作模式**：主从、反思、辩论、群聊、并行、嵌套、动态、异步、角色扮演（ROLE_PLAYING）、Workforce（WORKFORCE）
- **场景适配**：每种模式都有明确的适用场景和优化策略
- **可扩展性**：支持自定义协作模式的扩展
- **角色扮演模式**：基于 OWL 增强机制，支持 User/Assistant 双向对话和显式任务分解，适用于复杂任务的逐步分解和执行
- **Workforce 模式**：内化自 CAMEL-AI，实现 coordinator-planner-worker 三层架构，支持智能任务分解、智能任务分配、故障分析和自动恢复，适用于需要复杂任务分解和多 Worker 协作的场景

### 2. 智能化管理
- **自动任务分配**：基于智能体能力和负载的智能任务分配
- **动态优化**：实时监控和自适应优化协作效率
- **冲突解决**：自动检测和解决协作过程中的冲突

### 3. 全面监控分析
- **实时监控**：协作状态、性能指标的实时监控
- **历史分析**：协作历史数据的深度分析和模式识别
- **报告生成**：详细的协作报告和改进建议

### 4. Agent 委派能力（新增，参考 crewAI）
- **任务委派**：通过 DelegateWorkTool 实现 Agent 之间的任务委派
- **智能匹配**：基于角色名称的模糊匹配算法，支持精确匹配、部分匹配、词级别匹配
- **问答机制**：通过 AskQuestionTool 实现 Agent 之间的信息查询
- **上下文追踪**：完整的委派执行上下文记录，包括执行时间、结果、错误信息等

### 5. Eigent 集成特性（新增，内化自 Eigent）
- **任务分解和执行分离**：WorkforcePattern 支持 `decompose_task()` 和 `start_execution()` 异步方法，允许前端显示分解进度后再执行
- **前端事件推送**：WorkforceEventBus 支持 subscribe/publish 模式，与 SSE/WebSocket 集成实现实时事件推送
- **多轮对话支持**：ConversationManager 维护对话历史，Coordinator 基于完整对话历史做出更好决策
- **工作流内存传递**：SingleAgentWorker 支持 enable_workflow_memory，自动累积任务执行历史供后续 Worker 访问
- **自动事件通知**：create_workforce_event_hooks() 与 core.hooks 集成，Agent/Toolkit 执行时自动发送激活/停止事件（ListenAgent 模式）
- **简单问题直接回答**：WorkforcePattern.is_simple_question() 支持 LLM 和关键词判断，简单问题直接回答无需分解
- **上下文管理**：ContextManager 封装 ContextCompiler 和 TokenCounter，为 Coordinator/Worker 精细化管理上下文和 Token 限制

## 技术实现

### 1. 设计模式应用
- **工厂模式**：协作模式的动态创建和管理
- **策略模式**：不同协作策略的灵活切换
- **观察者模式**：事件驱动的状态更新和通知

### 2. 数据管理
- **事件溯源**：完整的协作事件记录和回放能力
- **内存管理**：智能体个性化记忆和协作历史管理
- **数据持久化**：支持多种存储后端的数据持久化

### 3. 性能优化
- **并发支持**：多协作会话的并发执行和管理
- **资源管理**：智能体资源的合理分配和调度
- **缓存机制**：协作结果和模式的缓存优化

这个协作模块代表了 AgenticX 框架在多智能体协作领域的核心能力，提供了完整、灵活、智能的协作解决方案，支持复杂的企业级多智能体应用场景。

**Eigent 集成新增（2026年1月）**：
基于 Eigent 框架的深入调研，AgenticX 内化了以下核心特性，显著增强了 Workforce 模式的能力：
- **任务分解-执行分离**：WorkforcePattern 的 `decompose_task()` 和 `start_execution()` 方法支持异步分解，满足前端需要显示任务分解进度的需求
- **前端事件推送系统**：WorkforceEventBus 支持发布/订阅模式，包含 30+ 事件类型，支持 SSE/WebSocket 实时推送，实现与前端的双向通信
- **多轮对话管理**：ConversationManager 维护完整的对话历史，自动清理过长记录，Coordinator 可基于历史做出更好决策，避免上下文丢失
- **工作流内存和尝试追踪**：SingleAgentWorker 的 enable_workflow_memory 选项自动累积任务执行历史（用 deque 存储），后续 Worker 可访问前任结果；worker_attempts 记录每次尝试详情
- **自动事件通知（ListenAgent 模式）**：create_workforce_event_hooks() 将 core.hooks 系统与 WorkforceEventBus 集成，Agent/Toolkit 执行时自动发送激活/停止事件，无需显式代码
- **简单问题直接回答**：WorkforcePattern.is_simple_question() 支持 LLM 和关键词双模式判断，简单问题（问候、简单查询）直接回答，避免不必要的任务分解
- **精细化上下文管理**：ContextManager 封装 ContextCompiler 和 TokenCounter，支持为 Coordinator 和 Worker 分别构建优化的上下文，自动实现语义压缩和 Token 限制

这些增强使 AgenticX 的 Workforce 模式与 Eigent 功能对标，同时保持了 AgenticX 架构的简洁性和可维护性，最小化新增外部依赖。