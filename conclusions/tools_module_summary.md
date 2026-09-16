# AgenticX Tools 模块完整结构分析

> 结论更新时间：2026-09-01（覆盖 f3ba65001c29 之后的变更）

## 目录路径
`/Users/damon/myWork/AgenticX/agenticx/tools`

## 完整目录结构和文件摘要

### 目录树
```
agenticx/tools/
├── __init__.py
├── base.py
├── builtin.py
├── config.py
├── credentials.py
├── document_routers.py
├── executor.py
├── fallback_chain.py        [(NEW) 多级工具回退链：API→Browser→Computer Use]
├── function_tool.py
├── hashline.py              [(NEW) 行稳定编辑引用的 hashline 工具]
├── html_extractor.py        [(NEW) stdlib HTML 正文 + 图片 URL 抽取，服务 web_fetch]
├── image_generation.py      [(NEW) 文生图工具：本地落盘 PNG + 结构化 JSON 返回，provider 可注入]
├── lsp_manager.py           [(NEW) JSON-RPC over stdio LSP 客户端：定义/引用/hover/诊断]
├── mineru.py
├── openapi_toolset.py
├── policy.py                [(NEW) 声明式多层工具访问控制 + 路径/计划模式/命令拒绝/类目策略]
├── remote.py
├── remote_v2.py
├── sandbox_tools.py         [沙箱文件/命令/状态化代码执行工具封装（OpenSandbox 风格）]
├── security.py
├── shell_bundle.py
├── show_images.py           [(NEW) 展示型远程图片工具：image_gallery JSON + 缩略图还原/垃圾图过滤]
├── skill_bundle.py
├── skill_execution_backend.py
├── tool_context.py
├── unified_document.py
├── windowed.py
├── README.md
├── guardrails/              [(NEW) 预调用守卫（DeerFlow 2.0 内化）]
│   ├── __init__.py
│   ├── provider.py          [GuardrailProvider 协议 + Decision/Reason/Request]
│   ├── builtin.py           [AllowlistProvider（allow/deny by tool name）]
│   └── hook.py              [ToolGuardrailHook]
├── resolvers/               [(NEW) fallback chain 解析器]
│   ├── __init__.py
│   ├── api_connector_resolver.py   [MCPConnectorResolver]
│   └── computer_use_resolver.py    [ComputerUseResolver]
├── intelligence/
│   ├── __init__.py
│   └── models.py
└── adapters/
    ├── __init__.py
    ├── base.py
    ├── liteparse.py         [(NEW) LiteParse CLI 文档解析适配器]
    └── mineru.py
```

---

### 文件摘要

#### agenticx/tools/__init__.py
**文件功能**：工具模块的统一入口和导出接口。
**技术实现**：通过 `__init__.py` 导出核心抽象类、执行器、内置工具、远程工具及安全装饰器，支持内置工具的 lazy import 模式以处理环境受限场景。
**关键组件**：`BaseTool`, `ToolExecutor`, `FunctionTool`, `CredentialStore`, `MCPClientV2`, `OpenAPIToolset`, `WindowedFileTool`, `SkillBundleLoader`, `SkillTool`, `SkillMetadata`, `UnifiedDocumentTool`, `DocumentRouter`, `create_default_router`, **`ToolCallingRecord` (新增)** 等。
**业务逻辑**：作为 Tools 模块的公共 API，简化了外部模块对工具系统的调用，并确保了版本兼容性（如同时导出 V1 和 V2 版本的远程工具）。**新增 ToolCallingRecord 的导出，支持外部模块访问工具调用记录数据模型**
**依赖关系**：聚合了本目录下所有子模块的功能。

#### agenticx/tools/base.py
**文件功能**：AgenticX 工具系统的抽象基类定义。
**技术实现**：基于 `abc.ABC` 定义了 `BaseTool`，使用 Pydantic 进行参数校验，支持同步/异步执行切换，并内置了 Bash 语法静态预检功能。
**关键组件**：`BaseTool` (核心抽象类), `ToolError` (异常基类), `validate_bash_syntax` (语法检查方法), `process_llm_request` (ADK 增强方法)。
**业务逻辑**：定义了工具的生命周期契约，包括参数验证、回调触发、LLM 请求修改等，赋予工具“感知和主动修改环境”的能力。
**依赖关系**：被所有具体工具实现继承，依赖 `..core.message`。

