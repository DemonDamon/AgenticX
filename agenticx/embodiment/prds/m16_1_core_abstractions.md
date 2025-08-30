### M16.1: 核心抽象层 (`agenticx.embodiment.core`)

> 启发来源: AgenticX Agent架构和GUI操作抽象化需求

* `GUIAgent(Agent)`: 继承AgenticX Agent，扩展GUI操作能力

  * `async execute_gui_task(self, task: GUITask) -> GUIAgentResult`: 执行GUI任务的主入口

  * `take_screenshot(self) -> ScreenState`: 获取当前屏幕状态

  * `analyze_screen(self, screenshot: bytes) -> List[InteractionElement]`: 分析屏幕元素

  * `execute_action(self, action: GUIAction) -> ActionResult`: 执行GUI动作

* `GUIAgentContext(AgentContext)`: GUI Agent执行上下文

  * `screen_history: List[ScreenState]`: 屏幕状态历史

  * `action_history: List[GUIAction]`: 动作执行历史

  * `current_app: str`: 当前操作的应用

  * `task_progress: float`: 任务完成进度

* `GUIAgentResult(AgentResult)`: GUI Agent执行结果

  * `action_sequence: List[GUIAction]`: 执行的动作序列

  * `final_screenshot: bytes`: 最终屏幕截图

  * `success_rate: float`: 任务成功率

  * `execution_time: float`: 执行时间

* `GUIEnvironment(ABC)`: GUI环境抽象基类

  * `@abstractmethod reset(self) -> ScreenState`: 重置环境状态

  * `@abstractmethod step(self, action: GUIAction) -> Tuple[ScreenState, float, bool, dict]`: 执行动作并返回新状态

  * `@abstractmethod get_action_space(self) -> ActionSpace`: 获取可用动作空间

  * `@abstractmethod is_terminal(self) -> bool`: 判断是否到达终止状态

* `ActionSpace(BaseModel)`: 统一动作空间定义

  * `click_actions: List[ClickAction]`: 点击动作列表

  * `swipe_actions: List[SwipeAction]`: 滑动动作列表

  * `input_actions: List[InputAction]`: 输入动作列表

  * `wait_actions: List[WaitAction]`: 等待动作列表

  * `validate_action(self, action: GUIAction) -> bool`: 验证动作有效性

* `GUIAction(BaseModel)`: GUI动作数据模型

  * `action_type: ActionType`: 动作类型枚举

  * `target_element: Optional[InteractionElement]`: 目标元素

  * `parameters: Dict[str, Any]`: 动作参数

  * `timestamp: datetime`: 执行时间戳

  * `to_platform_action(self, platform: str) -> PlatformAction`: 转换为平台特定动作

* `ScreenState(BaseModel)`: 屏幕状态数据模型

  * `screenshot: bytes`: 屏幕截图数据

  * `element_tree: ElementTree`: UI元素层次结构

  * `interactive_elements: List[InteractionElement]`: 可交互元素列表

  * `ocr_text: str`: OCR识别的文本内容

  * `state_hash: str`: 状态唯一标识

* `InteractionElement(BaseModel)`: 交互元素数据模型

  * `element_id: str`: 元素唯一标识

  * `bounds: BoundingBox`: 元素边界框

  * `element_type: ElementType`: 元素类型

  * `text_content: Optional[str]`: 文本内容

  * `attributes: Dict[str, str]`: 元素属性

  * `is_clickable(self) -> bool`: 判断是否可点击

  * `is_editable(self) -> bool`: 判断是否可编辑