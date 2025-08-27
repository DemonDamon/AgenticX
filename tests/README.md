# AgenticX 测试套件

本目录包含 AgenticX 框架的所有测试脚本和测试数据。

## 测试文件说明

### 1. `test_core.py` - 核心模块完整测试
这是 `agenticx.core` 模块的完整测试套件，使用 pytest 框架编写。

**测试覆盖内容：**

#### Agent 类测试 (TestAgent)
- ✅ 默认参数创建 Agent
- ✅ 完整参数创建 Agent  
- ✅ 所有必需字段验证
- ✅ UUID 自动生成
- ✅ 多租户 organization_id 支持

#### Task 类测试 (TestTask)
- ✅ 基本任务创建
- ✅ 完整任务创建（包含依赖关系）
- ✅ Agent 关联测试
- ✅ 输出模式验证
- ✅ 上下文和依赖管理

#### 工具系统测试 (TestTool)
- ✅ `@tool` 装饰器基本功能
- ✅ 自定义工具名称和描述
- ✅ 参数模式自动推断
- ✅ 同步工具执行 (`execute`)
- ✅ 异步工具执行 (`aexecute`)
- ✅ 同步函数的异步执行转换

#### 工作流系统测试 (TestWorkflow)
- ✅ WorkflowNode 创建和配置
- ✅ WorkflowEdge 创建（包含条件路由）
- ✅ 完整 Workflow 图结构
- ✅ 版本管理和多租户支持

#### 消息系统测试 (TestMessage)
- ✅ 基本消息创建
- ✅ 协议消息封装 (ProtocolMessage)
- ✅ 元数据支持

#### 平台类测试 (TestPlatform)
- ✅ Organization 创建和配置
- ✅ User 创建和角色管理
- ✅ 多租户关联验证
- ✅ 审计字段（创建时间等）

#### 模块导入测试 (TestModuleImports)
- ✅ 所有核心类正确导入
- ✅ 包级别导出验证

#### 集成测试 (TestIntegration)
- ✅ 完整工作流设置
- ✅ 跨类关联关系验证
- ✅ 端到端功能测试

**运行方式：**
```bash
# 使用 pytest 运行完整测试套件
pytest tests/test_core.py -v

# 运行特定测试类
pytest tests/test_core.py::TestAgent -v

# 运行特定测试方法
pytest tests/test_core.py::TestAgent::test_agent_creation_with_defaults -v
```

### 2. `run_core_tests.py` - 快速测试运行器
这是一个独立的测试运行器，无需安装 pytest 即可快速验证核心功能。

**测试内容：**

#### 基础功能测试
1. **模块导入测试** - 验证所有核心类可正常导入
2. **Agent 类测试** - 创建和属性验证
3. **Task 类测试** - 创建和关联测试
4. **Tool系统测试** - 装饰器和执行功能
5. **Workflow系统测试** - 图结构创建
6. **Message系统测试** - 消息创建和ID生成
7. **平台类测试** - Organization 和 User 创建
8. **集成测试** - 跨模块功能验证

#### 高级功能测试
- **异步工具测试** - 验证 `aexecute` 方法
- **同步转异步测试** - 验证自动异步转换

**运行方式：**
```bash
# 直接运行快速测试
python tests/run_core_tests.py

# 或从项目根目录运行
cd /path/to/AgenticX
python tests/run_core_tests.py
```

**预期输出示例：**
```
=== AgenticX Core Module Test Runner ===

1. 测试模块导入...
   ✅ 所有核心类导入成功

2. 测试 Agent 类...
   ✅ Agent 类创建和属性测试通过

3. 测试 Task 类...
   ✅ Task 类创建和关联测试通过

4. 测试 Tool 系统...
   ✅ Tool 装饰器和执行测试通过

5. 测试 Workflow 系统...
   ✅ Workflow 系统测试通过

6. 测试 Message 系统...
   ✅ Message 系统测试通过

7. 测试平台类...
   ✅ 平台类测试通过

8. 集成测试...
   ✅ 集成测试通过

🎉 所有测试都通过了！AgenticX Core 模块功能正常。

=== 高级功能测试 ===
   ✅ 异步工具测试通过
   ✅ 同步转异步测试通过

🎊 所有测试（包括高级功能）都通过了！
```

