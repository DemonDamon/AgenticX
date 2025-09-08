"""
Knowledge Base Implementation

Implements knowledge base functionality using metadata filtering, along with a KnowledgeBaseView class for creating scoped views.
"""

import logging
from typing import Any, Dict, List, Optional, Set
from datetime import datetime

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError

logger = logging.getLogger(__name__)


class KnowledgeBase:
    """
    Knowledge base implementation using metadata-based namespace isolation.
    
    Allows for mounting specific, scoped knowledge collections that can be
    read-only or read-write, with fine-grained access control.
    """
    
    def __init__(
        self,
        name: str,
        memory_backend: BaseMemory,
        read_only: bool = False,
        auto_tag: bool = True,
        allowed_content_types: Optional[Set[str]] = None,
        **kwargs
    ):
        """
        Initialize knowledge base.
        
        Args:
            name: Unique name for this knowledge base
            memory_backend: Backend memory implementation
            read_only: Whether this knowledge base is read-only
            auto_tag: Whether to automatically tag content with KB metadata
            allowed_content_types: Optional set of allowed content types
            **kwargs: Additional configuration options
        """
        self.name = name
        self.memory_backend = memory_backend
        self.read_only = read_only
        self.auto_tag = auto_tag
        self.allowed_content_types = allowed_content_types or set()
        self._config = kwargs
        
        # Knowledge base metadata
        self._kb_metadata = {
            "knowledge_base": self.name,
            "kb_created_at": datetime.now().isoformat(),
            "kb_read_only": self.read_only
        }
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
        content_type: Optional[str] = None
    ) -> str:
        """
        Add content to the knowledge base.
        
        Args:
            content: Content to add
            metadata: Optional metadata
            record_id: Optional record ID
            content_type: Optional content type
            
        Returns:
            Record ID of the added content
            
        Raises:
            MemoryError: If KB is read-only or content type not allowed
        """
        if self.read_only:
            raise MemoryError(f"Knowledge base '{self.name}' is read-only")
        
        # Validate content type
        if content_type and self.allowed_content_types and content_type not in self.allowed_content_types:
            raise MemoryError(f"Content type '{content_type}' not allowed in KB '{self.name}'")
        
        # Prepare metadata
        if metadata is None:
            metadata = {}
        else:
            metadata = metadata.copy()
        
        # Add KB metadata
        if self.auto_tag:
            metadata.update(self._kb_metadata)
            if content_type:
                metadata["content_type"] = content_type
        
        # Add to backend
        return await self.memory_backend.add(
            content=content,
            metadata=metadata,
            record_id=record_id
        )
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0,
        content_type: Optional[str] = None
    ) -> List[SearchResult]:
        """
        Search within the knowledge base.
        
        Args:
            query: Search query
            limit: Maximum results
            metadata_filter: Additional metadata filter
            min_score: Minimum relevance score
            content_type: Optional content type filter
            
        Returns:
            Search results from this knowledge base
        """
        # Build KB-specific filter
        kb_filter = {"knowledge_base": self.name}
        
        # Add content type filter if specified
        if content_type:
            kb_filter["content_type"] = content_type
        
        # Merge with additional filters
        if metadata_filter:
            kb_filter.update(metadata_filter)
        
        # Search in backend
        return await self.memory_backend.search(
            query=query,
            limit=limit,
            metadata_filter=kb_filter,
            min_score=min_score
        )
    
    async def get(self, record_id: str) -> Optional[MemoryRecord]:
        """
        Get a specific record from the knowledge base.
        
        Args:
            record_id: Record ID to retrieve
            
        Returns:
            Memory record if found and belongs to this KB, None otherwise
        """
        record = await self.memory_backend.get(record_id)
        
        if record and record.metadata.get("knowledge_base") == self.name:
            return record
        
        return None
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Update a record in the knowledge base.
        
        Args:
            record_id: Record ID to update
            content: New content (optional)
            metadata: New metadata (optional)
            
        Returns:
            True if update successful, False otherwise
            
        Raises:
            MemoryError: If KB is read-only or record doesn't belong to this KB
        """
        if self.read_only:
            raise MemoryError(f"Knowledge base '{self.name}' is read-only")
        
        # Check if record belongs to this KB
        existing_record = await self.get(record_id)
        if not existing_record:
            return False
        
        # Preserve KB metadata in updates
        if metadata:
            metadata = metadata.copy()
            if self.auto_tag:
                metadata.update(self._kb_metadata)
        
        return await self.memory_backend.update(
            record_id=record_id,
            content=content,
            metadata=metadata
        )
    
    async def delete(self, record_id: str) -> bool:
        """
        Delete a record from the knowledge base.
        
        Args:
            record_id: Record ID to delete
            
        Returns:
            True if deletion successful, False otherwise
            
        Raises:
            MemoryError: If KB is read-only or record doesn't belong to this KB
        """
        if self.read_only:
            raise MemoryError(f"Knowledge base '{self.name}' is read-only")
        
        # Check if record belongs to this KB
        existing_record = await self.get(record_id)
        if not existing_record:
            return False
        
        return await self.memory_backend.delete(record_id)
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        content_type: Optional[str] = None
    ) -> List[MemoryRecord]:
        """
        List all records in the knowledge base.
        
        Args:
            limit: Maximum records to return
            offset: Number of records to skip
            content_type: Optional content type filter
            
        Returns:
            List of memory records from this KB
        """
        # Build KB-specific filter
        kb_filter = {"knowledge_base": self.name}
        
        if content_type:
            kb_filter["content_type"] = content_type
        
        return await self.memory_backend.list_all(
            limit=limit,
            offset=offset,
            metadata_filter=kb_filter
        )
    
    async def clear(self) -> int:
        """
        Clear all records from the knowledge base.
        
        Returns:
            Number of records deleted
            
        Raises:
            MemoryError: If KB is read-only
        """
        if self.read_only:
            raise MemoryError(f"Knowledge base '{self.name}' is read-only")
        
        # Get all records in this KB
        all_records = await self.list_all(limit=10000)  # Large limit to get all
        
        # Delete each record
        deleted_count = 0
        for record in all_records:
            if await self.memory_backend.delete(record.id):
                deleted_count += 1
        
        return deleted_count
    
    async def get_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the knowledge base.
        
        Returns:
            Dictionary with KB statistics
        """
        # Get all records
        all_records = await self.list_all(limit=10000)
        
        # Calculate statistics
        stats = {
            "name": self.name,
            "total_records": len(all_records),
            "read_only": self.read_only,
            "content_types": {},
            "total_content_length": 0,
            "avg_content_length": 0.0,
            "created_at": self._kb_metadata.get("kb_created_at"),
            "last_updated": None
        }
        
        if all_records:
            # Content type distribution
            content_type_counts = {}
            total_length = 0
            latest_update = None
            
            for record in all_records:
                # Content type
                content_type = record.metadata.get("content_type", "unknown")
                content_type_counts[content_type] = content_type_counts.get(content_type, 0) + 1
                
                # Content length
                content_length = len(record.content)
                total_length += content_length
                
                # Latest update
                if latest_update is None or record.updated_at > latest_update:
                    latest_update = record.updated_at
            
            stats["content_types"] = content_type_counts
            stats["total_content_length"] = total_length
            stats["avg_content_length"] = total_length / len(all_records)
            stats["last_updated"] = latest_update.isoformat() if latest_update else None
        
        return stats
    
    async def export_data(self, include_metadata: bool = True) -> List[Dict[str, Any]]:
        """
        Export all data from the knowledge base.
        
        Args:
            include_metadata: Whether to include metadata in export
            
        Returns:
            List of record dictionaries
        """
        records = await self.list_all(limit=10000)
        
        exported_data: List[Dict[str, Any]] = []
        for record in records:
            record_data: Dict[str, Any] = {
                "id": record.id,
                "content": record.content,
                "created_at": record.created_at.isoformat(),
                "updated_at": record.updated_at.isoformat()
            }
            
            if include_metadata:
                record_data["metadata"] = record.metadata.copy()  # Create a copy to avoid reference issues
            
            exported_data.append(record_data)
        
        return exported_data
    
    async def import_data(
        self,
        data: List[Dict[str, Any]],
        overwrite_existing: bool = False
    ) -> Dict[str, int]:
        """
        Import data into the knowledge base.
        
        Args:
            data: List of record dictionaries to import
            overwrite_existing: Whether to overwrite existing records
            
        Returns:
            Dictionary with import statistics
            
        Raises:
            MemoryError: If KB is read-only
        """
        if self.read_only:
            raise MemoryError(f"Knowledge base '{self.name}' is read-only")
        
        stats = {
            "total_records": len(data),
            "imported": 0,
            "skipped": 0,
            "errors": 0
        }
        
        for record_data in data:
            try:
                record_id = record_data.get("id")
                content = record_data.get("content", "")
                metadata = record_data.get("metadata", {})
                
                # Check if record already exists
                if record_id and not overwrite_existing:
                    existing = await self.get(record_id)
                    if existing:
                        stats["skipped"] += 1
                        continue
                
                # Import record
                await self.add(
                    content=content,
                    metadata=metadata,
                    record_id=record_id
                )
                stats["imported"] += 1
                
            except Exception as e:
                logger.warning(f"Failed to import record: {e}")
                stats["errors"] += 1
        
        return stats
    
    def create_scoped_view(
        self,
        name: str,
        content_type_filter: Optional[str] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
        read_only: bool = True
    ) -> 'KnowledgeBaseView':
        """
        Create a scoped view of the knowledge base.
        
        Args:
            name: Name for the view
            content_type_filter: Optional content type filter
            metadata_filter: Optional metadata filter
            read_only: Whether the view is read-only
            
        Returns:
            KnowledgeBaseView instance
        """
        return KnowledgeBaseView(
            name=name,
            parent_kb=self,
            content_type_filter=content_type_filter,
            metadata_filter=metadata_filter,
            read_only=read_only
        )


