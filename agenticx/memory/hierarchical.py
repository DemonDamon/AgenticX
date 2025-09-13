"""
Hierarchical Memory Architecture

Implements a bionic six-layer memory architecture inspired by MIRIX,
designed to mimic human memory systems for enhanced AI agent capabilities.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta, UTC
from enum import Enum
import uuid
import json

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError


class MemoryType(Enum):
    """Memory layer types in the hierarchical architecture."""
    
    CORE = "core"              # Core memory - Agent identity and persistent info
    EPISODIC = "episodic"      # Episodic memory - Time-based events and experiences
    SEMANTIC = "semantic"      # Semantic memory - General knowledge and concepts
    PROCEDURAL = "procedural"  # Procedural memory - Skills and procedures
    RESOURCE = "resource"      # Resource memory - Documents and multimedia
    KNOWLEDGE = "knowledge"    # Knowledge vault - Sensitive information


class MemoryImportance(Enum):
    """Memory importance levels for prioritization."""
    
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


class MemorySensitivity(Enum):
    """Memory sensitivity levels for security."""
    
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    SECRET = "secret"


@dataclass
class MemoryEvent:
    """Memory event for tracking memory operations."""
    
    event_id: str
    event_type: str  # 'read', 'write', 'update', 'delete', 'decay'
    memory_type: MemoryType
    record_id: str
    timestamp: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def __post_init__(self):
        if not self.event_id:
            self.event_id = str(uuid.uuid4())


@dataclass
class HierarchicalMemoryRecord(MemoryRecord):
    """Enhanced memory record with hierarchical metadata."""
    
    memory_type: MemoryType
    importance: MemoryImportance = MemoryImportance.MEDIUM
    sensitivity: MemorySensitivity = MemorySensitivity.INTERNAL
    access_count: int = 0
    last_accessed: Optional[datetime] = None
    decay_factor: float = 1.0
    associations: List[str] = field(default_factory=list)  # Related record IDs
    source: Optional[str] = None
    context: Optional[Dict[str, Any]] = field(default_factory=dict)
    
    def __post_init__(self):
        super().__post_init__()
        if self.last_accessed is None:
            self.last_accessed = self.created_at


@dataclass
class SearchContext:
    """Context for memory search operations."""
    
    query_type: str = "general"  # 'general', 'temporal', 'semantic', 'procedural'
    time_range: Optional[Tuple[datetime, datetime]] = None
    importance_threshold: MemoryImportance = MemoryImportance.LOW
    memory_types: List[MemoryType] = field(default_factory=list)
    include_decayed: bool = True
    max_age: Optional[timedelta] = None


class BaseHierarchicalMemory(BaseMemory):
    """
    Base class for hierarchical memory layers.
    
    Extends BaseMemory with hierarchical-specific functionality.
    """
    
    def __init__(self, tenant_id: str, memory_type: MemoryType, **kwargs):
        super().__init__(tenant_id, **kwargs)
        self.memory_type = memory_type
        self._events: List[MemoryEvent] = []
    
    async def add(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
        importance: MemoryImportance = MemoryImportance.MEDIUM,
        sensitivity: MemorySensitivity = MemorySensitivity.INTERNAL,
        source: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Add a hierarchical memory record.
        
        Args:
            content: Memory content
            metadata: Optional metadata
            record_id: Optional custom record ID
            importance: Memory importance level
            sensitivity: Memory sensitivity level
            source: Optional source identifier
            context: Optional context information
            
        Returns:
            Record ID
        """
        if record_id is None:
            record_id = self._generate_record_id()
        
        now = datetime.now(UTC)
        
        # Create enhanced record
        record = HierarchicalMemoryRecord(
            id=record_id,
            content=content,
            metadata=self._ensure_tenant_isolation(metadata or {}),
            tenant_id=self.tenant_id,
            created_at=now,
            updated_at=now,
            memory_type=self.memory_type,
            importance=importance,
            sensitivity=sensitivity,
            source=source,
            context=context or {}
        )
        
        # Store the record
        await self._store_record(record)
        
        # Log event
        self._log_event(MemoryEvent(
            event_id=str(uuid.uuid4()),
            event_type="write",
            memory_type=self.memory_type,
            record_id=record_id,
            timestamp=now,
            metadata={"importance": importance.value, "sensitivity": sensitivity.value}
        ))
        
        return record_id
    
    async def search_hierarchical(
        self,
        query: str,
        context: Optional[SearchContext] = None,
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """
        Enhanced search with hierarchical context.
        
        Args:
            query: Search query
            context: Search context
            limit: Maximum results
            min_score: Minimum relevance score
            
        Returns:
            Search results
        """
        if context is None:
            context = SearchContext()
        
        # Apply hierarchical filters
        results = await self._hierarchical_search(query, context, limit, min_score)
        
        # Update access counts
        for result in results:
            await self._update_access_count(result.record.id)
        
        return results
    
    async def get_associations(self, record_id: str) -> List[HierarchicalMemoryRecord]:
        """Get associated memory records."""
        record = await self.get(record_id)
        # Check if record is of the correct type and has associations attribute
        if not record or not isinstance(record, HierarchicalMemoryRecord) or not hasattr(record, 'associations'):
            return []
        
        associations = []
        for assoc_id in record.associations:
            assoc_record = await self.get(assoc_id)
            # Ensure the associated record is of the correct type
            if assoc_record and isinstance(assoc_record, HierarchicalMemoryRecord):
                associations.append(assoc_record)
        
        return associations
    
    async def add_association(self, record_id: str, associated_id: str) -> bool:
        """Add association between memory records."""
        record = await self.get(record_id)
        # Check if record is of the correct type and has associations attribute
        if not record or not isinstance(record, HierarchicalMemoryRecord):
            return False
        
        if hasattr(record, 'associations') and associated_id not in record.associations:
            record.associations.append(associated_id)
            await self.update(record_id, metadata={"associations": record.associations})
            return True
        
        return False
    
    def _log_event(self, event: MemoryEvent):
        """Log memory event for observability."""
        self._events.append(event)
        
        # Keep only recent events to prevent memory bloat
        if len(self._events) > 1000:
            self._events = self._events[-500:]
    
    def get_recent_events(self, limit: int = 100) -> List[MemoryEvent]:
        """Get recent memory events."""
        return self._events[-limit:]
    
    @abstractmethod
    async def _store_record(self, record: HierarchicalMemoryRecord):
        """Store a hierarchical memory record."""
        pass
    
    @abstractmethod
    async def _hierarchical_search(
        self,
        query: str,
        context: SearchContext,
        limit: int,
        min_score: float
    ) -> List[SearchResult]:
        """Perform hierarchical search."""
        pass
    
    @abstractmethod
    async def _update_access_count(self, record_id: str):
        """Update access count for a record."""
        pass


class HierarchicalMemoryManager:
    """
    Manager for the hierarchical memory system.
    
    Coordinates operations across all memory layers.
    """
    
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self._layers: Dict[MemoryType, BaseHierarchicalMemory] = {}
        self._routing_rules: Dict[str, List[MemoryType]] = {
            "default": [MemoryType.CORE, MemoryType.EPISODIC, MemoryType.SEMANTIC],
            "temporal": [MemoryType.EPISODIC, MemoryType.CORE],
            "factual": [MemoryType.SEMANTIC, MemoryType.KNOWLEDGE],
            "procedural": [MemoryType.PROCEDURAL, MemoryType.SEMANTIC],
            "resource": [MemoryType.RESOURCE, MemoryType.SEMANTIC]
        }
    
    def register_layer(self, memory_type: MemoryType, layer: BaseHierarchicalMemory):
        """Register a memory layer."""
        self._layers[memory_type] = layer
    
    def get_layer(self, memory_type: MemoryType) -> Optional[BaseHierarchicalMemory]:
        """Get a memory layer."""
        return self._layers.get(memory_type)
    
    async def add_memory(
        self,
        content: str,
        memory_type: MemoryType,
        **kwargs
    ) -> str:
        """Add memory to specific layer."""
        layer = self.get_layer(memory_type)
        if not layer:
            raise MemoryError(f"Memory layer {memory_type} not registered")
        
        return await layer.add(content, **kwargs)
    
    async def search_all_layers(
        self,
        query: str,
        query_type: str = "default",
        limit: int = 10,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search across multiple memory layers."""
        memory_types = self._routing_rules.get(query_type, self._routing_rules["default"])
        
        all_results = []
        for memory_type in memory_types:
            layer = self.get_layer(memory_type)
            if layer:
                context = SearchContext(
                    query_type=query_type,
                    memory_types=[memory_type]
                )
                results = await layer.search_hierarchical(query, context, limit, min_score)
                all_results.extend(results)
        
        # Sort by relevance and return top results
        all_results.sort(key=lambda r: r.score, reverse=True)
        return all_results[:limit]
    
    async def get_memory_stats(self) -> Dict[str, Any]:
        """Get statistics for all memory layers."""
        stats = {}
        
        for memory_type, layer in self._layers.items():
            try:
                records = await layer.list_all(limit=1000)
                stats[memory_type.value] = {
                    "total_records": len(records),
                    "recent_events": len(layer.get_recent_events(50)),
                    "layer_type": memory_type.value
                }
            except Exception as e:
                stats[memory_type.value] = {
                    "error": str(e)
                }
        
        return stats 