### 3. `test_llms.py` - LLM 服务层测试
这是 `agenticx.llms` 模块的测试套件，使用 pytest 框架和 `unittest.mock` 进行模拟测试。

**测试覆盖内容：**

#### 数据类测试 (TestLLMDataClasses)
- ✅ `TokenUsage`, `LLMChoice`, `LLMResponse` 等数据类的实例化和属性验证。

#### LiteLLMProvider 测试 (TestLiteLLMProvider)
- ✅ **模拟 API 调用**：所有测试都通过模拟 `litellm` 的 API 调用来完成，确保测试的快速和独立性。
- ✅ **同步调用**：测试 `invoke` 方法能否正确处理模拟响应。
- ✅ **异步调用**：测试 `ainvoke` 方法能否正确处理模拟响应。
- ✅ **同步流式调用**：测试 `stream` 方法能否正确处理流式数据块。
- ✅ **异步流式调用**：测试 `astream` 方法能否正确处理异步流。
- ✅ **响应解析**：验证 `_parse_response` 能否将 `litellm` 的响应正确转换为 `AgenticX` 的 `LLMResponse` 格式。

#### 便利提供商测试 (TestConvenienceProviders)
- ✅ 验证 `OpenAIProvider`, `AnthropicProvider`, `OllamaProvider`, `GeminiProvider` 等便利类是否能被正确实例化。

**运行方式：**
```bash
# 运行 LLM 模块的测试套件
pytest tests/test_llms.py -v
```

### 4. `run_llm_tests.py` - LLM 模块快速测试运行器
这是一个独立的 LLM 模块测试运行器，无需安装 pytest 即可快速验证 LLM 功能。

**测试内容：**

#### 基础功能测试
1. **模块导入测试** - 验证所有 LLM 类可正常导入
2. **数据类测试** - `TokenUsage`, `LLMChoice`, `LLMResponse` 创建和属性验证
3. **便利提供商测试** - `OpenAIProvider`, `AnthropicProvider` 等类的实例化
4. **LiteLLMProvider 测试** - 模拟同步调用和响应解析
5. **流式调用测试** - 模拟流式响应处理

#### 异步功能测试
- **异步调用测试** - 验证 `ainvoke` 方法
- **异步流式测试** - 验证 `astream` 方法

**运行方式：**
```bash
# 直接运行 LLM 快速测试
python tests/run_llm_tests.py

# 或从项目根目录运行
cd /path/to/AgenticX
python tests/run_llm_tests.py
```

**预期输出示例：**
```
=== AgenticX LLM Module Test Runner ===

1. 测试模块导入...
   ✅ 所有LLM类导入成功

2. 测试数据类...
   ✅ 数据类创建和属性测试通过

3. 测试便利提供商类...
   ✅ 便利提供商类测试通过

4. 测试LiteLLMProvider（模拟调用）...
   ✅ LiteLLMProvider同步调用测试通过

5. 测试流式调用（模拟）...
   ✅ 流式调用测试通过

🎉 所有LLM模块测试都通过了！AgenticX LLM 模块功能正常。

=== 异步功能测试 ===
   ✅ 异步调用测试通过
   ✅ 异步流式调用测试通过

🎊 所有测试（包括异步功能）都通过了！
```

### 5. `test_tools.py` - 工具系统测试
这是 `agenticx.tools` 模块的测试套件，使用 pytest 框架编写，同时支持直接运行。

**测试覆盖内容：**

#### 工具系统测试 (TestToolsSystem)
- ✅ **模块导入测试** - 验证所有工具类可正常导入
- ✅ **基础工具测试** - `BaseTool` 抽象基类功能
- ✅ **函数工具测试** - `FunctionTool` 和 `@tool` 装饰器
- ✅ **工具执行器测试** - `ToolExecutor` 执行引擎
- ✅ **凭据存储测试** - `CredentialStore` 加密存储
- ✅ **内置工具测试** - `FileTool`, `CodeInterpreterTool` 等
- ✅ **综合工作流测试** - 完整的工具使用流程

**运行方式：**
```bash
# 使用 pytest 运行完整测试套件
pytest tests/test_tools.py -v

# 或直接运行脚本进行快速测试
python tests/test_tools.py
```

### 6. `test_tool_paradigms.py` - 工具范式测试 🆕
这是一个综合性的工具范式测试脚本，验证 M3 工具系统对三种不同工具调用范式的支持情况。可直接运行。

**测试范式：**

