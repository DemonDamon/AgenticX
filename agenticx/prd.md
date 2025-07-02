# AgenticX: 一个统一的多智能体框架

## 1. 愿景与目标 (Vision & Goals)

**愿景:** 打造一个统一、可扩展、生产就绪的多智能体应用开发框架，旨在赋予开发者构建从简单自动化助手到复杂协作式智能体系统的全部能力。

**核心目标:**
*   **统一的核心抽象 (Unified Core Abstractions):** 提供清晰、可复用的 `Agent`, `Task`, `Tool` 等核心构建块，作为所有应用的基础 (M1-M6)。
*   **灵活的编排引擎 (Flexible Orchestration Engine):** 内置强大的图式编排引擎，原生支持单智能体应用、顺序工作流、以及动态的多智能体协作，满足不同复杂度的需求 (M7)。
*   **企业级安全基座 (Enterprise-Ready Foundation):** 将多租户数据隔离、权限控制(RBAC)和安全护栏(Guardrails)作为框架的内置特性，确保开箱即用的安全合规 (M11)。
*   **可插拔的组件生态 (Pluggable Component Ecosystem):** 所有关键组件，包括 LLM、记忆系统、工具、甚至企业数据源（通过连接器），都可轻松替换和扩展，避免厂商锁定 (M2, M3, M4, M8, M12)。
*   **卓越的开发者体验 (Superior Developer Experience):** 提供一流的可观测性、简洁的 SDK/CLI，以及方便资产复用的中心库(Hub)，大幅提升开发和维护效率 (M9, M10, M13)。

## 2. 技术架构 (Technical Architecture)

```mermaid
graph TD
    subgraph "M10: 用户接口层 (User Interfaces)"
        SDK[Python SDK]
        CLI[CLI]
        UI[Web UI (未来)]
    end

    subgraph "核心框架层 (Core Framework)"
        subgraph "M7: 编排与路由引擎"
            Orchestrator["Orchestrator & Router"]
        end
        subgraph "M5, M6: 执行器"
            AgentExecutor["Agent Executor"]
            TaskExecutor["Task Executor"]
        end
        subgraph "M1-M4: 核心抽象与组件"
            direction LR
            Agent["Agent"]
            Task["Task"]
            Tool["Tool"]
            Memory["Memory"]
            LLM["LLM Provider"]
        end
    end

    subgraph "平台服务层 (Platform Services)"
        subgraph "M13: 资产中心"
            Hub["Agent/Workflow/Tool Hub"]
        end
        subgraph "M12: 知识层"
            Knowledge["Connectors &<br>Unified Search"]
        end
        subgraph "M11: 安全与租户"
            Security["RBAC & Guardrails"]
        end
        subgraph "M9: 可观测性"
            Callbacks["Callback Manager"]
        end
        subgraph "M8: 通信协议"
            Protocols["Protocol Handlers"]
        end
    end

    %% Connections
    SDK & CLI & UI -- "构建/运行" --> Orchestrator

    Orchestrator -- "调度" --> TaskExecutor
    TaskExecutor -- "调用" --> AgentExecutor
    AgentExecutor -- "使用" --> Agent & Task & Tool & Memory & LLM

    %% Core Framework Dependencies on Platform Services
    AgentExecutor -- "触发" --> Callbacks
    AgentExecutor -- "发送/接收" --> Protocols
    AgentExecutor -- "检查" --> Security
    Agent & Tool & Workflow -- "注册/发现" --> Hub
    Tool -- "访问" --> Knowledge
```

## 3. 功能模块拆解 (Functional Modules Breakdown)

基于该架构，我们可以定义以下功能模块:

*   **M1: 核心抽象层 (`agenticx.core`)**: 定义框架的基础数据结构。
*   **M2: LLM 服务提供层 (`agenticx.llms`)**: 对接不同的大语言模型。
*   **M3: 工具系统 (`agenticx.tools`)**: 定义和管理 Agent 可用的工具。
*   **M4: 记忆系统 (`agenticx.memory`)**: 为 Agent 提供短期和长期记忆。
*   **M5: 智能体核心 (`agenticx.agent`)**: 定义 Agent 的生命周期和执行逻辑。
*   **M6: 任务管理 (`agenticx.task`)**: 定义、分配和追踪任务。
*   **M7: 编排与路由引擎 (`agenticx.orchestrator`)**: 负责驱动整个协作流程。
*   **M8: 通信协议层 (`agenticx.protocols`)**: 负责 Agent 间和跨平台的通信。
*   **M9: 可观测性 (`agenticx.callbacks`)**: 日志、追踪和可视化。
*   **M10: 用户接口 (`agenticx.interfaces`)**: CLI、SDK 和未来的 Web UI。
*   **M11: 平台服务层 (`agenticx.platform`)**: 覆盖多租户、安全与治理。
*   **M12: 知识与数据层 (`agenticx.knowledge`)**: 统一的数据连接、处理和权限化访问。
*   **M13: 资产中心 (`agenticx.hub`)**: 管理和复用 Agents, Workflows, 和 Models。

