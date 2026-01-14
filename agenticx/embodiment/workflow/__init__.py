"""GUI Workflow System for AgenticX Embodiment.

This module provides a graph-based workflow system specifically designed for GUI automation tasks.
It extends the core AgenticX workflow infrastructure with GUI-specific capabilities.

Key Components:
- GUIWorkflow: GUI task workflow representation
- WorkflowEngine: Workflow execution engine
- WorkflowBuilder: Pythonic DSL for workflow definition

Enhanced with (GUI Agent Unified Proposal):
- StuckDetector: Stuck detection and recovery (MobileAgent)
"""

from .workflow import GUIWorkflow
from .engine import WorkflowEngine
from .builder import WorkflowBuilder
# 新增：卡住检测器 (MobileAgent 错误恢复机制)
from .stuck_detector import (
    StuckDetector,
    StuckState,
    RecoveryStrategy,
    ActionRecord,
)

__all__ = [
    "GUIWorkflow",
    "WorkflowEngine", 
    "WorkflowBuilder",
    # 新增
    "StuckDetector",
    "StuckState",
    "RecoveryStrategy",
    "ActionRecord",
]