from pydantic import BaseModel, Field
from typing import List, Any, Dict, Optional
import uuid

class WorkflowNode(BaseModel):
    """
    Represents a node in the workflow graph.
    """
    id: str = Field(description="Unique identifier for the node.")
    type: str = Field(description="Type of the node (e.g., 'agent', 'task', 'tool', 'dispatch').")
    name: str = Field(description="Name of the node.")
    config: Dict[str, Any] = Field(description="Configuration for the node.", default_factory=dict)

class WorkflowEdge(BaseModel):
    """
    Represents an edge in the workflow graph.
    """
    source: str = Field(description="ID of the source node.")
    target: str = Field(description="ID of the target node.")
    condition: Optional[str] = Field(description="Optional condition for the edge execution.", default=None)
    metadata: Dict[str, Any] = Field(description="Additional metadata for the edge.", default_factory=dict)

class Workflow(BaseModel):
    """
    Represents a workflow of agents and tasks with graph-based structure.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the workflow.")
    name: str = Field(description="The name of the workflow.")
    version: str = Field(default="1.0.0", description="Version of the workflow.")
    organization_id: str = Field(description="Organization ID for multi-tenant isolation.")
    
    nodes: List[WorkflowNode] = Field(description="List of nodes in the workflow graph.", default_factory=list)
    edges: List[WorkflowEdge] = Field(description="List of edges in the workflow graph.", default_factory=list)
    
    metadata: Dict[str, Any] = Field(description="Additional metadata for the workflow.", default_factory=dict) 