#### agenticx/tools/builtin.py
**文件功能**：提供开箱即用的基础内置工具集。
**技术实现**：实现了文件读写、基于 DuckDuckGo 和 Google 的网络搜索、受限沙箱内的 Python 代码执行、以及通用的 HTTP/JSON 处理工具。
**关键组件**：`FileTool`, `WebSearchTool`, `CodeInterpreterTool`, `HttpRequestTool`, `JsonTool`。
**业务逻辑**：满足智能体最基本的物理世界与数字世界交互需求，通过 `allowed_paths` 和 `SandboxEnvironment` 确保操作安全。
**依赖关系**：继承 `BaseTool`，依赖 `requests`, `credentials`, `executor.SandboxEnvironment`。

#### agenticx/tools/config.py
**文件功能**：特定工具（主要针对 MinerU）的配置管理模块。
**技术实现**：使用 Pydantic 的 `BaseModel` 统一管理环境变量、配置文件和字典格式的配置，支持单例模式的 `ConfigManager`。
**关键组件**：`MinerUConfig` (配置模型), `ConfigManager` (单例管理器), `get_config` (便捷获取函数)。
**业务逻辑**：解耦了工具逻辑与配置参数，支持多来源（ENV, JSON file）配置注入，并提供运行时配置热更新能力。
**依赖关系**：被 `mineru.py` 等模块使用。

#### agenticx/tools/credentials.py
**文件功能**：安全的凭据管理器，用于存储敏感信息（如 API Key）。
**技术实现**：利用 `cryptography.fernet` 进行加密存储，支持基于 `organization_id` 的多租户隔离，提供凭据的导入导出功能。
**关键组件**：`CredentialStore` (核心管理类), `get_credential`/`set_credential` (全局单例接口)。
**业务逻辑**：确保工具调用所需的各种密钥不以明文形式散落在代码或配置文件中，提升系统的安全性。
**依赖关系**：被内置工具和远程工具调用以获取访问凭据。

#### agenticx/tools/executor.py
**文件功能**：工具执行引擎，负责安全、可靠地运行工具。
**技术实现**：支持同步/异步批量执行、超时控制、指数退避重试，并实现了基于 `_state` 钩子的状态侧车（State Sidecar）同步机制。支持两级沙箱：简单沙箱（基于 exec）和高级沙箱（进程/容器级隔离）。**新增工具调用历史追踪功能（参考 CAMEL-AI）**
**关键组件**：
- `ToolCallingRecord` (新增): 工具调用记录数据模型（Pydantic BaseModel），包含工具名称、参数、Agent ID、Task ID、时间戳、成功状态、结果、错误信息、执行时间、重试次数等字段
- `ToolExecutor` (执行器): 核心执行引擎，支持异步上下文管理器
  - `_tool_calling_history` (新增): 工具调用历史记录列表，最多保留最近 1000 条
  - `_record_tool_call()` (新增): 记录工具调用，在 `execute()` 和 `aexecute()` 方法中自动调用
  - `get_tool_calling_history()` (新增): 获取工具调用历史，支持按 Agent ID、Task ID、工具名称过滤，支持限制返回数量
