"""AgenticX M16.1: GUI环境抽象类测试

测试GUI环境抽象类的功能，包括：
- 环境配置和状态
- 连接管理
- 动作执行
- 状态获取
- 元素查找
"""

import unittest
import time
from unittest.mock import Mock, patch
from typing import List, Optional, Dict, Any

from ..environment import GUIEnvironment, EnvironmentConfig, EnvironmentState
from ..models import (
    ActionType,
    ElementType,
    BoundingBox,
    InteractionElement,
    ElementTree,
    ScreenState,
    GUIAction,
    ActionSpace
)


class MockGUIEnvironment(GUIEnvironment):
    """用于测试的模拟GUI环境实现"""
    
    def __init__(self, config: EnvironmentConfig):
        super().__init__(config)
        self._mock_connected = False
        self._mock_screen_state = None
        self._mock_screenshot_data = b"mock_screenshot_data"
        self._mock_device_info = {
            "platform": "mock",
            "version": "1.0",
            "screen_size": (400, 800),
            "density": 2.0
        }
    
    def _create_action_space(self) -> ActionSpace:
        """创建模拟动作空间"""
        return ActionSpace(
            supported_actions=[
                ActionType.CLICK,
                ActionType.TYPE,
                ActionType.SCROLL,
                ActionType.SCREENSHOT,
                ActionType.BACK
            ],
            platform="mock"
        )
    
    async def connect(self) -> bool:
        """模拟连接"""
        await super().connect()
        self._mock_connected = True
        return True
    
    async def disconnect(self) -> bool:
        """模拟断开连接"""
        self._mock_connected = False
        return True
    
    async def get_screen_state(self, include_screenshot: bool = True) -> ScreenState:
        """模拟获取屏幕状态"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        if self._mock_screen_state is None:
            # 创建默认的屏幕状态
            root_element = InteractionElement(
                element_id="root",
                element_type=ElementType.CONTAINER,
                bounds=BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
            )
            
            button_element = InteractionElement(
                element_id="btn1",
                element_type=ElementType.BUTTON,
                bounds=BoundingBox(x=50.0, y=100.0, width=100.0, height=50.0),
                text="Test Button",
                clickable=True,
                enabled=True
            )
            
            tree = ElementTree(root_element=root_element)
            tree.add_element(button_element, parent_id="root")
            
            self._mock_screen_state = ScreenState(
                timestamp=time.time(),
                screen_size=(400, 800),
                orientation="portrait",
                element_tree=tree,
                platform="mock"
            )
        
        return self._mock_screen_state
    
    async def execute_action(self, action: GUIAction) -> Dict[str, Any]:
        """模拟执行动作"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        if not action.validate():
            return {"success": False, "error": "Invalid action"}
        
        # 模拟动作执行
        if action.action_type in [ActionType.CLICK, ActionType.TYPE, ActionType.SCROLL, ActionType.SCREENSHOT, ActionType.BACK]:
            return {"success": True, "message": f"Executed {action.action_type.value}"}
        else:
            return {"success": False, "error": "Unsupported action type"}
    
    async def take_screenshot(self, save_path: Optional[str] = None) -> str:
        """模拟截图"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        if save_path is None:
            save_path = f"mock_screenshot_{int(time.time())}.png"
        
        # 模拟保存截图文件
        return save_path
    
    async def find_elements(self, **criteria) -> List[InteractionElement]:
        """模拟查找元素"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        screen_state = await self.get_screen_state()
        elements = []
        
        # 简单的查找逻辑
        for element in screen_state.element_tree.elements.values():
            match = True
            for key, value in criteria.items():
                if key == "element_id" and element.element_id != value:
                    match = False
                    break
                elif key == "element_type" and element.element_type != value:
                    match = False
                    break
                elif key == "text" and element.text != value:
                    match = False
                    break
            if match:
                elements.append(element)
        
        return elements
    
    async def find_element(self, element_id: str) -> Optional[InteractionElement]:
        """模拟查找单个元素"""
        elements = await self.find_elements(element_id=element_id)
        return elements[0] if elements else None
    
    async def wait_for_element(
        self,
        element_id: str,
        timeout: float = 10.0
    ) -> Optional[InteractionElement]:
        """模拟等待元素"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        # 简单模拟：直接查找元素
        return await self.find_element(element_id)
    
    def is_element_visible(self, element: InteractionElement) -> bool:
        """模拟检查元素可见性"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        
        return element is not None and element.visible
    
    async def get_device_info(self) -> Dict[str, Any]:
        """模拟获取设备信息"""
        if not self._mock_connected:
            raise RuntimeError("Environment not connected")
        return self._mock_device_info.copy()


