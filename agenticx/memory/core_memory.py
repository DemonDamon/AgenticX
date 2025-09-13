"""
Core Memory Layer

Implements the core memory layer for storing agent identity,
personality, and persistent information.
"""

from typing import Any, Dict, List, Optional, Tuple, Union
from datetime import datetime, UTC
import json
import asyncio
import uuid
from dataclasses import asdict

from .hierarchical import (
    BaseHierarchicalMemory,
    HierarchicalMemoryRecord,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    SearchContext,
    SearchResult
)
from .base import MemoryError, MemoryRecord


class CoreMemory(BaseHierarchicalMemory):
    """
    Core Memory Layer
    
    Manages agent identity, personality, and persistent information.
    This layer stores the most essential information about an agent
    that should persist across all conversations and interactions.
    """
    
    def __init__(self, tenant_id: str, agent_id: str, **kwargs):
        super().__init__(tenant_id, MemoryType.CORE, **kwargs)
        self.agent_id = agent_id
        self._core_records: Dict[str, HierarchicalMemoryRecord] = {}
        self._index: Dict[str, List[str]] = {}  # Simple keyword index
        self._initialized = False
        
        # Initialize with default agent profile on first use
        # to avoid event loop issues in tests
    
    async def _ensure_initialized(self):
        """Ensure agent profile is initialized."""
        if self._initialized:
            return
            
        try:
            # Check if agent profile exists by searching internal records directly
            profile_exists = False
            for record in self._core_records.values():
                if record.metadata.get("type") == "agent_profile" and record.metadata.get("agent_id") == self.agent_id:
                    profile_exists = True
                    break
            
            if not profile_exists:
                # Create default agent profile directly
                record_id = str(uuid.uuid4())
                now = datetime.now()
                record = HierarchicalMemoryRecord(
                    id=record_id,
                    content=f"Agent {self.agent_id} profile",
                    metadata={
                        "type": "agent_profile",
                        "agent_id": self.agent_id,
                        "created_at": datetime.now(UTC).isoformat()
                    },
                    tenant_id=self.tenant_id,
                    created_at=now,
                    updated_at=now,
                    memory_type=MemoryType.CORE,
                    importance=MemoryImportance.CRITICAL,
                    sensitivity=MemorySensitivity.INTERNAL,
                    source="system"
                )
                await self._store_record(record)
                
            self._initialized = True
        except Exception:
            # Ignore initialization errors
            self._initialized = True  # Set to true to prevent infinite loops
    
    async def set_agent_identity(
        self,
        name: str,
        role: str,
        description: str,
        personality: Optional[Dict[str, Any]] = None,
        capabilities: Optional[List[str]] = None
    ) -> str:
        """
        Set or update agent identity information.
        
        Args:
            name: Agent name
            role: Agent role/job
            description: Agent description
            personality: Personality traits
            capabilities: List of capabilities
            
        Returns:
            Record ID
        """
        identity_data = {
            "name": name,
            "role": role,
            "description": description,
            "personality": personality or {},
            "capabilities": capabilities or []
        }
        
        # Check if identity already exists
        existing_identity = await self.search("agent_identity", limit=1)
        if existing_identity:
            # Update existing identity
            record_id = existing_identity[0].record.id
            await self.update(
                record_id,
                content=f"Agent Identity: {name} ({role})",
                metadata={
                    "type": "agent_identity",
                    "identity_data": identity_data,
                    "updated_at": datetime.now(UTC).isoformat()
                }
            )
            return record_id
        else:
            # Create new identity
            return await self.add(
                content=f"Agent Identity: {name} ({role})",
                metadata={
                    "type": "agent_identity",
                    "identity_data": identity_data
                },
                importance=MemoryImportance.CRITICAL,
                sensitivity=MemorySensitivity.INTERNAL,
                source="user"
            )
    
    async def get_agent_identity(self) -> Optional[Dict[str, Any]]:
        """Get current agent identity."""
        results = await self.search("agent_identity", limit=1)
        if results:
            identity_data = results[0].record.metadata.get("identity_data")
            return identity_data
        return None
    
    async def set_persistent_context(
        self,
        key: str,
        value: Any,
        description: Optional[str] = None
    ) -> str:
        """
        Set persistent context information.
        
        Args:
            key: Context key
            value: Context value
            description: Optional description
            
        Returns:
            Record ID
        """
        await self._ensure_initialized()
        
        # Check if context already exists in internal records
        existing_record_id = None
        for record_id, record in self._core_records.items():
            if (record.metadata.get("type") == "persistent_context" and 
                record.metadata.get("context_key") == key):
                existing_record_id = record_id
                break
        
        content = f"Persistent Context: {key}"
        if description:
            content += f" - {description}"
        
        metadata = {
            "type": "persistent_context",
            "context_key": key,
            "context_value": value,
            "description": description or ""
        }
        
        if existing_record_id:
            # Update existing context
            await self.update(existing_record_id, content=content, metadata=metadata)
            return existing_record_id
        else:
            # Create new context
            record_id = str(uuid.uuid4())
            now = datetime.now()
            record = HierarchicalMemoryRecord(
                id=record_id,
                content=content,
                metadata=metadata,
                tenant_id=self.tenant_id,
                created_at=now,
                updated_at=now,
                memory_type=MemoryType.CORE,
                importance=MemoryImportance.HIGH,
                sensitivity=MemorySensitivity.INTERNAL,
                source="user"
            )
            
            # Store record
            await self._store_record(record)
            return record.id
    
    async def get_persistent_context(self, key: str) -> Optional[Any]:
        """Get persistent context by key."""
        await self._ensure_initialized()
        
        # Search in internal records directly
        for record in self._core_records.values():
            if (record.metadata.get("type") == "persistent_context" and 
                record.metadata.get("context_key") == key):
                return record.metadata.get("context_value")
        return None
    
    async def get_all_context(self) -> Dict[str, Any]:
        """Get all persistent context."""
        await self._ensure_initialized()
        
        # Search in internal records directly
        context = {}
        for record in self._core_records.values():
            if record.metadata.get("type") == "persistent_context":
                key = record.metadata.get("context_key")
                value = record.metadata.get("context_value")
                if key:
                    context[key] = value
        return context
    
    async def update_agent_state(
        self,
        state_data: Dict[str, Any],
        description: Optional[str] = None
    ) -> str:
        """
        Update agent's current state.
        
        Args:
            state_data: State information
            description: Optional description
            
        Returns:
            Record ID
        """
        content = f"Agent State Update: {description or 'Current state'}"
        
        # Use high precision timestamp for accurate ordering
        timestamp = datetime.now(UTC)
        metadata = {
            "type": "agent_state",
            "state_data": state_data,
            "timestamp": timestamp.isoformat(),
            "description": description or ""
        }
        
        return await self.add(
            content=content,
            metadata=metadata,
            importance=MemoryImportance.HIGH,
            sensitivity=MemorySensitivity.INTERNAL,
            source="system"
        )
    
    async def get_recent_states(self, limit: int = 5) -> List[Dict[str, Any]]:
        """Get recent agent states."""
        # Find all agent state records
        await self._ensure_initialized()
        
        states = []
        for record in self._core_records.values():
            if record.metadata.get("type") == "agent_state":
                state_data = record.metadata.get("state_data", {})
                timestamp = record.metadata.get("timestamp")
                states.append({
                    "timestamp": timestamp,
                    "state_data": state_data,
                    "description": record.metadata.get("description", ""),
                    "created_at": record.created_at
                })
        
        # Sort by timestamp (newest first)
        def sort_key(state):
            # Use timestamp if available, otherwise use created_at
            if state["timestamp"]:
                try:
                    # Handle ISO format timestamps
                    timestamp_str = state["timestamp"].replace('Z', '+00:00')
                    return datetime.fromisoformat(timestamp_str)
                except:
                    # Fallback to created_at
                    return state["created_at"]
            return state["created_at"]
        
        states.sort(key=sort_key, reverse=True)
        return states[:limit]
    
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
        """Add a new memory record."""
        await self._ensure_initialized()
        
        if record_id is None:
            record_id = str(uuid.uuid4())
        
        now = datetime.now()
        record = HierarchicalMemoryRecord(
            id=record_id,
            content=content,
            metadata=metadata or {},
            tenant_id=self.tenant_id,
            created_at=now,
            updated_at=now,
            memory_type=MemoryType.CORE,
            importance=importance,
            sensitivity=sensitivity,
            source=source,
            context=context or {}
        )
        
        await self._store_record(record)
        return record.id
    
    async def add_association(self, record_id: str, associated_id: str) -> bool:
        """Add association between records."""
        if record_id in self._core_records:
            record = self._core_records[record_id]
            if associated_id not in record.associations:
                record.associations.append(associated_id)
            return True
        return False
    
    async def get_associations(self, record_id: str) -> List[HierarchicalMemoryRecord]:
        """Get associations for a record."""
        if record_id in self._core_records:
            associated_records = []
            record = self._core_records[record_id]
            for assoc_id in record.associations:
                if assoc_id in self._core_records:
                    associated_records.append(self._core_records[assoc_id])
            return associated_records
        return []
    
    async def _store_record(self, record: HierarchicalMemoryRecord):
        """Store a hierarchical memory record."""
        self._core_records[record.id] = record
        
        # Update simple keyword index
        keywords = self._extract_keywords(record.content)
        for keyword in keywords:
            if keyword not in self._index:
                self._index[keyword] = []
            if record.id not in self._index[keyword]:
                self._index[keyword].append(record.id)
        
        # Also index metadata
        if record.metadata:
            for key, value in record.metadata.items():
                if isinstance(value, str):
                    meta_keywords = self._extract_keywords(value)
                    for keyword in meta_keywords:
                        if keyword not in self._index:
                            self._index[keyword] = []
                        if record.id not in self._index[keyword]:
                            self._index[keyword].append(record.id)
    
    async def _hierarchical_search(
        self,
        query: str,
        context: SearchContext,
        limit: int,
        min_score: float
    ) -> List[SearchResult]:
        """Perform hierarchical search."""
        await self._ensure_initialized()
        
        query_keywords = self._extract_keywords(query)
        
        # Find matching records
        candidate_ids = set()
        for keyword in query_keywords:
            if keyword in self._index:
                candidate_ids.update(self._index[keyword])
        
        # Score and rank results
        results = []
        for record_id in candidate_ids:
            record = self._core_records.get(record_id)
            if not record:
                continue
            
            # Apply context filters
            if context.time_range:
                if not (context.time_range[0] <= record.created_at <= context.time_range[1]):
                    continue
            
            if context.importance_threshold:
                if record.importance.value < context.importance_threshold.value:
                    continue
            
            if context.max_age:
                if datetime.now(UTC) - record.created_at > context.max_age:
                    continue
            
            if not context.include_decayed and record.decay_factor < 0.5:
                continue
            
            # Calculate relevance score
            score = self._calculate_relevance_score(record, query_keywords)
            
            if score >= min_score:
                results.append(SearchResult(record=record, score=score))
        
        # Sort by score and return top results
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]
    
    async def _update_access_count(self, record_id: str):
        """Update access count for a record."""
        if record_id in self._core_records:
            record = self._core_records[record_id]
            record.access_count += 1
            record.last_accessed = datetime.now(UTC)
            
            # Update decay factor based on access
            record.decay_factor = min(1.0, record.decay_factor + 0.1)
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from text."""
        if not text:
            return []
        
        # Simple keyword extraction
        import re
        words = re.findall(r'\b\w+\b', text.lower())
        
        # Filter out common stop words
        stop_words = {
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
            'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those'
        }
        
        keywords = [word for word in words if word not in stop_words and len(word) > 2]
        return keywords
    
    def _calculate_relevance_score(self, record: HierarchicalMemoryRecord, query_keywords: List[str]) -> float:
        """Calculate relevance score for a record."""
        if not query_keywords:
            return 0.0
        
        # Extract record keywords
        record_keywords = self._extract_keywords(record.content)
        
        # Also extract from metadata
        if record.metadata:
            for key, value in record.metadata.items():
                if isinstance(value, str):
                    record_keywords.extend(self._extract_keywords(value))
        
        # Calculate keyword match ratio
        matches = len(set(query_keywords) & set(record_keywords))
        keyword_score = matches / len(query_keywords)
        
        # Apply importance multiplier
        importance_multiplier = record.importance.value / 4.0
        
        # Apply decay factor
        decay_factor = record.decay_factor
        
        # Apply recency bonus (newer records get slight boost)
        age_hours = (datetime.now(UTC) - record.created_at).total_seconds() / 3600
        recency_bonus = max(0, 1 - (age_hours / (24 * 7)))  # Bonus fades over a week
        
        # Calculate final score
        score = keyword_score * importance_multiplier * decay_factor * (1 + recency_bonus * 0.1)
        
        return min(1.0, score)
    
    # Implement required abstract methods from BaseMemory
    async def search(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0
    ) -> List[SearchResult]:
        """Search for relevant memory records."""
        context = SearchContext(
            query_type="general",
            memory_types=[MemoryType.CORE]
        )
        
        results = await self._hierarchical_search(query, context, limit, min_score)
        
        # Apply metadata filter if provided
        if metadata_filter:
            filtered_results = []
            for result in results:
                if self._matches_metadata_filter(result.record, metadata_filter):
                    filtered_results.append(result)
            results = filtered_results
        
        return results
    
    def _matches_metadata_filter(self, record: Union[HierarchicalMemoryRecord, MemoryRecord], filter_dict: Dict[str, Any]) -> bool:
        """Check if record matches the filter."""
        for key, value in filter_dict.items():
            # Check record attributes first
            if hasattr(record, key):
                record_value = getattr(record, key)
                # Handle enum values for HierarchicalMemoryRecord
                if hasattr(record_value, 'value'):
                    record_value = record_value.value
                if record_value != value:
                    return False
            # Check metadata for both types of records
            elif hasattr(record, 'metadata') and record.metadata and key in record.metadata:
                if record.metadata[key] != value:
                    return False
            else:
                return False
        return True
    
    async def update(
        self,
        record_id: str,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update an existing memory record."""
        if record_id not in self._core_records:
            return False
        
        record = self._core_records[record_id]
        
        if content is not None:
            record.content = content
        
        if metadata is not None:
            # Merge metadata
            record.metadata.update(metadata)
        
        record.updated_at = datetime.now(UTC)
        
        # Re-index the record
        await self._store_record(record)
        
        return True
    
    async def delete(self, record_id: str) -> bool:
        """Delete a memory record."""
        if record_id not in self._core_records:
            return False
        
        # Remove from index
        for keyword_list in self._index.values():
            if record_id in keyword_list:
                keyword_list.remove(record_id)
        
        # Remove record
        del self._core_records[record_id]
        
        return True
    
    async def get(self, record_id: str) -> Optional[HierarchicalMemoryRecord]:
        """Get a specific memory record by ID."""
        return self._core_records.get(record_id)
    
    async def list_all(
        self,
        limit: int = 100,
        offset: int = 0,
        metadata_filter: Optional[Dict[str, Any]] = None
    ) -> List[MemoryRecord]:
        """List all memory records for the current tenant."""
        all_records: List[MemoryRecord] = list(self._core_records.values())
        
        # Apply metadata filter
        if metadata_filter:
            filtered_records = []
            for record in all_records:
                if self._matches_metadata_filter(record, metadata_filter):
                    filtered_records.append(record)
            all_records = filtered_records
        
        # Sort by creation time (newest first)
        all_records.sort(key=lambda r: r.created_at, reverse=True)  # type: ignore
        
        # Apply pagination
        start = offset
        end = offset + limit
        return all_records[start:end]  # type: ignore
    
    async def clear(self) -> int:
        """Clear all memory records for the current tenant."""
        count = len(self._core_records)
        self._core_records.clear()
        self._index.clear()
        return count 