## 4. 开发路线图 (Development Roadmap / To-Do List)

### M1: 核心抽象层 (`agenticx.core`) ✅
- [x] `Agent(BaseModel)`: 定义 Agent 的静态属性，如 `id`, `name`, `version`, `role`, `goal`, `backstory`, `llm_config_name` (指向M13), `memory_config`, `tool_names` (指向M13), `organization_id`。
- [x] `Task(BaseModel)`: 定义任务的静态属性，如 `id`, `description`, `agent_id`, `expected_output`, `context`, `dependencies` (依赖的其他 Task ID), `output_schema`。
- [x] `BaseTool(ABC)`: 工具的抽象基类，定义 `name`, `description`, `args_schema` (Pydantic Model), 以及 `execute(**kwargs)` 和 `aexecute(**kwargs)` 方法。
- [x] `Workflow(BaseModel)`: 定义工作流的静态结构，包含 `id`, `name`, `version`, `nodes`, `edges`, `organization_id`。
- [x] `Message(BaseModel)`: 定义 Agent 之间通信的消息格式，包含 `id`, `sender_id`, `recipient_id`, `content`, `metadata`。
- [x] `User(BaseModel)` & `Organization(BaseModel)`: 定义用户和租户的基本数据结构，用于平台服务层。

**实现状态**: ✅ **已完成** - 所有核心抽象类已完全实现，包含完整的字段定义、类型注解、多租户支持和版本管理。已通过全面测试验证。

### M2: LLM 服务提供层 (`agenticx.llms`)
- [ ] `BaseLLMProvider(ABC)`: 定义统一的 LLM Provider 接口，包含 `invoke(prompt)`, `ainvoke(prompt)`, `stream(prompt)` 等方法。
- [ ] `LLMResponse(BaseModel)`: 定义标准的 LLM 返回对象，包含 `content`, `token_usage`, `cost`, `model_name`。
- [ ] `OpenAIProvider(BaseLLMProvider)`: 实现 OpenAI 系列模型的服务对接。
- [ ] `AnthropicProvider(BaseLLMProvider)`: 实现 Anthropic Claude 系列模型的服务对接。
- [ ] (可选) `OllamaProvider(BaseLLMProvider)`: 实现对本地 Ollama 服务的对接。
- [ ] `TokenUsageTracker`: 一个工具类或 Callback，用于聚合和计算整个工作流的 Token 使用量和成本。

### M3: 工具系统 (`agenticx.tools`)
- [ ] `@tool` 装饰器: 一个工厂函数，能将任意 Python 函数快速包装成一个 `BaseTool` 的实例，并自动从函数签名和 docstring 推断 `name`, `description`, `args_schema`。
- [ ] `ToolExecutionEngine`: 工具执行引擎，负责安全地调用 `BaseTool` 的 `execute` 方法。
    - [ ] `SandboxEnvironment`: 为需要执行代码（如 Python）的工具提供一个隔离和安全的环境（例如，使用 Docker 容器或 WebAssembly）。
    - [ ] 内置错误处理和重试逻辑。
- [ ] `CredentialStore`: 一个安全的凭据管理器。
    - [ ] `get_credential(organization_id: str, tool_name: str)`: 根据组织和工具名获取凭据。
    - [ ] `set_credential(...)`: 设置凭据，并使用 M11 的 `EncryptionService` 进行加密存储。
- [ ] `BuiltInTools`: 提供一组开箱即用的基础工具集，如 `WebSearchTool`, `LocalFileTool`, `PythonCodeInterpreterTool`。

### M4: 记忆系统 (`agenticx.memory`)
- [ ] `BaseMemory(ABC)`: 记忆接口，定义 `add`, `search`, `update`, `delete` 等核心方法，并强制要求实现租户隔离。
- [ ] `ShortTermMemory(BaseMemory)`: 实现基于会话的简单易失性记忆（如消息历史）。
- [ ] `LongTermMemory(BaseMemory)`: 对接向量数据库的长期语义记忆。
    - [ ] 内置 `RAGPipeline`: 实现标准的检索增强生成逻辑。
    - [ ] `MemoryUpdator(Component)`: 实现"提取-检索-推理-更新"的智能循环，在 `add` 方法中被调用，以实现记忆的自我演化。
- [ ] `GraphMemory(BaseMemory)`: 对接图数据库（如 Neo4j），用于存储和查询结构化的知识图谱。
- [ ] `MemoryHistory`: 记录对 `LongTermMemory` 和 `GraphMemory` 的所有变更操作，用于审计和调试。
- [ ] `KnowledgeBase`: 允许为任务或 Agent 挂载特定的、只读的知识集合（可基于向量存储）。

