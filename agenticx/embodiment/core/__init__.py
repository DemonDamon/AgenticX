"""AgenticX Embodiment Core Module.

This module contains the core abstractions for GUI automation agents,
including GUIAgent, GUITask, GUIAgentContext, and related data models.
"""

from .agent import GUIAgent
from .task import GUITask
from .context import GUIAgentContext
from .models import ScreenState, InteractionElement, GUIAgentResult

__all__ = [
    "GUIAgent",
    "GUITask", 
    "GUIAgentContext",
    "ScreenState",
    "InteractionElement",
    "GUIAgentResult"
]