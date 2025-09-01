"""GUI Agent implementation.

This module contains the GUIAgent class which extends the base Agent class
for GUI automation capabilities.
"""

from typing import Optional, Dict, Any, List
from pydantic import Field
from agenticx.core.agent import Agent
from .context import GUIAgentContext
from .task import GUITask
from .models import GUIAgentResult, ScreenState, TaskStatus
import asyncio
import time


class GUIAgent(Agent):
    """GUI automation agent that inherits from the base Agent class.
    
    This agent specializes in GUI automation tasks, providing capabilities
    for screen capture, element interaction, and workflow execution.
    """
    
    tool_executor: Optional[Any] = Field(
        default=None,
        description="Tool executor for GUI automation operations"
    )
    memory: Dict[str, Any] = Field(
        default_factory=dict,
        description="Agent memory for storing execution state and learned patterns"
    )
    learning_components: Dict[str, Any] = Field(
        default_factory=dict,
        description="Learning components for adaptive behavior"
    )
    screen_capture_enabled: bool = Field(
        default=True,
        description="Whether screen capture is enabled"
    )
    max_retry_attempts: int = Field(
        default=3,
        description="Maximum number of retry attempts for failed operations"
    )
    action_delay: float = Field(
        default=1.0,
        description="Delay between actions in seconds"
    )
    
    def __init__(self, organization_id: str = "default", **kwargs):
        """Initialize GUIAgent with required organization_id."""
        super().__init__(organization_id=organization_id, **kwargs)
    
    async def arun(self, task: GUITask, context: Optional[GUIAgentContext] = None) -> GUIAgentResult:
        """Execute a GUI automation task asynchronously.
        
        This method overrides the base Agent's arun method to provide
        GUI-specific task execution logic.
        
        Args:
            task: The GUI task to execute
            context: Optional GUI agent context
            
        Returns:
            GUIAgentResult: The result of the task execution
        """
        start_time = time.time()
        
        # Initialize context if not provided
        if context is None:
            context = GUIAgentContext(
                agent_id=self.id,
                task_id=task.id
            )
        
        try:
            # Set up the target application
            await self._setup_target_application(task, context)
            
            # Capture initial screen state
            if self.screen_capture_enabled:
                initial_screen = await self._capture_screen_state(context)
                context.add_screen_state(initial_screen)
            
            # Execute the main task logic
            result = await self._execute_task_logic(task, context)
            
            # Calculate execution time
            execution_time = time.time() - start_time
            
            # Create successful result
            return GUIAgentResult(
                task_id=task.id,
                status=TaskStatus.COMPLETED,
                summary=f"Task '{task.description}' completed successfully",
                output=result,
                execution_time=execution_time,
                screenshots=[state.screenshot for state in context.screen_history if state.screenshot],
                actions_performed=context.action_history
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            
            # Capture error screenshot if enabled
            error_screenshots = []
            if task.screenshot_on_failure and self.screen_capture_enabled:
                try:
                    error_screen = await self._capture_screen_state(context)
                    if error_screen.screenshot:
                        error_screenshots.append(error_screen.screenshot)
                except:
                    pass  # Ignore screenshot errors during error handling
            
            return GUIAgentResult(
                task_id=task.id,
                status=TaskStatus.FAILED,
                summary=f"Task '{task.description}' failed: {str(e)}",
                error_message=str(e),
                execution_time=execution_time,
                screenshots=error_screenshots,
                actions_performed=context.action_history
            )
    
    async def _setup_target_application(self, task: GUITask, context: GUIAgentContext) -> None:
        """Set up the target application for automation."""
        if task.app_name:
            context.set_active_application(task.app_name, task.target_window_title)
            
        if task.is_web_automation() and task.initial_url:
            # For web automation, navigate to initial URL
            action = {
                "type": "navigate",
                "url": task.initial_url,
                "timestamp": time.time()
            }
            context.add_action(action)
    
    async def _capture_screen_state(self, context: GUIAgentContext) -> ScreenState:
        """Capture the current screen state."""
        # This is a placeholder implementation
        # In a real implementation, this would capture actual screen data
        return ScreenState(
            agent_id=context.agent_id,
            screenshot=None,  # Would contain actual screenshot data
            element_tree={},  # Would contain actual UI element tree
            interactive_elements=[],  # Would contain actual interactive elements
            ocr_text=None,  # Would contain actual OCR text
            state_hash=None  # Would contain actual state hash
        )
    
    async def _execute_task_logic(self, task: GUITask, context: GUIAgentContext) -> Dict[str, Any]:
        """Execute the main task logic.
        
        This is a placeholder implementation that would be extended
        with actual GUI automation logic.
        """
        # Simulate task execution
        await asyncio.sleep(0.1)
        
        # Add a sample action to the context
        action = {
            "type": "task_execution",
            "description": task.description,
            "timestamp": time.time(),
            "status": "completed"
        }
        context.add_action(action)
        
        return {
            "task_completed": True,
            "description": task.description,
            "automation_type": task.automation_type
        }
    
    def add_learning_component(self, name: str, component: Any) -> None:
        """Add a learning component to the agent."""
        self.learning_components[name] = component
    
    def get_learning_component(self, name: str) -> Optional[Any]:
        """Get a learning component by name."""
        return self.learning_components.get(name)
    
    def update_memory(self, key: str, value: Any) -> None:
        """Update agent memory with a key-value pair."""
        self.memory[key] = value
    
    def get_memory(self, key: str, default: Any = None) -> Any:
        """Get a value from agent memory."""
        return self.memory.get(key, default)
    
    def clear_memory(self) -> None:
        """Clear agent memory."""
        self.memory.clear()