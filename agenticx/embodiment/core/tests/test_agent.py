"""AgenticX M16.1: GUI智能体核心类测试

测试GUI智能体核心类的功能，包括：
- 任务管理
- 智能体上下文
- 执行结果
- 智能体抽象类
"""

import unittest
import time
from unittest.mock import Mock, AsyncMock, patch
from typing import List, Optional, Dict, Any

from ..agent import (
    GUITask,
    TaskStatus,
    TaskPriority,
    ActionResult,
    GUIAgentContext,
    GUIAgentResult,
    GUIAgent
)
from ..environment import GUIEnvironment, EnvironmentConfig
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


class MockGUIAgent(GUIAgent):
    """用于测试的模拟GUI智能体实现"""
    
    def __init__(self, agent_id: str = "test_agent"):
        super().__init__(agent_id)
        self.plan_action_calls = []
        self.select_action_calls = []
        self.evaluate_state_calls = []
        self.check_task_completion_calls = []
        self.handle_error_calls = []
        self.learn_from_experience_calls = []
        
        # 模拟返回值
        self.mock_actions = []
        self.mock_selected_action = None
        self.mock_state_evaluation = {"score": 0.8, "confidence": 0.9}
        self.mock_task_completed = False
        self.mock_error_handled = True
    
    async def plan_actions(
        self,
        context: GUIAgentContext
    ) -> List[GUIAction]:
        """模拟动作规划"""
        self.plan_action_calls.append(context)
        return self.mock_actions.copy()
    
    async def select_action(
        self,
        available_actions: List[GUIAction],
        context: GUIAgentContext
    ) -> Optional[GUIAction]:
        """模拟动作选择"""
        self.select_action_calls.append((available_actions, context))
        return self.mock_selected_action
    
    async def evaluate_state(
        self,
        screen_state: ScreenState,
        context: GUIAgentContext
    ) -> Dict[str, Any]:
        """模拟状态评估"""
        self.evaluate_state_calls.append((screen_state, context))
        return self.mock_state_evaluation.copy()
    
    async def check_task_completion(
        self,
        context: GUIAgentContext
    ) -> bool:
        """模拟任务完成检查"""
        self.check_task_completion_calls.append(context)
        return self.mock_task_completed
    
    async def handle_error(
        self,
        error: Exception,
        context: GUIAgentContext
    ) -> bool:
        """模拟错误处理"""
        self.handle_error_calls.append((error, context))
        return self.mock_error_handled
    
    async def select_next_action(self, context: GUIAgentContext) -> Optional[GUIAction]:
        """选择下一个动作"""
        return self.mock_selected_action
    
    async def learn_from_experience(
        self,
        context: GUIAgentContext,
        result: GUIAgentResult
    ) -> None:
        """模拟经验学习"""
        self.learn_from_experience_calls.append((context, result))


class MockGUIEnvironment(GUIEnvironment):
    """用于测试的模拟GUI环境"""
    
    def __init__(self, config: EnvironmentConfig):
        super().__init__(config)
        self._connected = False
        self._mock_screen_state = None
        self._action_results = {}
        self.action_history = []
    
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
        self._connected = True
        return True
    
    async def disconnect(self) -> bool:
        self._connected = False
        return True
    
    async def get_screen_state(self, include_screenshot: bool = True) -> ScreenState:
        if not self._connected:
            raise RuntimeError("Environment not connected")
        
        if self._mock_screen_state is None:
            # 创建默认屏幕状态
            root_element = InteractionElement(
                element_id="root",
                element_type=ElementType.CONTAINER,
                bounds=BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
            )
            
            tree = ElementTree(root_element=root_element)
            
            self._mock_screen_state = ScreenState(
                timestamp=time.time(),
                screen_size=(400, 800),
                orientation="portrait",
                element_tree=tree
            )
        
        return self._mock_screen_state
    
    async def execute_action(self, action: GUIAction) -> Dict[str, Any]:
        if not self._connected:
            raise RuntimeError("Environment not connected")
        
        # 模拟动作执行结果
        action_key = f"{action.action_type}_{action.target_element_id or 'none'}"
        success = self._action_results.get(action_key, True)
        return {"success": success, "message": f"Executed {action.action_type.value}"}
    
    async def take_screenshot(self, save_path: Optional[str] = None) -> str:
        if save_path is None:
            save_path = f"mock_screenshot_{int(time.time())}.png"
        return save_path
    
    async def find_elements(self, **criteria) -> List[InteractionElement]:
        return []
    
    async def find_element(self, element_id: str) -> Optional[InteractionElement]:
        return None
    
    async def wait_for_element(self, element_id: str, timeout: float = 10.0) -> Optional[InteractionElement]:
        return None
    
    def is_element_visible(self, element: InteractionElement) -> bool:
        return False
    
    async def get_device_info(self) -> Dict[str, Any]:
        return {"platform": "mock", "version": "1.0"}
    
    def set_action_result(self, action_type: ActionType, element_id: str, result: bool):
        """设置动作执行结果"""
        action_key = f"{action_type}_{element_id or 'none'}"
        self._action_results[action_key] = result
    
    def set_screen_state(self, screen_state: ScreenState):
        """设置屏幕状态"""
        self._mock_screen_state = screen_state


