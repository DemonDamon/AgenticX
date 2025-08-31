"""AgenticX M16.1: 核心数据模型

本模块定义GUI Agent的核心数据模型，包括：
- 基础枚举类型（ActionType, ElementType）
- 几何数据类型（BoundingBox）
- 交互元素模型（InteractionElement）
- 屏幕状态模型（ScreenState）
- GUI动作模型（GUIAction）
- 动作空间模型（ActionSpace）
"""

from enum import Enum
from typing import Dict, List, Optional, Any, Union, Tuple
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
import json


class ActionType(Enum):
    """GUI动作类型枚举"""
    CLICK = "click"
    DOUBLE_CLICK = "double_click"
    RIGHT_CLICK = "right_click"
    LONG_PRESS = "long_press"
    TYPE = "type"
    CLEAR = "clear"
    SCROLL = "scroll"
    SWIPE = "swipe"
    DRAG = "drag"
    HOVER = "hover"
    KEY_PRESS = "key_press"
    WAIT = "wait"
    SCREENSHOT = "screenshot"
    NAVIGATE = "navigate"
    BACK = "back"
    HOME = "home"
    MENU = "menu"
    SEARCH = "search"
    REFRESH = "refresh"
    ZOOM = "zoom"
    ROTATE = "rotate"
    PINCH = "pinch"
    CUSTOM = "custom"


class ElementType(Enum):
    """GUI元素类型枚举"""
    BUTTON = "button"
    TEXT_FIELD = "text_field"
    TEXT_VIEW = "text_view"
    IMAGE = "image"
    ICON = "icon"
    LINK = "link"
    CHECKBOX = "checkbox"
    RADIO_BUTTON = "radio_button"
    DROPDOWN = "dropdown"
    LIST_ITEM = "list_item"
    TAB = "tab"
    MENU_ITEM = "menu_item"
    DIALOG = "dialog"
    POPUP = "popup"
    TOOLBAR = "toolbar"
    NAVIGATION_BAR = "navigation_bar"
    STATUS_BAR = "status_bar"
    SCROLL_VIEW = "scroll_view"
    WEB_VIEW = "web_view"
    VIDEO = "video"
    SLIDER = "slider"
    SWITCH = "switch"
    PROGRESS_BAR = "progress_bar"
    SPINNER = "spinner"
    CONTAINER = "container"
    UNKNOWN = "unknown"


@dataclass
class BoundingBox:
    """边界框数据类
    
    表示GUI元素在屏幕上的位置和大小
    """
    x: float  # 左上角x坐标
    y: float  # 左上角y坐标
    width: float  # 宽度
    height: float  # 高度
    
    @property
    def center(self) -> Tuple[float, float]:
        """获取中心点坐标"""
        return (self.x + self.width / 2, self.y + self.height / 2)
    
    @property
    def area(self) -> float:
        """获取面积"""
        return self.width * self.height
    
    def contains_point(self, x: float, y: float) -> bool:
        """判断点是否在边界框内"""
        return (self.x <= x <= self.x + self.width and 
                self.y <= y <= self.y + self.height)
    
    def intersects(self, other: 'BoundingBox') -> bool:
        """判断是否与另一个边界框相交"""
        return not (self.x + self.width < other.x or 
                   other.x + other.width < self.x or
                   self.y + self.height < other.y or 
                   other.y + other.height < self.y)
    
    def to_dict(self) -> Dict[str, float]:
        """转换为字典"""
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, float]) -> 'BoundingBox':
        """从字典创建"""
        return cls(
            x=data["x"],
            y=data["y"],
            width=data["width"],
            height=data["height"]
        )


