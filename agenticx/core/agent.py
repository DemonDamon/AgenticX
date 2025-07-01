from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class Agent(BaseModel):
    """
    Represents an agent in the AgenticX framework.
    """
    role: str = Field(description="The role of the agent.")
    goal: str = Field(description="The primary goal of the agent.")
    backstory: Optional[str] = Field(description="A backstory for the agent, providing context.", default=None)
    
    llm_config: Optional[Dict[str, Any]] = Field(description="Configuration for the language model.", default_factory=dict)
    memory: Optional[Any] = Field(description="The memory system for the agent.", default=None) # TODO: Replace with BaseMemory
    tools: List[Any] = Field(description="A list of tools available to the agent.", default_factory=list) # TODO: Replace with BaseTool
    
    class Config:
        """Pydantic configuration."""
        arbitrary_types_allowed = True
