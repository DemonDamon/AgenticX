"""
Base Memory Interface

Defines the core memory interface with tenant isolation support.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
from dataclasses import dataclass
from datetime import datetime
import uuid


@dataclass
class MemoryRecord:
    """A single memory record with metadata."""
    
    id: str
    content: str
    metadata: Dict[str, Any]
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    
    def __post_init__(self):
        """Ensure timestamps are datetime objects."""
        if isinstance(self.created_at, str):
            # Use a more explicit approach to help type checkers
            created_at_str = str(self.created_at)
            formatted_created_at = created_at_str.replace('Z', '+00:00')
            self.created_at = datetime.fromisoformat(formatted_created_at)
        if isinstance(self.updated_at, str):
            # Use a more explicit approach to help type checkers
            updated_at_str = str(self.updated_at)
            formatted_updated_at = updated_at_str.replace('Z', '+00:00')
            self.updated_at = datetime.fromisoformat(formatted_updated_at)


@dataclass
class SearchResult:
    """Search result with relevance score."""
    
    record: MemoryRecord
    score: float
    
    def __post_init__(self):
        """Ensure score is between 0 and 1."""
        self.score = max(0.0, min(1.0, self.score))


class BaseMemory(ABC):
    """
    Abstract base class for all memory implementations.
    
    Enforces tenant isolation and provides a consistent interface
    for memory operations across different backends.
    """
    
    def __init__(self, tenant_id: str, **kwargs):
        """
        Initialize memory with tenant isolation.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            **kwargs: Additional configuration options
        """
        self.tenant_id = tenant_id
        self._config = kwargs
    
    @abstractmethod
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """
        Add a new memory record.
        
        Args:
            content: The memory content to store
            metadata: Optional metadata dictionary
            record_id: Optional custom record ID (auto-generated if not provided)
            
        Returns:
            The ID of the created memory record
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    @abstractmethod
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """
        Search for relevant memory records.
        
        Args:
            query: Search query string
            limit: Maximum number of results to return
            metadata_filter: Optional metadata filter for scoping search
            min_score: Minimum relevance score threshold
            
        Returns:
            List of SearchResult objects ordered by relevance
            
        Raises:
            MemoryError: If the search operation fails
        """
        pass
    
    @abstractmethod
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Update an existing memory record.
        
        Args:
            record_id: ID of the record to update
            content: New content (if provided)
            metadata: New metadata (if provided, will be merged with existing)
            
        Returns:
            True if update was successful, False if record not found
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    @abstractmethod
    async def delete(self, record_id: str) -> bool:
        """
        Delete a memory record.
        
        Args:
            record_id: ID of the record to delete
            
        Returns:
            True if deletion was successful, False if record not found
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    @abstractmethod
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """
        Get a specific memory record by ID.
        
        Args:
            record_id: ID of the record to retrieve
            
        Returns:
            MemoryRecord if found, None otherwise
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    @abstractmethod
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """
        List all memory records for the current tenant.
        
        Args:
            limit: Maximum number of records to return
            offset: Number of records to skip
            metadata_filter: Optional metadata filter
            
        Returns:
            List of MemoryRecord objects
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    @abstractmethod
    async def clear(self) -> int:
        """
        Clear all memory records for the current tenant.
        
        Returns:
            Number of records deleted
            
        Raises:
            MemoryError: If the operation fails
        """
        pass
    
    def _generate_record_id(self) -> str:
        """Generate a unique record ID."""
        return str(uuid.uuid4())
    
    def _ensure_tenant_isolation(self, metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Ensure tenant isolation by adding tenant_id to metadata.
        
        Args:
            metadata: Original metadata dictionary
            
        Returns:
            Metadata with tenant_id added
        """
        if metadata is None:
            metadata = {}
        else:
            metadata = metadata.copy()
        
        metadata["tenant_id"] = self.tenant_id
        return metadata


class MemoryError(Exception):
    """Base exception for memory operations."""
    pass


class MemoryNotFoundError(MemoryError):
    """Raised when a memory record is not found."""
    pass


class MemoryConnectionError(MemoryError):
    """Raised when connection to memory backend fails."""
    pass 