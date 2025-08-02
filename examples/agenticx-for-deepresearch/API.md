# AgenticX-for-DeepSearch API 文档

## 概述

本文档详细说明了 `agenticx-for-deepsearch` 项目中各个组件的 API 接口。

## 核心组件

### 1. DeepSearchWorkflow

深度搜索工作流的主要类，负责编排整个研究过程。

#### 构造函数

```python
DeepSearchWorkflow(
    llm_provider: BaseLLMProvider,
    max_research_loops: int = 3,
    organization_id: str = "deepsearch",
    search_engine: str = "mock",
    config_path: str = "config.yaml"
)
```

**参数说明：**
- `llm_provider`: LLM 提供者实例
- `max_research_loops`: 最大研究循环次数，默认 3
- `organization_id`: 组织ID，默认 "deepsearch"
- `search_engine`: 搜索引擎类型，支持 "google", "bing", "mock"
- `config_path`: 配置文件路径，默认 "config.yaml"

#### 主要方法

##### execute(research_topic: str) -> Dict[str, Any]

执行深度搜索工作流。

**参数：**
- `research_topic`: 研究主题字符串

**返回值：**
```python
{
    "research_topic": str,
    "final_report": str,
    "research_context": Dict[str, Any],
    "total_loops": int,
    "metrics": Dict[str, Any]
}
```

**示例：**
```python
workflow = DeepSearchWorkflow(llm_provider=llm, search_engine="mock")
result = workflow.execute("人工智能发展")
print(result["final_report"])
```

##### get_metrics() -> Dict[str, Any]

获取当前监控指标。

**返回值：**
```python
{
    "execution_time": float,    # 执行时间（秒）
    "search_count": int,        # 搜索次数
    "loop_count": int,          # 循环次数
    "success_rate": float,      # 成功率
    "token_usage": int,         # Token 使用量
    "error_count": int          # 错误次数
}
```

##### reset_metrics()

重置监控指标。

### 2. QueryGeneratorAgent

查询生成智能体，负责生成搜索查询。

#### 构造函数

```python
QueryGeneratorAgent(organization_id: str = "deepsearch")
```

#### 主要方法

##### generate_initial_queries(research_topic: str, num_queries: int = 3) -> str

生成初始搜索查询的提示词。

**参数：**
- `research_topic`: 研究主题
- `num_queries`: 要生成的查询数量，默认 3

**返回值：** 格式化的提示词字符串

##### generate_followup_queries(research_topic: str, previous_findings: str, knowledge_gaps: str, num_queries: int = 2) -> str

生成后续搜索查询的提示词。

**参数：**
- `research_topic`: 研究主题
- `previous_findings`: 已有发现
- `knowledge_gaps`: 知识空白
- `num_queries`: 要生成的查询数量，默认 2

**返回值：** 格式化的提示词字符串

### 3. ResearchSummarizerAgent

研究总结智能体，负责执行搜索、总结和撰写报告。

#### 构造函数

```python
ResearchSummarizerAgent(organization_id: str = "deepsearch")
```

#### 主要方法

##### create_search_and_summarize_prompt(query: str, research_topic: str) -> str

创建搜索和总结的提示词。

**参数：**
- `query`: 搜索查询
- `research_topic`: 研究主题

**返回值：** 格式化的提示词字符串

##### create_reflection_prompt(research_topic: str, all_summaries: list) -> str

创建反思和知识空白分析的提示词。

**参数：**
- `research_topic`: 研究主题
- `all_summaries`: 所有搜索结果的总结列表

**返回值：** 格式化的提示词字符串

##### create_final_report_prompt(research_topic: str, all_summaries: list) -> str

创建最终报告的提示词。

**参数：**
- `research_topic`: 研究主题
- `all_summaries`: 所有搜索结果的总结列表

**返回值：** 格式化的提示词字符串

### 4. 搜索工具

#### GoogleSearchTool

Google 搜索工具，封装了对 Google Search API 的调用。

**构造函数：**
```python
GoogleSearchTool(api_key: Optional[str] = None, config: Optional[Dict[str, Any]] = None)
```

