"""
Base Retrieval System

Defines the core abstractions for the AgenticX retrieval system.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from pydantic import BaseModel


class RetrievalType(Enum):
    """Retrieval strategy types."""
    VECTOR = "vector"
    BM25 = "bm25"
    HYBRID = "hybrid"
    GRAPH = "graph"
    AUTO = "auto"


@dataclass
class RetrievalQuery:
    """Represents a retrieval query."""
    
    text: str
    query_type: RetrievalType = RetrievalType.AUTO
    filters: Dict[str, Any] = field(default_factory=dict)
    limit: int = 10
    min_score: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RetrievalResult:
    """Represents a single retrieval result."""
    
    content: str
    score: float
    metadata: Dict[str, Any] = field(default_factory=dict)
    source: Optional[str] = None
    chunk_id: Optional[str] = None
    created_at: Optional[datetime] = None
    
    # Additional fields for different retrieval types
    vector_score: Optional[float] = None
    bm25_score: Optional[float] = None
    graph_score: Optional[float] = None
    hybrid_score: Optional[float] = None


class BaseRetriever(ABC):
    """
    Abstract base class for all retrievers.
    
    Provides a unified interface for different retrieval strategies.
    """
    
    def __init__(self, tenant_id: str, **kwargs):
        """
        Initialize retriever with tenant isolation.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            **kwargs: Additional configuration options
        """
        self.tenant_id = tenant_id
        self._config = kwargs
        self._initialized = False
    
    @abstractmethod
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """
        Retrieve relevant documents.
        
        Args:
            query: Query string or RetrievalQuery object
            **kwargs: Additional query parameters
            
        Returns:
            List of RetrievalResult objects ordered by relevance
            
        Raises:
            RetrievalError: If the retrieval operation fails
        """
        pass
    
    @abstractmethod
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """
        Add documents to the retrieval index.
        
        Args:
            documents: List of document dictionaries
            **kwargs: Additional indexing parameters
            
        Returns:
            List of document IDs that were added
            
        Raises:
            RetrievalError: If the indexing operation fails
        """
        pass
    
    @abstractmethod
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """
        Remove documents from the retrieval index.
        
        Args:
            document_ids: List of document IDs to remove
            **kwargs: Additional parameters
            
        Returns:
            True if successful, False otherwise
            
        Raises:
            RetrievalError: If the removal operation fails
        """
        pass
    
    @abstractmethod
    async def get_stats(self) -> Dict[str, Any]:
        """
        Get retrieval system statistics.
        
        Returns:
            Dictionary containing system statistics
        """
        pass
    
    async def initialize(self):
        """Initialize the retriever if not already initialized."""
        if not self._initialized:
            await self._initialize()
            self._initialized = True
    
    @abstractmethod
    async def _initialize(self):
        """Internal initialization method."""
        pass


class RetrievalError(Exception):
    """Base exception for retrieval operations."""
    pass


class RetrievalConnectionError(RetrievalError):
    """Exception raised for connection-related errors."""
    pass


class RetrievalQueryError(RetrievalError):
    """Exception raised for query-related errors."""
    pass


class RetrievalIndexError(RetrievalError):
    """Exception raised for indexing-related errors."""
    pass 