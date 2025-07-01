from pydantic import BaseModel, Field
from typing import List, Any, Dict

class Workflow(BaseModel):
    """
    Represents a workflow of agents and tasks.
    This is a placeholder for a more complex graph-based structure.
    """
    name: str = Field(description="The name of the workflow.")
    tasks: List[Any] = Field(description="A list of tasks in the workflow.", default_factory=list) # TODO: Replace with Task
    graph: Dict[str, List[str]] = Field(description="A simple graph representation (e.g., adjacency list).", default_factory=dict) 