### M16.1: 核心抽象层 (`agenticx.embodiment.core`)

> 启发来源: `agenticx.core` 核心抽象, GUI 操作的特殊需求

* `GUIAgent(agenticx.core.agent.Agent)`: 继承自 `agenticx.core.agent.Agent`，是执行 GUI 自动化任务的核心智能体。
  * **核心组件**:
    * `tool_executor: agenticx.tools.executor.ToolExecutor`: 用于执行 `GUIActionTool`。
    * `memory: agenticx.memory.component.MemoryComponent`: 用于存储和检索任务历史、屏幕状态和学习到的知识。
    * `learning_components: List[agenticx.core.component.Component]`: 一系列用于实现人类对齐学习的组件 (定义于 M16.2)。
  * **核心方法**:
    * `async def arun(self, task: GUITask) -> GUIAgentResult`: 覆盖基类的 `arun` 方法，作为执行单个 GUI 任务的主入口。

* `GUITask(agenticx.core.task.Task)`: 继承自 `agenticx.core.task.Task`，定义一个具体的 GUI 操作任务。
  * `app_name: str`: 任务目标应用程序的名称。
  * `initial_url: Optional[str]`: (对于 Web 应用) 初始 URL。

* `GUIAgentContext(agenticx.core.agent.AgentContext)`: 继承自 `agenticx.core.agent.AgentContext`，为 `GUIAgent` 提供执行期间的上下文信息。
  * `screen_history: List[ScreenState]`: 屏幕状态的历史记录。
  * `action_history: List[GUIAction]`: 已执行的 GUI 动作历史。
  * `current_app_name: str`: 当前正在交互的应用名称。
  * `current_workflow_state: Dict[str, Any]`: (可选) 如果任务由工作流驱动，则存储当前工作流的状态。

* `ScreenState(BaseModel)`: 屏幕状态的数据模型，代表某个时间点的完整 UI 信息。
  * `timestamp: datetime`: 状态捕获时的时间戳。
  * `agent_id: str`: 捕获该状态的 `GUIAgent` 的 ID。
  * `screenshot: bytes`: 屏幕截图的原始数据。
  * `element_tree: Dict[str, Any]`: UI 元素的可序列化层次结构 (例如，以字典形式表示)。
  * `interactive_elements: List[InteractionElement]`: 屏幕上所有可交互元素的列表。
  * `ocr_text: str`: 通过 OCR 从截图中识别出的所有文本。
  * `state_hash: str`: 基于屏幕内容计算出的唯一哈希值，用于快速比较状态。

* `InteractionElement(BaseModel)`: 可交互 UI 元素的数据模型。
  * `element_id: str`: 在当前屏幕状态下的唯一标识符。
  * `bounds: Tuple[int, int, int, int]`: 元素的边界框 `(x1, y1, x2, y2)`。
  * `element_type: str`: 元素的类型 (如 `button`, `input`, `link`)。
  * `text_content: Optional[str]`: 元素的文本内容。
  * `attributes: Dict[str, Any]`: 元素的其他属性 (如 `aria-label`, `class`, `id`)。

* `GUIAgentResult(BaseModel)`: `GUIAgent` 执行任务后的返回结果。
  * `task_id: str`: 完成的任务 ID。
  * `status: Literal["success", "failure", "error"]`: 任务执行状态。
  * `summary: str`: 任务执行过程的摘要。
  * `output: Any`: 任务的最终输出 (例如，提取的数据)。
  * `error_message: Optional[str]`: 如果执行失败，则包含错误信息。