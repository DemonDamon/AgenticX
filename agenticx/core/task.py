from pydantic import BaseModel, Field
from typing import List, Optional, Any

from .agent import Agent

class Task(BaseModel):
    """
    Represents a task to be executed by an agent.
    """
    description: str = Field(description="A clear, detailed description of the task.")
    agent: Optional[Agent] = Field(description="The agent assigned to this task.", default=None)
    expected_output: str = Field(description="A description of the expected output or outcome of the task.")
    
    context: Optional[List['Task']] = Field(description="A list of tasks that this task depends on.", default=None)
    tools: Optional[List[Any]] = Field(description="A list of specific tools required for this task.", default=None) # TODO: Replace with BaseTool
    
    class Config:
        """Pydantic configuration."""
        arbitrary_types_allowed = True