- `ExecutionResult` (执行结果): 封装工具执行的返回值和元数据
- `SandboxEnvironment` (简单沙箱): 基于 exec 的轻量级隔离环境
- `SandboxConfig` (高级沙箱配置): 配置进程/容器级沙箱，支持 subprocess/microsandbox/docker 后端
**新增方法**：
- `execute_code_in_sandbox()`: 在高级沙箱中执行代码，返回 `SandboxExecutionResult`
- `execute_tool_in_sandbox()`: 在沙箱中执行工具，自动识别代码执行类工具
- `cleanup_sandbox()`: 手动清理沙箱资源
- `__aenter__`/`__aexit__`: 支持 async with 上下文管理器模式
- `_record_tool_call()` (新增): 记录工具调用到历史记录
- `get_tool_calling_history()` (新增): 获取工具调用历史，支持多维度过滤
**业务逻辑**：统一管控工具的执行过程，处理人工审批拦截，并收集执行统计信息（成功率、耗时、沙箱执行次数等），确保 LLM 环境状态的实时性。通过 `sandbox_config` 参数可启用高级沙箱，与 `agenticx.sandbox` 模块深度集成。**新增工具调用历史追踪功能，自动记录每次工具调用的详细信息，支持按 Agent、Task、工具名称等维度查询历史记录，为可观测性和调试提供支持**。**新增 SafetyLayer 集成（内化自 IronClaw）**：构造参数 `safety_layer: Optional["SafetyLayer"] = None`（TYPE_CHECKING 导入，无循环依赖）。**输出安全**：`execute()` 和 `aexecute()` 在获取工具结果后，若 `self.safety_layer is not None and isinstance(result, str)` 则调用 `safety_layer.sanitize_tool_output(result, tool_name=tool.name)` 对字符串输出执行安全管线。**输入安全**（hardening 新增）：工具执行前调用 `safety_layer.validate_tool_input(tool.name, kwargs)`，阻止时抛出 `ToolError`（shell 注入、路径穿越、SSRF 等危险参数被预执行拦截）。非字符串结果不受影响，默认 `None` 时行为完全不变。
**依赖关系**：核心调度组件，依赖 `BaseTool`、`ToolError`、`security.ApprovalRequiredError`，可选依赖 `agenticx.sandbox` 模块、`agenticx.safety.layer.SafetyLayer`（TYPE_CHECKING）。**新增依赖 Pydantic BaseModel 用于 ToolCallingRecord 数据模型**

#### agenticx/tools/function_tool.py
**文件功能**：将普通 Python 函数包装成 AgenticX 标准工具。
**技术实现**：通过 `inspect` 和 `docstring_parser` 自动提取函数签名、类型注解和文档字符串，动态生成 Pydantic 校验模型。
**关键组件**：`FunctionTool` (包装类), `@tool` (便捷装饰器), `_extract_function_info` (信息提取器)。
**业务逻辑**：极大降低了开发者创建新工具的成本，使得任何符合规范的 Python 函数都能无缝接入 AgenticX 体系。
**依赖关系**：继承 `BaseTool`。

#### agenticx/tools/mineru.py
**文件功能**：针对 MinerU 文档解析服务的深度集成工具。
**技术实现**：支持本地后端（pipeline）与远程 API（httpx/curl 下载）两种模式，包含复杂的任务轮询、ZIP 解压及工件索引逻辑。
**关键组件**：`ParseDocumentsTool`, `ResultFetcher`, `ZipExtractor`, `ArtifactIndex`。
**业务逻辑**：提供高精度的文档（PDF/PPT等）转结构化 Markdown 及其相关图片/模型数据的全生命周期管理能力。
**依赖关系**：继承 `RemoteTool` (legacy 版)，依赖 `config.MinerUConfig` 和 `httpx`。

#### agenticx/tools/openapi_toolset.py
**文件功能**：从 OpenAPI (Swagger) 规范自动生成 REST API 工具集。
**技术实现**：解析 OpenAPI 3.x/2.0 JSON/YAML 定义，动态为每个 endpoint 创建 Pydantic 参数模型和 `RestApiTool` 实例。
**关键组件**：`OpenAPIToolset` (生成器), `RestApiTool` (通用 API 调用类)。
**业务逻辑**：实现零代码接入第三方 Web 服务，允许智能体根据规范文档自动感知并调用远程 API。
**依赖关系**：继承 `BaseTool`，依赖 `httpx`, `pyyaml` (可选)。

#### agenticx/tools/remote.py
**文件功能**：Model Context Protocol (MCP) 客户端 V1 版（Legacy）。
**技术实现**：基于子进程交互实现的短连接 MCP 客户端，每次调用都会重新初始化环境，支持基础的 JSON-RPC 通信。
**关键组件**：`RemoteTool`, `MCPClient`, `MCPServerConfig`。
**业务逻辑**：AgenticX 早期接入 MCP 生态的方案，虽然可靠但延迟较高，主要用于不需要频繁交互的简单工具调用。
**依赖关系**：继承 `BaseTool`。

