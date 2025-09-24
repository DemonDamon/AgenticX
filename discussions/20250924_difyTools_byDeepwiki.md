# 我问：
在dify里面，工具和自定义api的区别是啥？

# deepwiki答：
在Dify中，工具（Tools）和自定义API（Custom API）是两个不同的概念，主要区别如下：

## 工具（Tools）

工具是Dify中的一个标准化功能模块，用于扩展AI应用的能力 <cite/>。从代码中可以看到，工具系统支持多种类型：

- **内置工具**（Built-in Tools）：系统预置的工具 [1](#0-0) 
- **自定义工具**（Custom Tools）：用户创建的工具 [2](#0-1) 
- **工作流工具**（Workflow Tools）：从工作流发布的工具 [3](#0-2) 

工具具有标准化的结构，包括名称、描述、认证方法、输入参数等 [4](#0-3) 。工具系统提供了完整的管理界面，支持创建、编辑、测试和授权等操作。

## 自定义API（API扩展）

自定义API在Dify中被称为"API扩展"，是一个集中式的API管理功能 [5](#0-4) 。它的主要特点是：

- **集中管理**：统一添加和管理API配置
- **复用性**：配置后可在各类应用中直接使用
- **简化配置**：包含API端点、API密钥等基本配置 [6](#0-5) 

## 主要区别

1. **功能范围**：工具是完整的功能模块，包含详细的参数定义、认证方式、测试功能等；而API扩展主要是API连接的配置管理

2. **使用方式**：工具可以直接在应用中调用使用；API扩展更多是作为底层的API连接配置，为其他功能提供支持

3. **管理复杂度**：工具系统提供了完整的生命周期管理，包括OpenAPI schema定义 [7](#0-6) ；API扩展相对简单，主要关注连接配置

从技术实现上看，工具系统有专门的API端点来获取不同类型的工具 [8](#0-7) ，而API扩展更多是配置管理层面的功能。

## Notes

工具和API扩展在Dify中服务于不同的使用场景：工具更适合需要复杂参数配置和标准化调用的场景，而API扩展更适合简单的API连接管理需求。两者可以配合使用，API扩展提供底层连接，工具提供上层的功能封装。

Wiki pages you might want to explore:
- [Web Frontend Architecture (langgenius/dify)](/wiki/langgenius/dify#10)

### Citations

**File:** web/i18n/zh-Hans/tools.ts (L7-7)
```typescript
    builtIn: '工具',
```

**File:** web/i18n/zh-Hans/tools.ts (L8-8)
```typescript
    custom: '自定义',
```

**File:** web/i18n/zh-Hans/tools.ts (L9-9)
```typescript
    workflow: '工作流',
```

**File:** web/i18n/zh-Hans/tools.ts (L51-119)
```typescript
    name: '名称',
    toolNamePlaceHolder: '输入工具名称',
    nameForToolCall: '工具调用名称',
    nameForToolCallPlaceHolder: '用于机器识别，如 getCurrentWeather, list_pets',
    nameForToolCallTip: '仅支持数字、字母、下划线。',
    description: '工具描述',
    descriptionPlaceholder: '工具用途的简要描述，例如获取特定位置的温度。',
    schema: 'Schema',
    schemaPlaceHolder: '在此处输入您的 OpenAPI schema',
    viewSchemaSpec: '查看 OpenAPI-Swagger 规范',
    importFromUrl: '从 URL 中导入',
    importFromUrlPlaceHolder: 'https://...',
    urlError: '请输入有效的 URL',
    examples: '例子',
    exampleOptions: {
      json: '天气 (JSON)',
      yaml: '宠物商店 (YAML)',
      blankTemplate: '空白模版',
    },
    availableTools: {
      title: '可用工具',
      name: '名称',
      description: '描述',
      method: '方法',
      path: '路径',
      action: '操作',
      test: '测试',
    },
    authMethod: {
      title: '鉴权方法',
      type: '鉴权类型',
      keyTooltip: 'HTTP 头部名称，如果你不知道是什么，可以将其保留为 Authorization 或设置为自定义值',
      queryParam: '查询参数',
      queryParamTooltip: '用于传递 API 密钥查询参数的名称，如 "https://example.com/test?key=API_KEY" 中的 "key"参数',
      types: {
        none: '无',
        api_key_header: '请求头',
        api_key_query: '查询参数',
        apiKeyPlaceholder: 'HTTP 头部名称，用于传递 API Key',
        apiValuePlaceholder: '输入 API Key',
        queryParamPlaceholder: '查询参数名称，用于传递 API Key',
      },
      key: '键',
      value: '值',
    },
    authHeaderPrefix: {
      title: '鉴权头部前缀',
      types: {
        basic: 'Basic',
        bearer: 'Bearer',
        custom: 'Custom',
      },
    },
    privacyPolicy: '隐私协议',
    privacyPolicyPlaceholder: '请输入隐私协议',
    toolInput: {
      title: '工具入参',
      name: '名称',
      required: '必须',
      method: '方式',
      methodSetting: '用户输入',
      methodSettingTip: '用户在工具配置中填写',
      methodParameter: 'LLM 填入',
      methodParameterTip: 'LLM 在推理过程中填写',
      label: '标签',
      labelPlaceholder: '选择标签 (可选)',
      description: '描述',
      descriptionPlaceholder: '参数意义的描述',
    },
```

**File:** web/i18n/zh-Hans/common.ts (L566-568)
```typescript
  apiBasedExtension: {
    title: 'API 扩展提供了一个集中式的 API 管理，在此统一添加 API 配置后，方便在 Dify 上的各类应用中直接使用。',
    link: '了解如何开发您自己的 API 扩展。',
```

**File:** web/i18n/zh-Hans/common.ts (L582-590)
```typescript
      apiEndpoint: {
        title: 'API Endpoint',
        placeholder: '请输入 API endpoint',
      },
      apiKey: {
        title: 'API-key',
        placeholder: '请输入 API-key',
        lengthError: 'API-key 不能少于 5 位',
      },
```

**File:** web/service/use-tools.ts (L35-47)
```typescript
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/builtin'),
  })
}

export const useInvalidateAllBuiltInTools = () => {
  return useInvalid(useAllBuiltInToolsKey)
}

const useAllCustomToolsKey = [NAME_SPACE, 'customTools']
export const useAllCustomTools = () => {
  return useQuery<ToolWithProvider[]>({
    queryKey: useAllCustomToolsKey,
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/tools/api'),
```

# dify的tools源码解析

我理解您想要对Dify的工具系统进行详细的源码分析。基于您提供的指令和我看到的代码上下文，我需要按照您的分析框架来进行深度分析。

不过，我需要先澄清一个重要问题：根据您的指令要求，我需要**读取并分析所有核心文件夹下的每一个源代码文件**，但目前我只能看到有限的代码片段，无法访问完整的目录结构和所有源文件 <cite/>。

## Phase 1: 全局扫描与规划

基于当前可见的代码片段，我可以识别出以下与工具系统相关的核心模块：

### 1.1 目录结构概览（基于可见代码）

从现有代码片段可以看出，Dify的工具系统主要分布在以下路径：

- `api/core/tools/` - 工具核心实现 [1](#2-0) 
- `api/core/datasource/` - 数据源实体定义 [2](#2-1) 
- `api/core/mcp/` - MCP服务器支持 [3](#2-2) 
- `api/core/workflow/` - 工作流引擎 [4](#2-3) 

### 1.2 分析计划

由于我无法访问完整的源码目录，我建议您提供以下必填信息以便进行完整分析：

1. **核心源码路径**：请提供Dify工具系统的完整目录结构，特别是：
   - `api/core/tools/` 目录下的所有文件
   - `api/models/tools.py` 等模型定义文件
   - 工具相关的控制器和服务文件

2. **README文件**：项目的整体说明文档（已部分可见）

## 当前可分析的模块

基于现有代码片段，我可以提供以下初步分析：

### 工作流工具模块 (WorkflowTool)

从 `api/core/tools/workflow_as_tool/tool.py` 可以看出，这是一个将工作流封装为工具的实现 [1](#2-0) ：

- 支持应用查找和参数转换
- 处理文件类型参数的多种传输方式
- 集成了完整的错误处理机制

### 数据源实体模块

`api/core/datasource/entities/datasource_entities.py` 定义了数据源的核心实体结构 [2](#2-1) ：

- `DatasourceIdentity` - 数据源身份信息
- `DatasourceEntity` - 数据源实体定义
- `DatasourceProviderIdentity` - 数据源提供商身份

### MCP服务器支持

`api/core/mcp/server/streamable_http.py` 实现了Model Context Protocol支持 [3](#2-2) ，提供了工具列表和初始化功能。

## 建议

为了完成您要求的详细分析，我需要您提供：

1. 完整的 `api/core/tools/` 目录结构和所有源文件
2. 工具相关的模型定义文件
3. 工具管理的控制器和服务层代码
4. 工具系统的配置和初始化代码

一旦获得这些信息，我将按照您的指令严格执行**代码穷尽原则**，为每个模块生成详细的PlantUML类图，并提供完整的架构分析报告。

您是否可以提供这些核心源码路径的完整内容？

Wiki pages you might want to explore:
- [Introduction to Dify (langgenius/dify)](/wiki/langgenius/dify#1)
- [System Architecture (langgenius/dify)](/wiki/langgenius/dify#2)

### Citations

**File:** api/core/tools/workflow_as_tool/tool.py (L146-192)
```python
    def _get_app(self, app_id: str) -> App:
        """
        get the app by app id
        """
        stmt = select(App).where(App.id == app_id)
        app = db.session.scalar(stmt)
        if not app:
            raise ValueError("app not found")

        return app

    def _transform_args(self, tool_parameters: dict) -> tuple[dict, list[dict]]:
        """
        transform the tool parameters

        :param tool_parameters: the tool parameters
        :return: tool_parameters, files
        """
        parameter_rules = self.get_merged_runtime_parameters()
        parameters_result = {}
        files = []
        for parameter in parameter_rules:
            if parameter.type == ToolParameter.ToolParameterType.SYSTEM_FILES:
                file = tool_parameters.get(parameter.name)
                if file:
                    try:
                        file_var_list = [File.model_validate(f) for f in file]
                        for file in file_var_list:
                            file_dict: dict[str, str | None] = {
                                "transfer_method": file.transfer_method.value,
                                "type": file.type.value,
                            }
                            if file.transfer_method == FileTransferMethod.TOOL_FILE:
                                file_dict["tool_file_id"] = file.related_id
                            elif file.transfer_method == FileTransferMethod.LOCAL_FILE:
                                file_dict["upload_file_id"] = file.related_id
                            elif file.transfer_method == FileTransferMethod.REMOTE_URL:
                                file_dict["url"] = file.generate_url()

                            files.append(file_dict)
                    except Exception:
                        logger.exception("Failed to transform file %s", file)
            else:
                parameters_result[parameter.name] = tool_parameters.get(parameter.name)

        return parameters_result, files

```

**File:** api/core/datasource/entities/datasource_entities.py (L118-163)
```python
class DatasourceIdentity(BaseModel):
    author: str = Field(..., description="The author of the datasource")
    name: str = Field(..., description="The name of the datasource")
    label: I18nObject = Field(..., description="The label of the datasource")
    provider: str = Field(..., description="The provider of the datasource")
    icon: str | None = None


class DatasourceEntity(BaseModel):
    identity: DatasourceIdentity
    parameters: list[DatasourceParameter] = Field(default_factory=list)
    description: I18nObject = Field(..., description="The label of the datasource")
    output_schema: dict | None = None

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[DatasourceParameter]:
        return v or []


class DatasourceProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    tags: list[ToolLabelEnum] | None = Field(
        default=[],
        description="The tags of the tool",
    )

    def generate_datasource_icon_url(self, tenant_id: str) -> str:
        HARD_CODED_DATASOURCE_ICONS = ["https://assets.dify.ai/images/File%20Upload.svg"]
        if self.icon in HARD_CODED_DATASOURCE_ICONS:
            return self.icon
        return str(
            URL(dify_config.CONSOLE_API_URL or "/")
            / "console"
            / "api"
            / "workspaces"
            / "current"
            / "plugin"
            / "icon"
            % {"tenant_id": tenant_id, "filename": self.icon}
        )

```

**File:** api/core/mcp/server/streamable_http.py (L87-125)
```python
def handle_ping() -> mcp_types.EmptyResult:
    """Handle ping request"""
    return mcp_types.EmptyResult()


def handle_initialize(description: str) -> mcp_types.InitializeResult:
    """Handle initialize request"""
    capabilities = mcp_types.ServerCapabilities(
        tools=mcp_types.ToolsCapability(listChanged=False),
    )

    return mcp_types.InitializeResult(
        protocolVersion=mcp_types.SERVER_LATEST_PROTOCOL_VERSION,
        capabilities=capabilities,
        serverInfo=mcp_types.Implementation(name="Dify", version=dify_config.project.version),
        instructions=description,
    )


def handle_list_tools(
    app_name: str,
    app_mode: str,
    user_input_form: list[VariableEntity],
    description: str,
    parameters_dict: dict[str, str],
) -> mcp_types.ListToolsResult:
    """Handle list tools request"""
    parameter_schema = build_parameter_schema(app_mode, user_input_form, parameters_dict)

    return mcp_types.ListToolsResult(
        tools=[
            mcp_types.Tool(
                name=app_name,
                description=description,
                inputSchema=parameter_schema,
            )
        ],
    )

```

**File:** api/core/workflow/README.md (L1-60)
```markdown
# Workflow

## Project Overview

This is the workflow graph engine module of Dify, implementing a queue-based distributed workflow execution system. The engine handles agentic AI workflows with support for parallel execution, node iteration, conditional logic, and external command control.

## Architecture

### Core Components

The graph engine follows a layered architecture with strict dependency rules:

1. **Graph Engine** (`graph_engine/`) - Orchestrates workflow execution

   - **Manager** - External control interface for stop/pause/resume commands
   - **Worker** - Node execution runtime
   - **Command Processing** - Handles control commands (abort, pause, resume)
   - **Event Management** - Event propagation and layer notifications
   - **Graph Traversal** - Edge processing and skip propagation
   - **Response Coordinator** - Path tracking and session management
   - **Layers** - Pluggable middleware (debug logging, execution limits)
   - **Command Channels** - Communication channels (InMemory, Redis)

1. **Graph** (`graph/`) - Graph structure and runtime state

   - **Graph Template** - Workflow definition
   - **Edge** - Node connections with conditions
   - **Runtime State Protocol** - State management interface

1. **Nodes** (`nodes/`) - Node implementations

   - **Base** - Abstract node classes and variable parsing
   - **Specific Nodes** - LLM, Agent, Code, HTTP Request, Iteration, Loop, etc.

1. **Events** (`node_events/`) - Event system

   - **Base** - Event protocols
   - **Node Events** - Node lifecycle events

1. **Entities** (`entities/`) - Domain models

   - **Variable Pool** - Variable storage
   - **Graph Init Params** - Initialization configuration

## Key Design Patterns

### Command Channel Pattern

External workflow control via Redis or in-memory channels:

```python
# Send stop command to running workflow
channel = RedisChannel(redis_client, f"workflow:{task_id}:commands")
channel.send_command(AbortCommand(reason="User requested"))
```

### Layer System

Extensible middleware for cross-cutting concerns:

```