### M5: 智能体核心 (`agenticx.agent`)
- [ ] `AgentExecutor`: Agent 的执行器，包含 Agent 的核心 `think-act` 循环。
    - [ ] `run(task: Task)`: 接收一个任务并开始执行循环，直到任务完成或失败。
- [ ] `PromptManager`: 管理和格式化不同类型 Agent 所需的 Prompt 模板。
    - [ ] `ReActPromptTemplate`: 实现 ReAct 风格的 Prompting。
    - [ ] `PlanAndExecutePromptTemplate`: 实现 Plan-and-Execute 模式的 Prompting。
- [ ] `CommunicationInterface`: 实现 Agent 的通信能力。
    - [ ] `send(message: Message)`: 调用 M8 的协议层发送消息。
    - [ ] `receive() -> Message`: 从 M8 的协议层接收消息。
- [ ] `AgentRetryHandler`: 负责处理 Agent 执行过程中的错误，并根据配置进行重试。

### M6: 任务管理 (`agenticx.task`)
- [ ] `TaskExecutor`: 任务执行器，负责调用 `AgentExecutor` 来完成一个具体的 `Task`。
- [ ] `TaskContextManager`: 管理任务的上下文，将相关信息（如前置任务的输出 `task.context`）传递给 Agent。
- [ ] `TaskResultValidator`: (可选) 在任务完成后，根据 `task.output_schema` 校验 Agent 的最终输出结果是否符合预定义的格式。

### M7: 编排与路由引擎 (Orchestration & Routing Engine)
- [ ] `TriggerService`: 事件触发器服务。
    - [ ] `ScheduledTrigger`: `__init__(schedule: str, workflow_name: str, initial_state: dict)`, `run()`。
    - [ ] `EventDrivenTrigger`: `__init__(topic: str, workflow_name: str)`, `listen()`, `handle_event(event_data)`。
- [ ] `MasterRouterAgent`: 一个特殊的元智能体，负责智能路由。
    - [ ] `route(request: UserRequest) -> Union[Agent, Workflow]`: 接收用户请求，查询 `AgentHub` 和 `WorkflowHub`，根据请求内容路由到最合适的专业 Agent 或工作流。
- [ ] `WorkflowManager`: 编排引擎主入口。
    - [ ] `run_static(workflow: Workflow, initial_state: dict)`: 执行一个静态定义的工作流。
    - [ ] `run_dynamic(trigger_event, initial_state)`: 响应 `TriggerService` 的调度，启动一个工作流。
- [ ] `InterAgentCommunicator`: Agent 间通信高级组件。
    - [ ] `dispatch(from_workflow: str, to_workflow: str, payload: dict)`: 允许一个工作流向另一个工作流分派任务。
- [ ] `WorkflowGraph`: 执行图的核心实现。
    - [ ] `add_node(name: str, component: Union[AgentExecutor, BaseTool, 'DispatchNode'])`: 添加执行节点，`DispatchNode` 用于调用 `InterAgentCommunicator`。
    - [ ] `add_edge(start_node: str, end_node: str, condition: Callable = None)`: 添加条件路由边。
- [ ] `ExecutionState`: 在图中流转的状态对象，每个节点都可以读写。

### M8: 通信协议层 (`agenticx.protocols`)
- [ ] `Envelope(BaseModel)`: 标准的消息信封，包含 `header` (元数据) 和 `body` (M1 的 `Message` 对象)。
- [ ] `BaseProtocolHandler(ABC)`: 协议处理器的接口，定义 `encode(envelope)` 和 `decode(raw_data)`。
- [ ] `InternalA2AHandler(BaseProtocolHandler)`: 一个高效的、用于进程内 Agent 间通信的协议处理器。
- [ ] `MCPHandler(BaseProtocolHandler)`: (研究) 兼容外部标准（如 FIPA）的 MCP 协议处理器，用于跨平台通信。
- [ ] `ProtocolRouter`: 根据消息的 `recipient_id` 或 `metadata`，选择合适的 `ProtocolHandler` 进行路由。

### M9: 可观测性 (`agenticx.callbacks`)
- [ ] `BaseCallbackHandler(ABC)`: 定义 Callback 系统的接口，包含 `on_workflow_start`, `on_workflow_end`, `on_agent_action`, `on_tool_start`, `on_tool_end`, `on_llm_stream` 等一系列事件钩子。
- [ ] `CallbackManager`: 管理所有注册的 `BaseCallbackHandler`，并在代码执行的关键节点触发相应的事件。
- [ ] `LoggingCallbackHandler(BaseCallbackHandler)`: 实现将所有事件以结构化日志格式输出。
- [ ] `LangfuseCallbackHandler(BaseCallback_Handler)`: 实现与 Langfuse 的集成，用于高级追踪和调试。
- [ ] `WebSocketCallbackHandler(BaseCallbackHandler)`: 将事件通过 WebSocket 发送到前端，支持实时可视化监控。

