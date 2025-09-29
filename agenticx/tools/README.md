# AgenticX Tools: 通用 MCP 客户端架构

本文档详细介绍了 AgenticX 框架中用于连接远程服务的工具系统，特别是其通用的 MCP (Model Context Protocol) 客户端架构。

## 核心设计理念：自动化与零适配

目标是让开发者可以 **轻松、快速地将任何符合 MCP 标准的服务集成** 到他们的智能体应用中，而无需编写任何专门的适配代码。

为了实现这一目标，架构经历了一次重要的演进。

## 架构演进：从特定适配到通用发现

### 旧架构：特定适配模式

最初，每接入一个新的 MCP 服务器，都需要一位开发者手动完成以下步骤：

```
用户想接入新的 MCP 服务器
    ↓
需要编写专门的适配文件 (如 mineru.py)
    ↓
手动定义参数模型 (如 MinerUParseArgs)
    ↓
手动编写工具创建函数 (如 create_mineru_parse_tool)
    ↓
更新 __init__.py 导入
    ↓
用户才能使用工具
```

**问题:**
- ❌ **高昂的维护成本**: 每个 MCP 服务器都需要单独的适配文件。
- ❌ **大量的重复代码**: 参数定义和创建函数高度相似。
- ❌ **糟糕的扩展性**: 用户无法快速接入新服务器，必须等待框架更新。

### 新架构：通用自动发现模式

彻底重构了此模式，新架构的核心是 **自动化**。现在，接入新服务器的流程被简化为：

```
用户想接入新的 MCP 服务器
    ↓
在配置文件中添加服务器信息 (一行命令)
    ↓
使用 MCPClient 自动发现工具、解析参数
    ↓
框架自动生成工具实例
    ↓
直接在 Agent 中使用
```

**新架构优势:**
- ✅ **零适配代码**: 支持任何标准 MCP 服务器，无需编写一行适配代码。
- ✅ **自动发现**: 运行时自动发现服务器提供的所有工具及其参数 schema。
- ✅ **动态类型安全**: 自动从 JSON Schema 生成 Pydantic 模型，提供完整的类型安全和编辑器智能提示。
- ✅ **即插即用**: 用户可以瞬间接入任何 MCP 服务器。
- ✅ **低维护**: 框架维护者无需再为每个新服务器编写适配。

## 🧩 核心组件详解

新架构主要由以下几个核心组件构成：

1.  **`MCPClient` - 通用客户端**: 这是与 MCP 服务器交互的入口。
    - `discover_tools()`: 自动发现服务器提供的所有工具。
    - `create_tool()`: 为指定工具创建实例，自动解析参数。
    - `create_all_tools()`: 批量创建服务器提供的所有工具。

2.  **`RemoteTool` - 远程工具基类**: 表示一个远程工具的实例，负责处理调用请求和响应。

3.  **动态模型生成器**:
    - `_create_pydantic_model_from_schema()`: 内部函数，负责将从服务器获取的 JSON Schema 实时转换为 Pydantic 模型，这是实现动态类型安全的关键。

4.  **标准协议实现**:
    - `_communicate_with_server()`: 完整实现了 MCP 协议的 `initialize` 握手、`initialized` 通知和 `tools/call` 调用，确保了与任何标准 MCP 服务器的兼容性。

## 🚀 如何使用

### 1. 添加服务器配置
在您的配置文件（如 `~/.cursor/mcp.json`）中，添加您想连接的服务器信息：

```json
{
  "mcpServers": {
    "my-custom-server": {
      "command": "python",
      "args": ["-m", "my_mcp_server_module"],
      "env": { "API_KEY": "your-secret-key" }
    }
  }
}
```

### 2. 创建客户端并使用工具

```python
from agenticx.tools import create_mcp_client

# 1. 创建客户端
client = await create_mcp_client("my-custom-server")

# 2. 自动发现并创建工具
# 方式 A: 创建一个指定的工具
my_tool = await client.create_tool("some_tool_name_from_server")

# 方式 B: 创建该服务器提供的所有工具
all_tools_from_server = await client.create_all_tools()

# 3. 在 Agent 中使用
result = await my_tool.arun(param1="value1", param2="value2")
```

## 🌐 与 FastMCP 的关系：客户端 vs. 服务器框架

`remote.py` 的设计经常被拿来与 `FastMCP` 比较，理解它们的区别至关重要：

- **`agenticx.tools.remote`**: 是一个 **MCP 客户端**。它的作用是 *消费* 远程服务。
- **`FastMCP`**: 是一个 **MCP 服务器框架**。它的作用是 *提供* 服务。

它们是生态中互补的两个部分。**你可以用 FastMCP 构建一个强大的 MCP 服务器，然后用 `RemoteTool` 来连接和使用它。**

| 维度 | `agenticx.tools.remote` | FastMCP 2.0 |
|------|---------------------------------|-------------|
| **角色** | **客户端 (Consumer)** | **服务器框架 (Provider)** |
| **主要功能** | 调用远程 MCP 服务 | 构建和部署 MCP 服务 |
| **依赖** | 标准库 + pydantic (轻量级) | 完整的 FastMCP 生态 |
| **场景** | 在 AgenticX 中集成外部工具 | 将你自己的功能暴露为服务 |

## 总结

AgenticX 的 `RemoteTool` 系统提供了一个轻量级、零依赖、功能强大的通用 MCP 客户端。其 **自动发现** 和 **动态类型生成** 的核心特性，使开发者能够以前所未有的速度和便捷性集成任何标准的远程工具，极大地增强了框架的扩展性和易用性。