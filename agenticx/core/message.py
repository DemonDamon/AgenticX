from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import uuid

class Message(BaseModel):
    """
    Represents a message exchanged between agents.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the message.")
    sender_id: str = Field(description="The ID of the sender agent.")
    recipient_id: str = Field(description="The ID of the recipient agent.")
    content: Any = Field(description="The content of the message.")
    metadata: Dict[str, Any] = Field(description="Additional metadata for the message.", default_factory=dict)

class ProtocolMessage(BaseModel):
    """
    An envelope for messages, supporting different communication protocols.
    """
    protocol: str = Field(description="The communication protocol being used (e.g., 'a2a', 'mcp').")
    message: Message = Field(description="The core message.")
    header: Dict[str, Any] = Field(description="Protocol-specific headers.", default_factory=dict)
