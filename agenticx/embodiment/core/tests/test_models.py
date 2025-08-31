"""AgenticX M16.1: 核心数据模型测试

测试核心数据模型的功能，包括：
- 基础数据类型
- 交互元素模型
- 屏幕状态模型
- GUI动作模型
- 动作空间模型
"""

import unittest
import time
from typing import Dict, Any

from ..models import (
    ActionType,
    ElementType,
    BoundingBox,
    InteractionElement,
    ElementTree,
    ScreenState,
    GUIAction,
    PlatformAction,
    ActionSpace
)


class TestBoundingBox(unittest.TestCase):
    """测试BoundingBox类"""
    
    def setUp(self):
        """设置测试数据"""
        self.bbox = BoundingBox(x=10.0, y=20.0, width=100.0, height=50.0)
    
    def test_center_property(self):
        """测试中心点计算"""
        center = self.bbox.center
        self.assertEqual(center, (60.0, 45.0))
    
    def test_area_property(self):
        """测试面积计算"""
        area = self.bbox.area
        self.assertEqual(area, 5000.0)
    
    def test_contains_point(self):
        """测试点包含判断"""
        # 内部点
        self.assertTrue(self.bbox.contains_point(50.0, 30.0))
        # 边界点
        self.assertTrue(self.bbox.contains_point(10.0, 20.0))
        self.assertTrue(self.bbox.contains_point(110.0, 70.0))
        # 外部点
        self.assertFalse(self.bbox.contains_point(5.0, 15.0))
        self.assertFalse(self.bbox.contains_point(120.0, 80.0))
    
    def test_intersects(self):
        """测试相交判断"""
        # 相交的框
        intersecting = BoundingBox(x=50.0, y=40.0, width=100.0, height=50.0)
        self.assertTrue(self.bbox.intersects(intersecting))
        
        # 不相交的框
        non_intersecting = BoundingBox(x=150.0, y=100.0, width=50.0, height=30.0)
        self.assertFalse(self.bbox.intersects(non_intersecting))
    
    def test_to_dict_and_from_dict(self):
        """测试字典转换"""
        data = self.bbox.to_dict()
        expected = {"x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0}
        self.assertEqual(data, expected)
        
        restored = BoundingBox.from_dict(data)
        self.assertEqual(restored.x, self.bbox.x)
        self.assertEqual(restored.y, self.bbox.y)
        self.assertEqual(restored.width, self.bbox.width)
        self.assertEqual(restored.height, self.bbox.height)


class TestInteractionElement(unittest.TestCase):
    """测试InteractionElement类"""
    
    def setUp(self):
        """设置测试数据"""
        self.bounds = BoundingBox(x=0.0, y=0.0, width=100.0, height=50.0)
        self.element = InteractionElement(
            element_id="btn_submit",
            element_type=ElementType.BUTTON,
            bounds=self.bounds,
            text="Submit",
            clickable=True,
            enabled=True
        )
    
    def test_is_interactable(self):
        """测试可交互性判断"""
        # 可交互元素
        self.assertTrue(self.element.is_interactable())
        
        # 不可交互元素（禁用）
        disabled_element = InteractionElement(
            element_id="btn_disabled",
            element_type=ElementType.BUTTON,
            bounds=self.bounds,
            enabled=False
        )
        self.assertFalse(disabled_element.is_interactable())
        
        # 不可交互元素（无交互属性）
        non_interactive = InteractionElement(
            element_id="text_label",
            element_type=ElementType.TEXT_VIEW,
            bounds=self.bounds,
            clickable=False,
            scrollable=False,
            focusable=False
        )
        self.assertFalse(non_interactive.is_interactable())
    
    def test_get_display_text(self):
        """测试显示文本获取"""
        # 有文本的元素
        self.assertEqual(self.element.get_display_text(), "Submit")
        
        # 无文本但有content_desc的元素
        element_with_desc = InteractionElement(
            element_id="btn_icon",
            element_type=ElementType.BUTTON,
            bounds=self.bounds,
            content_desc="Icon button"
        )
        self.assertEqual(element_with_desc.get_display_text(), "Icon button")
        
        # 无文本无描述的元素
        element_no_text = InteractionElement(
            element_id="btn_empty",
            element_type=ElementType.BUTTON,
            bounds=self.bounds
        )
        self.assertEqual(element_no_text.get_display_text(), "button_btn_empty")
    
    def test_to_dict_and_from_dict(self):
        """测试字典转换"""
        data = self.element.to_dict()
        self.assertIsInstance(data, dict)
        self.assertEqual(data["element_id"], "btn_submit")
        self.assertEqual(data["element_type"], "button")
        self.assertEqual(data["text"], "Submit")
        
        restored = InteractionElement.from_dict(data)
        self.assertEqual(restored.element_id, self.element.element_id)
        self.assertEqual(restored.element_type, self.element.element_type)
        self.assertEqual(restored.text, self.element.text)


class TestElementTree(unittest.TestCase):
    """测试ElementTree类"""
    
    def setUp(self):
        """设置测试数据"""
        self.root_bounds = BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
        self.root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=self.root_bounds
        )
        
        self.child_bounds = BoundingBox(x=50.0, y=100.0, width=100.0, height=50.0)
        self.child_element = InteractionElement(
            element_id="child_btn",
            element_type=ElementType.BUTTON,
            bounds=self.child_bounds,
            text="Click me",
            clickable=True
        )
        
        self.tree = ElementTree(root_element=self.root_element)
    
    def test_add_element(self):
        """测试添加元素"""
        self.tree.add_element(self.child_element, parent_id="root")
        
        # 检查元素是否添加到树中
        self.assertIn("child_btn", self.tree.elements)
        
        # 检查父子关系
        self.assertEqual(self.child_element.parent_id, "root")
        self.assertIn("child_btn", self.root_element.children_ids)
    
    def test_get_children(self):
        """测试获取子元素"""
        self.tree.add_element(self.child_element, parent_id="root")
        
        children = self.tree.get_children("root")
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].element_id, "child_btn")
    
    def test_get_parent(self):
        """测试获取父元素"""
        self.tree.add_element(self.child_element, parent_id="root")
        
        parent = self.tree.get_parent("child_btn")
        self.assertIsNotNone(parent)
        self.assertEqual(parent.element_id, "root")
    
    def test_find_elements_by_type(self):
        """测试按类型查找元素"""
        self.tree.add_element(self.child_element, parent_id="root")
        
        buttons = self.tree.find_elements_by_type(ElementType.BUTTON)
        self.assertEqual(len(buttons), 1)
        self.assertEqual(buttons[0].element_id, "child_btn")
    
    def test_find_elements_by_text(self):
        """测试按文本查找元素"""
        self.tree.add_element(self.child_element, parent_id="root")
        
        # 精确匹配
        exact_results = self.tree.find_elements_by_text("Click me", exact_match=True)
        self.assertEqual(len(exact_results), 1)
        
        # 模糊匹配
        fuzzy_results = self.tree.find_elements_by_text("click", exact_match=False)
        self.assertEqual(len(fuzzy_results), 1)


