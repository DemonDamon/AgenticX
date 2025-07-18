"""
Storage base classes
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from .models import (
    StorageSession, StorageDocument, StorageVector, StorageIndex,
    StorageQuery, StorageResult, StorageMode, IndexType, DistanceMetric
)
from .errors import StorageError, ConnectionError, QueryError


class BaseStorage(ABC):
    """Base storage abstract class"""
    
    def __init__(self, mode: StorageMode = StorageMode.AGENT):
        self.mode = mode
        self._connected = False
        self._initialized = False
    
    @property
    def connected(self) -> bool:
        """Check if storage is connected"""
        return self._connected
    
    @property
    def initialized(self) -> bool:
        """Check if storage is initialized"""
        return self._initialized
    
    @abstractmethod
    async def connect(self) -> None:
        """Connect to storage backend"""
        raise NotImplementedError
    
    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from storage backend"""
        raise NotImplementedError
    
    @abstractmethod
    async def create(self) -> None:
        """Create storage schema/tables"""
        raise NotImplementedError
    
    @abstractmethod
    async def drop(self) -> None:
        """Drop storage schema/tables"""
        raise NotImplementedError
    
    @abstractmethod
    async def exists(self) -> bool:
        """Check if storage exists"""
        raise NotImplementedError
    
    @abstractmethod
    async def upgrade_schema(self) -> None:
        """Upgrade storage schema"""
        raise NotImplementedError
    
    # Session operations
    @abstractmethod
    async def create_session(self, session: StorageSession) -> StorageSession:
        """Create a new session"""
        raise NotImplementedError
    
    @abstractmethod
    async def read_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[StorageSession]:
        """Read a session by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def update_session(self, session: StorageSession) -> StorageSession:
        """Update an existing session"""
        raise NotImplementedError
    
    @abstractmethod
    async def delete_session(self, session_id: str) -> bool:
        """Delete a session by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def list_sessions(
        self, 
        user_id: Optional[str] = None, 
        entity_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = 0
    ) -> List[StorageSession]:
        """List sessions with optional filtering"""
        raise NotImplementedError
    
    # Document operations
    @abstractmethod
    async def create_document(self, document: StorageDocument) -> StorageDocument:
        """Create a new document"""
        raise NotImplementedError
    
    @abstractmethod
    async def read_document(self, document_id: str, collection: str) -> Optional[StorageDocument]:
        """Read a document by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def update_document(self, document: StorageDocument) -> StorageDocument:
        """Update an existing document"""
        raise NotImplementedError
    
    @abstractmethod
    async def delete_document(self, document_id: str, collection: str) -> bool:
        """Delete a document by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def list_documents(
        self,
        collection: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = 0
    ) -> List[StorageDocument]:
        """List documents with optional filtering"""
        raise NotImplementedError
    
    # Query operations
    @abstractmethod
    async def query(self, query: StorageQuery) -> StorageResult:
        """Execute a query"""
        raise NotImplementedError
    
    # Health check
    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """Perform health check"""
        raise NotImplementedError
    
    # Statistics
    @abstractmethod
    async def get_statistics(self) -> Dict[str, Any]:
        """Get storage statistics"""
        raise NotImplementedError


class BaseVectorStorage(BaseStorage):
    """Base vector storage abstract class"""
    
    def __init__(self, mode: StorageMode = StorageMode.AGENT, dimension: Optional[int] = None):
        super().__init__(mode)
        self.dimension = dimension
    
    # Vector operations
    @abstractmethod
    async def create_vector(self, vector: StorageVector) -> StorageVector:
        """Create a new vector"""
        raise NotImplementedError
    
    @abstractmethod
    async def read_vector(self, vector_id: str, collection: str) -> Optional[StorageVector]:
        """Read a vector by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def update_vector(self, vector: StorageVector) -> StorageVector:
        """Update an existing vector"""
        raise NotImplementedError
    
    @abstractmethod
    async def delete_vector(self, vector_id: str, collection: str) -> bool:
        """Delete a vector by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def list_vectors(
        self,
        collection: str,
        filters: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = 0
    ) -> List[StorageVector]:
        """List vectors with optional filtering"""
        raise NotImplementedError
    
    # Vector search operations
    @abstractmethod
    async def vector_search(
        self,
        collection: str,
        query_vector: List[float],
        limit: int = 10,
        distance_metric: DistanceMetric = DistanceMetric.COSINE,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[StorageVector]:
        """Search vectors by similarity"""
        raise NotImplementedError
    
    @abstractmethod
    async def hybrid_search(
        self,
        collection: str,
        query: str,
        query_vector: List[float],
        limit: int = 10,
        distance_metric: DistanceMetric = DistanceMetric.COSINE,
        filters: Optional[Dict[str, Any]] = None
    ) -> List[StorageVector]:
        """Perform hybrid search (text + vector)"""
        raise NotImplementedError
    
    # Index operations
    @abstractmethod
    async def create_index(
        self,
        collection: str,
        index_type: IndexType,
        distance_metric: DistanceMetric = DistanceMetric.COSINE,
        parameters: Optional[Dict[str, Any]] = None
    ) -> StorageIndex:
        """Create a vector index"""
        raise NotImplementedError
    
    @abstractmethod
    async def read_index(self, index_id: str) -> Optional[StorageIndex]:
        """Read an index by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def delete_index(self, index_id: str) -> bool:
        """Delete an index by ID"""
        raise NotImplementedError
    
    @abstractmethod
    async def list_indexes(self, collection: str) -> List[StorageIndex]:
        """List indexes for a collection"""
        raise NotImplementedError
    
    @abstractmethod
    async def get_index_status(self, index_id: str) -> Dict[str, Any]:
        """Get index building status"""
        raise NotImplementedError
    
    # Batch operations
    @abstractmethod
    async def batch_create_vectors(self, vectors: List[StorageVector]) -> List[StorageVector]:
        """Create multiple vectors in batch"""
        raise NotImplementedError
    
    @abstractmethod
    async def batch_update_vectors(self, vectors: List[StorageVector]) -> List[StorageVector]:
        """Update multiple vectors in batch"""
        raise NotImplementedError
    
    @abstractmethod
    async def batch_delete_vectors(self, vector_ids: List[str], collection: str) -> bool:
        """Delete multiple vectors in batch"""
        raise NotImplementedError
    
    # Vector utilities
    @abstractmethod
    async def get_vector_dimension(self, collection: str) -> Optional[int]:
        """Get vector dimension for a collection"""
        raise NotImplementedError
    
    @abstractmethod
    async def validate_vector(self, vector: List[float], collection: str) -> bool:
        """Validate vector dimension and format"""
        raise NotImplementedError
    
    @abstractmethod
    async def calculate_distance(
        self,
        vector1: List[float],
        vector2: List[float],
        metric: DistanceMetric = DistanceMetric.COSINE
    ) -> float:
        """Calculate distance between two vectors"""
        raise NotImplementedError 