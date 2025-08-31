"""AgenticX M16.1: 核心抽象层

本模块定义GUI智能体的核心抽象类和数据模型，包括：
- 基础数据类型和枚举
- GUI元素和状态表示
- 动作定义和执行
- 智能体接口和上下文
"""

# 基础数据模型
from .models import (
    ActionType,
    ElementType,
    BoundingBox,
    InteractionElement,
    ScreenState,
    GUIAction,
    ActionSpace,
    ElementTree,
    PlatformAction
)

# 环境抽象
from .environment import (
    GUIEnvironment,
    EnvironmentConfig,
    EnvironmentState
)

# 智能体核心类
from .agent import (
    GUIAgent,
    GUIAgentContext,
    GUIAgentResult,
    GUITask,
    ActionResult,
    TaskStatus,
    TaskPriority
)

__all__ = [
    # 基础数据模型
    "ActionType",
    "ElementType", 
    "BoundingBox",
    "InteractionElement",
    "ScreenState",
    "GUIAction",
    "ActionSpace",
    "ElementTree",
    "PlatformAction",
    
    # 环境抽象
    "GUIEnvironment",
    "EnvironmentConfig",
    "EnvironmentState",
    
    # 智能体核心类
    "GUIAgent",
    "GUIAgentContext", 
    "GUIAgentResult",
    "GUITask",
    "ActionResult",
    "TaskStatus",
    "TaskPriority"
]