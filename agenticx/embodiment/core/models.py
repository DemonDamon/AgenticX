"""Data models for GUI automation.

This module contains the core data models used in GUI automation,
including screen state representation and interaction elements.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum
from agenticx.core.task import Task


class TaskStatus(str, Enum):
    """Task execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


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
    
    model_config = ConfigDict(use_enum_values=True)


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