#### 1. Function Call 范式
- **特点**: 静态函数调用，OpenAI 兼容格式，适合 API 服务包装
- **测试内容**:
  - ✅ 基础函数调用 - 使用 `@tool` 装饰器
  - ✅ OpenAI 格式兼容 - schema 生成和函数执行
  - ✅ 多 API 服务适配 - 模拟数据库、支付、通知等 API

#### 2. Tool Use 范式  
- **特点**: 动态工具执行，支持沙箱环境和 ReAct 模式
- **测试内容**:
  - ✅ 本地沙箱执行 - 安全的代码执行环境
  - ✅ 文件系统操作 - 读写文件权限控制
  - ✅ ReAct 模式模拟 - 思考→行动→观察循环
  - ✅ 远程工具执行 - 模拟远程服务调用

#### 3. MCP Server 范式
- **特点**: 标准化协议，统一接口，无需单独适配
- **测试内容**:
  - ✅ 服务发现 - 动态发现可用服务能力
  - ✅ 统一协议调用 - 标准化的服务调用接口
  - ✅ 动态能力扩展 - 运行时添加新服务
  - ✅ 协议解耦验证 - 不同后端的统一调用

#### 4. A2A (Agent-to-Agent) 范式
- **特点**: 将 Agent 作为工具调用，支持分布式协作
- **状态**: 🚧 TODO - 未来扩展方向
- **计划内容**:
  - ❌ Agent 间通信协议 (待实现)
  - ❌ Agent 能力发现 (待实现)
  - ❌ 分布式任务分解 (待实现)
  - ❌ Agent 协作执行 (待实现)
  - ❌ 结果聚合和反馈 (待实现)

**运行方式：**
```bash
# 直接运行完整的工具范式测试
python tests/test_tool_paradigms.py
```

**预期输出示例：**
```
🧪 AgenticX M3 工具系统范式测试
============================================================
测试三种工具调用范式的实现情况：
1. Function Call - 静态函数调用
2. Tool Use - 动态工具执行
3. MCP Server - 标准化协议服务
4. A2A - Agent 间协作（TODO）
============================================================

🔧 测试 Function Call 范式
==================================================
  ✅ 基础函数调用: 北京今天天气晴朗，温度 25°C
  ✅ OpenAI 格式兼容: Schema: True, Execution: True
  ✅ 多 API 服务适配: APIs tested: 3, Success: 3/3

🛠️ 测试 Tool Use 范式
==================================================
  ✅ 本地沙箱执行: Math calculation: Code executed successfully. Result: 12.0
  ✅ 文件系统操作: Write: OK, Read: OK
  ✅ ReAct 模式模拟: Thought: I need to calculate... -> Action: Execute calculation -> ...
  ✅ 远程工具执行: Remote analysis result: 3.0

🌐 测试 MCP Server 范式
==================================================
  ✅ 服务发现: Found 2 capabilities
  ✅ 统一协议调用: Weather: success, Analytics: success
  ✅ 动态能力扩展: Dynamic server added and called: True
  ✅ 协议解耦验证: Protocol decoupling verified: DB=success, API=success

🤖 测试 A2A (Agent-to-Agent) 范式
==================================================
⚠️  A2A 范式尚未实现，这是未来的扩展方向
  ❌ Agent 间通信协议: TODO: 待实现
  ❌ Agent 能力发现: TODO: 待实现
  ❌ 分布式任务分解: TODO: 待实现
  ❌ Agent 协作执行: TODO: 待实现
  ❌ 结果聚合和反馈: TODO: 待实现

============================================================
📊 测试报告
============================================================
✅ Function Call: 3/3 (100.0%)
✅ Tool Use: 4/4 (100.0%)
✅ MCP Server: 4/4 (100.0%)
❌ A2A (Agent-to-Agent): 0/5 (0.0%)
------------------------------------------------------------
🎯 总体通过率: 11/16 (68.8%)

📋 分析和建议:
✅ Function Call 范式完全支持 - 适合标准化 API 服务包装
✅ Tool Use 范式完全支持 - 适合动态工具执行和 ReAct 模式
✅ MCP Server 范式完全支持 - 适合标准化协议服务
🚧 A2A 范式尚未实现 - 这是未来的重要扩展方向

🔮 未来发展建议:
1. 实现真正的 MCP 协议客户端和服务端
2. 开发 A2A Agent 间通信和协作机制
3. 增强工具安全性和沙箱隔离
4. 支持更多的远程工具执行环境
5. 实现工具的动态发现和注册机制
```

