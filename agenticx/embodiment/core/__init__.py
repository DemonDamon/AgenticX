"""AgenticX Embodiment Core Module.

This module contains the core abstractions for GUI automation agents,
including GUIAgent, GUITask, GUIAgentContext, and related data models.

Enhanced with:
- ActionOutcome: A/B/C action result classification (MobileAgent)
- NormalizedCoordinate: 0-1000 normalized coordinates (AgentCPM-GUI)
- EnhancedTrajStep: Extended trajectory step with MCP/HumanInTheLoop support (MAI-UI)
"""

from .agent import GUIAgent
from .task import GUITask
from .context import GUIAgentContext
from .models import (
    ScreenState, 
    InteractionElement, 
    GUIAgentResult,
    GUIAction,
    GUITask as GUITaskModel,
    TaskStatus,
    ElementType,
    # 新增模型
    ActionOutcome,
    NormalizedCoordinate,
    EnhancedTrajStep,
)

__all__ = [
    # 核心类
    "GUIAgent",
    "GUITask", 
    "GUIAgentContext",
    # 数据模型
    "ScreenState",
    "InteractionElement",
    "GUIAgentResult",
    "GUIAction",
    "GUITaskModel",
    # 枚举
    "TaskStatus",
    "ElementType",
    "ActionOutcome",
    # 新增模型
    "NormalizedCoordinate",
    "EnhancedTrajStep",
]