class TestEnvironmentConfig(unittest.TestCase):
    """测试EnvironmentConfig类"""
    
    def test_config_creation(self):
        """测试配置创建"""
        config = EnvironmentConfig(
            platform="android",
            device_id="emulator-5554",
            app_package="com.example.app",
            timeout=30.0,
            retry_count=3
        )
        
        self.assertEqual(config.platform, "android")
        self.assertEqual(config.device_id, "emulator-5554")
        self.assertEqual(config.app_package, "com.example.app")
        self.assertEqual(config.timeout, 30.0)
        self.assertEqual(config.retry_count, 3)
    
    def test_config_defaults(self):
        """测试默认配置"""
        config = EnvironmentConfig(platform="android")
        
        self.assertEqual(config.timeout, 30.0)
        self.assertEqual(config.retry_count, 3)
        self.assertIsNone(config.device_id)
        self.assertIsNone(config.app_package)


class TestEnvironmentState(unittest.TestCase):
    """测试EnvironmentState类"""
    
    def test_state_creation(self):
        """测试状态创建"""
        state = EnvironmentState(
            is_connected=True,
            error_count=1
        )
        
        self.assertTrue(state.is_connected)
        self.assertEqual(state.error_count, 1)
    
    def test_state_defaults(self):
        """测试默认状态"""
        state = EnvironmentState()
        
        self.assertFalse(state.is_connected)
        self.assertEqual(state.error_count, 0)
        self.assertIsNone(state.session_start_time)


class TestGUIEnvironment(unittest.TestCase):
    """测试GUIEnvironment抽象类"""
    
    def setUp(self):
        """设置测试数据"""
        self.config = EnvironmentConfig(
            platform="mock",
            device_id="test-device",
            timeout=5.0
        )
        self.env = MockGUIEnvironment(self.config)
    
    def test_initialization(self):
        """测试初始化"""
        self.assertEqual(self.env.config, self.config)
        self.assertFalse(self.env.is_connected())
        self.assertIsNotNone(self.env.action_space)
        self.assertEqual(len(self.env.action_history), 0)
    
    async def test_connection_lifecycle(self):
        """测试连接生命周期"""
        # 初始状态：未连接
        self.assertFalse(self.env.is_connected)
        
        # 连接
        result = await self.env.connect()
        self.assertTrue(result)
        self.assertTrue(self.env.is_connected)
        
        # 断开连接
        await self.env.disconnect()
        self.assertFalse(self.env.is_connected)
    
    async def test_screen_state_retrieval(self):
        """测试屏幕状态获取"""
        # 未连接时应该抛出异常
        with self.assertRaises(RuntimeError):
            await self.env.get_screen_state()
        
        # 连接后应该能获取状态
        await self.env.connect()
        screen_state = await self.env.get_screen_state()
        
        self.assertIsInstance(screen_state, ScreenState)
        self.assertEqual(screen_state.screen_size, (400, 800))
        self.assertEqual(screen_state.platform, "mock")
    
    async def test_action_execution(self):
        """测试动作执行"""
        await self.env.connect()
        
        # 有效动作
        valid_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        
        result = await self.env.execute_action_safe(valid_action)
        self.assertTrue(result)
        
        # 检查动作历史
        self.assertEqual(len(self.env.action_history), 1)
        self.assertEqual(self.env.action_history[0], valid_action)
        
        # 无效动作
        invalid_action = GUIAction(action_type=ActionType.CLICK)  # 缺少目标
        
        result = await self.env.execute_action_safe(invalid_action)
        self.assertFalse(result.get("success", False))
    
    async def test_action_sequence_execution(self):
        """测试动作序列执行"""
        await self.env.connect()
        
        actions = [
            GUIAction(action_type=ActionType.CLICK, target_element_id="btn1"),
            GUIAction(action_type=ActionType.WAIT, duration=1.0),
            GUIAction(action_type=ActionType.SCREENSHOT)
        ]
        
        results = await self.env.execute_action_sequence(actions)
        
        self.assertEqual(len(results), 3)
        self.assertTrue(all(result.get("success", False) for result in results))
        self.assertEqual(len(self.env.action_history), 3)
    
    async def test_element_operations(self):
        """测试元素操作"""
        await self.env.connect()
        
        # 查找元素
        elements = await self.env.find_elements(element_id="btn1")
        self.assertGreater(len(elements), 0)
        element = elements[0]
        self.assertEqual(element.element_id, "btn1")
        
        # 查找不存在的元素
        missing_elements = await self.env.find_elements(element_id="nonexistent")
        self.assertEqual(len(missing_elements), 0)
        missing_element = None
        
        # 检查元素可见性
        if element:
            is_visible = self.env.is_element_visible(element)
            self.assertTrue(is_visible)
        
        # 测试不存在元素的可见性
        if missing_element is None:
            # 创建一个不可见的元素用于测试
            invisible_element = InteractionElement(
                element_id="invisible",
                element_type=ElementType.BUTTON,
                bounds=BoundingBox(x=0.0, y=0.0, width=0.0, height=0.0),
                visible=False
            )
            is_visible_missing = self.env.is_element_visible(invisible_element)
            self.assertFalse(is_visible_missing)
    
    async def test_screenshot(self):
        """测试截图"""
        await self.env.connect()
        
        screenshot = await self.env.take_screenshot()
        self.assertIsInstance(screenshot, bytes)
        self.assertEqual(screenshot, b"mock_screenshot_data")
    
    async def test_device_info(self):
        """测试设备信息获取"""
        await self.env.connect()
        
        device_info = await self.env.get_device_info()
        self.assertIsInstance(device_info, dict)
        self.assertEqual(device_info["platform"], "mock")
        self.assertEqual(device_info["screen_size"], (400, 800))
    
    def test_action_validation(self):
        """测试动作验证"""
        # 有效动作
        valid_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        is_valid, _ = self.env.validate_action(valid_action)
        self.assertTrue(is_valid)
        
        # 无效动作
        invalid_action = GUIAction(action_type=ActionType.CLICK)
        is_valid, error_msg = self.env.validate_action(invalid_action)
        self.assertFalse(is_valid)
        self.assertIn("invalid", error_msg)
        
        # 不支持的动作类型
        unsupported_action = GUIAction(action_type=ActionType.DRAG)
        is_valid, error_msg = self.env.validate_action(unsupported_action)
        self.assertFalse(is_valid)
        self.assertIn("not supported", error_msg)
    
    async def test_environment_reset(self):
        """测试环境重置"""
        await self.env.connect()
        
        # 执行一些动作
        action = GUIAction(action_type=ActionType.CLICK, target_element_id="btn1")
        await self.env.execute_action_safe(action)
        
        # 检查状态
        self.assertEqual(len(self.env.action_history), 1)
        
        # 重置环境
        success = await self.env.reset()
        self.assertTrue(success)
        
        # 检查重置后的状态
        self.assertEqual(len(self.env.action_history), 0)
        self.assertEqual(self.env.state.error_count, 0)
    
    def test_statistics(self):
        """测试统计信息"""
        stats = self.env.get_statistics()
        
        self.assertIsInstance(stats, dict)
        self.assertIn("total_actions", stats)
        self.assertIn("error_count", stats)
        self.assertIn("session_duration", stats)
        self.assertIn("is_connected", stats)
        self.assertIn("platform", stats)
        
        # 初始状态的统计
        self.assertEqual(stats["total_actions"], 0)
        self.assertEqual(stats["error_count"], 0)
        self.assertEqual(stats["platform"], "mock")
    
    def test_context_manager(self):
        """测试上下文管理器"""
        async def test_context():
            # 初始状态应该是未连接
            self.assertFalse(self.env.is_connected())
            
            async with self.env:
                # 在上下文中应该是连接状态
                self.assertTrue(self.env.is_connected())
            
            # 退出上下文后应该是未连接状态
            self.assertFalse(self.env.is_connected())
        
        # 运行异步测试
        import asyncio
        asyncio.run(test_context())