@dataclass
class InteractionElement:
    """交互元素数据类
    
    表示屏幕上可交互的GUI元素
    """
    element_id: str  # 元素唯一标识符
    element_type: ElementType  # 元素类型
    bounds: BoundingBox  # 边界框
    text: Optional[str] = None  # 元素文本内容
    description: Optional[str] = None  # 元素描述
    class_name: Optional[str] = None  # 元素类名
    resource_id: Optional[str] = None  # 资源ID
    package_name: Optional[str] = None  # 包名
    content_desc: Optional[str] = None  # 内容描述
    clickable: bool = False  # 是否可点击
    scrollable: bool = False  # 是否可滚动
    focusable: bool = False  # 是否可获得焦点
    enabled: bool = True  # 是否启用
    selected: bool = False  # 是否选中
    checked: Optional[bool] = None  # 是否勾选（适用于checkbox等）
    password: bool = False  # 是否为密码字段
    index: Optional[int] = None  # 在父容器中的索引
    parent_id: Optional[str] = None  # 父元素ID
    children_ids: List[str] = field(default_factory=list)  # 子元素ID列表
    attributes: Dict[str, Any] = field(default_factory=dict)  # 额外属性
    platform_specific: Dict[str, Any] = field(default_factory=dict)  # 平台特定属性
    
    def is_interactable(self) -> bool:
        """判断元素是否可交互"""
        return self.enabled and (self.clickable or self.scrollable or self.focusable)
    
    def get_display_text(self) -> str:
        """获取用于显示的文本"""
        if self.text:
            return self.text
        elif self.content_desc:
            return self.content_desc
        elif self.description:
            return self.description
        elif self.resource_id:
            return self.resource_id.split('/')[-1] if '/' in self.resource_id else self.resource_id
        else:
            return f"{self.element_type.value}_{self.element_id}"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "element_id": self.element_id,
            "element_type": self.element_type.value,
            "bounds": self.bounds.to_dict(),
            "text": self.text,
            "description": self.description,
            "class_name": self.class_name,
            "resource_id": self.resource_id,
            "package_name": self.package_name,
            "content_desc": self.content_desc,
            "clickable": self.clickable,
            "scrollable": self.scrollable,
            "focusable": self.focusable,
            "enabled": self.enabled,
            "selected": self.selected,
            "checked": self.checked,
            "password": self.password,
            "index": self.index,
            "parent_id": self.parent_id,
            "children_ids": self.children_ids,
            "attributes": self.attributes,
            "platform_specific": self.platform_specific
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'InteractionElement':
        """从字典创建"""
        return cls(
            element_id=data["element_id"],
            element_type=ElementType(data["element_type"]),
            bounds=BoundingBox.from_dict(data["bounds"]),
            text=data.get("text"),
            description=data.get("description"),
            class_name=data.get("class_name"),
            resource_id=data.get("resource_id"),
            package_name=data.get("package_name"),
            content_desc=data.get("content_desc"),
            clickable=data.get("clickable", False),
            scrollable=data.get("scrollable", False),
            focusable=data.get("focusable", False),
            enabled=data.get("enabled", True),
            selected=data.get("selected", False),
            checked=data.get("checked"),
            password=data.get("password", False),
            index=data.get("index"),
            parent_id=data.get("parent_id"),
            children_ids=data.get("children_ids", []),
            attributes=data.get("attributes", {}),
            platform_specific=data.get("platform_specific", {})
        )


@dataclass
class ElementTree:
    """元素树数据类
    
    表示GUI界面的层次结构
    """
    root_element: InteractionElement
    elements: Dict[str, InteractionElement] = field(default_factory=dict)
    
    def __post_init__(self):
        """初始化后处理"""
        if self.root_element.element_id not in self.elements:
            self.elements[self.root_element.element_id] = self.root_element
    
    def add_element(self, element: InteractionElement, parent_id: Optional[str] = None):
        """添加元素到树中"""
        self.elements[element.element_id] = element
        if parent_id and parent_id in self.elements:
            element.parent_id = parent_id
            parent = self.elements[parent_id]
            if element.element_id not in parent.children_ids:
                parent.children_ids.append(element.element_id)
    
    def get_element(self, element_id: str) -> Optional[InteractionElement]:
        """根据ID获取元素"""
        return self.elements.get(element_id)
    
    def get_children(self, element_id: str) -> List[InteractionElement]:
        """获取子元素列表"""
        element = self.get_element(element_id)
        if not element:
            return []
        return [self.elements[child_id] for child_id in element.children_ids 
                if child_id in self.elements]
    
    def get_parent(self, element_id: str) -> Optional[InteractionElement]:
        """获取父元素"""
        element = self.get_element(element_id)
        if not element or not element.parent_id:
            return None
        return self.get_element(element.parent_id)
    
    def find_elements_by_type(self, element_type: ElementType) -> List[InteractionElement]:
        """根据类型查找元素"""
        return [elem for elem in self.elements.values() 
                if elem.element_type == element_type]
    
    def find_elements_by_text(self, text: str, exact_match: bool = False) -> List[InteractionElement]:
        """根据文本查找元素"""
        results = []
        for elem in self.elements.values():
            elem_text = elem.get_display_text().lower()
            search_text = text.lower()
            if exact_match and elem_text == search_text:
                results.append(elem)
            elif not exact_match and search_text in elem_text:
                results.append(elem)
        return results


