"""Data models for GUI automation.

This module contains the core data models used in GUI automation,
including screen state representation and interaction elements.

Enhanced with:
- ActionOutcome: A/B/C action result classification (MobileAgent)
- NormalizedCoordinate: 0-1000 normalized coordinates (AgentCPM-GUI)
- EnhancedTrajStep: Extended trajectory step with MCP/HumanInTheLoop support (MAI-UI)
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field, ConfigDict, field_validator  # type: ignore
from enum import Enum
from agenticx.core.task import Task


class TaskStatus(str, Enum):
    """Task execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ActionOutcome(str, Enum):
    """动作结果分类 - 借鉴 MobileAgent A/B/C 分类
    
    与 TaskStatus 枚举配合使用，提供更细粒度的动作级结果判定。
    
    Classification:
        - SUCCESS (A): 动作成功执行，UI 状态按预期变化
        - WRONG_STATE (B): 动作导致错误状态，需要回退
        - NO_CHANGE (C): 动作执行但 UI 无变化，操作无效
        - UNKNOWN: 无法判断动作结果
    """
    SUCCESS = "success"           # A: 成功或部分成功
    WRONG_STATE = "wrong_state"   # B: 导致错误状态，需要回退
    NO_CHANGE = "no_change"       # C: 无变化，操作无效
    UNKNOWN = "unknown"           # 无法判断
    
    @property
    def is_failure(self) -> bool:
        """判断是否为失败结果"""
        return self in (ActionOutcome.WRONG_STATE, ActionOutcome.NO_CHANGE)
    
    @property
    def needs_rollback(self) -> bool:
        """判断是否需要回退"""
        return self == ActionOutcome.WRONG_STATE
    
    @property
    def needs_retry(self) -> bool:
        """判断是否需要重试"""
        return self == ActionOutcome.NO_CHANGE


class ElementType(str, Enum):
    """UI element types."""
    BUTTON = "button"
    TEXT_INPUT = "text_input"
    DROPDOWN = "dropdown"
    CHECKBOX = "checkbox"
    RADIO_BUTTON = "radio_button"
    LINK = "link"
    IMAGE = "image"
    LABEL = "label"
    MENU = "menu"
    DIALOG = "dialog"
    WINDOW = "window"
    OTHER = "other"


class NormalizedCoordinate(BaseModel):
    """归一化坐标 - 0-1000 范围，借鉴 AgentCPM-GUI 设计
    
    跨分辨率兼容，坐标相对于屏幕左上角。
    使用 0-1000 范围（而非 0-1 浮点数）以减少 token 消耗并提高精度。
    
    Example:
        >>> coord = NormalizedCoordinate(x=500, y=300)
        >>> abs_x, abs_y = coord.to_absolute(1920, 1080)
        >>> print(abs_x, abs_y)  # 960, 324
        
        >>> coord2 = NormalizedCoordinate.from_absolute(960, 540, 1920, 1080)
        >>> print(coord2.x, coord2.y)  # 500, 500
    """
    x: int = Field(ge=0, le=1000, description="横坐标 [0-1000]")
    y: int = Field(ge=0, le=1000, description="纵坐标 [0-1000]")
    
    model_config = ConfigDict(frozen=True)
    
    @classmethod
    def from_absolute(
        cls, 
        abs_x: int, 
        abs_y: int, 
        width: int, 
        height: int
    ) -> "NormalizedCoordinate":
        """从绝对坐标转换为归一化坐标
        
        Args:
            abs_x: 绝对 X 坐标
            abs_y: 绝对 Y 坐标
            width: 屏幕宽度
            height: 屏幕高度
            
        Returns:
            归一化坐标对象
        """
        if width <= 0 or height <= 0:
            raise ValueError(f"Invalid dimensions: width={width}, height={height}")
        norm_x = min(1000, max(0, int(abs_x / width * 1000)))
        norm_y = min(1000, max(0, int(abs_y / height * 1000)))
        return cls(x=norm_x, y=norm_y)
    
    def to_absolute(self, width: int, height: int) -> Tuple[int, int]:
        """转换为绝对坐标
        
        Args:
            width: 屏幕宽度
            height: 屏幕高度
            
        Returns:
            (abs_x, abs_y) 绝对坐标元组
        """
        if width <= 0 or height <= 0:
            raise ValueError(f"Invalid dimensions: width={width}, height={height}")
        return (int(self.x / 1000 * width), int(self.y / 1000 * height))
    
    def distance_to(self, other: "NormalizedCoordinate") -> float:
        """计算到另一坐标的曼哈顿距离（归一化）
        
        Args:
            other: 另一个归一化坐标
            
        Returns:
            归一化距离 [0, 1]
        """
        return (abs(self.x - other.x) + abs(self.y - other.y)) / 2000
    
    def euclidean_distance_to(self, other: "NormalizedCoordinate") -> float:
        """计算到另一坐标的欧几里得距离（归一化）
        
        Args:
            other: 另一个归一化坐标
            
        Returns:
            归一化距离 [0, ~1.414]
        """
        import math
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2) / 1000
    
    def __str__(self) -> str:
        return f"[{self.x}, {self.y}]"
    
    def to_list(self) -> List[int]:
        """转换为列表格式，用于 JSON 序列化"""
        return [self.x, self.y]


