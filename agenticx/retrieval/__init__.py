"""
AgenticX Retrieval System

A unified retrieval system that supports multiple retrieval strategies
and can be used both as core infrastructure and as agentic tools.
"""

from .base import BaseRetriever, RetrievalResult, RetrievalQuery, RetrievalType, RetrievalError
from .provenance import (
    Provenance,
    SourceType,
    attach_provenance,
    provenance_from_legacy,
)
from .evidence import (
    EvidenceItem,
    EvidenceBundle,
    assemble_evidence,
)
from .vector_retriever import VectorRetriever
from .bm25_retriever import BM25Retriever
from .hybrid_retriever import HybridRetriever, HybridConfig
from .graph_retriever import GraphRetriever, GraphNode, GraphRelationship, GraphVectorConfig
from .auto_retriever import AutoRetriever, StrategyPerformance
from .reranker import Reranker, RerankingConfig

# Agentic Retrieval Components
from .agents import (
    QueryAnalysisAgent,
    RetrievalAgent,
    RerankingAgent,
    IndexingAgent,
    QueryAnalysis
)

# RAG Workflow Tools
from .tools import (
    DocumentIndexingTool,
    RetrievalTool,
    RerankingTool,
    QueryModificationTool,
    AnswerGenerationTool,
    CanAnswerTool,
    # Tool argument models
    DocumentIndexingArgs,
    RetrievalArgs,
    RerankingArgs,
    QueryModificationArgs,
    AnswerGenerationArgs,
    CanAnswerArgs
)

__all__ = [
    # Core Abstractions
    "BaseRetriever",
    "RetrievalResult",
    "RetrievalQuery", 
    "RetrievalType",
    "RetrievalError",
    "Provenance",
    "SourceType",
    "attach_provenance",
    "provenance_from_legacy",
    "EvidenceItem",
    "EvidenceBundle",
    "assemble_evidence",
    
    # Core Retrievers
    "VectorRetriever",
    "BM25Retriever",
    "HybridRetriever",
    "HybridConfig",
    "GraphRetriever",
    "GraphNode",
    "GraphRelationship",
    "GraphVectorConfig",
    "AutoRetriever",
    "StrategyPerformance",
    "Reranker",
    "RerankingConfig",
    
    # Agentic Components
    "QueryAnalysisAgent",
    "RetrievalAgent",
    "RerankingAgent",
    "IndexingAgent",
    "QueryAnalysis",
    
    # RAG Tools
    "DocumentIndexingTool",
    "RetrievalTool",
    "RerankingTool",
    "QueryModificationTool",
    "AnswerGenerationTool",
    "CanAnswerTool",
    
    # Tool Arguments
    "DocumentIndexingArgs",
    "RetrievalArgs",
    "RerankingArgs",
    "QueryModificationArgs",
    "AnswerGenerationArgs",
    "CanAnswerArgs"
]