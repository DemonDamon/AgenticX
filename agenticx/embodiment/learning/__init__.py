"""AgenticX M16.2: Human-Aligned Learning Engine

This module implements the human-aligned learning engine for GUI agents,
following the natural process of how humans learn new applications.

The learning engine consists of core components:
- AppKnowledgeRetriever: Retrieves application knowledge from past experiences
- GUIExplorer: Performs intelligent exploration of GUI interfaces
- TaskSynthesizer: Synthesizes meaningful tasks from interaction traces
- DeepUsageOptimizer: Optimizes workflows for better efficiency
- EdgeCaseHandler: Handles edge cases and learns from failures
- KnowledgeEvolution: Manages the evolution of the knowledge base

Enhanced with (GUI Agent Unified Proposal):
- ActionReflector: A/B/C action result classification (MobileAgent)
- ActionCache/ActionTree: Action caching for performance (MobiAgent AgentRR)
"""

from .app_knowledge_retriever import AppKnowledgeRetriever
from .gui_explorer import GUIExplorer
from .task_synthesizer import TaskSynthesizer
from .deep_usage_optimizer import DeepUsageOptimizer
from .edge_case_handler import EdgeCaseHandler
from .knowledge_evolution import KnowledgeEvolution
# 新增：动作反思器 (MobileAgent A/B/C 分类)
from .action_reflector import (
    ActionReflector,
    ActionContext,
    ActionReflectionResult,
)
# 新增：动作缓存 (MobiAgent AgentRR)
from .action_tree import (
    ActionTree,
    ActionTreeNode,
    ActionTreeEdge,
    CachedAction,
)
from .action_cache import (
    ActionCache,
    MatchMode,
)

__all__ = [
    "AppKnowledgeRetriever",
    "GUIExplorer",
    "TaskSynthesizer",
    "DeepUsageOptimizer",
    "EdgeCaseHandler",
    "KnowledgeEvolution",
    # 动作反思
    "ActionReflector",
    "ActionContext",
    "ActionReflectionResult",
    # 动作缓存
    "ActionTree",
    "ActionTreeNode",
    "ActionTreeEdge",
    "CachedAction",
    "ActionCache",
    "MatchMode",
]