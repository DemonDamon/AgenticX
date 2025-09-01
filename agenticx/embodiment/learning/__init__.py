"""AgenticX M16.2: Human-Aligned Learning Engine

This module implements the human-aligned learning engine for GUI agents,
following the natural process of how humans learn new applications.

The learning engine consists of five core components:
- AppKnowledgeRetriever: Retrieves application knowledge from past experiences
- GUIExplorer: Performs intelligent exploration of GUI interfaces
- TaskSynthesizer: Synthesizes meaningful tasks from interaction traces
- DeepUsageOptimizer: Optimizes workflows for better efficiency
- EdgeCaseHandler: Handles edge cases and learns from failures
- KnowledgeEvolution: Manages the evolution of the knowledge base
"""

from .app_knowledge_retriever import AppKnowledgeRetriever
from .gui_explorer import GUIExplorer
from .task_synthesizer import TaskSynthesizer
from .deep_usage_optimizer import DeepUsageOptimizer
from .edge_case_handler import EdgeCaseHandler
from .knowledge_evolution import KnowledgeEvolution

__all__ = [
    "AppKnowledgeRetriever",
    "GUIExplorer",
    "TaskSynthesizer",
    "DeepUsageOptimizer",
    "EdgeCaseHandler",
    "KnowledgeEvolution",
]