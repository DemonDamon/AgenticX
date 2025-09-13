"""
Storage data models
"""

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field, ConfigDict


class StorageMode(str, Enum):
    """Storage mode enumeration"""
    AGENT = "agent"
    TEAM = "team"
    WORKFLOW = "workflow"
    SESSION = "session"
    MEMORY = "memory"
    KNOWLEDGE = "knowledge"


class IndexType(str, Enum):
    """Index type enumeration"""
    BTREE = "btree"
    HASH = "hash"
    GIN = "gin"
    GIST = "gist"
    HNSW = "hnsw"
    IVF = "ivf"
    LSH = "lsh"


class DistanceMetric(str, Enum):
    """Distance metric enumeration"""
    COSINE = "cosine"
    EUCLIDEAN = "euclidean"
    MANHATTAN = "manhattan"
    DOT_PRODUCT = "dot_product"
    HAMMING = "hamming"


class StorageSession(BaseModel):
    """Storage session model"""
    session_id: str = Field(..., description="Unique session identifier")
    user_id: Optional[str] = Field(None, description="User identifier")
    agent_id: Optional[str] = Field(None, description="Agent identifier")
    team_id: Optional[str] = Field(None, description="Team identifier")
    workflow_id: Optional[str] = Field(None, description="Workflow identifier")
    
    # Session data
    memory: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Session memory data")
    session_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Session metadata")
    extra_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional session data")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    updated_at: Optional[int] = Field(None, description="Last update timestamp (epoch)")
    
    # Mode-specific data
    agent_data: Optional[Dict[str, Any]] = Field(None, description="Agent-specific data")
    team_data: Optional[Dict[str, Any]] = Field(None, description="Team-specific data")
    workflow_data: Optional[Dict[str, Any]] = Field(None, description="Workflow-specific data")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )


class StorageDocument(BaseModel):
    """Storage document model"""
    document_id: str = Field(..., description="Unique document identifier")
    collection: str = Field(..., description="Document collection name")
    
    # Document content
    content: Optional[str] = Field(None, description="Document content")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Document metadata")
    
    # Vector data
    vector: Optional[List[float]] = Field(None, description="Document vector embedding")
    vector_dimension: Optional[int] = Field(None, description="Vector dimension")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    updated_at: Optional[int] = Field(None, description="Last update timestamp (epoch)")
    
    # Indexing
    indexed: bool = Field(False, description="Whether document is indexed")
    index_type: Optional[IndexType] = Field(None, description="Index type used")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )


class StorageVector(BaseModel):
    """Storage vector model"""
    vector_id: str = Field(..., description="Unique vector identifier")
    collection: str = Field(..., description="Vector collection name")
    
    # Vector data
    vector: List[float] = Field(..., description="Vector data")
    dimension: int = Field(..., description="Vector dimension")
    
    # Metadata
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Vector metadata")
    tags: Optional[List[str]] = Field(default_factory=list, description="Vector tags")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    updated_at: Optional[int] = Field(None, description="Last update timestamp (epoch)")
    
    # Indexing
    indexed: bool = Field(False, description="Whether vector is indexed")
    index_type: Optional[IndexType] = Field(None, description="Index type used")
    distance_metric: Optional[DistanceMetric] = Field(None, description="Distance metric used")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )


class StorageIndex(BaseModel):
    """Storage index model"""
    index_id: str = Field(..., description="Unique index identifier")
    collection: str = Field(..., description="Index collection name")
    
    # Index configuration
    index_type: IndexType = Field(..., description="Index type")
    distance_metric: DistanceMetric = Field(..., description="Distance metric")
    
    # Index parameters
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Index parameters")
    
    # Status
    status: str = Field("pending", description="Index status (pending, building, active, failed)")
    progress: Optional[float] = Field(None, description="Index building progress (0-1)")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    updated_at: Optional[int] = Field(None, description="Last update timestamp (epoch)")
    
    # Statistics
    total_vectors: Optional[int] = Field(None, description="Total vectors in index")
    index_size: Optional[int] = Field(None, description="Index size in bytes")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )


class StorageQuery(BaseModel):
    """Storage query model"""
    query_id: str = Field(..., description="Unique query identifier")
    
    # Query parameters
    collection: str = Field(..., description="Collection to query")
    query_type: str = Field(..., description="Query type (search, filter, aggregate)")
    
    # Query data
    query_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Query data")
    filters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Query filters")
    
    # Pagination
    limit: Optional[int] = Field(None, description="Result limit")
    offset: Optional[int] = Field(0, description="Result offset")
    
    # Vector search
    vector: Optional[List[float]] = Field(None, description="Query vector")
    distance_metric: Optional[DistanceMetric] = Field(None, description="Distance metric")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )


class StorageResult(BaseModel):
    """Storage result model"""
    result_id: str = Field(..., description="Unique result identifier")
    query_id: str = Field(..., description="Query identifier")
    
    # Results
    documents: Optional[List[StorageDocument]] = Field(default_factory=list, description="Query documents")
    vectors: Optional[List[StorageVector]] = Field(default_factory=list, description="Query vectors")
    sessions: Optional[List[StorageSession]] = Field(default_factory=list, description="Query sessions")
    
    # Metadata
    total_count: int = Field(0, description="Total result count")
    query_time: Optional[float] = Field(None, description="Query execution time in seconds")
    
    # Timestamps
    created_at: Optional[int] = Field(None, description="Creation timestamp (epoch)")
    
    model_config = ConfigDict(
        json_encoders={
            datetime: lambda v: int(v.timestamp())
        }
    )