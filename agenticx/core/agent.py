from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any, List
import uuid
from datetime import datetime, timezone

class Agent(BaseModel):
    """
    Represents an agent in the AgenticX framework.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the agent.")
    name: str = Field(description="The name of the agent.")
    version: str = Field(default="1.0.0", description="Version of the agent.")
    role: str = Field(description="The role of the agent.")
    goal: str = Field(description="The primary goal of the agent.")
    backstory: Optional[str] = Field(description="A backstory for the agent, providing context.", default=None)
    
    llm_config_name: Optional[str] = Field(description="Name of the LLM configuration to use (reference to M13 ModelHub).", default=None)
    memory_config: Optional[Dict[str, Any]] = Field(description="Configuration for the memory system.", default_factory=dict)
    tool_names: List[str] = Field(description="List of tool names available to the agent (reference to M13 Hub).", default_factory=list)
    organization_id: str = Field(description="Organization ID for multi-tenant isolation.")
    llm: Optional[Any] = Field(description="LLM instance for the agent.", default=None)
    retrievers: Optional[Dict[str, Any]] = Field(description="Retrievers available to the agent.", default=None)
    query_patterns: Optional[Dict[str, Any]] = Field(description="Query patterns for the agent.", default=None)
    retrieval_history: Optional[List[Dict[str, Any]]] = Field(description="Retrieval history for the agent.", default_factory=list)
    query_analyzer: Optional[Any] = Field(description="Query analyzer for the agent.", default=None)
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    async def execute_task(self, task, context=None):
        """Execute a task using the agent's capabilities."""
        # This is a simplified implementation
        # In practice, this would use the agent's LLM and tools
        
        # For now, return a mock result
        return {
            "output": {
                "intent": "general",
                "keywords": ["task", "execution"],
                "entities": [],
                "query_type": "vector",  # Use a valid RetrievalType value
                "suggested_filters": {},
                "confidence": 0.8
            }
        }


class AgentContext(BaseModel):
    """Agent execution context"""
    agent_id: str = Field(description="Agent identifier")
    task_id: Optional[str] = Field(default=None, description="Current task identifier")
    session_id: Optional[str] = Field(default=None, description="Session identifier")
    variables: Dict[str, Any] = Field(default_factory=dict, description="Context variables")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Context creation time")
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


class AgentResult(BaseModel):
    """Agent execution result"""
    agent_id: str = Field(description="Agent identifier")
    task_id: Optional[str] = Field(default=None, description="Task identifier")
    success: bool = Field(description="Whether the execution was successful")
    output: Any = Field(default=None, description="Execution output")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    execution_time: Optional[float] = Field(default=None, description="Execution time in seconds")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Result creation time")
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
