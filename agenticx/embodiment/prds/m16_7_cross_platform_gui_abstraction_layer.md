### M16.7: 平台适配器 (`agenticx.embodiment.platform`)

> 启发来源: Appium, Playwright 等跨平台测试框架

* `PlatformAdapter(ABC)`: 平台适配器抽象基类

  * `@abstractmethod
    def setup(self, config: PlatformConfig) -> None`: 初始化

  * `@abstractmethod
    def teardown(self) -> None`: 清理

  * `@abstractmethod
    def take_screenshot(self) -> bytes`: 截屏

  * `@abstractmethod
    def perform_action(self, action: CrossPlatformAction) -> ActionResult`: 执行动作

  * `@abstractmethod
    def get_element_tree(self) -> ElementTree`: 获取元素树

* `AndroidAdapter(PlatformAdapter)`: 安卓适配器

  * `_execute_adb_command(self, command: str) -> str`: 执行 ADB 命令

* `IOSAdapter(PlatformAdapter)`: iOS 适配器

  * `_execute_wda_command(self, command: str) -> str`: 执行 WDA 命令

* `WebAdapter(PlatformAdapter)`: Web 适配器

  * `_execute_selenium_command(self, command: str) -> str`: 执行 Selenium 命令

* `DesktopAdapter(PlatformAdapter)`: 桌面适配器

  * `_execute_pyautogui_command(self, command: str) -> str`: 执行 PyAutoGUI 命令

* `DeviceManager(Component)`: 设备管理器

  * `list_devices(self) -> List[Device]`: 列出设备

  * `connect_device(self, device_id: str) -> DeviceHandle`: 连接设备

  * `disconnect_device(self, device_handle: DeviceHandle) -> None`: 断开设备

* `ScreenCapture(Component)`: 屏幕捕获器

  * `capture_full_screen(self) -> bytes`: 捕获全屏

  * `capture_region(self, region: BoundingBox) -> bytes`: 捕获区域

* `InputMethod(Component)`: 输入法

  * `type_text(self, text: str) -> None`: 输入文本

  * `tap(self, x: int, y: int) -> None`: 点击

  * `swipe(self, start_x: int, start_y: int, end_x: int, end_y: int, duration: int) -> None`: 滑动

* `ElementInspector(Component)`: 元素检查器

  * `get_element_at(self, x: int, y: int) -> InteractionElement`: 获取指定位置元素

  * `get_all_elements(self) -> List[InteractionElement]`: 获取所有元素

* **配置模型**

  * `PlatformConfig(BaseModel)`: 平台配置

  * `DeviceCapabilities(BaseModel)`: 设备能力

  * `CrossPlatformAction(BaseModel)`: 跨平台动作