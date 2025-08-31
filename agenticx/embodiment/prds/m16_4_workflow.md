### M16.4: GUI 任务工作流 (`agenticx.embodiment.workflow`)

> 启发来源: `agenticx.core.workflow`, LangGraph, CrewAI

#### 1. 核心设计原则

1.  **代码优先 (Code-First)**: 优先使用 Pythonic DSL (领域特定语言) 来定义工作流，使其具有更高的灵活性和表现力，同时支持从 YAML 等格式加载。
2.  **基于图 (Graph-Based)**: 工作流被定义为一个有向图，其中节点代表 `Tool` 调用或 `Component` 逻辑，边代表控制流。
3.  **状态驱动**: 工作流的执行由共享的 `GUIAgentContext` 状态驱动。每个节点接收当前的上下文，执行其逻辑，并更新上下文，然后传递给下一个节点。
4.  **可观察性与可调试性**: 工作流的每一步执行都应被记录，包括节点输入、输出、状态变更和错误，以便于监控和调试。

#### 2. 核心组件

*   `GUIWorkflow(agenticx.core.workflow.Workflow)`: GUI 任务工作流的表示。
    *   `graph: DiGraph`: 工作流的图结构，使用 `networkx` 或类似的库来表示。
    *   `entry_point: str`: 图的入口节点名称。
    *   `state_schema: Type[GUIAgentContext]`: 定义了此工作流所操作的状态对象的模型。

*   `WorkflowEngine(agenticx.core.component.Component)`: 负责执行工作流的引擎。
    *   `async def arun(self, workflow: GUIWorkflow, initial_context: GUIAgentContext) -> GUIAgentResult`: 接收一个工作流和初始上下文，并从入口节点开始执行，直到到达终点或发生无法处理的错误。

#### 3. 工作流定义示例 (Pythonic DSL)

下面是一个使用 Pythonic DSL 定义的 "登录" 工作流示例，它比 YAML 更具表现力。

```python
from agenticx.core.workflow import WorkflowBuilder
from agenticx.embodiment.core import GUIAgentContext

# 定义工作流状态
class LoginState(GUIAgentContext):
    username: str
    password: str
    error_count: int = 0

# 创建工作流构建器
builder = WorkflowBuilder(state_schema=LoginState)

# 定义节点 (每个节点都是一个函数或 Component)
def enter_username(state: LoginState) -> LoginState:
    # 调用 TypeTool
    tool_result = agent.tool_executor.execute("gui_type", text=state.username, element_query="username input")
    state.action_history.append(tool_result)
    return state

def enter_password(state: LoginState) -> LoginState:
    # 调用 TypeTool
    tool_result = agent.tool_executor.execute("gui_type", text=state.password, element_query="password input")
    state.action_history.append(tool_result)
    return state

def click_login(state: LoginState) -> LoginState:
    # 调用 ClickTool
    tool_result = agent.tool_executor.execute("gui_click", element_query="login button")
    state.action_history.append(tool_result)
    return state

# 将节点添加到工作流
builder.add_node("enter_username", enter_username)
builder.add_node("enter_password", enter_password)
builder.add_node("click_login", click_login)

# 定义边的连接关系
builder.set_entry_point("enter_username")
builder.add_edge("enter_username", "enter_password")
builder.add_edge("enter_password", "click_login")
builder.add_conditional_edge(
    "click_login",
    lambda state: "dashboard" in state.screen_history[-1].ocr_text, # 检查是否登录成功
    "end", # 成功则结束
    "handle_error" # 失败则进入错误处理
)

# 构建工作流
login_workflow = builder.build(name="gui_login_workflow")
```

#### 4. 与 `agenticx` 核心集成

*   **GUIAgent**: `GUIAgent` 可以根据 `GUITask` 的描述，从内存中检索一个预先存在的 `GUIWorkflow` (由 `DeepUsageOptimizer` 创建) 并执行它，或者在没有合适工作流时，通过 LLM 动态地执行一系列 `Tool` 调用。
*   **ToolExecutor**: 工作流中的节点可以直接访问并使用 `GUIAgent` 的 `ToolExecutor` 来调用 `GUIActionTool`。
*   **Context Management**: `WorkflowEngine` 负责创建和管理 `GUIAgentContext` 的生命周期，确保每个节点都能访问到最新的状态，并将最终结果持久化到内存中。
*   **Learning Integration**: 工作流的执行结果 (`GUIAgentResult`) 是 `KnowledgeEvolution` 组件的关键输入，用于触发对工作流本身的优化 (`DeepUsageOptimizer`) 或对失败的反思 (`EdgeCaseHandler`)。