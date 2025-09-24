# AgenticX 工具系统 v2.0

## 概述

AgenticX 工具系统 v2.0 是一个全面重构的工具管理和执行框架，提供了统一的工具接口、安全管理、协议适配和市场功能。

## 主要特性

### 🛠️ 核心组件
- **统一工具接口**: `BaseTool` 抽象基类，支持同步和异步执行
- **工具元数据**: 完整的工具描述信息，包括参数定义、分类、标签等
- **参数验证**: 类型安全和业务逻辑验证
- **执行上下文**: 支持多租户、会话管理和环境变量

### 🗃️ 注册表和工厂
- **工具注册表**: 集中管理工具注册、发现和生命周期
- **工具工厂**: 动态创建工具实例，支持从函数创建工具
- **分类管理**: 按类别、标签、作者等维度组织工具
- **依赖注入**: 支持工具间的依赖关系管理

### ⚡ 执行引擎
- **同步/异步执行**: 完整的异步支持，支持并发执行
- **沙箱环境**: 安全的代码执行环境，支持资源限制
- **重试机制**: 可配置的重试策略和退避算法
- **超时控制**: 精细的超时管理和取消机制
- **资源监控**: 实时监控CPU、内存、网络等资源使用

### 🔒 安全管理
- **权限系统**: 基于角色的细粒度权限控制
- **安全策略**: 可配置的安全规则和约束
- **审计日志**: 完整的操作记录和审计跟踪
- **凭据管理**: 安全的凭据存储和访问控制
- **限流保护**: 基于令牌桶算法的请求限流

### 🔌 协议适配
- **OpenAI适配器**: 支持OpenAI函数调用格式
- **MCP适配器**: 支持模型上下文协议
- **多协议支持**: 同时处理多种协议格式
- **消息转换**: 统一的消息格式转换和处理

### 🏪 工具市场
- **工具发布**: 支持工具打包和版本管理
- **搜索发现**: 智能搜索和推荐功能
- **安装管理**: 一键安装、更新和卸载
- **评分评论**: 用户评分和反馈系统
- **远程市场**: 支持连接到远程工具市场

## 快速开始

### 1. 创建工具系统

```python
from agenticx.core import create_tool_system, ToolSystemConfig

# 创建配置
config = ToolSystemConfig(
    enable_security=True,
    enable_marketplace=True,
    enable_protocol_adapters=True,
    enable_sandbox=True,
    max_concurrent_executions=10,
    execution_timeout=30.0,
    security_level="medium"
)

# 创建工具系统
tool_system = create_tool_system(config)
```

### 2. 定义自定义工具

```python
from agenticx.core import BaseTool, ToolMetadata, ToolParameter, ToolResult
from agenticx.core import ParameterType, ToolCategory
from typing import Dict, Any, Optional
import asyncio

class MyTool(BaseTool):
    def __init__(self):
        metadata = ToolMetadata(
            name="my_tool",
            description="我的自定义工具",
            category=ToolCategory.UTILITIES,
            parameters=[
                ToolParameter(
                    name="input",
                    type=ParameterType.STRING,
                    description="输入参数",
                    required=True
                )
            ],
            tags=["custom", "utility"],
            version="1.0.0",
            author="YourName",
            timeout=10.0
        )
        super().__init__(metadata)
    
    async def execute_async(self, parameters: Dict[str, Any], 
                           context: Optional[ToolContext] = None) -> ToolResult:
        input_data = parameters.get("input", "")
        
        # 工具逻辑
        result = f"处理结果: {input_data.upper()}"
        
        return ToolResult(
            success=True,
            data={"result": result},
            metadata={"processed": True}
        )
```

### 3. 注册和使用工具

```python
# 注册工具
my_tool = MyTool()
tool_system.register_tool(my_tool)

# 执行工具
result = await tool_system.execute_tool_async("my_tool", {
    "input": "hello world"
})

if result.success:
    print(f"结果: {result.data['result']}")
else:
    print(f"错误: {result.error}")
```

### 4. 搜索和发现工具

```python
# 搜索工具
results = tool_system.search_tools("calculator", category="utilities")

for tool_info in results:
    print(f"工具: {tool_info['name']}")
    print(f"描述: {tool_info['description']}")
    print(f"来源: {tool_info['source']}")
    print("---")
```

### 5. 从市场安装工具

```python
# 搜索市场工具
marketplace_results = tool_system.search_tools("weather")

# 安装工具
for tool in marketplace_results:
    if tool['source'] == 'marketplace' and not tool['installed']:
        success = tool_system.install_tool_from_marketplace(tool['name'])
        if success:
            print(f"成功安装: {tool['name']}")
```

## 高级用法