class KnowledgeBaseView:
    """
    A filtered view of a knowledge base.
    
    Provides a scoped interface to a subset of KB records based on filters.
    """
    
    def __init__(
        self,
        name: str,
        parent_kb: KnowledgeBase,
        content_type_filter: Optional[str] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
        read_only: bool = True
    ):
        """
        Initialize knowledge base view.
        
        Args:
            name: Name for this view
            parent_kb: Parent knowledge base
            content_type_filter: Optional content type filter
            metadata_filter: Optional metadata filter
            read_only: Whether this view is read-only
        """
        self.name = name
        self.parent_kb = parent_kb
        self.content_type_filter = content_type_filter
        self.metadata_filter = metadata_filter or {}
        self.read_only = read_only
    
    def _apply_filters(self, metadata_filter: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Apply view filters to a metadata filter."""
        combined_filter = self.metadata_filter.copy()
        
        if self.content_type_filter:
            combined_filter["content_type"] = self.content_type_filter
        
        if metadata_filter:
            combined_filter.update(metadata_filter)
        
        return combined_filter
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search within the view."""
        combined_filter = self._apply_filters(metadata_filter)
        
        return await self.parent_kb.search(
            query=query,
            limit=limit,
            metadata_filter=combined_filter,
            min_score=min_score
        )
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0
    ) -> List[MemoryRecord]:
        """List all records in the view."""
        # Get records from parent KB and apply filters
        all_records = await self.parent_kb.list_all(limit=limit * 2, offset=offset)
        
        # Apply view filters
        filtered_records = []
        for record in all_records:
            # Check content type filter
            if self.content_type_filter:
                if record.metadata.get("content_type") != self.content_type_filter:
                    continue
            
            # Check metadata filters
            matches = True
            for key, value in self.metadata_filter.items():
                if record.metadata.get(key) != value:
                    matches = False
                    break
            
            if matches:
                filtered_records.append(record)
                if len(filtered_records) >= limit:
                    break
        
        return filtered_records
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the view."""
        records = await self.list_all(limit=10000)
        
        stats = {
            "view_name": self.name,
            "parent_kb": self.parent_kb.name,
            "total_records": len(records),
            "read_only": self.read_only,
            "content_type_filter": self.content_type_filter,
            "metadata_filter": self.metadata_filter
        }
        
        if records:
            total_length = sum(len(record.content) for record in records)
            stats["total_content_length"] = total_length
            stats["avg_content_length"] = total_length / len(records)
        
        return stats 