if __name__ == '__main__':
    # 运行异步测试
    import asyncio
    
    class AsyncTestRunner:
        def __init__(self, test_case):
            self.test_case = test_case
        
        def run_async_test(self, test_method):
            async def wrapper():
                await test_method()
            
            asyncio.run(wrapper())
    
    # 创建测试套件
    suite = unittest.TestSuite()
    
    # 添加同步测试
    suite.addTest(TestEnvironmentConfig('test_config_creation'))
    suite.addTest(TestEnvironmentConfig('test_config_defaults'))
    suite.addTest(TestEnvironmentState('test_state_creation'))
    suite.addTest(TestEnvironmentState('test_state_defaults'))
    suite.addTest(TestGUIEnvironment('test_initialization'))
    suite.addTest(TestGUIEnvironment('test_action_validation'))
    suite.addTest(TestGUIEnvironment('test_statistics'))
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
    
    # 运行异步测试
    print("\n运行异步测试...")
    test_env = TestGUIEnvironment()
    test_env.setUp()
    
    async_runner = AsyncTestRunner(test_env)
    
    try:
        async_runner.run_async_test(test_env.test_connection_lifecycle)
        print("✓ test_connection_lifecycle 通过")
        
        async_runner.run_async_test(test_env.test_screen_state_retrieval)
        print("✓ test_screen_state_retrieval 通过")
        
        async_runner.run_async_test(test_env.test_action_execution)
        print("✓ test_action_execution 通过")
        
        async_runner.run_async_test(test_env.test_action_sequence_execution)
        print("✓ test_action_sequence_execution 通过")
        
        async_runner.run_async_test(test_env.test_element_operations)
        print("✓ test_element_operations 通过")
        
        async_runner.run_async_test(test_env.test_screenshot)
        print("✓ test_screenshot 通过")
        
        async_runner.run_async_test(test_env.test_device_info)
        print("✓ test_device_info 通过")
        
        async_runner.run_async_test(test_env.test_environment_reset)
        print("✓ test_environment_reset 通过")
        
        print("\n所有异步测试通过！")
    except Exception as e:
        print(f"异步测试失败: {e}")