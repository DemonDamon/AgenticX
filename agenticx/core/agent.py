from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid

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