class TestGUITask(unittest.TestCase):
    """测试GUITask类"""
    
    def test_task_creation(self):
        """测试任务创建"""
        task = GUITask(
            task_id="task_001",
            description="Click the submit button",
            goal="Submit the form by clicking the submit button",
            priority=TaskPriority.HIGH,
            max_steps=10,
            timeout=30.0
        )
        
        self.assertEqual(task.task_id, "task_001")
        self.assertEqual(task.description, "Click the submit button")
        self.assertEqual(task.priority, TaskPriority.HIGH)
        self.assertEqual(task.status, TaskStatus.PENDING)
        self.assertEqual(task.max_steps, 10)
        self.assertEqual(task.timeout, 30.0)
        self.assertIsNotNone(task.created_at)
        self.assertIsNone(task.started_at)
        self.assertIsNone(task.completed_at)
    
    def test_task_lifecycle(self):
        """测试任务生命周期"""
        task = GUITask(
            task_id="task_002",
            description="Test task",
            goal="Complete test task"
        )
        
        # 初始状态
        self.assertEqual(task.status, TaskStatus.PENDING)
        self.assertIsNone(task.started_at)
        
        # 开始任务
        task.start()
        self.assertEqual(task.status, TaskStatus.RUNNING)
        self.assertIsNotNone(task.started_at)
        
        # 添加小延迟确保duration > 0
        time.sleep(0.01)
        
        # 完成任务
        task.complete(success=True)
        self.assertEqual(task.status, TaskStatus.COMPLETED)
        self.assertIsNotNone(task.completed_at)
        self.assertTrue(task.success)
        
        # 检查持续时间
        duration = task.get_duration()
        self.assertIsNotNone(duration)
        self.assertGreater(duration, 0)
    
    def test_task_failure(self):
        """测试任务失败"""
        task = GUITask(
            task_id="task_003",
            description="Test task",
            goal="Complete test task"
        )
        
        task.start()
        task.complete(success=False, error="Test error")
        
        self.assertEqual(task.status, TaskStatus.FAILED)
        self.assertFalse(task.success)
        self.assertEqual(task.error, "Test error")
    
    def test_task_timeout_check(self):
        """测试任务超时检查"""
        # 短超时任务
        task = GUITask(
            task_id="task_004",
            description="Test task",
            goal="Complete test task",
            timeout=0.1  # 100ms
        )
        
        task.start()
        
        # 立即检查（不应该超时）
        self.assertFalse(task.is_timeout())
        
        # 等待超时
        time.sleep(0.2)
        self.assertTrue(task.is_timeout())
    
    def test_task_step_tracking(self):
        """测试步骤跟踪"""
        task = GUITask(
            task_id="task_005",
            description="Test task",
            goal="Complete test task",
            max_steps=3
        )
        
        # 初始步骤
        self.assertEqual(task.current_step, 0)
        self.assertFalse(task.is_max_steps_reached())
        
        # 增加步骤
        task.increment_step()
        self.assertEqual(task.current_step, 1)
        
        task.increment_step()
        task.increment_step()
        self.assertEqual(task.current_step, 3)
        self.assertTrue(task.is_max_steps_reached())
    
    def test_task_to_dict(self):
        """测试任务字典转换"""
        task = GUITask(
            task_id="task_006",
            description="Test task",
            goal="Complete test task",
            priority=TaskPriority.MEDIUM
        )
        
        task.start()
        task.increment_step()
        
        data = task.to_dict()
        
        self.assertEqual(data["task_id"], "task_006")
        self.assertEqual(data["description"], "Test task")
        self.assertEqual(data["priority"], "medium")
        self.assertEqual(data["status"], "running")
        self.assertEqual(data["current_step"], 1)