### 安全管理

```python
from agenticx.core import SecurityManager, SecurityLevel, Permission

# 检查权限
if tool_system.check_security("my_tool", "execute"):
    result = await tool_system.execute_tool_async("my_tool", params)

# 配置安全策略
security_manager = tool_system.security_manager
security_manager.add_policy("restrict_sensitive_tools", {
    "tools": ["file_access", "database"],
    "allowed_roles": ["admin", "developer"],
    "conditions": {"time_range": "09:00-18:00"}
})
```

### 协议适配

```python
from agenticx.core import ProtocolType, create_openai_adapter

# 创建OpenAI适配器
openai_adapter = create_openai_adapter()

# 转换工具为OpenAI函数格式
openai_functions = openai_adapter.convert_tools_to_functions([my_tool])

# 处理OpenAI函数调用
openai_response = {
    "function_call": {
        "name": "my_tool",
        "arguments": '{"input": "test"}'
    }
}

tool_result = openai_adapter.handle_function_call(openai_response)
```

### 批量执行

```python
# 批量执行工具调用
tasks = [
    ("calculator", {"operation": "add", "a": 1, "b": 2}),
    ("calculator", {"operation": "multiply", "a": 3, "b": 4}),
    ("weather", {"city": "北京"})
]

results = await asyncio.gather(*[
    tool_system.execute_tool_async(name, params)
    for name, params in tasks
])

for (tool_name, params), result in zip(tasks, results):
    print(f"{tool_name}: {'成功' if result.success else '失败'}")
```

### 监控和统计

```python
# 获取系统状态
status = tool_system.get_system_status()
print(f"总工具数: {status['registry']['total_tools']}")
print(f"总执行次数: {status['executor']['total_executions']}")

# 获取工具统计信息
tool_info = tool_system.get_tool_info("calculator")
if 'execution_stats' in tool_info:
    stats = tool_info['execution_stats']
    print(f"执行次数: {stats['total_executions']}")
    print(f"成功率: {stats['success_rate']:.2%}")
    print(f"平均执行时间: {stats['avg_execution_time']:.2f}s")
```

## 架构设计

### 组件关系

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolSystem                              │
│  ┌───────────────────────────────────────────────────────┐    │
│  │              统一接口层                              │    │
│  └───────────────────────────────────────────────────────┘    │
│                           │                                 │
│  ┌─────────────┬──────────┼──────────┬──────────────┐       │
│  │   BaseTool  │          │          │   ToolResult │       │
│  │  ToolMetadata│         │          │  ToolContext │       │
│  └─────────────┘          │          └──────────────┘       │
│                           │                                 │
│  ┌─────────────┐ ┌────────┴────────┐ ┌─────────────────┐    │
│  │ToolRegistry │ │  ToolFactory    │ │ ToolExecutor    │    │
│  │  注册管理    │ │   工厂创建       │ │  执行引擎        │    │
│  └─────────────┘ └─────────────────┘ └─────────────────┘    │
│                           │                                 │
│  ┌─────────────┐ ┌────────┴────────┐ ┌─────────────────┐    │
│  │   Security  │ │   Protocol     │ │  Marketplace    │    │
│  │   Manager    │ │   Adapters     │ │   工具市场       │    │
│  └─────────────┘ └─────────────────┘ └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                           │
                  ┌────────┴────────┐
                  │   沙箱环境       │
                  │ SandboxEnvironment│
                  └─────────────────┘