#### agenticx/tools/remote_v2.py
**文件功能**：基于官方 SDK 的 MCP 客户端 V2 版（推荐）。
**技术实现**：使用官方 `mcp` Python SDK 实现持久化会话，支持 `AsyncExitStack` 生命周期管理和核心的 **Sampling（反向推理）** 回调。
**关键组件**：`MCPClientV2` (高性能客户端), `RemoteToolV2` (持久化工具类), `_handle_sampling` (采样处理器)。
**业务逻辑**：将工具调用延迟从秒级降至毫秒级，并允许远程工具在执行过程中反向请求智能体的 LLM 能力，实现高度闭环的自动挖掘。
**依赖关系**：继承 `BaseTool`，依赖官方 `mcp` 库和 `BaseLLMProvider`。

#### agenticx/tools/security.py
**文件功能**：工具执行安全防护模块。
**技术实现**：提供基于装饰器模式的人工审批机制，通过拦截执行流并抛出特定异常来请求用户确认。
**关键组件**：`human_in_the_loop` (安全装饰器), `ApprovalRequiredError` (拦截异常)。
**业务逻辑**：为高风险操作（如删除文件、执行支付等）提供最后一道人工防线，是 AgenticX 安全治理体系的重要组成部分。
**依赖关系**：被 `executor.py` 捕获处理。

#### agenticx/tools/shell_bundle.py
**文件功能**：兼容 SWE-agent 规范的 Shell 工具包加载器。
**技术实现**：解析 `config.yaml` 声明，将 `bin/` 下的 shell 脚本封装为 `BaseTool`，支持执行后的状态自动同步。
**关键组件**：`ShellBundleLoader`, `ShellScriptTool`, `run_state` (状态提取逻辑)。
**业务逻辑**：实现了 Agent 与 Computer 接口（ACI）的工业级封装，使得社区成熟的 shell 脚本工具能以"捆绑包"形式快速复用。
**依赖关系**：继承 `BaseTool`，依赖 `pyyaml`。

#### agenticx/tools/skill_bundle.py
**文件功能**：兼容 Anthropic Agent Skills 规范的技能包加载器。
**技术实现**：扫描 `.agent/skills` 和 `.claude/skills` 目录，解析 `SKILL.md` 的 YAML Frontmatter 提取元数据，支持多路径优先级扫描和同名技能去重。通过 `process_llm_request` 实现渐进式 Prompt 注入。**新增 `execution_backend` 参数支持（P2-1），允许指定技能执行后端（本地或沙箱）**。
**关键组件**：`SkillMetadata` (技能元数据 dataclass), `SkillBundleLoader` (扫描与解析器), `SkillTool` (list/read 操作封装)。
**业务逻辑**：
- 实现 Anthropic 的"渐进式披露"设计：技能指令只在 Agent 决定使用时才加载到上下文，节省 Token 开销。
- 支持 `DiscoveryBus` 集成：扫描时自动发布 `DiscoveryType.CAPABILITY` 事件，允许 Planner 动态感知新技能。
- 搜索路径优先级：项目级 `.agent/skills` > 全局 `~/.agent/skills` > 项目级 `.claude/skills` > 全局 `~/.claude/skills`。
- 技能包结构：每个技能为独立目录，包含 `SKILL.md` 和可选的 `scripts/`、`assets/`、`references/` 资源。
- **新增桥接沙箱执行**：通过 `SkillExecutionBackend` 支持本地和沙箱两种执行模式。
**依赖关系**：继承 `BaseTool`，集成 `DiscoveryBus`，依赖 `ToolContext` 和 `LlmRequest`。**新增依赖 `SkillExecutionBackend`（P2-1）**。
**设计来源**：内化自 openskills 项目 (Apache-2.0)，适配 AgenticX 体系。

#### agenticx/tools/skill_execution_backend.py (新增，P2-1)
**文件功能**：技能执行后端抽象与实现，支持本地和沙箱隔离执行。
**技术实现**：基于抽象基类的执行后端策略模式，支持不同的技能执行环境。
**关键组件**：
- `SkillExecutionBackend` 抽象基类：定义技能执行的统一接口
  - `execute(skill_code: str, **kwargs) -> Dict` 方法