class TestActionResult(unittest.TestCase):
    """测试ActionResult类"""
    
    def test_action_result_creation(self):
        """测试动作结果创建"""
        action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        
        result = ActionResult(
            action=action,
            success=True,
            execution_time=0.5,
            error_message=None
        )
        
        self.assertEqual(result.action, action)
        self.assertTrue(result.success)
        self.assertEqual(result.execution_time, 0.5)
        self.assertIsNone(result.error_message)
        self.assertIsNotNone(result.timestamp)
    
    def test_action_result_failure(self):
        """测试动作结果失败"""
        action = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="text_field",
            text_input="test"
        )
        
        result = ActionResult(
            action=action,
            success=False,
            execution_time=1.0,
            error_message="Element not found"
        )
        
        self.assertFalse(result.success)
        self.assertEqual(result.error_message, "Element not found")
    
    def test_action_result_to_dict(self):
        """测试动作结果字典转换"""
        action = GUIAction(
            action_type=ActionType.SCROLL,
            scroll_direction="down"
        )
        
        result = ActionResult(
            action=action,
            success=True,
            execution_time=0.3
        )
        
        data = result.to_dict()
        
        self.assertIsInstance(data, dict)
        self.assertTrue(data["success"])
        self.assertEqual(data["execution_time"], 0.3)
        self.assertIn("action", data)
        self.assertIn("timestamp", data)


class TestGUIAgentContext(unittest.TestCase):
    """测试GUIAgentContext类"""
    
    def setUp(self):
        """设置测试数据"""
        self.task = GUITask(
            task_id="test_task",
            description="Test task",
            goal="Complete test task"
        )
        
        config = EnvironmentConfig(platform="mock")
        self.environment = MockGUIEnvironment(config)
        
        self.context = GUIAgentContext(
            task=self.task,
            environment=self.environment
        )
    
    def test_context_creation(self):
        """测试上下文创建"""
        self.assertEqual(self.context.task, self.task)
        self.assertEqual(self.context.environment, self.environment)
        self.assertIsNone(self.context.current_state)
        self.assertEqual(len(self.context.action_history), 0)
        self.assertEqual(len(self.context.state_history), 0)
    
    def test_add_action_result(self):
        """测试添加动作结果"""
        action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        
        result = ActionResult(
            action=action,
            success=True,
            execution_time=0.5
        )
        
        self.context.add_action_result(result)
        
        self.assertEqual(len(self.context.action_history), 1)
        self.assertEqual(self.context.action_history[0], result)
        self.assertEqual(self.context.last_action_result, result)
    
    def test_update_state(self):
        """测试更新状态"""
        # 创建屏幕状态
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
        )
        
        tree = ElementTree(root_element=root_element)
        
        screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(400, 800),
            orientation="portrait",
            element_tree=tree
        )
        
        self.context.update_state(screen_state)
        
        self.assertEqual(self.context.current_state, screen_state)
        self.assertEqual(len(self.context.state_history), 1)
        self.assertEqual(self.context.state_history[0], screen_state)
    
    def test_get_statistics(self):
        """测试获取统计信息"""
        # 添加一些动作结果
        successful_action = ActionResult(
            action=GUIAction(action_type=ActionType.CLICK, target_element_id="btn1"),
            success=True,
            execution_time=0.5
        )
        
        failed_action = ActionResult(
            action=GUIAction(action_type=ActionType.TYPE, target_element_id="text1"),
            success=False,
            execution_time=1.0,
            error_message="Element not found"
        )
        
        self.context.add_action_result(successful_action)
        self.context.add_action_result(failed_action)
        
        stats = self.context.get_statistics()
        
        self.assertEqual(stats["total_actions"], 2)
        self.assertEqual(stats["successful_actions"], 1)
        self.assertEqual(stats["failed_actions"], 1)
        self.assertEqual(stats["success_rate"], 0.5)
        self.assertEqual(stats["average_execution_time"], 0.75)
    
    def test_context_to_dict(self):
        """测试上下文字典转换"""
        data = self.context.to_dict()
        
        self.assertIsInstance(data, dict)
        self.assertIn("task", data)
        self.assertIn("action_history", data)
        self.assertIn("state_history", data)
        self.assertIn("statistics", data)