### 7. `test_deepseek_interactive.py` - DeepSeek 交互式测试
这是一个交互式测试脚本，用于验证 AgenticX LLM 服务层与 DeepSeek API 的实际集成。

**测试功能：**
- ✅ 非流式调用测试
- ✅ 流式调用测试  
- ✅ 异步调用测试
- ✅ 异步流式调用测试
- ✅ DeepSeek Reasoner 模型测试
- ✅ 交互式用户输入

**运行方式：**
```bash
# 运行交互式测试（需要 DeepSeek API Key）
python tests/test_deepseek_interactive.py
```

### 8. `test_e2e_agent_tools.py` - 端到端集成测试 🆕
这是完整的端到端测试，实现了 **Agent + LLM + Tools** 的完整集成，让大模型通过 Function Call 调用工具完成实际任务。

**核心功能：**
- 🤖 **智能 Agent** - 使用真实的 Agent 实例
- 🧠 **LLM 集成** - 支持真实 API 调用和模拟模式
- 🔧 **Function Call** - 标准的 OpenAI 函数调用格式
- ⚙️ **工具执行** - 计算器、文件操作、代码执行等

**可用工具：**
- `calculator` - 数学计算工具
- `file_writer` - 文件写入工具  
- `code_executor` - Python 代码执行工具

**运行方式：**
```bash
# 交互式模式（推荐）- 可以实时对话测试
python tests/test_e2e_agent_tools.py --mode interactive

# 批量测试模式
python tests/test_e2e_agent_tools.py --mode batch

# 使用真实 API（需要设置 DEEPSEEK_API_KEY 环境变量）
python tests/test_e2e_agent_tools.py --api-key YOUR_API_KEY --model deepseek/deepseek-chat
```

**交互式测试示例：**
```
👤 您: 帮我计算 1000 + 2000

🤖 Agent: AgenticX测试助手
📝 用户输入: 帮我计算 1000 + 2000
🔄 调用真实 LLM...
🔧 调用工具: calculator
📋 参数: {'expression': '1000 + 2000'}
✅ 工具执行成功: 计算结果：1000 + 2000 = 3000

🎉 最终结果: 计算结果：1000 + 2000 = 3000
```

### 9. `test_mcp_server_demo.py` - MCP Server 演示 🆕
这是 MCP (Model Context Protocol) Server 的完整演示，展示了标准化协议的服务调用。

**演示内容：**
- 🔍 **服务发现** - 动态发现可用服务和能力
- 💻 **直接调用** - 通过 MCP 协议调用远程服务
- 🔧 **工具适配** - 将 MCP 服务适配为 AgenticX 工具
- 🌐 **分布式架构** - 模拟多个独立的服务器

**模拟服务：**
- `calculator-service` - 数学计算服务
- `text-service` - 文本处理服务
- `data-service` - 数据分析服务

**运行方式：**
```bash
# 运行完整的 MCP 演示
python tests/test_mcp_server_demo.py
```

### 10. `test_universal_mcp.py` - 通用 MCP 客户端架构演示 🆕
这是对重构后的通用 MCP 客户端架构的演示和测试脚本，展示了如何通过零适配代码轻松接入任何标准的 MCP 服务器。

**演示内容：**
- ✅ **自动发现** - 连接到 `mineru-mcp` 服务并自动发现其提供的 `parse_documents` 和 `get_ocr_languages` 工具。
- ✅ **动态工具创建** - 从服务器返回的 schema 动态创建类型安全的 `RemoteTool` 实例。
- ✅ **端到端调用** - 实际调用 `parse_documents` 工具来解析一个 PDF 文件并验证结果。
- ✅ **易用性展示** - 提供了清晰的步骤说明，展示用户如何轻松接入自己的或其他第三方的 MCP 服务器。
- ✅ **高级用法示例** - 演示了如何批量集成多个 MCP 服务器的工具，以及如何在 Agent 中使用它们。

**运行方式：**
```bash
# 运行通用 MCP 客户端演示
python tests/test_universal_mcp.py
```

### 11. `test_provider_kimi.py` - Kimi LLM 提供商基础测试 🆕
这是针对 Kimi（Moonshot）LLM 提供商的基础测试脚本，验证核心功能。

