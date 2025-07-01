from pydantic import BaseModel, Field
from typing import Callable, Any, Optional

class Tool(BaseModel):
    """
    Represents a tool that an agent can use.
    """
    name: str = Field(description="The name of the tool.")
    description: str = Field(description="A description of what the tool does.")
    func: Callable[..., Any] = Field(description="The function that implements the tool.")
    args_schema: Optional[Any] = Field(description="The schema for the tool's arguments (e.g., Pydantic model).", default=None)

    class Config:
        """Pydantic configuration."""
        arbitrary_types_allowed = True

def tool(description: str):
    """
    Decorator to create a Tool from a function.
    
    The function's docstring will be used as the tool's name,
    and its signature will be inspected to create the args_schema.
    """
    def decorator(func: Callable[..., Any]):
        # TODO: Implement the logic to create a Tool instance from the function
        # This will involve inspecting the function's signature and docstring.
        # For now, we'll just return the function itself.
        return func
    return decorator 