class TestGUIAgentResult(unittest.TestCase):
    """测试GUIAgentResult类"""
    
    def test_result_creation(self):
        """测试结果创建"""
        result = GUIAgentResult(
            task_id="test_task",
            success=True,
            total_steps=5,
            execution_time=10.5,
            final_state=None
        )
        
        self.assertEqual(result.task_id, "test_task")
        self.assertTrue(result.success)
        self.assertEqual(result.total_steps, 5)
        self.assertEqual(result.execution_time, 10.5)
        self.assertIsNone(result.error_message)
        self.assertIsNotNone(result.timestamp)
    
    def test_result_failure(self):
        """测试失败结果"""
        result = GUIAgentResult(
            task_id="failed_task",
            success=False,
            total_steps=3,
            execution_time=5.0,
            error_message="Task timeout",
            final_state=None
        )
        
        self.assertFalse(result.success)
        self.assertEqual(result.error_message, "Task timeout")
    
    def test_result_metrics(self):
        """测试结果指标"""
        metrics = {
            "accuracy": 0.95,
            "efficiency": 0.8,
            "user_satisfaction": 0.9
        }
        
        result = GUIAgentResult(
            task_id="metrics_task",
            success=True,
            total_steps=8,
            execution_time=15.0,
            metrics=metrics,
            final_state=None
        )
        
        self.assertEqual(result.metrics, metrics)
        self.assertEqual(result.metrics["accuracy"], 0.95)
    
    def test_result_to_dict(self):
        """测试结果字典转换"""
        result = GUIAgentResult(
            task_id="dict_task",
            success=True,
            total_steps=4,
            execution_time=8.0,
            final_state=None
        )
        
        data = result.to_dict()
        
        self.assertIsInstance(data, dict)
        self.assertEqual(data["task_id"], "dict_task")
        self.assertTrue(data["success"])
        self.assertEqual(data["total_steps"], 4)
        self.assertEqual(data["execution_time"], 8.0)


class TestGUIAgent(unittest.TestCase):
    """测试GUIAgent抽象类"""
    
    def setUp(self):
        """设置测试数据"""
        self.agent = MockGUIAgent("test_agent")
        
        self.task = GUITask(
            task_id="test_task",
            description="Test task",
            goal="Complete test task",
            max_steps=5,
            timeout=10.0
        )
        
        config = EnvironmentConfig(platform="mock")
        self.environment = MockGUIEnvironment(config)
    
    def test_agent_initialization(self):
        """测试智能体初始化"""
        self.assertEqual(self.agent.agent_id, "test_agent")
        self.assertIsNotNone(self.agent.created_at)
    
    async def test_execute_task_success(self):
        """测试成功执行任务"""
        # 设置模拟返回值
        self.agent.mock_task_completed = True
        self.agent.mock_selected_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        
        # 连接环境
        await self.environment.connect()
        
        # 执行任务
        result = await self.agent.execute_task(self.task, self.environment)
        
        # 验证结果
        self.assertIsInstance(result, GUIAgentResult)
        self.assertEqual(result.task_id, "test_task")
        self.assertTrue(result.success)
        
        # 验证方法调用
        self.assertGreater(len(self.agent.check_task_completion_calls), 0)
        self.assertGreater(len(self.agent.learn_from_experience_calls), 0)
    
    async def test_execute_task_timeout(self):
        """测试任务超时"""
        # 创建短超时任务
        short_task = GUITask(
            task_id="timeout_task",
            description="Timeout test",
            goal="Complete timeout test",
            timeout=0.1  # 100ms
        )
        
        # 设置永不完成
        self.agent.mock_task_completed = False
        self.agent.mock_selected_action = GUIAction(
            action_type=ActionType.WAIT,
            duration=1.0  # 等待1秒，会超时
        )
        
        await self.environment.connect()
        
        # 执行任务
        result = await self.agent.execute_task(short_task, self.environment)
        
        # 验证超时结果
        self.assertFalse(result.success)
        self.assertIn("timeout", result.error_message.lower())
    
    async def test_execute_task_max_steps(self):
        """测试最大步骤限制"""
        # 创建限制步骤的任务
        limited_task = GUITask(
            task_id="limited_task",
            description="Limited steps test",
            goal="Complete limited steps test",
            max_steps=2
        )
        
        # 设置永不完成
        self.agent.mock_task_completed = False
        self.agent.mock_selected_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        
        await self.environment.connect()
        
        # 执行任务
        result = await self.agent.execute_task(limited_task, self.environment)
        
        # 验证步骤限制结果
        self.assertFalse(result.success)
        self.assertIn("max steps", result.error_message.lower())
        self.assertEqual(result.total_steps, 2)
    
    async def test_execute_task_error_handling(self):
        """测试错误处理"""
        # 设置环境动作失败
        self.environment.set_action_result(ActionType.CLICK, "btn1", False)
        
        self.agent.mock_task_completed = False
        self.agent.mock_selected_action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        self.agent.mock_error_handled = True
        
        await self.environment.connect()
        
        # 执行任务
        result = await self.agent.execute_task(self.task, self.environment)
        
        # 验证错误处理
        self.assertGreater(len(self.agent.handle_error_calls), 0)
    
    def test_agent_to_dict(self):
        """测试智能体字典转换"""
        data = self.agent.to_dict()
        
        self.assertIsInstance(data, dict)
        self.assertEqual(data["agent_id"], "test_agent")
        self.assertIn("created_at", data)