class TestScreenState(unittest.TestCase):
    """测试ScreenState类"""
    
    def setUp(self):
        """设置测试数据"""
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
        )
        
        button_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(x=50.0, y=100.0, width=100.0, height=50.0),
            text="Button 1",
            clickable=True,
            enabled=True
        )
        
        tree = ElementTree(root_element=root_element)
        tree.add_element(button_element, parent_id="root")
        
        self.screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(400, 800),
            orientation="portrait",
            element_tree=tree,
            app_package="com.example.app",
            platform="android"
        )
    
    def test_interactable_elements(self):
        """测试获取可交互元素"""
        interactable = self.screen_state.interactable_elements
        self.assertEqual(len(interactable), 1)
        self.assertEqual(interactable[0].element_id, "btn1")
    
    def test_clickable_elements(self):
        """测试获取可点击元素"""
        clickable = self.screen_state.clickable_elements
        self.assertEqual(len(clickable), 1)
        self.assertEqual(clickable[0].element_id, "btn1")
    
    def test_find_element_at_position(self):
        """测试按位置查找元素"""
        # 在按钮范围内
        element = self.screen_state.find_element_at_position(75.0, 125.0)
        self.assertIsNotNone(element)
        self.assertEqual(element.element_id, "btn1")
        
        # 在根容器范围内但不在按钮内
        element = self.screen_state.find_element_at_position(200.0, 300.0)
        self.assertIsNotNone(element)
        self.assertEqual(element.element_id, "root")
        
        # 超出范围
        element = self.screen_state.find_element_at_position(500.0, 900.0)
        self.assertIsNone(element)
    
    def test_to_dict(self):
        """测试字典转换"""
        data = self.screen_state.to_dict()
        self.assertIsInstance(data, dict)
        self.assertEqual(data["screen_size"], (400, 800))
        self.assertEqual(data["orientation"], "portrait")
        self.assertEqual(data["app_package"], "com.example.app")
        self.assertEqual(data["platform"], "android")


