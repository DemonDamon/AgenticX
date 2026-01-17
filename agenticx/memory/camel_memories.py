"""
CAMEL-style Memory Implementations

This module provides memory implementations inspired by CAMEL-AI's memory system:
- ChatHistoryMemory: Chat history memory using key-value storage
- VectorDBMemory: Vector database memory for semantic search
- LongtermAgentMemory: Long-term agent memory for persistent storage

These implementations adapt CAMEL's memory concepts to AgenticX's BaseMemory interface.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
from collections import deque

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError
from ..storage.key_value_storages.base import BaseKeyValueStorage
from ..storage.key_value_storages.in_memory import InMemoryStorage


class ChatHistoryMemory(BaseMemory):
    """
    Chat history memory implementation inspired by CAMEL's ChatHistoryBlock.
    
    Stores chat messages in chronological order with windowed retrieval support.
    Uses key-value storage backend for persistence.
    
    Example:
        >>> memory = ChatHistoryMemory(tenant_id="user_123")
        >>> await memory.add("Hello, how are you?", metadata={"role": "user"})
        >>> await memory.add("I'm doing well, thank you!", metadata={"role": "assistant"})
        >>> results = await memory.search("greeting", limit=5)
    """
    
    def __init__(
        self,
        tenant_id: str,
        storage: Optional[Any] = None,  # BaseKeyValueStorage
        keep_rate: float = 0.9,
        max_history: Optional[int] = None,
        **kwargs
    ):
        """
        Initialize chat history memory.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            storage: Key-value storage backend (defaults to InMemoryKeyValueStorage)
            keep_rate: Score decay rate for historical messages (0-1)
            max_history: Maximum number of messages to keep (None for unlimited)
            **kwargs: Additional configuration options
        """
        super().__init__(tenant_id, **kwargs)
        
        if keep_rate > 1 or keep_rate < 0:
            raise ValueError("`keep_rate` should be in [0,1]")
        
        self.storage = storage or InMemoryStorage()
        self.keep_rate = keep_rate
        self.max_history = max_history
        
        # In-memory cache for fast access
        self._message_queue: deque = deque()
        self._records: Dict[str, MemoryRecord] = {}
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """Add a new chat message to history."""
        try:
            if record_id is None:
                record_id = self._generate_record_id()
            
            metadata = self._ensure_tenant_isolation(metadata or {})
            metadata.setdefault("role", "user")  # Default role
            
            now = datetime.now()
            record = MemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=now,
                updated_at=now
            )
            
            # Store in memory
            self._records[record_id] = record
            self._message_queue.append(record_id)
            
            # Enforce max history limit
            if self.max_history and len(self._message_queue) > self.max_history:
                oldest_id = self._message_queue.popleft()
                del self._records[oldest_id]
            
            # Persist to storage
            await self._persist_to_storage()
            
            return record_id
            
        except Exception as e:
            raise MemoryError(f"Failed to add chat message: {str(e)}") from e
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0,
        window_size: Optional[int] = None
    ) -> List[SearchResult]:
        """
        Search chat history with optional windowing.
        
        Args:
            query: Search query string
            limit: Maximum number of results
            metadata_filter: Optional metadata filter
            min_score: Minimum relevance score
            window_size: Optional window size for recent messages only
        """
        try:
            # Don't reload from storage here - use current in-memory state
            # This ensures that delete/clear operations are respected
            
            # Get records to search
            if window_size is not None and window_size > 0:
                # Use windowed retrieval (recent messages)
                record_ids = list(self._message_queue)[-window_size:]
                records_to_search = [
                    self._records[rid] for rid in record_ids if rid in self._records
                ]
            else:
                # Search all records
                records_to_search = list(self._records.values())
            
            results = []
            query_lower = query.lower()
            
            for record in records_to_search:
                # Apply metadata filter
                if metadata_filter and not self._matches_metadata_filter(record, metadata_filter):
                    continue
                
                # Calculate relevance score
                score = self._calculate_relevance_score(record.content, query_lower)
                
                # Apply keep_rate decay for older messages
                if window_size is None and len(self._message_queue) > 0:
                    try:
                        index = list(self._message_queue).index(record.id)
                        decay_factor = self.keep_rate ** (len(self._message_queue) - index - 1)
                        score *= decay_factor
                    except ValueError:
                        pass  # Record not in queue, use original score
                
                if score >= min_score:
                    results.append(SearchResult(record=record, score=score))
            
            # Sort by score and limit
            results.sort(key=lambda x: x.score, reverse=True)
            return results[:limit]
            
        except Exception as e:
            raise MemoryError(f"Failed to search chat history: {str(e)}") from e
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing chat message."""
        try:
            # Don't reload - work with current state
            if record_id not in self._records:
                return False
            
            record = self._records[record_id]
            
            if content is not None:
                record.content = content
                record.updated_at = datetime.now()
            
            if metadata is not None:
                record.metadata.update(self._ensure_tenant_isolation(metadata))
            
            await self._persist_to_storage()
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to update chat message: {str(e)}") from e
    
    async def delete(self, record_id: str) -> bool:
        """Delete a chat message."""
        try:
            # Don't reload - work with current state
            if record_id not in self._records:
                return False
            
            del self._records[record_id]
            
            # Remove from queue
            if record_id in self._message_queue:
                self._message_queue.remove(record_id)
            
            # Persist deletion to storage
            await self._persist_to_storage()
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to delete chat message: {str(e)}") from e
    
    async def clear(self) -> None:
        """Clear all chat history."""
        try:
            self._records.clear()
            self._message_queue.clear()
            await self._persist_to_storage()
        except Exception as e:
            raise MemoryError(f"Failed to clear chat history: {str(e)}") from e
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID."""
        try:
            # Don't reload - use current state
            return self._records.get(record_id)
        except Exception as e:
            raise MemoryError(f"Failed to get memory record: {str(e)}") from e
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records, optionally filtered."""
        try:
            # Don't reload - use current state
            
            records = list(self._records.values())
            
            # Apply metadata filter
            if metadata_filter:
                records = [
                    r for r in records
                    if self._matches_metadata_filter(r, metadata_filter)
                ]
            
            # Apply offset and limit
            records = records[offset:offset + limit]
            
            return records
        except Exception as e:
            raise MemoryError(f"Failed to list memory records: {str(e)}") from e
    
    async def get_recent_messages(self, count: int) -> List[MemoryRecord]:
        """
        Get recent chat messages.
        
        Args:
            count: Number of recent messages to retrieve
            
        Returns:
            List of recent memory records (most recent last)
        """
        # Don't reload from storage - use current in-memory state
        
        # Get the last 'count' record IDs from the queue
        record_ids = list(self._message_queue)[-count:]
        
        # Return records in order (oldest first, newest last)
        return [
            self._records[rid] for rid in record_ids if rid in self._records
        ]
    
    def _generate_record_id(self) -> str:
        """Generate a unique record ID."""
        import uuid
        return f"chat_{uuid.uuid4().hex[:12]}"
    
    def _ensure_tenant_isolation(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure tenant isolation in metadata."""
        metadata = metadata.copy()
        metadata["tenant_id"] = self.tenant_id
        return metadata
    
    def _matches_metadata_filter(
        self,
        record: MemoryRecord,
        metadata_filter: Dict[str, Any]
    ) -> bool:
        """Check if record matches metadata filter."""
        for key, value in metadata_filter.items():
            if key not in record.metadata or record.metadata[key] != value:
                return False
        return True
    
    def _calculate_relevance_score(self, content: str, query: str) -> float:
        """Calculate simple text-based relevance score."""
        content_lower = content.lower()
        query_words = query.split()
        
        if not query_words:
            return 0.0
        
        matches = sum(1 for word in query_words if word in content_lower)
        return matches / len(query_words)
    
    async def _persist_to_storage(self) -> None:
        """Persist records to storage backend."""
        try:
            # Convert records to dict format for storage
            records_dict = {
                record_id: {
                    "id": record.id,
                    "content": record.content,
                    "metadata": record.metadata,
                    "created_at": record.created_at.isoformat(),
                    "updated_at": record.updated_at.isoformat(),
                }
                for record_id, record in self._records.items()
            }
            
            # Store using key-value storage
            if hasattr(self.storage, 'save'):
                # InMemoryStorage.save expects a list
                records_list = [{"key": k, "value": v} for k, v in records_dict.items()]
                self.storage.save(records_list)
            elif hasattr(self.storage, 'set'):
                # Store as a single dict under tenant_id
                self.storage.set(self.tenant_id, records_dict)
            elif hasattr(self.storage, 'store'):
                await self.storage.store(self.tenant_id, records_dict)
        except Exception as e:
            # Log but don't fail - in-memory cache is still available
            import logging
            logging.getLogger(__name__).warning(f"Failed to persist to storage: {e}")
    
    async def _load_from_storage(self) -> None:
        """Load records from storage backend."""
        try:
            records_dict = {}
            
            if hasattr(self.storage, 'load'):
                # InMemoryStorage.load returns a list
                records_list = self.storage.load()
                records_dict = {r.get('key', ''): r.get('value', {}) for r in records_list if isinstance(r, dict)}
            elif hasattr(self.storage, 'get'):
                # Get by tenant_id
                data = self.storage.get(self.tenant_id)
                if isinstance(data, dict):
                    records_dict = data
            elif hasattr(self.storage, 'retrieve'):
                records_dict = await self.storage.retrieve(self.tenant_id) or {}
            else:
                return  # No storage method available
            
            # Reconstruct records
            for record_id, record_data in records_dict.items():
                if not isinstance(record_data, dict) or "id" not in record_data:
                    continue
                    
                record = MemoryRecord(
                    id=record_data["id"],
                    content=record_data["content"],
                    metadata=record_data["metadata"],
                    tenant_id=self.tenant_id,
                    created_at=datetime.fromisoformat(record_data["created_at"]),
                    updated_at=datetime.fromisoformat(record_data["updated_at"]),
                )
                self._records[record_id] = record
                if record_id not in self._message_queue:
                    self._message_queue.append(record_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to load from storage: {e}")


class VectorDBMemory(BaseMemory):
    """
    Vector database memory implementation inspired by CAMEL's VectorDBBlock.
    
    Stores memory records as vector embeddings for semantic search.
    Uses vector storage backend for similarity search.
    
    Example:
        >>> from agenticx.storage.vectordb_storages.faiss import FAISSStorage
        >>> storage = FAISSStorage(vector_dim=384)
        >>> memory = VectorDBMemory(tenant_id="user_123", storage=storage)
        >>> await memory.add("Python is a programming language")
        >>> results = await memory.search("programming", limit=5)
    """
    
    def __init__(
        self,
        tenant_id: str,
        storage: Optional[Any] = None,  # BaseVectorStorage
        embedding: Optional[Any] = None,  # BaseEmbedding
        **kwargs
    ):
        """
        Initialize vector database memory.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            storage: Vector storage backend (optional)
            embedding: Embedding model for text-to-vector conversion (optional)
            **kwargs: Additional configuration options
        """
        super().__init__(tenant_id, **kwargs)
        
        # Try to import vector storage and embedding if not provided
        if storage is None:
            try:
                from ..storage.vectordb_storages.faiss import FaissStorage
                # Default to FAISS with a reasonable dimension
                storage = FaissStorage(dimension=384)
            except ImportError:
                # If FAISS is not available, we'll use a fallback mode
                # that only supports text-based search
                storage = None
        
        if embedding is None:
            # No default embedding available
            # Will fallback to text-based similarity search
            embedding = None
        
        self.storage = storage
        self.embedding = embedding
        self._records: Dict[str, MemoryRecord] = {}
        
        # If no storage is available, we'll use text-based search only
        if self.storage is None and self.embedding is None:
            # This is acceptable - we'll use text-based search as fallback
            pass
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """Add a new memory record with vector embedding."""
        try:
            if record_id is None:
                record_id = self._generate_record_id()
            
            metadata = self._ensure_tenant_isolation(metadata or {})
            
            now = datetime.now()
            record = MemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=now,
                updated_at=now
            )
            
            self._records[record_id] = record
            
            # Generate embedding and store in vector DB if storage is available
            if self.storage:
                if self.embedding:
                    vector = await self._get_embedding(content)
                    await self._store_vector(record_id, vector, record)
                else:
                    # Fallback: store metadata only
                    await self._store_vector(record_id, None, record)
            # If no storage, we just keep records in memory for text-based search
            
            return record_id
            
        except Exception as e:
            raise MemoryError(f"Failed to add vector memory: {str(e)}") from e
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search memory using vector similarity."""
        try:
            # If no storage or embedding, use text-based search
            if not self.storage or not self.embedding:
                return await self._text_based_search(query, limit, metadata_filter, min_score)
            
            # Generate query embedding
            query_vector = await self._get_embedding(query)
            
            # Query vector storage
            if hasattr(self.storage, 'query'):
                from ..storage.vectordb_storages.base import VectorDBQuery
                query_obj = VectorDBQuery(query_vector=query_vector, top_k=limit)
                
                import inspect
                if inspect.iscoroutinefunction(self.storage.query):
                    results = await self.storage.query(query_obj)
                else:
                    results = self.storage.query(query_obj)
            else:
                # Fallback search
                return await self._text_based_search(query, limit, metadata_filter, min_score)
            
            # Convert to SearchResult format
            search_results = []
            for result in results:
                # Handle VectorDBQueryResult format
                if hasattr(result, 'record') and hasattr(result, 'similarity'):
                    # It's a VectorDBQueryResult object
                    record_id = result.record.id
                    score = result.similarity
                    payload = result.record.payload or {}
                else:
                    # It's a dict format
                    record_id = result.get('id') or result.get('record_id')
                    score = result.get('score', result.get('similarity', 0.0))
                    payload = result.get('payload', {})
                
                if record_id in self._records and score >= min_score:
                    record = self._records[record_id]
                    
                    # Apply metadata filter
                    if metadata_filter and not self._matches_metadata_filter(record, metadata_filter):
                        continue
                    
                    search_results.append(SearchResult(record=record, score=float(score)))
            
            # Sort by score and limit
            search_results.sort(key=lambda x: x.score, reverse=True)
            return search_results[:limit]
            
        except Exception as e:
            raise MemoryError(f"Failed to search vector memory: {str(e)}") from e
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update a memory record and re-embed if content changed."""
        try:
            if record_id not in self._records:
                return False
            
            record = self._records[record_id]
            content_changed = False
            
            if content is not None:
                record.content = content
                record.updated_at = datetime.now()
                content_changed = True
            
            if metadata is not None:
                record.metadata.update(self._ensure_tenant_isolation(metadata))
            
            # Re-embed if content changed and storage/embedding available
            if content_changed and self.storage and self.embedding:
                vector = await self._get_embedding(content)
                await self._store_vector(record_id, vector, record)
            
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to update vector memory: {str(e)}") from e
    
    async def delete(self, record_id: str) -> bool:
        """Delete a memory record from both cache and vector storage."""
        try:
            if record_id not in self._records:
                return False
            
            # Delete from vector storage
            if self.storage and hasattr(self.storage, 'delete'):
                import inspect
                # FaissStorage.delete() expects List[str]
                if inspect.iscoroutinefunction(self.storage.delete):
                    await self.storage.delete([record_id])
                else:
                    self.storage.delete([record_id])
            
            del self._records[record_id]
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to delete vector memory: {str(e)}") from e
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID."""
        try:
            return self._records.get(record_id)
        except Exception as e:
            raise MemoryError(f"Failed to get memory record: {str(e)}") from e
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records, optionally filtered."""
        try:
            records = list(self._records.values())
            
            # Apply metadata filter
            if metadata_filter:
                records = [
                    r for r in records
                    if self._matches_metadata_filter(r, metadata_filter)
                ]
            
            # Apply offset and limit
            records = records[offset:offset + limit]
            
            return records
        except Exception as e:
            raise MemoryError(f"Failed to list memory records: {str(e)}") from e
    
    async def clear(self) -> None:
        """Clear all memory records."""
        try:
            self._records.clear()
            if self.storage and hasattr(self.storage, 'clear'):
                import inspect
                if inspect.iscoroutinefunction(self.storage.clear):
                    await self.storage.clear()
                else:
                    self.storage.clear()
        except Exception as e:
            raise MemoryError(f"Failed to clear vector memory: {str(e)}") from e
    
    async def _get_embedding(self, text: str) -> List[float]:
        """Get embedding vector for text."""
        if hasattr(self.embedding, 'embed_async'):
            return await self.embedding.embed_async(text)
        elif hasattr(self.embedding, 'embed'):
            return self.embedding.embed(text)
        else:
            raise ValueError("Embedding model must have 'embed' or 'embed_async' method")
    
    async def _store_vector(
        self,
        record_id: str,
        vector: Optional[List[float]],
        record: MemoryRecord
    ) -> None:
        """Store vector in vector storage."""
        if not self.storage:
            return
        
        # Check if storage uses VectorRecord format (like FaissStorage)
        try:
            from ..storage.vectordb_storages.base import VectorRecord
            
            # FaissStorage.add() expects List[VectorRecord]
            if vector is None:
                # Create a zero vector if no embedding available
                # Use a default dimension (384) or get from storage
                dimension = getattr(self.storage, 'dimension', 384)
                vector = [0.0] * dimension
            
            vector_record = VectorRecord(
                id=record_id,
                vector=vector,
                payload={
                    "content": record.content,
                    "metadata": record.metadata,
                    "created_at": record.created_at.isoformat(),
                    "updated_at": record.updated_at.isoformat(),
                }
            )
            
            # Call add with list of records
            if hasattr(self.storage, 'add'):
                # Check if it's async
                import inspect
                if inspect.iscoroutinefunction(self.storage.add):
                    await self.storage.add([vector_record])
                else:
                    self.storage.add([vector_record])
                return
        except ImportError:
            pass
        
        # Fallback: try other storage interfaces
        if hasattr(self.storage, 'insert'):
            if vector is None:
                dimension = getattr(self.storage, 'dimension', 384)
                vector = [0.0] * dimension
            import inspect
            if inspect.iscoroutinefunction(self.storage.insert):
                await self.storage.insert(
                    record_id,
                    vector,
                    record.content,
                    metadata=record.metadata
                )
            else:
                self.storage.insert(
                    record_id,
                    vector,
                    record.content,
                    metadata=record.metadata
                )
    
    async def _text_based_search(
        self,
        query: str,
        limit: int,
        metadata_filter: Optional[Dict[str, Any]],
        min_score: float
    ) -> List[SearchResult]:
        """Fallback text-based search when embedding is not available."""
        results = []
        query_lower = query.lower()
        
        for record in self._records.values():
            if metadata_filter and not self._matches_metadata_filter(record, metadata_filter):
                continue
            
            score = self._calculate_relevance_score(record.content, query_lower)
            if score >= min_score:
                results.append(SearchResult(record=record, score=score))
        
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:limit]
    
    def _generate_record_id(self) -> str:
        """Generate a unique record ID."""
        import uuid
        return f"vector_{uuid.uuid4().hex[:12]}"
    
    def _ensure_tenant_isolation(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure tenant isolation in metadata."""
        metadata = metadata.copy()
        metadata["tenant_id"] = self.tenant_id
        return metadata
    
    def _matches_metadata_filter(
        self,
        record: MemoryRecord,
        metadata_filter: Dict[str, Any]
    ) -> bool:
        """Check if record matches metadata filter."""
        for key, value in metadata_filter.items():
            if key not in record.metadata or record.metadata[key] != value:
                return False
        return True
    
    def _calculate_relevance_score(self, content: str, query: str) -> float:
        """Calculate simple text-based relevance score."""
        content_lower = content.lower()
        query_words = query.split()
        
        if not query_words:
            return 0.0
        
        matches = sum(1 for word in query_words if word in content_lower)
        return matches / len(query_words)


class LongtermAgentMemory(BaseMemory):
    """
    Long-term agent memory implementation for persistent agent knowledge.
    
    Combines chat history and vector storage for comprehensive long-term memory.
    Suitable for agents that need to remember information across sessions.
    
    Example:
        >>> memory = LongtermAgentMemory(tenant_id="agent_123")
        >>> await memory.add("User prefers dark mode", metadata={"preference": "ui"})
        >>> await memory.add("User's favorite programming language is Python")
        >>> results = await memory.search("preferences", limit=5)
    """
    
    def __init__(
        self,
        tenant_id: str,
        chat_memory: Optional[ChatHistoryMemory] = None,
        vector_memory: Optional[VectorDBMemory] = None,
        **kwargs
    ):
        """
        Initialize long-term agent memory.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            chat_memory: Chat history memory instance (optional)
            vector_memory: Vector database memory instance (optional)
            **kwargs: Additional configuration options
        """
        super().__init__(tenant_id, **kwargs)
        
        self.chat_memory = chat_memory or ChatHistoryMemory(tenant_id=tenant_id)
        
        # Try to create vector memory, but fallback to chat-only if dependencies are missing
        if vector_memory is None:
            try:
                self.vector_memory = VectorDBMemory(tenant_id=tenant_id)
            except (ValueError, ImportError, AttributeError):
                # If vector storage is not available, use chat memory only
                # This allows LongtermAgentMemory to work without vector dependencies
                self.vector_memory = None
        else:
            self.vector_memory = vector_memory
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """Add memory to both chat history and vector storage."""
        # Add to vector memory (for semantic search) if available
        if self.vector_memory:
            vector_id = await self.vector_memory.add(content, metadata, record_id)
        else:
            # Fallback: use chat memory ID generation
            vector_id = record_id or self.chat_memory._generate_record_id()
        
        # Also add to chat history if it's a conversation
        if metadata and metadata.get("role") in ["user", "assistant"]:
            await self.chat_memory.add(content, metadata, record_id or vector_id)
        else:
            # Even if not a conversation, add to chat memory for completeness
            await self.chat_memory.add(content, metadata, record_id or vector_id)
        
        return vector_id
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search both chat history and vector memory."""
        # Search vector memory (primary) if available
        if self.vector_memory:
            vector_results = await self.vector_memory.search(
                query, limit=limit, metadata_filter=metadata_filter, min_score=min_score
            )
        else:
            vector_results = []
        
        # Also search chat history for recent context
        chat_results = await self.chat_memory.search(
            query, limit=limit // 2 if self.vector_memory else limit,
            metadata_filter=metadata_filter, min_score=min_score
        )
        
        # Combine and deduplicate results
        seen_ids = set()
        combined_results = []
        
        for result in vector_results + chat_results:
            if result.record.id not in seen_ids:
                seen_ids.add(result.record.id)
                combined_results.append(result)
        
        # Sort by score and limit
        combined_results.sort(key=lambda x: x.score, reverse=True)
        return combined_results[:limit]
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update memory in both stores."""
        vector_updated = False
        if self.vector_memory:
            vector_updated = await self.vector_memory.update(record_id, content, metadata)
        chat_updated = await self.chat_memory.update(record_id, content, metadata)
        return vector_updated or chat_updated
    
    async def delete(self, record_id: str) -> bool:
        """Delete memory from both stores."""
        vector_deleted = False
        if self.vector_memory:
            vector_deleted = await self.vector_memory.delete(record_id)
        chat_deleted = await self.chat_memory.delete(record_id)
        return vector_deleted or chat_deleted
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID."""
        # Try vector memory first if available
        if self.vector_memory:
            record = await self.vector_memory.get(record_id)
            if record:
                return record
        return await self.chat_memory.get(record_id)
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records from both stores."""
        vector_records = []
        if self.vector_memory:
            vector_records = await self.vector_memory.list_all(limit, offset, metadata_filter)
        chat_records = await self.chat_memory.list_all(limit, offset, metadata_filter)
        
        # Combine and deduplicate
        seen_ids = set()
        combined = []
        for record in vector_records + chat_records:
            if record.id not in seen_ids:
                seen_ids.add(record.id)
                combined.append(record)
        
        # Apply offset and limit
        combined = combined[offset:offset + limit]
        
        return combined
    
    async def clear(self) -> None:
        """Clear all memory from both stores."""
        if self.vector_memory:
            await self.vector_memory.clear()
        await self.chat_memory.clear()
