"""
Core data models for A2A protocol implementation.

This module defines the Pydantic models that represent the fundamental
data structures used in agent-to-agent communication.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Type, Literal
from uuid import UUID, uuid4
from pydantic import BaseModel, Field, HttpUrl, ConfigDict


class Skill(BaseModel):
    """
    Represents a skill that an agent can provide.
    
    Skills define the capabilities that an agent advertises to the network.
    Other agents can discover and invoke these skills through the A2A protocol.
    """
    name: str = Field(..., description="Unique name for the skill")
    description: str = Field(..., description="Human-readable description of what the skill does")
    parameters_schema: Dict[str, Any] = Field(
        default_factory=dict,
        description="JSON schema defining the expected parameters"
    )
    
    model_config = ConfigDict(
        json_encoders={
            Type: lambda v: str(v)
        }
    )


class AgentCard(BaseModel):
    """
    Agent's digital business card.
    
    Published via the /.well-known/agent.json endpoint to enable
    service discovery and capability advertising.
    """
    agent_id: str = Field(..., description="Unique identifier for the agent")
    name: str = Field(..., description="Human-readable name of the agent")
    description: str = Field(..., description="Description of the agent's purpose and capabilities")
    endpoint: HttpUrl = Field(..., description="Base URL where the agent's A2A service is hosted")
    skills: List[Skill] = Field(default_factory=list, description="List of skills this agent provides")
    version: str = Field(default="1.0.0", description="Agent version for compatibility tracking")
    
    model_config = ConfigDict(
        json_encoders={
            HttpUrl: str
        }
    )


class CollaborationTask(BaseModel):
    """
    Basic unit of agent-to-agent collaboration.
    
    Replaces the generic Message concept from M1 with a structured,
    task-oriented approach to inter-agent communication.
    """
    task_id: UUID = Field(default_factory=uuid4, description="Unique task identifier")
    issuer_agent_id: str = Field(..., description="ID of the agent that created this task")
    target_agent_id: str = Field(..., description="ID of the agent that should execute this task")
    skill_name: str = Field(..., description="Name of the skill to invoke")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters to pass to the skill")
    status: Literal['pending', 'in_progress', 'completed', 'failed'] = Field(
        default='pending',
        description="Current status of the task"
    )
    result: Optional[Any] = Field(default=None, description="Result of task execution (if completed)")
    error: Optional[str] = Field(default=None, description="Error message (if failed)")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Task creation timestamp")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Last update timestamp")
    
    def update_status(self, status: Literal['pending', 'in_progress', 'completed', 'failed']) -> None:
        """Update task status and timestamp."""
        self.status = status
        self.updated_at = datetime.now(UTC)
    
    def complete(self, result: Any) -> None:
        """Mark task as completed with result."""
        self.result = result
        self.update_status('completed')
    
    def fail(self, error: str) -> None:
        """Mark task as failed with error message."""
        self.error = error
        self.update_status('failed')


class TaskCreationRequest(BaseModel):
    """
    Request model for creating a new collaboration task.
    
    Used by the A2A web service to accept task creation requests
    from remote agents.
    """
    issuer_agent_id: str = Field(..., description="ID of the requesting agent")
    skill_name: str = Field(..., description="Name of the skill to invoke")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters for the skill")
    
    def to_collaboration_task(self, target_agent_id: str) -> CollaborationTask:
        """Convert request to a CollaborationTask."""
        return CollaborationTask(
            issuer_agent_id=self.issuer_agent_id,
            target_agent_id=target_agent_id,
            skill_name=self.skill_name,
            parameters=self.parameters
        )


class TaskStatusResponse(BaseModel):
    """
    Response model for task status queries.
    
    Provides a clean interface for returning task information
    to requesting agents.
    """
    task_id: UUID
    status: Literal['pending', 'in_progress', 'completed', 'failed']
    result: Optional[Any] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    @classmethod
    def from_collaboration_task(cls, task: CollaborationTask) -> 'TaskStatusResponse':
        """Create response from CollaborationTask."""
        return cls(
            task_id=task.task_id,
            status=task.status,
            result=task.result,
            error=task.error,
            created_at=task.created_at,
            updated_at=task.updated_at
        ) 