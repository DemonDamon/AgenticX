"""GUI Workflow System for AgenticX Embodiment.

This module provides a graph-based workflow system specifically designed for GUI automation tasks.
It extends the core AgenticX workflow infrastructure with GUI-specific capabilities.

Key Components:
- GUIWorkflow: GUI task workflow representation
- WorkflowEngine: Workflow execution engine
- WorkflowBuilder: Pythonic DSL for workflow definition
"""

from .workflow import GUIWorkflow
from .engine import WorkflowEngine
from .builder import WorkflowBuilder

__all__ = [
    "GUIWorkflow",
    "WorkflowEngine", 
    "WorkflowBuilder"
]