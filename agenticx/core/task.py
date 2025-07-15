from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any, Dict
import uuid

class Task(BaseModel):
    """
    Represents a task to be executed by an agent.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the task.")
    description: str = Field(description="A clear, detailed description of the task.")
    agent_id: Optional[str] = Field(description="The ID of the agent assigned to this task.", default=None)
    expected_output: str = Field(description="A description of the expected output or outcome of the task.")
    
    context: Optional[Dict[str, Any]] = Field(description="Context information for the task execution.", default_factory=dict)
    dependencies: Optional[List[str]] = Field(description="List of task IDs that this task depends on.", default_factory=list)
    output_schema: Optional[Dict[str, Any]] = Field(description="Schema definition for the expected output format.", default=None)
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
