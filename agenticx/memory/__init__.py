"""
AgenticX Memory System

A pluggable, shareable memory system based on open standards.
Supports short-term session memory and long-term persistent memory via MCP.
Now includes hierarchical memory architecture inspired by MIRIX.
"""

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError
from .short_term import ShortTermMemory
from .mcp_memory import MCPMemory
from .component import MemoryComponent
from .knowledge_base import KnowledgeBase
from .mem0_memory import Mem0 as AsyncMem0
from .mem0_wrapper import Mem0

# Hierarchical Memory Components
from .hierarchical import (
    BaseHierarchicalMemory,
    HierarchicalMemoryRecord,
    HierarchicalMemoryManager,
    MemoryType,
    MemoryImportance,
    MemorySensitivity,
    SearchContext,
    MemoryEvent
)
from .core_memory import CoreMemory
from .episodic_memory import EpisodicMemory, Episode, EpisodeEvent
from .semantic_memory import SemanticMemory, Concept, KnowledgeTriple
from .hybrid_search import (
    HybridSearchEngine,
    BM25SearchBackend,
    VectorSearchBackend,
    HybridRanker,
    SearchQuery,
    SearchCandidate
)
from .memory_decay import (
    MemoryDecayService,
    DecayStrategy,
    DecayParameters,
    DecayAnalysis
)

# For backward compatibility
Mem0Wrapper = Mem0

__all__ = [
    # Base components
    "BaseMemory",
    "MemoryRecord",
    "SearchResult",
    "MemoryError",
    "ShortTermMemory", 
    "MCPMemory",
    "MemoryComponent",
    "KnowledgeBase",
    "Mem0",
    "AsyncMem0",
    "Mem0Wrapper",
    
    # Hierarchical Memory Architecture
    "BaseHierarchicalMemory",
    "HierarchicalMemoryRecord",
    "HierarchicalMemoryManager",
    "MemoryType",
    "MemoryImportance",
    "MemorySensitivity",
    "SearchContext",
    "MemoryEvent",
    
    # Memory Layers
    "CoreMemory",
    "EpisodicMemory",
    "Episode",
    "EpisodeEvent",
    "SemanticMemory",
    "Concept",
    "KnowledgeTriple",
    
    # Hybrid Search Engine
    "HybridSearchEngine",
    "BM25SearchBackend",
    "VectorSearchBackend",
    "HybridRanker",
    "SearchQuery",
    "SearchCandidate",
    
    # Memory Decay Service
    "MemoryDecayService",
    "DecayStrategy",
    "DecayParameters",
    "DecayAnalysis"
] 