"""
Memory Component

High-level component for complex memory operations including intelligent updates
and history tracking.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Callable, Awaitable
from datetime import datetime
from dataclasses import dataclass, asdict

from ..core.component import Component
from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError

logger = logging.getLogger(__name__)


@dataclass
class MemoryOperation:
    """Record of a memory operation for history tracking."""
    
    operation_id: str
    operation_type: str  # 'add', 'update', 'delete', 'search'
    tenant_id: str
    record_id: Optional[str]
    content: Optional[str]
    metadata: Optional[Dict[str, Any]]
    timestamp: datetime
    result: Any
    error: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        data['timestamp'] = self.timestamp.isoformat()
        return data


class MemoryComponent(Component):
    """
    High-level memory component with intelligent operations.
    
    Provides advanced memory functionality including:
    - Intelligent memory updates with extract-retrieve-reason-update cycles
    - Operation history tracking for audit and debugging
    - Memory consolidation and optimization
    - Cross-memory search and routing
    """
    
    def __init__(
        self,
        primary_memory: BaseMemory,
        secondary_memories: Optional[List[BaseMemory]] = None,
        enable_history: bool = True,
        history_limit: int = 1000,
        auto_consolidate: bool = False,
        consolidation_threshold: int = 100,
        **kwargs
    ):
        """
        Initialize memory component.
        
        Args:
            primary_memory: Primary memory backend
            secondary_memories: Optional list of secondary memory backends
            enable_history: Whether to track operation history
            history_limit: Maximum number of history records to keep
            auto_consolidate: Whether to automatically consolidate memories
            consolidation_threshold: Number of operations before consolidation
            **kwargs: Additional configuration options
        """
        super().__init__(**kwargs)
        self.primary_memory = primary_memory
        self.secondary_memories = secondary_memories or []
        self.enable_history = enable_history
        self.history_limit = history_limit
        self.auto_consolidate = auto_consolidate
        self.consolidation_threshold = consolidation_threshold
        
        # Operation history
        self._operation_history: List[MemoryOperation] = []
        self._operation_count = 0
        
        # Memory update pipeline
        self._update_pipeline: List[Callable] = []
        self._setup_default_pipeline()
    
    def _setup_default_pipeline(self):
        """Setup default memory update pipeline."""
        self._update_pipeline = [
            self._extract_key_information,
            self._retrieve_related_memories,
            self._reason_about_updates,
            self._apply_updates
        ]
    
    async def add_intelligent(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
        enable_pipeline: bool = True
    ) -> str:
        """
        Add memory with intelligent processing pipeline.
        
        Args:
            content: Memory content
            metadata: Optional metadata
            record_id: Optional record ID
            enable_pipeline: Whether to run intelligent update pipeline
            
        Returns:
            Record ID of the added memory
        """
        operation_id = self._generate_operation_id()
        
        try:
            # Run intelligent pipeline if enabled
            if enable_pipeline:
                processed_content, processed_metadata = await self._run_update_pipeline(
                    content, metadata
                )
            else:
                processed_content, processed_metadata = content, metadata
            
            # Add to primary memory
            result_id = await self.primary_memory.add(
                content=processed_content,
                metadata=processed_metadata,
                record_id=record_id
            )
            
            # Add to secondary memories if configured
            for secondary_memory in self.secondary_memories:
                try:
                    await secondary_memory.add(
                        content=processed_content,
                        metadata=processed_metadata,
                        record_id=result_id
                    )
                except Exception as e:
                    logger.warning(f"Failed to add to secondary memory: {e}")
            
            # Record operation
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='add',
                    record_id=result_id,
                    content=processed_content,
                    metadata=processed_metadata,
                    result=result_id
                )
            
            # Auto-consolidate if enabled
            if self.auto_consolidate:
                await self._maybe_consolidate()
            
            return result_id
            
        except Exception as e:
            # Record error
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='add',
                    record_id=record_id,
                    content=content,
                    metadata=metadata,
                    result=None,
                    error=str(e)
                )
            raise
    
    async def search_across_memories(
        self,
        query: str,
        limit: int = 10,
        metadata_filter: Optional[Dict[str, Any]] = None,
        min_score: float = 0.0,
        include_secondary: bool = True
    ) -> List[SearchResult]:
        """
        Search across all configured memories.
        
        Args:
            query: Search query
            limit: Maximum results
            metadata_filter: Optional metadata filter
            min_score: Minimum relevance score
            include_secondary: Whether to include secondary memories
            
        Returns:
            Consolidated search results from all memories
        """
        operation_id = self._generate_operation_id()
        
        try:
            all_results = []
            
            # Search primary memory
            primary_results = await self.primary_memory.search(
                query=query,
                limit=limit,
                metadata_filter=metadata_filter,
                min_score=min_score
            )
            all_results.extend(primary_results)
            
            # Search secondary memories
            if include_secondary:
                for secondary_memory in self.secondary_memories:
                    try:
                        secondary_results = await secondary_memory.search(
                            query=query,
                            limit=limit,
                            metadata_filter=metadata_filter,
                            min_score=min_score
                        )
                        all_results.extend(secondary_results)
                    except Exception as e:
                        logger.warning(f"Failed to search secondary memory: {e}")
            
            # Deduplicate and sort by score
            seen_ids = set()
            unique_results = []
            for result in all_results:
                if result.record.id not in seen_ids:
                    seen_ids.add(result.record.id)
                    unique_results.append(result)
            
            # Sort by score and limit
            unique_results.sort(key=lambda x: x.score, reverse=True)
            final_results = unique_results[:limit]
            
            # Record operation
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='search',
                    record_id=None,
                    content=query,
                    metadata=metadata_filter,
                    result=len(final_results)
                )
            
            return final_results
            
        except Exception as e:
            # Record error
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='search',
                    record_id=None,
                    content=query,
                    metadata=metadata_filter,
                    result=None,
                    error=str(e)
                )
            raise
    
    async def consolidate_memories(self) -> int:
        """
        Consolidate similar memories to reduce redundancy.
        
        Returns:
            Number of memories consolidated
        """
        operation_id = self._generate_operation_id()
        
        try:
            # Get all memories from primary storage
            all_memories = await self.primary_memory.list_all(limit=10000)
            
            if len(all_memories) < 2:
                return 0
            
            consolidated_count = 0
            
            # Group similar memories
            similarity_groups = await self._group_similar_memories(all_memories)
            
            # Consolidate each group
            for group in similarity_groups:
                if len(group) > 1:
                    consolidated_memory = await self._merge_memories(group)
                    
                    # Delete original memories
                    for memory in group:
                        await self.primary_memory.delete(memory.id)
                    
                    # Add consolidated memory
                    await self.primary_memory.add(
                        content=consolidated_memory.content,
                        metadata=consolidated_memory.metadata,
                        record_id=consolidated_memory.id
                    )
                    
                    consolidated_count += len(group) - 1
            
            # Record operation
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='consolidate',
                    record_id=None,
                    content=None,
                    metadata=None,
                    result=consolidated_count
                )
            
            return consolidated_count
            
        except Exception as e:
            # Record error
            if self.enable_history:
                await self._record_operation(
                    operation_id=operation_id,
                    operation_type='consolidate',
                    record_id=None,
                    content=None,
                    metadata=None,
                    result=None,
                    error=str(e)
                )
            raise
    
    async def get_operation_history(
        self,
        limit: int = 100,
        operation_type: Optional[str] = None
    ) -> List[MemoryOperation]:
        """
        Get operation history.
        
        Args:
            limit: Maximum number of operations to return
            operation_type: Optional filter by operation type
            
        Returns:
            List of memory operations
        """
        history = self._operation_history
        
        if operation_type:
            history = [op for op in history if op.operation_type == operation_type]
        
        return history[-limit:]
    
    async def _run_update_pipeline(
        self,
        content: str,
        metadata: Optional[Dict[str, Any]]
    ) -> tuple[str, Optional[Dict[str, Any]]]:
        """Run the intelligent update pipeline."""
        context = {
            'content': content,
            'metadata': metadata or {},
            'extracted_info': {},
            'related_memories': [],
            'updates': {}
        }
        
        # Run each pipeline stage
        for stage in self._update_pipeline:
            try:
                context = await stage(context)
            except Exception as e:
                logger.warning(f"Pipeline stage failed: {e}")
                continue
        
        return context['content'], context['metadata']
    
    async def _extract_key_information(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Extract key information from content."""
        content = context['content']
        
        # Simple key extraction (can be enhanced with NLP)
        extracted = {
            'length': len(content),
            'word_count': len(content.split()),
            'has_questions': '?' in content,
            'has_urls': 'http' in content.lower(),
            'has_code': any(keyword in content.lower() for keyword in ['def ', 'class ', 'import ', 'function']),
            'topics': self._extract_topics(content)
        }
        
        context['extracted_info'] = extracted
        return context
    
    async def _retrieve_related_memories(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Retrieve related memories."""
        content = context['content']
        extracted_info = context['extracted_info']
        
        # Search for related memories
        related_memories = []
        
        # Search by content similarity
        if len(content) > 10:
            search_results = await self.primary_memory.search(
                query=content[:200],  # Use first 200 chars as query
                limit=5,
                min_score=0.3
            )
            related_memories.extend([result.record for result in search_results])
        
        # Search by topics
        for topic in extracted_info.get('topics', []):
            topic_results = await self.primary_memory.search(
                query=topic,
                limit=3,
                min_score=0.2
            )
            related_memories.extend([result.record for result in topic_results])
        
        # Remove duplicates
        unique_memories = []
        seen_ids = set()
        for memory in related_memories:
            if memory.id not in seen_ids:
                seen_ids.add(memory.id)
                unique_memories.append(memory)
        
        context['related_memories'] = unique_memories
        return context
    
    async def _reason_about_updates(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Reason about potential updates to content and metadata."""
        content = context['content']
        metadata = context['metadata']
        extracted_info = context['extracted_info']
        related_memories = context['related_memories']
        
        updates = {}
        
        # Enhance metadata based on extracted information
        if extracted_info.get('has_code'):
            metadata['content_type'] = 'code'
        elif extracted_info.get('has_questions'):
            metadata['content_type'] = 'question'
        elif extracted_info.get('has_urls'):
            metadata['content_type'] = 'reference'
        else:
            metadata['content_type'] = 'text'
        
        # Add topic tags
        if extracted_info.get('topics'):
            metadata['topics'] = extracted_info['topics']
        
        # Add relationship information
        if related_memories:
            metadata['related_memory_ids'] = [mem.id for mem in related_memories]
            metadata['related_count'] = len(related_memories)
        
        # Add processing timestamp
        metadata['processed_at'] = datetime.now().isoformat()
        
        updates['metadata'] = metadata
        context['updates'] = updates
        return context
    
    async def _apply_updates(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Apply the reasoned updates."""
        updates = context['updates']
        
        if 'metadata' in updates:
            context['metadata'] = updates['metadata']
        
        if 'content' in updates:
            context['content'] = updates['content']
        
        return context
    
    def _extract_topics(self, content: str) -> List[str]:
        """Extract topics from content (simple implementation)."""
        # Simple keyword-based topic extraction
        topics = []
        
        # Common technical topics
        tech_keywords = {
            'python': ['python', 'django', 'flask', 'pandas'],
            'javascript': ['javascript', 'js', 'node', 'react', 'vue'],
            'database': ['sql', 'database', 'mysql', 'postgresql', 'mongodb'],
            'ai': ['ai', 'machine learning', 'deep learning', 'neural network'],
            'web': ['html', 'css', 'http', 'api', 'rest'],
            'devops': ['docker', 'kubernetes', 'aws', 'deployment']
        }
        
        content_lower = content.lower()
        for topic, keywords in tech_keywords.items():
            if any(keyword in content_lower for keyword in keywords):
                topics.append(topic)
        
        return topics
    
    async def _group_similar_memories(self, memories: List[MemoryRecord]) -> List[List[MemoryRecord]]:
        """Group similar memories for consolidation."""
        # Simple grouping by content similarity
        groups = []
        processed = set()
        
        for i, memory in enumerate(memories):
            if memory.id in processed:
                continue
            
            group = [memory]
            processed.add(memory.id)
            
            # Find similar memories
            for j, other_memory in enumerate(memories[i+1:], i+1):
                if other_memory.id in processed:
                    continue
                
                similarity = self._calculate_similarity(memory.content, other_memory.content)
                if similarity > 0.7:  # 70% similarity threshold
                    group.append(other_memory)
                    processed.add(other_memory.id)
            
            groups.append(group)
        
        return groups
    
    def _calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts."""
        # Simple word-based similarity
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = words1.intersection(words2)
        union = words1.union(words2)
        
        return len(intersection) / len(union)
    
    async def _merge_memories(self, memories: List[MemoryRecord]) -> MemoryRecord:
        """Merge multiple memories into one."""
        # Use the first memory as base
        base_memory = memories[0]
        
        # Combine contents
        combined_content = base_memory.content
        for memory in memories[1:]:
            if memory.content not in combined_content:
                combined_content += f"\n\n{memory.content}"
        
        # Merge metadata
        combined_metadata = base_memory.metadata.copy()
        for memory in memories[1:]:
            for key, value in memory.metadata.items():
                if key not in combined_metadata:
                    combined_metadata[key] = value
                elif isinstance(value, list) and isinstance(combined_metadata[key], list):
                    combined_metadata[key].extend(value)
        
        # Add consolidation info
        combined_metadata['consolidated_from'] = [mem.id for mem in memories]
        combined_metadata['consolidated_at'] = datetime.now().isoformat()
        
        return MemoryRecord(
            id=base_memory.id,
            content=combined_content,
            metadata=combined_metadata,
            tenant_id=base_memory.tenant_id,
            created_at=base_memory.created_at,
            updated_at=datetime.now()
        )
    
    async def _record_operation(
        self,
        operation_id: str,
        operation_type: str,
        record_id: Optional[str],
        content: Optional[str],
        metadata: Optional[Dict[str, Any]],
        result: Any,
        error: Optional[str] = None
    ):
        """Record a memory operation."""
        operation = MemoryOperation(
            operation_id=operation_id,
            operation_type=operation_type,
            tenant_id=self.primary_memory.tenant_id,
            record_id=record_id,
            content=content,
            metadata=metadata,
            timestamp=datetime.now(),
            result=result,
            error=error
        )
        
        self._operation_history.append(operation)
        
        # Maintain history limit
        if len(self._operation_history) > self.history_limit:
            self._operation_history = self._operation_history[-self.history_limit:]
        
        self._operation_count += 1
    
    def _generate_operation_id(self) -> str:
        """Generate unique operation ID."""
        return f"op_{self._operation_count}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    async def _maybe_consolidate(self):
        """Maybe run consolidation if threshold is reached."""
        if self._operation_count % self.consolidation_threshold == 0:
            try:
                await self.consolidate_memories()
            except Exception as e:
                logger.warning(f"Auto-consolidation failed: {e}") 