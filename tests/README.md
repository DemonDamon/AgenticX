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

## 测试验证的 PRD 需求

这些测试脚本验证了 PRD 中 **M1: 核心抽象层 (`agenticx.core`)** 的所有要求：

- ✅ `Agent(BaseModel)` - 包含所有必需字段和多租户支持
- ✅ `Task(BaseModel)` - 完整的任务定义和依赖管理
- ✅ `BaseTool(ABC)` - 抽象基类和同步/异步执行
- ✅ `Workflow(BaseModel)` - 图结构工作流定义
- ✅ `Message(BaseModel)` - Agent 间通信消息格式
- ✅ `User(BaseModel)` & `Organization(BaseModel)` - 平台多租户支持

## 运行要求

- **Python 3.8+**
- **必需依赖：** `pydantic`
- **可选依赖：** `pytest` (仅用于 test_core.py)

## 故障排除

如果测试失败，请检查：

1. **导入错误** - 确保从项目根目录运行测试
2. **依赖缺失** - 安装 `pydantic` 包
3. **Python 版本** - 确保使用 Python 3.8 或更高版本

如需更详细的错误信息，查看 `run_core_tests.py` 的输出，它会显示完整的错误堆栈。

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

### 5. `run_core_tests.py` - 核心模块快速测试运行器
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

## 测试验证的 PRD 需求

这些测试脚本验证了 PRD 中 **M1: 核心抽象层 (`agenticx.core`)** 的所有要求：

- ✅ `Agent(BaseModel)` - 包含所有必需字段和多租户支持
- ✅ `Task(BaseModel)` - 完整的任务定义和依赖管理
- ✅ `BaseTool(ABC)` - 抽象基类和同步/异步执行
- ✅ `Workflow(BaseModel)` - 图结构工作流定义
- ✅ `Message(BaseModel)` - Agent 间通信消息格式
- ✅ `User(BaseModel)` & `Organization(BaseModel)` - 平台多租户支持

`test_llms.py` 脚本验证了 PRD 中 **M2: LLM 服务提供层 (`agenticx.llms`)** 的所有要求：
- ✅ `BaseLLMProvider(ABC)` - 统一接口
- ✅ `LLMResponse(BaseModel)` - 标准化返回对象
- ✅ `LiteLLMProvider` - 对主流模型的统一封装
- ✅ `TokenUsage` 和 `cost` 的正确解析

## 运行要求

- **Python 3.8+**
- **必需依赖：** `pydantic`, `litellm`
- **可选依赖：** `pytest`, `pytest-asyncio` (用于 `test_*.py` 文件)

## 故障排除

如果测试失败，请检查：

1. **导入错误** - 确保从项目根目录运行测试
2. **依赖缺失** - 安装 `pydantic` 包
3. **Python 版本** - 确保使用 Python 3.8 或更高版本

如需更详细的错误信息，查看 `run_core_tests.py` 的输出，它会显示完整的错误堆栈。
