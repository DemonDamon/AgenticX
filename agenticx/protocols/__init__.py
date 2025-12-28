"""
AgenticX Protocols Module

This module implements the Agent-to-Agent (A2A) communication protocol
inspired by Google's A2A protocol, enabling structured collaboration
between AgenticX agents.

Key Components:
- BaseTaskStore: Abstract interface for task persistence
- AgentCard, Skill, CollaborationTask: Core data models
- A2AWebServiceWrapper: Server-side FastAPI wrapper
- A2AClient: Client for remote agent communication
- A2ASkillTool: Tool wrapper for remote agent skills
- MiningProtocol: Data models for intelligent mining/exploration tasks (from DeerFlow)
"""

from .interfaces import BaseTaskStore, TaskError, TaskNotFoundError, TaskAlreadyExistsError
from .models import AgentCard, Skill, CollaborationTask, TaskCreationRequest, TaskStatusResponse
from .storage import InMemoryTaskStore
from .server import A2AWebServiceWrapper
from .client import A2AClient, A2AClientError, A2AConnectionError, A2ATaskError
from .tools import A2ASkillTool, A2ASkillToolFactory

# Mining Protocol (inspired by DeerFlow)
from .mining_protocol import (
    MiningStepType,
    MiningStepStatus,
    MiningStep,
    ExplorationStrategy,
    StopCondition,
    MiningPlanStatus,
    MiningPlan,
    PlanValidationResult,
    validate_mining_plan,
    create_research_plan,
    create_exploration_plan,
    create_validation_plan,
)

__all__ = [
    # Interfaces
    "BaseTaskStore",
    
    # Exceptions
    "TaskError",
    "TaskNotFoundError", 
    "TaskAlreadyExistsError",
    "A2AClientError",
    "A2AConnectionError",
    "A2ATaskError",
    
    # Data Models
    "AgentCard",
    "Skill", 
    "CollaborationTask",
    "TaskCreationRequest",
    "TaskStatusResponse",
    
    # Storage
    "InMemoryTaskStore",
    
    # Server
    "A2AWebServiceWrapper",
    
    # Client
    "A2AClient",
    
    # Tools
    "A2ASkillTool",
    "A2ASkillToolFactory",
    
    # Mining Protocol (DeerFlow-inspired)
    "MiningStepType",
    "MiningStepStatus",
    "MiningStep",
    "ExplorationStrategy",
    "StopCondition",
    "MiningPlanStatus",
    "MiningPlan",
    "PlanValidationResult",
    "validate_mining_plan",
    "create_research_plan",
    "create_exploration_plan",
    "create_validation_plan",
] 