- `LocalSkillBackend` 类：本地进程执行实现，支持直接 exec 或 subprocess
- `SandboxSkillBackend` 类：沙箱隔离执行实现，通过 `Sandbox.create()` 创建隔离环境
**业务逻辑**：
- 为技能执行提供灵活的后端选择，支持从完全信任的本地执行到完全隔离的沙箱执行
- LocalSkillBackend 用于开发/测试阶段，执行效率高
- SandboxSkillBackend 用于生产环节，确保技能代码的安全隔离
- 与 AgenticX 现有的 `Sandbox` 模块深度集成
**依赖关系**：依赖 `agenticx.sandbox.Sandbox`，被 `SkillBundleLoader` 使用。
**设计来源**：参考 VeADK 的 `local`/`skills_sandbox`/`aio_sandbox` 三种执行模式设计（P2-1）。

#### agenticx/tools/tool_context.py
**文件功能**：工具执行上下文与 LLM 请求管理。
**技术实现**：基于数据类（dataclass）定义的 `ToolContext` 提供状态、记忆、工件的统一访问，`LlmRequest` 支持动态修改消息列表和工具声明。
**关键组件**：`ToolContext`, `LlmRequest`。
**业务逻辑**：解耦了工具内部逻辑与 Agent 环境，使得工具不再是单纯的函数，而是能够感知任务进度并主动影响决策的“智能插件”。
**依赖关系**：被 `base.py` 引用，内化自 ADK。

#### agenticx/tools/windowed.py
**文件功能**：窗口化文件阅读与导航工具。
**技术实现**：模拟人类编辑器的窗口视图，通过 `window_size` 控制单次返回的文本行数，并维护内部文件指针。
**关键组件**：`WindowedFileTool`, `WindowAction` (open/goto/scroll 枚举)。
**业务逻辑**：专门解决大型工程（Monorepo）场景下的 Token 溢出问题，强制 LLM 采用局部观察法，极大地提升了处理长文件的准确性。
**依赖关系**：继承 `BaseTool`。

#### agenticx/tools/document_routers.py (186 lines, ~6.0KB)
**文件功能**：文档路由器，根据文件扩展名或 URL 类型路由到不同的文档处理器。
**技术实现**：DocumentRouter 类维护处理器注册表，支持基于文件扩展名的路由匹配和降级处理机制。
**关键组件**：
- `DocumentRouter` 类：核心路由器
  - `register_processor(extensions: Tuple[str, ...], processor: Callable) -> None`：注册文档处理器
  - `set_fallback_processor(processor: Callable) -> None`：设置降级处理器
  - `route(path: str) -> Tuple[bool, str]`：路由文档到对应处理器
  - `_is_webpage(url: str) -> bool`：判断是否是网页 URL
- `create_default_router() -> DocumentRouter`：创建包含基本处理器（JSON, Python, XML, ZIP）的默认路由器
- 默认处理器函数：`process_json_file()`, `process_python_file()`, `process_xml_file()`, `process_zip_file()`
**业务逻辑**：提供统一的文档路由机制，根据文件扩展名自动选择对应的处理器，支持处理器失败时的降级处理，确保文档处理的健壮性
**依赖关系**：被 unified_document.py 使用，可选依赖 xmltodict（XML 解析）
**设计来源**：内化自 OWL 的 DocumentProcessingToolkit 路由机制

#### agenticx/tools/unified_document.py (196 lines, ~6.6KB)
**文件功能**：统一文档处理工具，提供单一接口处理多种文档格式（图片、Excel、PDF、网页等）。
**技术实现**：UnifiedDocumentTool 类继承自 BaseTool，使用 DocumentRouter 进行文档路由，支持多种格式的自动识别和处理。
**关键组件**：
- `UnifiedDocumentTool` 类：统一文档处理工具
  - `execute(document_path: str) -> Tuple[bool, str]`：执行文档处理
  - `_run(**kwargs) -> Dict`：BaseTool 接口实现
  - `_register_processors()`：注册格式特定的处理器
  - `_process_image()`, `_process_excel()`, `_process_document()`, `_process_generic()`：格式特定处理器