**测试覆盖内容：**
- ✅ **导入验证** - 确认 `KimiProvider` 和 `MoonshotProvider` 的正确导入
- ✅ **实例创建** - 验证提供商实例的基本创建
- ✅ **多模态支持** - 检测多模态功能支持
- ✅ **模型前缀处理** - 验证模型名称前缀处理逻辑

**运行方式：**
```bash
# 运行 Kimi 提供商基础测试
python tests/test_provider_kimi.py
```

### 12. `test_provider_bailian.py` - 阿里云百炼 LLM 提供商基础测试 🆕
这是针对阿里云百炼（Dashscope）LLM 提供商的基础测试脚本，验证核心功能。

**测试覆盖内容：**
- ✅ **导入验证** - 确认 `BailianProvider` 和 `DashscopeProvider` 的正确导入
- ✅ **实例创建** - 验证提供商实例的基本创建
- ✅ **多模态支持** - 检测多模态功能支持
- ✅ **模型前缀处理** - 验证 `_ensure_dashscope_prefix` 方法
- ✅ **别名验证** - 确认 `DashscopeProvider` 作为 `BailianProvider` 的别名

**运行方式：**
```bash
# 运行百炼提供商基础测试
python tests/test_provider_bailian.py
```

### 13. `test_vlm_bailian.py` - 百炼视觉语言模型测试
这是针对百炼视觉语言模型（VLM）功能的专门测试脚本。

**测试功能：**
- ✅ 图像理解和描述
- ✅ 多模态对话
- ✅ 视觉问答
- ✅ 图像分析

**运行方式：**
```bash
# 运行百炼 VLM 测试（需要 BAILIAN_API_KEY 环境变量）
python tests/test_vlm_bailian.py
```

### 14. `test_embeddings.py` - 嵌入向量服务测试
这是 `agenticx.embeddings` 模块的测试套件，验证向量嵌入功能。

**测试覆盖内容：**
- ✅ 嵌入向量生成
- ✅ 批量文本处理
- ✅ 向量相似度计算
- ✅ 多种嵌入模型支持

**运行方式：**
```bash
# 运行嵌入向量测试
pytest tests/test_embeddings.py -v
```

### 15. `test_memory.py` & `test_mem0_memory.py` - 记忆系统测试
这些是 AgenticX 记忆系统的测试脚本，验证不同的记忆存储和检索机制。

**测试功能：**
- ✅ 短期记忆管理
- ✅ 长期记忆存储
- ✅ 记忆检索和更新
- ✅ Mem0 集成测试

**运行方式：**
```bash
# 运行记忆系统测试
pytest tests/test_memory.py -v
pytest tests/test_mem0_memory.py -v
```

### 16. 模块化测试套件 (M系列)
这些是按照 AgenticX 架构模块划分的专门测试脚本：

#### `test_m5_agent_core.py` - M5 Agent 核心测试
- ✅ Agent 生命周期管理
- ✅ Agent 状态转换
- ✅ Agent 间通信

#### `test_m6_task_validation.py` - M6 任务验证测试
- ✅ 任务创建和验证
- ✅ 任务依赖关系
- ✅ 任务执行状态

#### `test_m7_workflow_engine.py` - M7 工作流引擎测试
- ✅ 工作流定义和执行
- ✅ 条件分支处理
- ✅ 并行任务执行

#### `test_m8_protocols.py` - M8 协议层测试
- ✅ 通信协议验证
- ✅ 消息序列化/反序列化
- ✅ 协议兼容性

#### `test_m9_observability.py` - M9 可观测性测试
- ✅ 日志记录和追踪
- ✅ 性能监控
- ✅ 错误报告

#### `test_m15_retrieval.py` - M15 检索系统测试
- ✅ 文档检索和排序
- ✅ 语义搜索
- ✅ 检索增强生成 (RAG)

**运行方式：**
```bash
# 运行特定模块测试
pytest tests/test_m5_agent_core.py -v
pytest tests/test_m6_task_validation.py -v
pytest tests/test_m7_workflow_engine.py -v
pytest tests/test_m8_protocols.py -v
pytest tests/test_m9_observability.py -v
pytest tests/test_m15_retrieval.py -v
```

### 17. 高级功能测试