```

### 数据流

1. **工具注册**: ToolFactory → ToolRegistry
2. **工具执行**: ToolSystem → ToolExecutor → BaseTool
3. **安全检查**: ToolExecutor → SecurityManager
4. **协议转换**: ProtocolAdapter → ToolSystem
5. **市场交互**: ToolMarketplace → ToolRegistry

### 核心文件关系

为了更好地理解工具系统 v2.0 的代码结构，以下说明了三个核心文件之间的关系：

-   `agenticx/core/tool.py`:
    -   **角色**: 定义了**旧版（v1）**的工具基类 (`LegacyBaseTool`)。
    -   **目的**: 这是为了保持向后兼容性而保留的旧版工具定义。新的开发工作**不应该**直接使用此文件中的类。它的存在主要是为了平滑过渡，允许旧的工具实现逐步迁移到 v2 框架。

-   `agenticx/core/tool_v2.py`:
    -   **角色**: 定义了**新版（v2）**的核心工具架构。
    -   **目的**: 这是工具系统 v2 的基石。它引入了 `BaseTool` (v2)、`ToolMetadata`、`ToolParameter`、`ToolResult` 和 `ToolContext` 等一系列丰富的类。这些类提供了强大的元数据管理、类型安全的参数、结构化的执行结果和灵活的执行上下文，是所有新工具开发的基础。

-   `agenticx/core/tool_system.py`:
    -   **角色**: **统一的工具系统管理器**和总入口。
    -   **目的**: 该文件中的 `ToolSystem` 类是整个工具框架的“大脑”。它整合了 v2 的所有核心组件，包括注册表 (`ToolRegistry`)、执行器 (`ToolExecutor`)、安全管理器 (`SecurityManager`) 等。所有与工具相关的操作，如注册、执行、搜索、安全检查等，都应该通过 `ToolSystem` 实例来完成。它依赖 `tool_v2.py` 中定义的接口和数据模型来管理和协调整个工具生态。

-   `agenticx/core/security.py`:
    -   **角色**: **安全管理器**。
    -   **目的**: 提供全面的安全功能，包括权限控制、安全策略、审计日志和凭据管理。`SecurityManager` 确保工具的执行符合预定义的安全规则，防止未经授权的访问和恶意操作。

-   `agenticx/core/registry.py`:
    -   **角色**: **工具注册表**。
    -   **目的**: 集中管理所有工具的注册、发现和生命周期。`ToolRegistry` 维护一个所有可用工具的目录，并按类别、标签等进行组织，方便 `ToolSystem` 进行查找和调用。

-   `agenticx/core/marketplace.py`:
    -   **角色**: **工具市场**。
    -   **目的**: 提供工具的发现、发布、安装和管理功能。`ToolMarketplace` 允许用户从远程或本地源发现和集成新工具，扩展了 `ToolSystem` 的功能。

-   `agenticx/core/executor.py`:
    -   **角色**: **工具执行引擎**。
    -   **目的**: 负责工具的安全、可靠执行。`ToolExecutor` 提供了沙箱环境、重试逻辑、超时控制和资源监控等功能，确保工具在隔离和受控的环境中运行。

-   `agenticx/core/adapters.py`:
    -   **角色**: **协议适配器**。
    -   **目的**: 用于将 `ToolSystem` 与不同的外部工具调用协议（如 OpenAI Function Calling）进行集成。`ProtocolAdapter` 负责在 `ToolSystem` 的内部格式和外部协议之间进行转换，实现了系统的互操作性。

**总结**:

开发者在创建新工具时，应该继承和使用 `tool_v2.py` 中定义的 `BaseTool`。而在应用中使用工具时，则应该通过 `tool_system.py` 提供的 `ToolSystem` 来进行统一管理和调用。`tool.py` 仅作为历史兼容层存在。

### `executor.py` vs `agent_executor.py`

在 `core` 目录中，还存在两个与“执行”相关的文件，但它们的职责位于完全不同的抽象层次：

-   `agenticx/core/executor.py` (`ToolExecutor`):
    -   **角色**: **底层工具执行引擎**。
    -   **目的**: 它的唯一职责是**安全、可靠地执行单个工具**。它提供了沙箱、资源限制、超时和重试等底层机制，确保工具的执行过程是受控的。它不关心 Agent 的任务或思维链，只专注于完成一次具体的工具调用。

-   `agenticx/core/agent_executor.py` (`AgentExecutor`):
    -   **角色**: **高层 Agent 的执行循环和逻辑中枢**。
    -   **目的**: 它的职责是**驱动一个 Agent 完成一个复杂的任务**。它实现了 Agent 的“思考-行动”循环，负责调用 LLM 进行决策，并根据决策结果协调调用一个或多个工具。它本身不执行工具，而是通过 `ToolSystem` **委托** `ToolExecutor` 来完成具体的执行工作。

**关系比喻**:

-   `ToolExecutor` 是一个**精密机床**，擅长精确、安全地完成一项具体操作。
-   `AgentExecutor` 是**车间总调度员**，他拿着任务蓝图，指挥不同的机床协同工作，最终完成整个产品。

**建议**: 这两个文件应该**保持独立**。它们遵循了单一职责原则和清晰的架构分层，将高层的 Agent 逻辑与底层的工具执行细节解耦，使得系统更易于维护、测试和扩展。

### `executor.py` vs `agent_executor.py`

在 `core` 目录中，还存在两个与“执行”相关的文件，但它们的职责位于完全不同的抽象层次：

-   `agenticx/core/executor.py` (`ToolExecutor`):
    -   **角色**: **底层工具执行引擎**。
    -   **目的**: 它的唯一职责是**安全、可靠地执行单个工具**。它提供了沙箱、资源限制、超时和重试等底层机制，确保工具的执行过程是受控的。它不关心 Agent 的任务或思维链，只专注于完成一次具体的工具调用。

-   `agenticx/core/agent_executor.py` (`AgentExecutor`):
    -   **角色**: **高层 Agent 的执行循环和逻辑中枢**。
    -   **目的**: 它的职责是**驱动一个 Agent 完成一个复杂的任务**。它实现了 Agent 的“思考-行动”循环，负责调用 LLM 进行决策，并根据决策结果协调调用一个或多个工具。它本身不执行工具，而是通过 `ToolSystem` **委托** `ToolExecutor` 来完成具体的执行工作。

**关系比喻**:

-   `ToolExecutor` 是一个**精密机床**，擅长精确、安全地完成一项具体操作。
-   `AgentExecutor` 是**车间总调度员**，他拿着任务蓝图，指挥不同的机床协同工作，最终完成整个产品。

**建议**: 这两个文件应该**保持独立**。它们遵循了单一职责原则和清晰的架构分层，将高层的 Agent 逻辑与底层的工具执行细节解耦，使得系统更易于维护、测试和扩展。

## 最佳实践

### 1. 工具设计原则
- **单一职责**: 每个工具应该专注于一个具体的功能
- **参数验证**: 在工具内部进行完整的参数验证
- **错误处理**: 提供清晰的错误信息和错误码
- **超时设置**: 为长时间运行的操作设置合理的超时时间
- **幂等性**: 尽可能设计幂等的工具操作

### 2. 安全考虑
- **权限最小化**: 只授予必要的权限
- **输入验证**: 严格验证所有输入参数
- **敏感数据**: 使用CredentialStore管理敏感信息
- **审计日志**: 记录所有重要的操作
- **限流保护**: 为高频操作设置限流规则

### 3. 性能优化
- **异步执行**: 优先使用异步接口
- **连接池**: 复用数据库和网络连接
- **缓存策略**: 对频繁访问的数据使用缓存
- **批量操作**: 支持批量处理减少网络开销
- **资源监控**: 监控资源使用情况并及时优化

### 4. 错误处理
- **分级错误**: 区分系统错误和业务错误
- **重试策略**: 为临时错误实现智能重试
- **降级方案**: 为主工具准备备用方案
- **用户友好**: 提供用户友好的错误信息
- **监控告警**: 对关键错误设置告警

## 迁移指南

### 从 v1 迁移到 v2

1. **更新导入路径**
   ```python
   # v1
   from agenticx.core.tool import BaseTool
   
   # v2
   from agenticx.core import BaseTool  # 新的统一接口
   ```

2. **适配新的工具接口**
   ```python
   # v1
   class MyTool(BaseTool):
       name = "my_tool"
       description = "My tool"
       
       def execute(self, **kwargs):
           return {"result": "ok"}
   
   # v2
   class MyTool(BaseTool):
       def __init__(self):
           metadata = ToolMetadata(
               name="my_tool",
               description="My tool",
               # ... 其他元数据
           )
           super().__init__(metadata)
       
       async def execute_async(self, parameters, context=None):
           return ToolResult(success=True, data={"result": "ok"})
   ```

3. **使用新的注册和执行机制**
   ```python
   # v1 - 直接执行
   tool = MyTool()
   result = tool.execute(param="value")
   
   # v2 - 通过工具系统
   tool_system.register_tool(MyTool())
   result = await tool_system.execute_tool_async("my_tool", {"param": "value"})
   ```

4. **启用安全和市场功能**
   ```python
   config = ToolSystemConfig(
       enable_security=True,
       enable_marketplace=True,
       # ... 其他配置
   )
   tool_system = create_tool_system(config)
   ```

## 示例代码

参考 `examples/tool_system_demo.py` 获取完整的演示代码，包括：

- 基本工具创建和注册
- 工具执行和错误处理
- 批量执行和并发控制
- 安全管理和权限检查
- 工具搜索和市场集成
- 系统监控和统计信息

运行演示：
```bash
cd /Users/damon/myWork/AgenticX
python examples/tool_system_demo.py
```

## API 参考

详细的API文档请参考各个模块的docstring：

- `tool_v2.py` - 核心工具接口和数据模型
- `registry.py` - 工具注册表和工厂
- `executor.py` - 执行引擎和沙箱环境
- `security.py` - 安全管理和权限控制
- `adapters.py` - 协议适配器
- `marketplace.py` - 工具市场功能
- `tool_system.py` - 统一工具系统接口

## 贡献指南

欢迎贡献新的工具、适配器和安全策略。请遵循以下原则：

1. 遵循现有的代码风格和架构设计
2. 为新功能添加完整的测试用例
3. 更新相关文档和示例
4. 确保向后兼容性
5. 通过安全审查和性能测试

## 许可证

本项目采用 MIT 许可证 - 详见 LICENSE 文件。