@dataclass
class ScreenState:
    """屏幕状态数据类
    
    表示某一时刻的GUI界面状态
    """
    timestamp: float  # 时间戳
    screen_size: Tuple[int, int]  # 屏幕尺寸 (width, height)
    orientation: str  # 屏幕方向 (portrait/landscape)
    element_tree: ElementTree  # 元素树
    screenshot_path: Optional[str] = None  # 截图文件路径
    app_package: Optional[str] = None  # 当前应用包名
    activity_name: Optional[str] = None  # 当前Activity名称
    window_title: Optional[str] = None  # 窗口标题
    url: Optional[str] = None  # 网页URL（适用于Web）
    platform: str = "unknown"  # 平台类型
    device_info: Dict[str, Any] = field(default_factory=dict)  # 设备信息
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    
    @property
    def interactable_elements(self) -> List[InteractionElement]:
        """获取所有可交互元素"""
        return [elem for elem in self.element_tree.elements.values() 
                if elem.is_interactable()]
    
    @property
    def clickable_elements(self) -> List[InteractionElement]:
        """获取所有可点击元素"""
        return [elem for elem in self.element_tree.elements.values() 
                if elem.clickable and elem.enabled]
    
    def find_element_at_position(self, x: float, y: float) -> Optional[InteractionElement]:
        """查找指定位置的元素"""
        # 从最小的元素开始查找（通常是最上层的元素）
        candidates = [elem for elem in self.element_tree.elements.values() 
                     if elem.bounds.contains_point(x, y)]
        if not candidates:
            return None
        # 返回面积最小的元素（最精确的匹配）
        return min(candidates, key=lambda e: e.bounds.area)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "timestamp": self.timestamp,
            "screen_size": self.screen_size,
            "orientation": self.orientation,
            "element_tree": {
                "root_element": self.element_tree.root_element.to_dict(),
                "elements": {k: v.to_dict() for k, v in self.element_tree.elements.items()}
            },
            "screenshot_path": self.screenshot_path,
            "app_package": self.app_package,
            "activity_name": self.activity_name,
            "window_title": self.window_title,
            "url": self.url,
            "platform": self.platform,
            "device_info": self.device_info,
            "metadata": self.metadata
        }


@dataclass
class GUIAction:
    """GUI动作数据类
    
    表示在GUI界面上执行的一个动作
    """
    action_type: ActionType  # 动作类型
    target_element_id: Optional[str] = None  # 目标元素ID
    coordinates: Optional[Tuple[float, float]] = None  # 坐标位置
    text_input: Optional[str] = None  # 文本输入
    key_code: Optional[str] = None  # 按键代码
    scroll_direction: Optional[str] = None  # 滚动方向
    scroll_distance: Optional[float] = None  # 滚动距离
    duration: Optional[float] = None  # 动作持续时间
    force: Optional[float] = None  # 力度（适用于压感操作）
    parameters: Dict[str, Any] = field(default_factory=dict)  # 额外参数
    description: Optional[str] = None  # 动作描述
    expected_result: Optional[str] = None  # 预期结果
    
    def validate(self) -> bool:
        """验证动作参数是否有效"""
        if self.action_type in [ActionType.CLICK, ActionType.DOUBLE_CLICK, ActionType.RIGHT_CLICK]:
            return self.target_element_id is not None or self.coordinates is not None
        elif self.action_type == ActionType.TYPE:
            return self.text_input is not None and (self.target_element_id is not None or self.coordinates is not None)
        elif self.action_type == ActionType.SCROLL:
            return self.scroll_direction is not None
        elif self.action_type == ActionType.KEY_PRESS:
            return self.key_code is not None
        elif self.action_type == ActionType.WAIT:
            return self.duration is not None and self.duration > 0
        return True
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "action_type": self.action_type.value,
            "target_element_id": self.target_element_id,
            "coordinates": self.coordinates,
            "text_input": self.text_input,
            "key_code": self.key_code,
            "scroll_direction": self.scroll_direction,
            "scroll_distance": self.scroll_distance,
            "duration": self.duration,
            "force": self.force,
            "parameters": self.parameters,
            "description": self.description,
            "expected_result": self.expected_result
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GUIAction':
        """从字典创建"""
        return cls(
            action_type=ActionType(data["action_type"]),
            target_element_id=data.get("target_element_id"),
            coordinates=tuple(data["coordinates"]) if data.get("coordinates") else None,
            text_input=data.get("text_input"),
            key_code=data.get("key_code"),
            scroll_direction=data.get("scroll_direction"),
            scroll_distance=data.get("scroll_distance"),
            duration=data.get("duration"),
            force=data.get("force"),
            parameters=data.get("parameters", {}),
            description=data.get("description"),
            expected_result=data.get("expected_result")
        )


