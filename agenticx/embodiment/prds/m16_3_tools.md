### M16.3: GUI 工具 (`agenticx.embodiment.tools`)

> 启发来源: `agenticx.core.tool`, Playwright/Selenium 的面向对象工具设计

#### 1. 核心设计原则

1.  **标准化**: 所有 GUI 交互都必须封装为 `agenticx.core.tool.BaseTool` 的子类，共享统一的接口和生命周期。
2.  **原子性**: 每个工具代表一个逻辑上不可分割的原子操作 (如 `click`, `type`)。
3.  **声明式参数**: 工具的输入参数必须通过 Pydantic 的 `BaseModel` 进行严格定义，确保类型安全和可验证性。
4.  **平台解耦**: 工具的定义应与具体实现平台 (如 Web, macOS, Windows) 解耦。平台相关的执行逻辑由注入的 `PlatformAdapter` 处理。
5.  **可组合性**: 复杂的 GUI 操作通过 `agenticx.core.workflow.Workflow` 将多个原子工具组合起来完成。

#### 2. 工具基类和返回结构

*   `GUIActionTool(agenticx.core.tool.BaseTool)`: 所有 GUI 动作工具的抽象基类。
    *   `platform_adapter: BasePlatformAdapter`: 在运行时注入的平台适配器实例。
    *   `async def _arun(self, **kwargs) -> ToolResult`: 工具的异步执行逻辑。它调用 `platform_adapter` 来执行实际的平台操作。

*   `ToolResult(BaseModel)`: 所有 `GUIActionTool` 的标准返回模型。
    *   `status: Literal["success", "failure"]`: 操作是否成功。
    *   `new_screen_state: Optional[ScreenState]`: 操作执行后新的屏幕状态。如果操作失败或不改变屏幕，则为 `None`。
    *   `error_message: Optional[str]`: 如果 `status` 为 `failure`，则包含错误信息。
    *   `observation: str`: 对操作结果的自然语言描述，例如 "成功点击了'登录'按钮"。

#### 3. 核心 GUI 工具定义

*   `ClickTool(GUIActionTool)`: **点击工具**
    *   `name = "gui_click"`
    *   `description = "在指定的 UI 元素上执行点击操作。"`
    *   `args_schema: Type[ClickArgs] = ClickArgs`
        *   `class ClickArgs(BaseModel)`:
            *   `element_query: str`: 描述目标元素的自然语言查询，例如 "靠近'用户名'标签的输入框"。
            *   `element_id: Optional[str] = None`: (可选) 如果元素 ID 已知，可直接提供以跳过视觉定位。

*   `TypeTool(GUIActionTool)`: **输入文本工具**
    *   `name = "gui_type"`
    *   `description = "在当前聚焦的或指定的 UI 元素中输入文本。"`
    *   `args_schema: Type[TypeArgs] = TypeArgs`
        *   `class TypeArgs(BaseModel)`:
            *   `text: str`: 要输入的文本。
            *   `element_query: Optional[str] = None`: (可选) 指定在哪个元素中输入。如果为 `None`，则在当前聚焦的元素中输入。

*   `ScrollTool(GUIActionTool)`: **滚动工具**
    *   `name = "gui_scroll"`
    *   `description = "在指定的方向上滚动屏幕或可滚动元素。"`
    *   `args_schema: Type[ScrollArgs] = ScrollArgs`
        *   `class ScrollArgs(BaseModel)`:
            *   `direction: Literal["up", "down", "left", "right"]`: 滚动方向。
            *   `element_query: Optional[str] = None`: (可选) 在指定的可滚动元素内滚动。如果为 `None`，则滚动整个视图。

*   `ScreenshotTool(GUIActionTool)`: **截屏工具**
    *   `name = "gui_screenshot"`
    *   `description = "获取当前屏幕的截图。"`
    *   `args_schema: Type[BaseModel] = BaseModel` (无参数)

*   `GetElementTreeTool(GUIActionTool)`: **获取元素树工具**
    *   `name = "gui_get_element_tree"`
    *   `description = "获取当前屏幕的 UI 元素层次结构。"`
    *   `args_schema: Type[BaseModel] = BaseModel` (无参数)

#### 4. 平台适配器 (`PlatformAdapter`)

*   `BasePlatformAdapter(ABC)`: 平台适配器的抽象基类，定义了所有 `GUIActionTool` 所需的底层操作接口。
    *   `@abstractmethod
    async def click(self, element_id: str) -> None:`
    *   `@abstractmethod
    async def type(self, text: str, element_id: Optional[str] = None) -> None:`
    *   `... (其他方法的定义)`

*   `WebPlatformAdapter(BasePlatformAdapter)`: 针对 Web 平台的具体实现，内部可能使用 Playwright。
*   `MacOSPlatformAdapter(BasePlatformAdapter)`: 针对 macOS 平台的具体实现，内部可能使用 `pyobjc` 或其他原生 API。

#### 5. 与 `agenticx` 核心集成

*   **ToolExecutor**: `GUIAgent` 的 `ToolExecutor` 在初始化时，会根据目标平台 (例如，从 `GUITask` 中获取) 实例化对应的 `PlatformAdapter`，并将其注入到所有 `GUIActionTool` 实例中。
*   **Agent LLM Call**: `GUIAgent` 的大模型会根据当前目标和 `GUIAgentContext` 来决定调用哪个 `GUIActionTool` 以及传递什么参数 (`element_query` 等)。