- `UnifiedDocumentToolArgs`：Pydantic 参数模型
**业务逻辑**：提供统一的文档处理接口，自动根据文件类型路由到不同处理器，支持图片、Excel、PDF/DOCX/PPTX、ZIP、JSON、Python、XML、网页等多种格式。当前图片、Excel、PDF 等格式使用占位实现，待后续集成实际工具（如图像分析工具、Excel 工具、MinerU 等）
**依赖关系**：继承 `BaseTool`，依赖 `document_routers.py` 的 `DocumentRouter`
**设计来源**：内化自 OWL 的 DocumentProcessingToolkit，适配 AgenticX 工具系统

#### agenticx/tools/sandbox_tools.py
**文件功能**：沙箱能力工具封装（OpenSandbox 风格），为 Agent 提供沙箱内的文件操作、命令执行与状态化代码执行。
**技术实现**：三个工具类均继承 `BaseTool`，以 Pydantic 参数模型（`FileOperationArgs`/`CommandExecutionArgs`/`CodeExecutionArgs`）校验入参；异步 `_arun` 为主路径，同步 `_run` 通过 `agenticx.utils.async_bridge.run_sync()` 桥接（2026-09 起替代原先 `asyncio.get_event_loop().run_until_complete()` 的写法，避免在已有事件循环场景下的兼容性问题）。
**关键组件**：
- `SandboxFileTool`：沙箱文件操作（read/write/list/delete/mkdir）
- `SandboxCommandTool`：沙箱 Shell 命令执行（支持 timeout/background/cwd）
- `SandboxCodeInterpreterTool`：状态化代码执行，内部经 `StatefulCodeInterpreter`（Jupyter kernel 或 execd 后端）实现变量跨执行持久化，启动失败时降级到普通沙箱执行
- `create_sandbox_tools()` / `register_sandbox_tools()`：批量创建与注册入口（经 `__init__.py` 导出）
**业务逻辑**：将沙箱环境（`SandboxBase`/`CodeInterpreterSandbox`）包装为标准工具，使 Agent 能在隔离环境内安全地进行文件与代码操作。
**依赖关系**：继承 `BaseTool`，依赖 `agenticx.utils.async_bridge.run_sync`、`..sandbox.jupyter_kernel.StatefulCodeInterpreter`（延迟导入）。

#### agenticx/tools/image_generation.py (新增)
**文件功能**：文生图工具：根据文本提示在本地生成 PNG 并返回结构化 JSON 结果（`type=="image"`）。
**技术实现**：定义厂商无关的 `ImageGenProvider` Protocol（`generate(prompt, size, dest_path)`，运行时可注入）；`generate_image()` 读取 `ConfigManager.get_value("image_generation")`（provider/api_key/api_base/model）判断配置，P0 阶段未锁定云厂商 SDK——未配置且未注入 provider 时失败关闭，返回 `ERROR: image_generation is not configured`；尺寸限定白名单 `ALLOWED_SIZES = ("1024x1024", "1024x1792", "1792x1024")`；产物写入会话 workspace 的 `generated/` 子目录（无 workspace 时回落 `~/.agenticx/tmp-image-gen`），返回含 `path/mime/alt/width/height` 的 JSON 字符串。
**关键组件**：`generate_image()`（核心入口）、`ImageGenProvider`（Protocol）、`FakeImageGenProvider`（测试用，写 1x1 PNG）、`load_image_generation_config()` / `is_image_generation_configured()`。
**业务逻辑**：为对话侧提供「画一张图」能力；以可注入 provider 契约解耦具体云厂商，测试与生产路径分离。
**依赖关系**：依赖 `agenticx.cli.config_manager.ConfigManager`；经 `agenticx/cli/agent_tools.py` 注册为 STUDIO 工具 `generate_image`（不经 `tools/__init__.py` 导出）。

