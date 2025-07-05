"""
Short-term Memory Implementation

Implements session-based volatile memory for temporary context storage.
"""

import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime
from collections import defaultdict, deque

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError, MemoryNotFoundError


class ShortTermMemory(BaseMemory):
    """
    Session-based volatile memory implementation.
    
    Stores memory records in-memory with optional TTL (time-to-live) support.
    Data is lost when the process terminates.
    """
    
    def __init__(
        self,
        tenant_id: str,
        max_records: int = 1000,
        ttl_seconds: Optional[int] = None,
        **kwargs
    ):
        """
        Initialize short-term memory.
        
        Args:
            tenant_id: Unique identifier for tenant isolation
            max_records: Maximum number of records to keep (LRU eviction)
            ttl_seconds: Time-to-live for records in seconds (None for no expiration)
            **kwargs: Additional configuration options
        """
        super().__init__(tenant_id, **kwargs)
        self.max_records = max_records
        self.ttl_seconds = ttl_seconds
        
        # In-memory storage
        self._records: Dict[str, MemoryRecord] = {}
        self._access_order: deque = deque()  # For LRU eviction
        self._content_index: Dict[str, List[str]] = defaultdict(list)  # Simple content indexing
        
        # Background cleanup task
        self._cleanup_task = None
        if ttl_seconds:
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_records())
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None
    ) -> str:
        """Add a new memory record."""
        try:
            # Generate ID if not provided
            if record_id is None:
                record_id = self._generate_record_id()
            
            # Ensure tenant isolation
            metadata = self._ensure_tenant_isolation(metadata)
            
            # Create record
            now = datetime.now()
            record = MemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=now,
                updated_at=now
            )
            
            # Store record
            self._records[record_id] = record
            self._access_order.append(record_id)
            
            # Update content index for search
            self._update_content_index(record_id, content)
            
            # Enforce max records limit (LRU eviction)
            await self._enforce_max_records()
            
            return record_id
            
        except Exception as e:
            raise MemoryError(f"Failed to add memory record: {str(e)}") from e
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search for relevant memory records."""
        try:
            results = []
            query_lower = query.lower()
            
            for record_id, record in self._records.items():
                # Skip if record doesn't match metadata filter
                if metadata_filter and not self._matches_metadata_filter(record, metadata_filter):
                    continue
                
                # Simple text-based scoring
                score = self._calculate_relevance_score(record.content, query_lower)
                
                if score >= min_score:
                    results.append(SearchResult(record=record, score=score))
            
            # Sort by score (descending) and limit results
            results.sort(key=lambda x: x.score, reverse=True)
            return results[:limit]
            
        except Exception as e:
            raise MemoryError(f"Failed to search memory: {str(e)}") from e
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory record."""
        try:
            if record_id not in self._records:
                return False
            
            record = self._records[record_id]
            
            # Update content if provided
            if content is not None:
                # Remove old content from index
                self._remove_from_content_index(record_id, record.content)
                
                # Update content
                record.content = content
                record.updated_at = datetime.now()
                
                # Update content index
                self._update_content_index(record_id, content)
            
            # Update metadata if provided
            if metadata is not None:
                # Merge with existing metadata
                updated_metadata = record.metadata.copy()
                updated_metadata.update(metadata)
                record.metadata = self._ensure_tenant_isolation(updated_metadata)
                record.updated_at = datetime.now()
            
            # Update access order for LRU
            self._update_access_order(record_id)
            
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to update memory record: {str(e)}") from e
    
    async def delete(self, record_id: str) -> bool:
        """Delete a memory record."""
        try:
            if record_id not in self._records:
                return False
            
            record = self._records[record_id]
            
            # Remove from content index
            self._remove_from_content_index(record_id, record.content)
            
            # Remove from storage
            del self._records[record_id]
            
            # Remove from access order
            try:
                self._access_order.remove(record_id)
            except ValueError:
                pass  # Already removed
            
            return True
            
        except Exception as e:
            raise MemoryError(f"Failed to delete memory record: {str(e)}") from e
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """Get a specific memory record by ID."""
        try:
            if record_id not in self._records:
                return None
            
            # Update access order for LRU
            self._update_access_order(record_id)
            
            return self._records[record_id]
            
        except Exception as e:
            raise MemoryError(f"Failed to get memory record: {str(e)}") from e
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records for the current tenant."""
        try:
            records = []
            
            for record in self._records.values():
                # Skip if record doesn't match metadata filter
                if metadata_filter and not self._matches_metadata_filter(record, metadata_filter):
                    continue
                
                records.append(record)
            
            # Sort by creation time (newest first)
            records.sort(key=lambda x: x.created_at, reverse=True)
            
            # Apply offset and limit
            return records[offset:offset + limit]
            
        except Exception as e:
            raise MemoryError(f"Failed to list memory records: {str(e)}") from e
    
    async def clear(self) -> int:
        """Clear all memory records for the current tenant."""
        try:
            count = len(self._records)
            self._records.clear()
            self._access_order.clear()
            self._content_index.clear()
            return count
            
        except Exception as e:
            raise MemoryError(f"Failed to clear memory: {str(e)}") from e
    
    def _calculate_relevance_score(self, content: str, query: str) -> float:
        """
        Calculate relevance score between content and query.
        
        Simple implementation using keyword matching and position weighting.
        """
        content_lower = content.lower()
        
        # Exact match gets highest score
        if query in content_lower:
            return 1.0
        
        # Word-based matching
        query_words = query.split()
        content_words = content_lower.split()
        
        if not query_words:
            return 0.0
        
        # Count matching words
        matching_words = 0
        for word in query_words:
            if word in content_words:
                matching_words += 1
        
        # Calculate score based on word overlap
        score = matching_words / len(query_words)
        
        # Boost score if query words appear close together
        if matching_words > 1:
            for i, word in enumerate(content_words):
                if word in query_words:
                    # Check for adjacent query words
                    for j in range(1, min(len(query_words), len(content_words) - i)):
                        if content_words[i + j] in query_words:
                            score += 0.1  # Proximity bonus
                        else:
                            break
        
        return min(1.0, score)
    
    def _matches_metadata_filter(self, record: MemoryRecord, metadata_filter: Dict[str, Any]) -> bool:
        """Check if record matches metadata filter."""
        for key, value in metadata_filter.items():
            if key not in record.metadata or record.metadata[key] != value:
                return False
        return True
    
    def _update_content_index(self, record_id: str, content: str):
        """Update content index for search."""
        words = content.lower().split()
        for word in words:
            if record_id not in self._content_index[word]:
                self._content_index[word].append(record_id)
    
    def _remove_from_content_index(self, record_id: str, content: str):
        """Remove record from content index."""
        words = content.lower().split()
        for word in words:
            if record_id in self._content_index[word]:
                self._content_index[word].remove(record_id)
                if not self._content_index[word]:
                    del self._content_index[word]
    
    def _update_access_order(self, record_id: str):
        """Update access order for LRU."""
        try:
            self._access_order.remove(record_id)
        except ValueError:
            pass  # Not in list
        self._access_order.append(record_id)
    
    async def _enforce_max_records(self):
        """Enforce maximum records limit using LRU eviction."""
        while len(self._records) > self.max_records:
            # Remove oldest accessed record
            if self._access_order:
                oldest_id = self._access_order.popleft()
                if oldest_id in self._records:
                    record = self._records[oldest_id]
                    self._remove_from_content_index(oldest_id, record.content)
                    del self._records[oldest_id]
    
    async def _cleanup_expired_records(self):
        """Background task to cleanup expired records."""
        while True:
            try:
                if self.ttl_seconds:
                    now = datetime.now()
                    expired_ids = []
                    
                    for record_id, record in self._records.items():
                        age = (now - record.created_at).total_seconds()
                        if age > self.ttl_seconds:
                            expired_ids.append(record_id)
                    
                    # Remove expired records
                    for record_id in expired_ids:
                        await self.delete(record_id)
                
                # Sleep for 1 minute before next cleanup
                await asyncio.sleep(60)
                
            except asyncio.CancelledError:
                break
            except Exception:
                # Continue cleanup on error
                await asyncio.sleep(60)
    
    def __del__(self):
        """Cleanup background task on deletion."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel() 