**参数：**
- `api_key`: Google API Key（如果未提供则从环境变量获取）
- `config`: 额外的配置参数

#### MockGoogleSearchTool

模拟 Google 搜索工具，用于测试。

**构造函数：**
```python
MockGoogleSearchTool()
```

## 配置说明

### config.yaml 配置参数

#### LLM 配置
```yaml
llm:
  provider: openai          # LLM 提供者
  model: gpt-4.1           # 模型名称
  api_key: ${OPENAI_API_KEY}  # API 密钥
  base_url: ${OPENAI_API_BASE}  # 基础URL（支持代理）
  temperature: 0.7         # 温度参数
  max_tokens: 2000         # 最大Token数
```

#### 搜索引擎配置
```yaml
google_search:
  api_key: ${GOOGLE_API_KEY}  # Google API 密钥
  fallback_api_key: ${GEMINI_API_KEY}  # 备用API密钥

bing_search:
  subscription_key: ${BING_SUBSCRIPTION_KEY}  # Bing 订阅密钥
  endpoint: https://api.bing.microsoft.com/v7.0/search
  market: zh-CN
  safe_search: Moderate
  count: 10
```

#### 深度搜索配置
```yaml
deep_search:
  max_research_loops: 3    # 最大研究循环次数
  initial_query_count: 3   # 初始查询数量
  followup_query_count: 2  # 后续查询数量
  search_engine: google    # 搜索引擎选择
```

#### 监控配置
```yaml
monitoring:
  enabled: true
  metrics:
    - execution_time
    - search_count
    - loop_count
    - success_rate
    - token_usage
```

## 错误处理

### 重试机制

工作流中的搜索操作使用 `tenacity` 库实现重试机制：

- 最大重试次数：3次
- 重试间隔：指数退避（1-10秒）
- 重试条件：网络错误、超时、值错误

### 错误记录

工作流会记录执行过程中的所有错误：

```python
{
    "errors": [
        {
            "loop": 1,
            "error": "Connection timeout",
            "timestamp": 1640995200.0
        }
    ]
}
```

## 监控指标

### 执行指标

- `execution_time`: 总执行时间（秒）
- `search_count`: 搜索次数
- `loop_count`: 循环次数
- `success_rate`: 成功率（0-1）
- `token_usage`: Token 使用量
- `error_count`: 错误次数

### 日志记录

工作流会自动记录详细的执行日志到 `deepsearch.log` 文件，包括：

- 执行开始和结束时间
- 每个循环的执行状态
- 错误信息和堆栈跟踪
- 性能指标

## 使用示例

### 基本使用

```python
from agenticx.llms.litellm_provider import LiteLLMProvider
from workflows.deep_search_workflow import DeepSearchWorkflow

# 初始化 LLM 提供者
llm_provider = LiteLLMProvider(
    provider="openai",
    model="gpt-4",
    api_key="your-api-key"
)

# 创建工作流
workflow = DeepSearchWorkflow(
    llm_provider=llm_provider,
    max_research_loops=3,
    search_engine="mock"
)

# 执行研究
result = workflow.execute("人工智能发展")

# 获取结果
print(result["final_report"])
print(result["metrics"])
```

### 自定义配置

```python
# 使用自定义配置文件
workflow = DeepSearchWorkflow(
    llm_provider=llm_provider,
    config_path="custom_config.yaml"
)

# 获取监控指标
metrics = workflow.get_metrics()
print(f"执行时间: {metrics['execution_time']:.2f}秒")
```

## 扩展开发

### 添加新的搜索引擎

1. 在 `tools/` 目录下创建新的搜索工具类
2. 继承 `BaseTool` 类
3. 实现 `_run()` 方法
4. 在 `DeepSearchWorkflow._initialize_search_tool()` 中添加新的分支

### 添加新的智能体

1. 在 `agents/` 目录下创建新的智能体类
2. 继承 `Agent` 类
3. 定义角色、目标和工具
4. 在工作流中集成新的智能体

### 自定义监控指标

1. 在 `DeepSearchWorkflow` 的 `metrics` 字典中添加新指标
2. 在相应的方法中更新指标值
3. 在 `get_metrics()` 方法中返回新指标 