#### agenticx/tools/show_images.py (新增)
**文件功能**：展示型远程图片工具：将 http(s) 图片 URL 列表清洗后包装为 `image_gallery` JSON，供聊天气泡内联展示（纯展示，不要求模型具备视觉能力）。
**技术实现**：`show_images(items)` 返回 `{"type": "image_gallery", "images": [...]}` JSON，无有效 URL 时返回 ERROR 文本；`preview_show_images_items()` 提供同样的清洗逻辑但不包 JSON；URL 卫生管线包括：`upgrade_remote_image_url()` 将列表页缩略图（如 `.thumb.400_0.jpeg`）还原为原图文件名，`is_junk_remote_image_url()` 过滤站点装饰/广告/头像/二维码及 ≤160px 的小缩略图；上限约束：最多展示 6 张、扫描前 24 条、URL 最长 2048 字符、alt 最长 80 字符。
**关键组件**：`show_images()`、`preview_show_images_items()`、`normalize_content_image_url()`、`upgrade_remote_image_url()`、`is_junk_remote_image_url()`。
**业务逻辑**：配合 `web_fetch` 的 `[discovered_images]` 输出（该处亦复用 `is_junk_remote_image_url` 过滤），让 Agent 能把搜到的图片直接以图集形式展示给用户。
**依赖关系**：纯 stdlib（json/re）；经 `agenticx/cli/agent_tools.py` 注册为 STUDIO 工具 `show_images`（不经 `tools/__init__.py` 导出）。

#### agenticx/tools/README.md
**文件功能**：工具模块的使用说明与设计指南。
**技术实现**：Markdown 格式文档，包含模块架构图、核心类说明及扩展示例。
**关键组件**：不适用。
**业务逻辑**：作为模块的知识库，指导开发者如何添加新工具及配置远程服务。
**依赖关系**：不适用。

---

## 总结

AgenticX Tools 模块在保留原有强类型校验和 MCP 灵活性的基础上，通过深度内化 ADK、SWE-agent 的 ACI 思想以及 Anthropic Agent Skills 规范，构建了一个不仅"好用"而且"智能、安全"的工具生态。模块通过 `BaseTool` 与 `ToolExecutor` 提供了极其坚固的基石，而 `MCP V2`、`OpenAPIToolset`、`WindowedFileTool` 以及 `SkillBundleLoader` 等高级特性则赋予了智能体触达真实复杂工程场景的强力臂膀。新增的技能包系统（Skill Bundle）实现了"渐进式披露"设计，允许 Agent 按需加载高密度指令，同时与 DiscoveryBus 深度集成，支持 Planner 动态发现新技能。

新增的统一文档处理工具（UnifiedDocumentTool）和文档路由器（DocumentRouter）提供了多格式文档的统一处理接口，支持图片、Excel、PDF、网页等多种格式的自动路由和处理，内化自 OWL 的 DocumentProcessingToolkit 设计思想，简化了 Agent 对文档处理的复杂度。

新增的工具调用历史追踪功能（ToolCallingRecord）提供了完整的工具调用记录能力，支持按 Agent、Task、工具名称等维度查询历史记录，为可观测性和调试提供支持，内化自 CAMEL-AI 的 ToolCallingRecord 机制。

新增的图片能力工具对：`image_generation.py` 以可注入的 `ImageGenProvider` 契约提供文生图（本地落盘 PNG + 结构化 JSON，未配置时失败关闭），`show_images.py` 提供纯展示型远程图片图集（缩略图还原与垃圾图过滤），两者均经 `agenticx/cli/agent_tools.py` 注册为 STUDIO 工具；`sandbox_tools.py` 的同步入口统一改走 `agenticx.utils.async_bridge.run_sync()` 桥接。

**VeADK 内化**：
- **SkillExecutionBackend 抽象与实现（P2-1）**：新增 `skill_execution_backend.py` 定义技能执行后端的抽象接口，支持 `LocalSkillBackend`（本地执行）和 `SandboxSkillBackend`（沙箱隔离执行），通过与 AgenticX 现有 Sandbox 模块的集成，实现灵活的技能执行策略选择
- **SkillBundleLoader 后端支持（P2-1）**：扩展 `SkillBundleLoader.__init__` 接受 `execution_backend` 参数，允许为技能包指定执行后端，实现本地和沙箱执行的无缝切换
