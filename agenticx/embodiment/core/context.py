"""GUI Agent Context implementation.

This module contains the GUIAgentContext class which extends the base AgentContext
for GUI automation specific context information.
"""

from typing import List, Optional, Dict, Any
from pydantic import Field
from agenticx.core.agent import AgentContext
from .models import ScreenState


class GUIAgentContext(AgentContext):
    """GUI Agent execution context.
    
    Extends the base AgentContext with GUI-specific context information
    including screen history, action history, and workflow state.
    """
    screen_history: List[ScreenState] = Field(
        default_factory=list,
        description="History of screen states captured during execution"
    )
    action_history: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="History of actions performed by the agent"
    )
    current_app_name: Optional[str] = Field(
        default=None,
        description="Name of the currently active application"
    )
    current_workflow_state: Dict[str, Any] = Field(
        default_factory=dict,
        description="Current state of the workflow execution"
    )
    active_window_title: Optional[str] = Field(
        default=None,
        description="Title of the currently active window"
    )
    automation_mode: str = Field(
        default="interactive",
        description="Automation mode: 'interactive', 'batch', or 'headless'"
    )
    
    def add_screen_state(self, screen_state: ScreenState) -> None:
        """Add a new screen state to the history."""
        self.screen_history.append(screen_state)
        # Keep only the last 10 screen states to manage memory
        if len(self.screen_history) > 10:
            self.screen_history = self.screen_history[-10:]
    
    def add_action(self, action: Dict[str, Any]) -> None:
        """Add a new action to the history."""
        self.action_history.append(action)
        # Keep only the last 50 actions to manage memory
        if len(self.action_history) > 50:
            self.action_history = self.action_history[-50:]
    
    def get_current_screen_state(self) -> Optional[ScreenState]:
        """Get the most recent screen state."""
        return self.screen_history[-1] if self.screen_history else None
    
    def get_last_action(self) -> Optional[Dict[str, Any]]:
        """Get the most recent action."""
        return self.action_history[-1] if self.action_history else None
    
    def clear_history(self) -> None:
        """Clear screen and action history."""
        self.screen_history.clear()
        self.action_history.clear()
    
    def update_workflow_state(self, key: str, value: Any) -> None:
        """Update a specific workflow state value."""
        self.current_workflow_state[key] = value
    
    def get_workflow_state(self, key: str, default: Any = None) -> Any:
        """Get a specific workflow state value."""
        return self.current_workflow_state.get(key, default)
    
    def set_active_application(self, app_name: str, window_title: Optional[str] = None) -> None:
        """Set the currently active application and window."""
        self.current_app_name = app_name
        self.active_window_title = window_title
    
    def is_interactive_mode(self) -> bool:
        """Check if the agent is in interactive mode."""
        return self.automation_mode == "interactive"
    
    def is_batch_mode(self) -> bool:
        """Check if the agent is in batch mode."""
        return self.automation_mode == "batch"
    
    def is_headless_mode(self) -> bool:
        """Check if the agent is in headless mode."""
        return self.automation_mode == "headless"