@dataclass
class PlatformAction:
    """平台特定动作数据类
    
    封装平台特定的动作实现
    """
    platform: str  # 平台名称
    native_action: Any  # 原生动作对象
    gui_action: GUIAction  # 对应的GUI动作
    execution_context: Dict[str, Any] = field(default_factory=dict)  # 执行上下文
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "platform": self.platform,
            "gui_action": self.gui_action.to_dict(),
            "execution_context": self.execution_context
        }


@dataclass
class ActionSpace:
    """动作空间数据类
    
    定义在特定环境中可执行的动作集合
    """
    supported_actions: List[ActionType]  # 支持的动作类型
    platform: str  # 平台类型
    constraints: Dict[str, Any] = field(default_factory=dict)  # 动作约束
    action_mappings: Dict[ActionType, str] = field(default_factory=dict)  # 动作映射
    
    def is_action_supported(self, action_type: ActionType) -> bool:
        """检查是否支持指定动作"""
        return action_type in self.supported_actions
    
    def get_available_actions(self, screen_state: ScreenState) -> List[GUIAction]:
        """根据当前屏幕状态获取可用动作"""
        available_actions = []
        
        # 基础动作（不依赖元素）
        if ActionType.SCREENSHOT in self.supported_actions:
            available_actions.append(GUIAction(action_type=ActionType.SCREENSHOT))
        
        if ActionType.BACK in self.supported_actions:
            available_actions.append(GUIAction(action_type=ActionType.BACK))
        
        if ActionType.HOME in self.supported_actions:
            available_actions.append(GUIAction(action_type=ActionType.HOME))
        
        # 基于元素的动作
        for element in screen_state.interactable_elements:
            if element.clickable and ActionType.CLICK in self.supported_actions:
                available_actions.append(GUIAction(
                    action_type=ActionType.CLICK,
                    target_element_id=element.element_id
                ))
            
            if element.element_type == ElementType.TEXT_FIELD and ActionType.TYPE in self.supported_actions:
                available_actions.append(GUIAction(
                    action_type=ActionType.TYPE,
                    target_element_id=element.element_id,
                    text_input=""  # 占位符，实际使用时需要填入具体文本
                ))
            
            if element.scrollable and ActionType.SCROLL in self.supported_actions:
                for direction in ["up", "down", "left", "right"]:
                    available_actions.append(GUIAction(
                        action_type=ActionType.SCROLL,
                        target_element_id=element.element_id,
                        scroll_direction=direction
                    ))
        
        return available_actions
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "supported_actions": [action.value for action in self.supported_actions],
            "platform": self.platform,
            "constraints": self.constraints,
            "action_mappings": {k.value: v for k, v in self.action_mappings.items()}
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ActionSpace':
        """从字典创建"""
        return cls(
            supported_actions=[ActionType(action) for action in data["supported_actions"]],
            platform=data["platform"],
            constraints=data.get("constraints", {}),
            action_mappings={ActionType(k): v for k, v in data.get("action_mappings", {}).items()}
        )