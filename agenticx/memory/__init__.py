"""
AgenticX Memory System

A pluggable, shareable memory system based on open standards.
Supports short-term session memory and long-term persistent memory via MCP.
"""

from .base import BaseMemory, MemoryRecord, SearchResult, MemoryError
from .short_term import ShortTermMemory
from .mcp_memory import MCPMemory
from .component import MemoryComponent
from .knowledge_base import KnowledgeBase

# SOP Registry (JoyAgent-inspired, lightweight)
from .sop_registry import SOPRegistry, SOPItem, SOPMode

# Compaction Flush (inspired by OpenClaw)
from .compaction_flush import CompactionFlushConfig, MemoryFlushHandler, DefaultMemoryFlushHandler

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

    # SOP Registry
    "SOPRegistry",
    "SOPItem",
    "SOPMode",

    # Compaction Flush (inspired by OpenClaw)
    "CompactionFlushConfig",
    "MemoryFlushHandler",
    "DefaultMemoryFlushHandler",
]