#### `test_remote_tools_complete.py` - 远程工具完整测试
- ✅ 远程工具发现和注册
- ✅ 远程工具执行
- ✅ 网络通信和错误处理

#### `test_human_in_the_loop.py` - 人机协作测试
- ✅ 人工干预机制
- ✅ 审批流程
- ✅ 交互式决策

#### `test_hierarchical_memory.py` - 分层记忆测试
- ✅ 多层次记忆结构
- ✅ 记忆层级管理
- ✅ 智能记忆检索

**运行方式：**
```bash
# 运行高级功能测试
python tests/test_remote_tools_complete.py
python tests/test_human_in_the_loop.py
python tests/test_hierarchical_memory.py
```

## 测试验证的 PRD 需求

这些测试脚本验证了以下 PRD 模块：

### ✅ M1: 核心抽象层 (`agenticx.core`)
- `Agent(BaseModel)` - 包含所有必需字段和多租户支持
- `Task(BaseModel)` - 完整的任务定义和依赖管理
- `BaseTool(ABC)` - 抽象基类和同步/异步执行
- `Workflow(BaseModel)` - 图结构工作流定义
- `Message(BaseModel)` - Agent 间通信消息格式
- `User(BaseModel)` & `Organization(BaseModel)` - 平台多租户支持

### ✅ M2: LLM 服务提供层 (`agenticx.llms`)
- `BaseLLMProvider(ABC)` - 统一接口
- `LLMResponse(BaseModel)` - 标准化返回对象
- `LiteLLMProvider` - 对主流模型的统一封装
- `BailianProvider` - 阿里云百炼/Dashscope 专用提供商
- `TokenUsage` 和 `cost` 的正确解析
- 多模态支持 - 图像理解和视觉语言模型

### ✅ M3: 工具系统 (`agenticx.tools`)
- `BaseTool(ABC)` - 抽象基类和执行接口
- `FunctionTool` & `@tool` 装饰器 - 函数到工具的转换
- `ToolExecutor` - 安全的工具执行引擎
- `CredentialStore` - 加密的凭据管理
- 内置工具集 - 文件、代码执行、网络搜索等
- 远程工具系统 - 分布式工具发现和执行
- **四种工具范式支持**:
  - ✅ Function Call - 静态函数调用
  - ✅ Tool Use - 动态工具执行
  - ✅ MCP Server - 标准化协议服务
  - 🚧 A2A - Agent 间协作（TODO）

### ✅ M4: 工具智能化 (`agenticx.tools.intelligence`)
- 智能工具选择和推荐
- 工具使用模式学习
- 工具效果评估和优化

### ✅ M5: Agent 核心引擎 (`agenticx.core.agent`)
- Agent 生命周期管理
- Agent 状态转换和持久化
- Agent 间通信和协作
- 记忆智能化集成

### ✅ M6: 任务验证系统
- 任务定义和验证
- 任务依赖关系管理
- 任务执行状态跟踪
- 任务结果验证

### ✅ M7: 工作流引擎
- 复杂工作流定义和执行
- 条件分支和并行处理
- 工作流状态管理
- 错误处理和恢复

### ✅ M8: 协议和通信层
- 标准化通信协议
- 消息序列化和反序列化
- 协议兼容性验证
- 协作智能化支持

### ✅ M9: 可观测性系统
- 全链路日志记录和追踪
- 性能监控和分析
- 错误报告和诊断
- 系统健康检查

### ✅ M15: 检索增强系统 (`agenticx.retrieval`)
- 文档检索和排序
- 语义搜索和匹配
- 检索增强生成 (RAG)
- 智能检索策略

### ✅ 记忆系统 (`agenticx.memory`)
- 短期和长期记忆管理
- 分层记忆结构
- 记忆检索和更新
- Mem0 集成支持
- 记忆智能化

### ✅ 嵌入向量系统 (`agenticx.embeddings`)
- 多种嵌入模型支持
- 批量文本处理
- 向量相似度计算
- 嵌入向量缓存和优化

### ✅ 人机协作系统
- 人工干预机制
- 审批流程管理
- 交互式决策支持
- 人机协作智能化

## 测试套件统计

当前测试目录包含 **30+ 个测试文件**，覆盖 AgenticX 框架的所有核心模块：