if __name__ == '__main__':
    # 运行异步测试
    import asyncio
    
    class AsyncTestRunner:
        def __init__(self):
            pass
        
        def run_async_test(self, test_method):
            async def wrapper():
                await test_method()
            
            asyncio.run(wrapper())
    
    # 创建测试套件
    suite = unittest.TestSuite()
    
    # 添加同步测试
    suite.addTest(TestGUITask('test_task_creation'))
    suite.addTest(TestGUITask('test_task_lifecycle'))
    suite.addTest(TestGUITask('test_task_failure'))
    suite.addTest(TestGUITask('test_task_timeout_check'))
    suite.addTest(TestGUITask('test_task_step_tracking'))
    suite.addTest(TestGUITask('test_task_to_dict'))
    
    suite.addTest(TestActionResult('test_action_result_creation'))
    suite.addTest(TestActionResult('test_action_result_failure'))
    suite.addTest(TestActionResult('test_action_result_to_dict'))
    
    suite.addTest(TestGUIAgentContext('test_context_creation'))
    suite.addTest(TestGUIAgentContext('test_add_action_result'))
    suite.addTest(TestGUIAgentContext('test_update_state'))
    suite.addTest(TestGUIAgentContext('test_get_statistics'))
    suite.addTest(TestGUIAgentContext('test_context_to_dict'))
    
    suite.addTest(TestGUIAgentResult('test_result_creation'))
    suite.addTest(TestGUIAgentResult('test_result_failure'))
    suite.addTest(TestGUIAgentResult('test_result_metrics'))
    suite.addTest(TestGUIAgentResult('test_result_to_dict'))
    
    suite.addTest(TestGUIAgent('test_agent_initialization'))
    suite.addTest(TestGUIAgent('test_agent_to_dict'))
    
    # 运行同步测试
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(suite)
    
    # 运行异步测试
    print("\n运行异步测试...")
    
    async_runner = AsyncTestRunner()
    test_agent = TestGUIAgent()
    
    try:
        test_agent.setUp()
        async_runner.run_async_test(test_agent.test_execute_task_success)
        print("✓ test_execute_task_success 通过")
        
        test_agent.setUp()
        async_runner.run_async_test(test_agent.test_execute_task_timeout)
        print("✓ test_execute_task_timeout 通过")
        
        test_agent.setUp()
        async_runner.run_async_test(test_agent.test_execute_task_max_steps)
        print("✓ test_execute_task_max_steps 通过")
        
        test_agent.setUp()
        async_runner.run_async_test(test_agent.test_execute_task_error_handling)
        print("✓ test_execute_task_error_handling 通过")
        
        print("\n所有异步测试通过！")
    except Exception as e:
        print(f"异步测试失败: {e}")
        import traceback
        traceback.print_exc()