class InteractionElement(BaseModel):
    """Represents an interactive UI element.
    
    This model captures the essential information about UI elements
    that can be interacted with during GUI automation.
    """
    element_id: str = Field(description="Unique identifier for the element")
    bounds: Tuple[int, int, int, int] = Field(description="Element bounds as (x, y, width, height)")
    element_type: ElementType = Field(description="Type of the UI element")
    text_content: Optional[str] = Field(default=None, description="Text content of the element")
    attributes: Dict[str, Any] = Field(default_factory=dict, description="Additional element attributes")
    # 新增：归一化坐标（可选，用于跨分辨率场景）
    normalized_center: Optional[NormalizedCoordinate] = Field(
        default=None, 
        description="Normalized center coordinate [0-1000]"
    )
    
    model_config = ConfigDict(use_enum_values=True)
    
    def get_center(self) -> Tuple[int, int]:
        """获取元素中心的绝对坐标"""
        x, y, w, h = self.bounds
        return (x + w // 2, y + h // 2)
    
    def get_normalized_center(self, screen_width: int, screen_height: int) -> NormalizedCoordinate:
        """获取元素中心的归一化坐标
        
        Args:
            screen_width: 屏幕宽度
            screen_height: 屏幕高度
            
        Returns:
            归一化坐标
        """
        if self.normalized_center:
            return self.normalized_center
        cx, cy = self.get_center()
        return NormalizedCoordinate.from_absolute(cx, cy, screen_width, screen_height)


class ScreenState(BaseModel):
    """Represents the current state of the screen.
    
    This model captures a snapshot of the screen including visual information,
    interactive elements, and metadata for GUI automation.
    """
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="When this state was captured")
    agent_id: str = Field(description="ID of the agent that captured this state")
    screenshot: Optional[str] = Field(default=None, description="Base64 encoded screenshot or file path")
    element_tree: Dict[str, Any] = Field(default_factory=dict, description="Hierarchical representation of UI elements")
    interactive_elements: List[InteractionElement] = Field(default_factory=list, description="List of interactive elements")
    ocr_text: Optional[str] = Field(default=None, description="OCR extracted text from the screen")
    state_hash: Optional[str] = Field(default=None, description="Hash of the screen state for comparison")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata about the screen state")
    
    def get_element_by_id(self, element_id: str) -> Optional[InteractionElement]:
        """Get an interactive element by its ID."""
        for element in self.interactive_elements:
            if element.element_id == element_id:
                return element
        return None
    
    def get_elements_by_type(self, element_type: ElementType) -> List[InteractionElement]:
        """Get all interactive elements of a specific type."""
        return [element for element in self.interactive_elements if element.element_type == element_type]


class GUIAgentResult(BaseModel):
    """Result of a GUI agent task execution.
    
    This model represents the outcome of executing a GUI automation task,
    including success/failure status and relevant output data.
    """
    task_id: str = Field(description="ID of the executed task")
    status: TaskStatus = Field(description="Execution status of the task")
    summary: str = Field(description="Brief summary of the task execution")
    output: Optional[Dict[str, Any]] = Field(default=None, description="Task output data")
    error_message: Optional[str] = Field(default=None, description="Error message if task failed")
    execution_time: Optional[float] = Field(default=None, description="Task execution time in seconds")
    screenshots: List[str] = Field(default_factory=list, description="Screenshots taken during execution")
    actions_performed: List[Dict[str, Any]] = Field(default_factory=list, description="List of actions performed")
    node_executions: List[Any] = Field(default_factory=list, description="List of workflow node executions for compatibility")
    
    model_config = ConfigDict(use_enum_values=True)
    
    def is_successful(self) -> bool:
        """Check if the task execution was successful."""
        return self.status == TaskStatus.COMPLETED
    
    def has_error(self) -> bool:
        """Check if the task execution had an error."""
        return self.status == TaskStatus.FAILED and self.error_message is not None


class GUIAction(BaseModel):
    """GUI操作动作模型
    
    表示GUI自动化中的一个具体操作动作。
    """
    action_type: str = Field(description="操作类型，如click、type、scroll等")
    target: str = Field(description="操作目标，如元素ID或坐标")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="操作参数")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="操作时间")
    success: bool = Field(default=True, description="操作是否成功")
    error_message: Optional[str] = Field(default=None, description="错误信息")
    
    model_config = ConfigDict(use_enum_values=True)