### 📊 测试文件分类
- **核心模块测试**: 8 个文件 (test_core.py, test_llms.py, test_tools.py 等)
- **LLM 提供商测试**: 4 个文件 (test_provider_bailian.py, test_vlm_bailian.py 等)
- **模块化测试 (M系列)**: 8 个文件 (test_m5_*.py, test_m6_*.py 等)
- **高级功能测试**: 6 个文件 (test_remote_tools_*.py, test_human_*.py 等)
- **集成和演示测试**: 6 个文件 (test_e2e_*.py, test_mcp_*.py 等)
- **快速运行器**: 2 个文件 (run_core_tests.py, run_llm_tests.py)

### 🚀 快速运行指南

#### 1. 运行所有测试
```bash
# 使用 pytest 运行所有测试
pytest tests/ -v

# 运行特定模块的所有测试
pytest tests/test_*.py -v
```

#### 2. 快速验证核心功能
```bash
# 无需 pytest，快速验证核心模块
python tests/run_core_tests.py

# 快速验证 LLM 模块
python tests/run_llm_tests.py
```

#### 3. 运行特定功能测试
```bash
# 测试工具系统
pytest tests/test_tools.py tests/test_tool_paradigms.py -v

# 测试 LLM 提供商
pytest tests/test_llms.py tests/test_provider_bailian.py -v

# 测试记忆系统
pytest tests/test_memory.py tests/test_mem0_memory.py -v
```

#### 4. 交互式测试和演示
```bash
# 端到端 Agent 测试
python tests/test_e2e_agent_tools.py --mode interactive

# MCP 服务器演示
python tests/test_mcp_server_demo.py

# 通用 MCP 客户端演示
python tests/test_universal_mcp.py
```

## 运行要求

### 基础要求
- **Python 3.8+**
- **必需依赖：** `pydantic`, `litellm`
- **可选依赖：** `pytest`, `pytest-asyncio` (用于 `test_*.py` 文件)

### 环境变量 (可选)
- `BAILIAN_API_KEY` - 用于百炼 LLM 提供商测试
- `DEEPSEEK_API_KEY` - 用于 DeepSeek 交互式测试
- `OPENAI_API_KEY` - 用于 OpenAI 相关测试

### 安装依赖
```bash
# 安装基础依赖
pip install pydantic litellm

# 安装测试依赖
pip install pytest pytest-asyncio

# 安装完整依赖（推荐）
pip install -r requirements.txt
```

## 故障排除

### 常见问题

#### 1. 导入错误
```bash
# 确保从项目根目录运行测试
cd /path/to/AgenticX
python tests/test_*.py
```

#### 2. 依赖缺失
```bash
# 检查并安装缺失的包
pip install pydantic litellm pytest
```

#### 3. API Key 相关错误
```bash
# 设置环境变量（Windows）
set BAILIAN_API_KEY=your_api_key_here

# 设置环境变量（Linux/Mac）
export BAILIAN_API_KEY=your_api_key_here
```

#### 4. Python 版本兼容性
```bash
# 检查 Python 版本
python --version

# 确保使用 Python 3.8 或更高版本
```

### 获取详细错误信息

如需更详细的错误信息：

1. **使用快速运行器** - `run_core_tests.py` 和 `run_llm_tests.py` 会显示完整的错误堆栈
2. **使用 pytest 详细模式** - 添加 `-v` 和 `--tb=long` 参数
3. **查看日志文件** - 某些测试会生成日志文件用于调试

```bash
# 获取详细的测试输出
pytest tests/test_core.py -v --tb=long

# 运行单个测试并查看详细信息
pytest tests/test_core.py::TestAgent::test_agent_creation -v -s
```

## 贡献测试

如果您想为 AgenticX 贡献测试代码：

1. **遵循命名约定** - 使用 `test_*.py` 格式
2. **使用 pytest 框架** - 确保与现有测试兼容
3. **添加文档** - 在本 README 中添加测试说明
4. **包含示例** - 提供预期输出示例
5. **测试覆盖** - 确保新功能有对应的测试

### 测试模板
```python
# tests/test_new_feature.py
import pytest
from agenticx.new_module import NewClass

class TestNewFeature:
    def test_basic_functionality(self):
        """测试基本功能"""
        instance = NewClass()
        result = instance.method()
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_async_functionality(self):
        """测试异步功能"""
        instance = NewClass()
        result = await instance.async_method()
        assert result is not None

if __name__ == "__main__":
    # 支持直接运行
    pytest.main([__file__, "-v"])
```
