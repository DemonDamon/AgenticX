"""GUI Agent 专用子模块

Enhanced with (GUI Agent Unified Proposal):
- GUIActionCompact: 紧凑动作 Schema (AgentCPM-GUI)
- REACTOutput: REACT 输出解析器 (AgentCPM-GUI)
- NormalizedCoordinate: 0-1000 归一化坐标 (AgentCPM-GUI)
"""

from .action_schema import (
    GUIActionType,
    GUIActionCompact,
    ActionStatus,
    GUI_ACTION_SCHEMA,
)
from .react_output import (
    REACTOutput,
    REACTPromptBuilder,
)

__all__ = [
    # 动作 Schema
    "GUIActionType",
    "GUIActionCompact",
    "ActionStatus",
    "GUI_ACTION_SCHEMA",
    # REACT 输出解析
    "REACTOutput",
    "REACTPromptBuilder",
]
