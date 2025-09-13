from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import uuid

class User(BaseModel):
    """
    Represents a user in the AgenticX platform.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the user.")
    username: str = Field(description="Username for the user.")
    email: str = Field(description="Email address of the user.")
    full_name: Optional[str] = Field(description="Full name of the user.", default=None)
    organization_id: str = Field(description="Organization ID that the user belongs to.")
    
    is_active: bool = Field(default=True, description="Whether the user account is active.")
    roles: List[str] = Field(description="List of roles assigned to the user.", default_factory=list)
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the user was created.")
    updated_at: Optional[datetime] = Field(description="Timestamp when the user was last updated.", default=None)
    
    metadata: Dict[str, Any] = Field(description="Additional metadata for the user.", default_factory=dict)

class Organization(BaseModel):
    """
    Represents an organization in the AgenticX platform for multi-tenant isolation.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the organization.")
    name: str = Field(description="Name of the organization.")
    display_name: Optional[str] = Field(description="Display name of the organization.", default=None)
    description: Optional[str] = Field(description="Description of the organization.", default=None)
    
    is_active: bool = Field(default=True, description="Whether the organization is active.")
    
    settings: Dict[str, Any] = Field(description="Organization-specific settings.", default_factory=dict)
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Timestamp when the organization was created.")
    updated_at: Optional[datetime] = Field(description="Timestamp when the organization was last updated.", default=None)
    
    metadata: Dict[str, Any] = Field(description="Additional metadata for the organization.", default_factory=dict) 