class TestGUIAction(unittest.TestCase):
    """测试GUIAction类"""
    
    def test_click_action_validation(self):
        """测试点击动作验证"""
        # 有效的点击动作（通过元素ID）
        valid_click = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1"
        )
        self.assertTrue(valid_click.validate())
        
        # 有效的点击动作（通过坐标）
        valid_click_coords = GUIAction(
            action_type=ActionType.CLICK,
            coordinates=(100.0, 200.0)
        )
        self.assertTrue(valid_click_coords.validate())
        
        # 无效的点击动作（缺少目标）
        invalid_click = GUIAction(action_type=ActionType.CLICK)
        self.assertFalse(invalid_click.validate())
    
    def test_type_action_validation(self):
        """测试输入动作验证"""
        # 有效的输入动作
        valid_type = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="text_field",
            text_input="Hello World"
        )
        self.assertTrue(valid_type.validate())
        
        # 无效的输入动作（缺少文本）
        invalid_type = GUIAction(
            action_type=ActionType.TYPE,
            target_element_id="text_field"
        )
        self.assertFalse(invalid_type.validate())
    
    def test_scroll_action_validation(self):
        """测试滚动动作验证"""
        # 有效的滚动动作
        valid_scroll = GUIAction(
            action_type=ActionType.SCROLL,
            scroll_direction="down"
        )
        self.assertTrue(valid_scroll.validate())
        
        # 无效的滚动动作（缺少方向）
        invalid_scroll = GUIAction(action_type=ActionType.SCROLL)
        self.assertFalse(invalid_scroll.validate())
    
    def test_wait_action_validation(self):
        """测试等待动作验证"""
        # 有效的等待动作
        valid_wait = GUIAction(
            action_type=ActionType.WAIT,
            duration=2.0
        )
        self.assertTrue(valid_wait.validate())
        
        # 无效的等待动作（无持续时间）
        invalid_wait = GUIAction(action_type=ActionType.WAIT)
        self.assertFalse(invalid_wait.validate())
        
        # 无效的等待动作（负持续时间）
        invalid_wait_negative = GUIAction(
            action_type=ActionType.WAIT,
            duration=-1.0
        )
        self.assertFalse(invalid_wait_negative.validate())
    
    def test_to_dict_and_from_dict(self):
        """测试字典转换"""
        action = GUIAction(
            action_type=ActionType.CLICK,
            target_element_id="btn1",
            coordinates=(100.0, 200.0),
            description="Click submit button"
        )
        
        data = action.to_dict()
        self.assertEqual(data["action_type"], "click")
        self.assertEqual(data["target_element_id"], "btn1")
        self.assertEqual(data["coordinates"], (100.0, 200.0))
        
        restored = GUIAction.from_dict(data)
        self.assertEqual(restored.action_type, action.action_type)
        self.assertEqual(restored.target_element_id, action.target_element_id)
        self.assertEqual(restored.coordinates, action.coordinates)


class TestActionSpace(unittest.TestCase):
    """测试ActionSpace类"""
    
    def setUp(self):
        """设置测试数据"""
        self.action_space = ActionSpace(
            supported_actions=[
                ActionType.CLICK,
                ActionType.TYPE,
                ActionType.SCROLL,
                ActionType.SCREENSHOT,
                ActionType.BACK
            ],
            platform="android"
        )
        
        # 创建测试屏幕状态
        root_element = InteractionElement(
            element_id="root",
            element_type=ElementType.CONTAINER,
            bounds=BoundingBox(x=0.0, y=0.0, width=400.0, height=800.0)
        )
        
        button_element = InteractionElement(
            element_id="btn1",
            element_type=ElementType.BUTTON,
            bounds=BoundingBox(x=50.0, y=100.0, width=100.0, height=50.0),
            clickable=True,
            enabled=True
        )
        
        text_field = InteractionElement(
            element_id="text1",
            element_type=ElementType.TEXT_FIELD,
            bounds=BoundingBox(x=50.0, y=200.0, width=200.0, height=40.0),
            clickable=True,
            enabled=True
        )
        
        tree = ElementTree(root_element=root_element)
        tree.add_element(button_element, parent_id="root")
        tree.add_element(text_field, parent_id="root")
        
        self.screen_state = ScreenState(
            timestamp=time.time(),
            screen_size=(400, 800),
            orientation="portrait",
            element_tree=tree
        )
    
    def test_is_action_supported(self):
        """测试动作支持检查"""
        self.assertTrue(self.action_space.is_action_supported(ActionType.CLICK))
        self.assertTrue(self.action_space.is_action_supported(ActionType.TYPE))
        self.assertFalse(self.action_space.is_action_supported(ActionType.DRAG))
    
    def test_get_available_actions(self):
        """测试获取可用动作"""
        actions = self.action_space.get_available_actions(self.screen_state)
        
        # 检查基础动作
        action_types = [action.action_type for action in actions]
        self.assertIn(ActionType.SCREENSHOT, action_types)
        self.assertIn(ActionType.BACK, action_types)
        
        # 检查点击动作
        click_actions = [action for action in actions if action.action_type == ActionType.CLICK]
        self.assertEqual(len(click_actions), 2)  # 按钮和文本框都可点击
        
        # 检查输入动作
        type_actions = [action for action in actions if action.action_type == ActionType.TYPE]
        self.assertEqual(len(type_actions), 1)  # 只有文本框可输入
    
    def test_to_dict_and_from_dict(self):
        """测试字典转换"""
        data = self.action_space.to_dict()
        self.assertIsInstance(data, dict)
        self.assertEqual(data["platform"], "android")
        self.assertIn("click", data["supported_actions"])
        
        restored = ActionSpace.from_dict(data)
        self.assertEqual(restored.platform, self.action_space.platform)
        self.assertEqual(len(restored.supported_actions), len(self.action_space.supported_actions))


if __name__ == '__main__':
    unittest.main()