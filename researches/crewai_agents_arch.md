# CrewAI Agents 架构类图

基于对 CrewAI agents 模块的分析，以下是详细的 PlantUML 类图：

```plantuml
@startuml CrewAI_Agents_Architecture

!theme plain
skinparam classAttributeIconSize 0
skinparam classFontSize 12
skinparam packageStyle rectangle

package "crewai.agents" {
    
    ' 核心解析器相关类
    class AgentAction {
        +thought: str
        +tool: str
        +tool_input: str
        +text: str
        +result: str
        --
        +__init__(thought: str, tool: str, tool_input: str, text: str)
    }
    
    class AgentFinish {
        +thought: str
        +output: str
        +text: str
        --
        +__init__(thought: str, output: str, text: str)
    }
    
    class OutputParserException {
        +error: str
        --
        +__init__(error: str)
    }
    
    class CrewAgentParser {
        -_i18n: I18N
        +agent: Any
        --
        +__init__(agent: Optional[Any])
        +{static} parse_text(text: str): Union[AgentAction, AgentFinish]
        +parse(text: str): Union[AgentAction, AgentFinish]
        -_extract_thought(text: str): str
        -_clean_action(text: str): str
        -_safe_repair_json(tool_input: str): str
    }
    
    ' 缓存处理器
    class CacheHandler {
        ' 从__init__.py导入，具体实现在cache/cache_handler.py
        ' 缓存相关的方法和属性
    }
    
    ' 工具处理器
    class ToolsHandler {
        ' 从__init__.py导入，具体实现在tools_handler.py
        ' 工具管理相关的方法和属性
    }
    
    ' 代理执行器
    class CrewAgentExecutor {
        ' 具体实现在crew_agent_executor.py
        ' 代理执行相关的方法和属性
    }
    
}

package "crewai.agents.cache" {
    class CacheHandler {
        ' 缓存处理的具体实现
    }
}

package "crewai.agents.agent_builder" {
    ' 代理构建器相关类
    class AgentBuilder {
        ' 代理构建逻辑
    }
}

package "crewai.agents.agent_adapters" {
    ' 代理适配器相关类
    class AgentAdapter {
        ' 代理适配逻辑
    }
}

' 关系定义
CrewAgentParser --> AgentAction : creates
CrewAgentParser --> AgentFinish : creates
CrewAgentParser --> OutputParserException : throws

Exception <|-- OutputParserException

' 常量定义
note top of CrewAgentParser
  常量:
  - FINAL_ANSWER_ACTION = "Final Answer:"
  - MISSING_ACTION_AFTER_THOUGHT_ERROR_MESSAGE
  - MISSING_ACTION_INPUT_AFTER_ACTION_ERROR_MESSAGE
  - FINAL_ANSWER_AND_PARSABLE_ACTION_ERROR_MESSAGE
end note

note right of AgentAction
  表示代理执行的动作
  包含思考过程、工具选择
  和工具输入参数
end note

note right of AgentFinish
  表示代理完成任务
  包含最终答案和输出
end note

note right of CrewAgentParser
  解析ReAct风格的LLM输出
  支持两种格式:
  1. Action格式 -> AgentAction
  2. Final Answer格式 -> AgentFinish
end note

@enduml
```

## 架构说明

### 核心组件

1. **CrewAgentParser**: 
   - 核心解析器，负责解析LLM的ReAct风格输出
   - 支持静态方法 `parse_text()` 进行文本解析
   - 包含JSON修复和错误处理机制

2. **AgentAction**: 
   - 表示代理需要执行的动作
   - 包含思考过程、工具名称、工具输入和原始文本

3. **AgentFinish**: 
   - 表示代理任务完成
   - 包含最终思考、输出结果和原始文本

4. **OutputParserException**: 
   - 解析异常处理类
   - 用于处理格式错误和解析失败的情况

### 解析流程

1. **输入**: LLM生成的ReAct格式文本
2. **解析**: CrewAgentParser分析文本结构
3. **输出**: 根据内容返回AgentAction或AgentFinish对象

### 支持的格式

#### Action格式:
```
Thought: agent thought here
Action: search
Action Input: what is the temperature in SF?
```

#### Final Answer格式:
```
Thought: agent thought here
Final Answer: The temperature is 100 degrees
```

### 模块导出

从 `__init__.py` 可以看出，主要导出的类包括：
- `CacheHandler`: 缓存处理
- `CrewAgentParser`: 核心解析器
- `ToolsHandler`: 工具处理

### 错误处理

解析器包含完善的错误处理机制：
- 缺少Action的错误
- 缺少Action Input的错误
- 同时包含Action和Final Answer的错误
- JSON修复功能

这个架构体现了CrewAI对代理行为解析的精细化处理，确保了LLM输出的正确解析和执行。
