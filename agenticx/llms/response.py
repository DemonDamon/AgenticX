from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List

class TokenUsage(BaseModel):
    """
    Represents token usage for an LLM call.
    """
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

class LLMChoice(BaseModel):
    """
    Represents a single choice in an LLM response.
    """
    index: int
    content: str
    finish_reason: Optional[str] = None

class LLMResponse(BaseModel):
    """
    Defines a standard LLM return object for AgenticX.
    """
    id: str = Field(description="Unique identifier for the response.")
    model_name: str = Field(description="The model used to generate the response.")
    created: int = Field(description="Unix timestamp of when the response was created.")
    
    content: str = Field(description="The primary content of the response, typically from the first choice.")
    choices: List[LLMChoice] = Field(description="A list of all completion choices from the model.")
    
    token_usage: TokenUsage = Field(description="Token usage information for the request.")
    cost: Optional[float] = Field(description="Estimated cost of the API call.", default=None)
    
    metadata: Dict[str, Any] = Field(description="Additional metadata from the provider.", default_factory=dict) 