### M10: 用户接口 (`agenticx.interfaces`)
- [ ] `AgenticXClient`: 一个高层次的 Python SDK 客户端，封装了定义和运行工作流的常用操作。
- [ ] `agenticx.cli`: 基于 `Typer` 或 `Click` 的命令行工具。
    - [ ] `run <workflow_file.py>`: 执行一个定义了工作流的 Python 文件。
    - [ ] `validate <config.yaml>`: 检查 Agent 或 Workflow 的配置文件是否合法。
- [ ] `agenticx.ui`: (未来) 基于 Web 的可视化界面，用于创建、管理、监控和调试 Agent 与工作流。

### M11: 平台服务层 (`agenticx.platform`)
- [ ] `UserService` & `OrganizationService`: 实现用户和组织的 CRUD 及业务逻辑（如邀请）。
- [ ] `AuthContext`: 一个上下文变量 (`contextvars`)，在请求生命周期内持有当前的用户和组织信息。
- [ ] `RBACService`: 实现基于角色的访问控制，提供如 `@require_role('admin')` 的装饰器。
- [ ] `APIKeyAuthenticator`: 实现基于 API Key 的认证策略。
- [ ] `BaseRepository`: 一个泛型基类，所有对数据库的 CRUD 操作都继承自它，并自动使用 `AuthContext` 中的 `organization_id` 进行数据隔离。
- [ ] `EncryptionService`: 一个封装了加密库（如 Fernet）的服务，提供 `encrypt` 和 `decrypt` 方法。
- [ ] `PolicyEngine`: 智能体护栏的策略引擎。
    - [ ] `load_policies(organization_id: str)`: 加载 YAML 或 JSON 格式的策略规则。
    - [ ] `check_permission(action: str, agent_name: str, params: dict) -> bool`: 检查 Agent 的行为是否合规。
- [ ] `InputOutputScanner`: 内容扫描器。
    - [ ] `scan(text: str) -> ScanResult`: 扫描文本，`ScanResult` 包含是否发现敏感信息（PII）或违规内容。
- [ ] `AuditLogger`: 审计日志记录器。
    - [ ] `log_event(user_id, organization_id, event_type, details: dict)`: 记录所有关键操作。

### M12: 知识与数据层 (`agenticx.knowledge`)
- [ ] `ConnectorService`: 数据连接器服务，管理所有连接器的生命周期。
- [ ] `BaseConnector(ABC)`: 定义连接器标准接口，包含 `connect()`, `sync()`, `get_permissions()`, `fetch_batch(cursor)`。
- [ ] `ConnectorRegistry`: 用于注册和获取连接器实现类，如 `JiraConnector`, `SlackConnector`。
- [ ] `PermissionManager`: 权限管理服务。
    - [ ] `sync_permissions(connector_name: str)`: 同步源系统的权限信息。
    - [ ] `check_permission(user_id: str, resource_id: str) -> bool`: 提供快速的权限检查。
- [ ] `HybridSearchEngine`: 统一混合搜索服务。
    - [ ] `search(query: str, user_id: str) -> List[SearchResult]`: 对内调用 `VectorSearcher`, `KeywordSearcher`, `GraphSearcher` 并对结果进行权限过滤和重排序。
- [ ] `EnterpriseKnowledgeGraph`: 企业知识图谱构建与查询服务。
    - [ ] `build_from_source(connector: BaseConnector)`: 从一个数据源提取实体关系并更新图谱。
    - `query(cypher_query: str) -> List[dict]`: 提供图查询接口。

### M13: 资产中心 (`agenticx.hub`)
- [ ] `AgentHub`: Agent 注册与发现中心。
    - [ ] `register(agent: Agent)`: 注册一个新 Agent 或新版本。
    - [ ] `get(name: str, version: str = 'latest') -> Agent`: 获取一个 Agent 的定义。
    - [ ] `list() -> List[str]`: 列出所有可用的 Agent。
- [ ] `WorkflowHub`: Workflow 注册与发现中心。
    - [ ] `register(workflow: Workflow)`: 注册一个新 Workflow 或新版本。
    - [ ] `get(name: str, version: str = 'latest') -> Workflow`: 获取一个 Workflow 的定义。
- [ ] `ModelHub`: LLM 配置管理中心。
    - [ ] `register_provider_config(name: str, config: dict)`: 注册一个LLM Provider的配置。
    - [ ] `get_provider(name: str) -> BaseLLMProvider`: 使用存储的配置，通过 M2 的工厂创建并返回一个 LLM Provider 实例。
