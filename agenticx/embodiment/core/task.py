"""GUI Task implementation.

This module contains the GUITask class which extends the base Task class
for GUI automation specific requirements.
"""

from typing import Optional, Dict, Any
from pydantic import Field
from agenticx.core.task import Task


class GUITask(Task):
    """GUI automation task.
    
    Extends the base Task class with GUI-specific properties
    such as target application and initial URL.
    """
    app_name: Optional[str] = Field(
        default=None, 
        description="Name of the target application for GUI automation"
    )
    initial_url: Optional[str] = Field(
        default=None, 
        description="Initial URL to navigate to (for web applications)"
    )
    target_window_title: Optional[str] = Field(
        default=None,
        description="Title of the target window to interact with"
    )
    automation_type: str = Field(
        default="desktop",
        description="Type of automation: 'desktop', 'web', or 'mobile'"
    )
    max_execution_time: Optional[int] = Field(
        default=300,
        description="Maximum execution time in seconds"
    )
    screenshot_on_failure: bool = Field(
        default=True,
        description="Whether to take screenshot on task failure"
    )
    
    def get_target_info(self) -> Dict[str, Any]:
        """Get target application information."""
        return {
            "app_name": self.app_name,
            "initial_url": self.initial_url,
            "target_window_title": self.target_window_title,
            "automation_type": self.automation_type
        }
    
    def is_web_automation(self) -> bool:
        """Check if this is a web automation task."""
        return self.automation_type == "web" or self.initial_url is not None
    
    def is_desktop_automation(self) -> bool:
        """Check if this is a desktop automation task."""
        return self.automation_type == "desktop"
    
    def is_mobile_automation(self) -> bool:
        """Check if this is a mobile automation task."""
        return self.automation_type == "mobile"