class GUITask(Task):
    """GUI-specific task that extends the base Task class.
    
    This class represents a task specifically designed for GUI automation,
    including additional fields for GUI-specific operations and context.
    """
    steps: List[Dict[str, Any]] = Field(default_factory=list, description="List of GUI automation steps")
    target_application: Optional[str] = Field(default=None, description="Target application for the task")
    screen_requirements: Optional[Dict[str, Any]] = Field(default=None, description="Required screen state or elements")
    interaction_timeout: float = Field(default=30.0, description="Timeout for GUI interactions in seconds")
    retry_count: int = Field(default=3, description="Number of retries for failed interactions")
    validation_rules: List[Dict[str, Any]] = Field(default_factory=list, description="Rules to validate task completion")
    
    def add_step(self, action: str, target: str, **kwargs) -> None:
        """Add a GUI automation step to the task."""
        step = {
            'action': action,
            'target': target,
            **kwargs
        }
        self.steps.append(step)
    
    def get_step_count(self) -> int:
        """Get the total number of steps in the task."""
        return len(self.steps)
    
    def is_gui_task(self) -> bool:
        """Check if this is a GUI task (always True for GUITask)."""
        return True


# === 增强轨迹模型 ===

@dataclass
class EnhancedTrajStep:
    """增强的轨迹步骤 - 融合 MAI-UI TrajStep 设计
    
    相比基础轨迹步骤，增加了以下扩展字段：
    - ask_user_response: 用户响应（HumanInTheLoop 场景）
    - mcp_response: MCP 工具响应
    - outcome: 动作结果（A/B/C 分类）
    - latency_ms: 执行延迟
    - model_name: 使用的模型名称
    
    Example:
        >>> step = EnhancedTrajStep(
        ...     screenshot="base64...",
        ...     action={"type": "click", "point": [500, 300]},
        ...     step_index=0,
        ...     thought="需要点击搜索按钮",
        ...     outcome=ActionOutcome.SUCCESS,
        ...     latency_ms=1234.5
        ... )
    
    Attributes:
        screenshot: 屏幕截图（Base64 或文件路径）
        action: 解析后的动作字典
        step_index: 步骤索引（从 0 开始）
        thought: 模型推理过程
        ask_user_response: 用户响应（HumanInTheLoop）
        mcp_response: MCP 工具响应
        outcome: 动作结果（A/B/C 分类）
        latency_ms: 执行延迟（毫秒）
        model_name: 使用的模型名称
        timestamp: 步骤时间戳
        screen_state_before: 执行前的屏幕状态
        screen_state_after: 执行后的屏幕状态
        error_message: 错误信息（如有）
    """
    screenshot: Optional[str]
    action: Dict[str, Any]
    step_index: int = 0
    thought: Optional[str] = None
    # MAI-UI 扩展字段
    ask_user_response: Optional[str] = None
    mcp_response: Optional[str] = None
    # MobileAgent 扩展字段
    outcome: ActionOutcome = ActionOutcome.UNKNOWN
    # 性能追踪字段
    latency_ms: Optional[float] = None
    model_name: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # 状态追踪字段
    screen_state_before: Optional["ScreenState"] = None
    screen_state_after: Optional["ScreenState"] = None
    error_message: Optional[str] = None
    
    @property
    def is_successful(self) -> bool:
        """判断步骤是否成功"""
        return self.outcome == ActionOutcome.SUCCESS
    
    @property
    def has_user_interaction(self) -> bool:
        """判断是否有用户交互"""
        return self.ask_user_response is not None
    
    @property
    def has_mcp_call(self) -> bool:
        """判断是否有 MCP 工具调用"""
        return self.mcp_response is not None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式"""
        return {
            "screenshot": self.screenshot,
            "action": self.action,
            "step_index": self.step_index,
            "thought": self.thought,
            "ask_user_response": self.ask_user_response,
            "mcp_response": self.mcp_response,
            "outcome": self.outcome.value if isinstance(self.outcome, ActionOutcome) else self.outcome,
            "latency_ms": self.latency_ms,
            "model_name": self.model_name,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "error_message": self.error_message,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EnhancedTrajStep":
        """从字典创建实例"""
        outcome = data.get("outcome", "unknown")
        if isinstance(outcome, str):
            outcome = ActionOutcome(outcome)
        
        timestamp = data.get("timestamp")
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)
        elif timestamp is None:
            timestamp = datetime.now(timezone.utc)
            
        return cls(
            screenshot=data.get("screenshot"),
            action=data.get("action", {}),
            step_index=data.get("step_index", 0),
            thought=data.get("thought"),
            ask_user_response=data.get("ask_user_response"),
            mcp_response=data.get("mcp_response"),
            outcome=outcome,
            latency_ms=data.get("latency_ms"),
            model_name=data.get("model_name"),
            timestamp=timestamp,
            error_message=data.get("error_message"),
        )