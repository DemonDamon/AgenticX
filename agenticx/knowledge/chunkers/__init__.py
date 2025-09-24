"""Document chunkers for AgenticX Knowledge Management System"""

import logging
from typing import Type, Dict, Any

from ..base import BaseChunker, ChunkingConfig
from .framework import (
    AdvancedBaseChunker, 
    ChunkingFramework, 
    ChunkingOptimizer,
    ChunkingStrategy,
    ChunkQuality,
    ChunkMetrics,
    ChunkingResult,
    get_chunking_framework,
    register_chunker as register_global_chunker
)
from .semantic_chunker import SemanticChunker
from .agentic_chunker import AgenticChunker
from .recursive_chunker import RecursiveChunker
from .fixed_size_chunker import FixedSizeChunker
from .document_chunker import DocumentChunker
from .csv_row_chunker import CSVRowChunker

logger = logging.getLogger(__name__)

# Registry of available chunkers (legacy support)
CHUNKER_REGISTRY: Dict[str, Type[BaseChunker]] = {
    'semantic': SemanticChunker,
    'agentic': AgenticChunker,
    'recursive': RecursiveChunker,
    'fixed_size': FixedSizeChunker,
    'document': DocumentChunker,
    'csv_row': CSVRowChunker,
    # Aliases
    'fixed': FixedSizeChunker,
    'llm': AgenticChunker,
    'csv': CSVRowChunker,
}

# Initialize global framework with intelligent chunkers
_framework = get_chunking_framework()

# Register all intelligent chunkers
_framework.register_chunker('semantic', SemanticChunker)
_framework.register_chunker('agentic', AgenticChunker)
_framework.register_chunker('recursive', RecursiveChunker)
_framework.register_chunker('fixed_size', FixedSizeChunker)
_framework.register_chunker('document', DocumentChunker)
_framework.register_chunker('csv_row', CSVRowChunker)

# Register aliases
_framework.register_chunker('fixed', FixedSizeChunker)
_framework.register_chunker('llm', AgenticChunker)
_framework.register_chunker('csv', CSVRowChunker)


def register_chunker(name: str, chunker_class: Type[BaseChunker]) -> None:
    """Register a new chunker in both legacy registry and global framework
    
    Args:
        name: Chunker name
        chunker_class: Chunker class
    """
    CHUNKER_REGISTRY[name] = chunker_class
    
    # Also register in global framework if it's an AdvancedBaseChunker
    if issubclass(chunker_class, AdvancedBaseChunker):
        _framework.register_chunker(name, chunker_class)
    
    logger.info(f"Registered chunker: {name}")


def get_chunker(
    strategy: str = 'recursive',
    config: ChunkingConfig = None,
    **kwargs
) -> BaseChunker:
    """Get chunker by strategy name
    
    Args:
        strategy: Chunking strategy name
        config: Chunking configuration
        **kwargs: Additional arguments for chunker
        
    Returns:
        Chunker instance
        
    Raises:
        ValueError: If unknown strategy
    """
    
    # Try to get from global framework first (preferred)
    try:
        return _framework.get_chunker(strategy, config, **kwargs)
    except ValueError:
        pass
    
    # Fallback to legacy registry
    if strategy not in CHUNKER_REGISTRY:
        available_strategies = list(set(list(CHUNKER_REGISTRY.keys()) + _framework.list_strategies()))
        raise ValueError(f"Unknown chunking strategy: {strategy}. Available: {available_strategies}")
    
    return CHUNKER_REGISTRY[strategy](config=config, **kwargs)


def list_chunkers() -> Dict[str, Type[BaseChunker]]:
    """List all available chunkers
    
    Returns:
        Dictionary of chunker names to classes
    """
    return CHUNKER_REGISTRY.copy()


def get_chunking_framework() -> ChunkingFramework:
    """Get the global chunking framework
    
    Returns:
        ChunkingFramework instance
    """
    return _framework


def create_chunking_optimizer() -> ChunkingOptimizer:
    """Create a chunking optimizer
    
    Returns:
        ChunkingOptimizer instance
    """
    return ChunkingOptimizer(_framework)


def create_chunking_config(
    strategy: str = 'recursive',
    chunk_size: int = 1000,
    overlap_size: int = 200,
    **kwargs
) -> ChunkingConfig:
    """Create a chunking configuration
    
    Args:
        strategy: Chunking strategy
        chunk_size: Target chunk size
        overlap_size: Overlap between chunks
        **kwargs: Additional configuration
        
    Returns:
        ChunkingConfig instance
    """
    
    return ChunkingConfig(
        enabled=True,
        strategy=strategy,
        chunk_size=chunk_size,
        overlap_size=overlap_size,
        **kwargs
    )


__all__ = [
    # Base classes
    'BaseChunker',
    'AdvancedBaseChunker',
    'ChunkingConfig',
    
    # Framework classes
    'ChunkingFramework',
    'ChunkingOptimizer',
    'ChunkingStrategy',
    'ChunkQuality',
    'ChunkMetrics',
    'ChunkingResult',
    
    # Intelligent chunkers
    'SemanticChunker',
    'AgenticChunker',
    'RecursiveChunker',
    'FixedSizeChunker',
    'DocumentChunker',
    'CSVRowChunker',
    
    # Functions
    'register_chunker',
    'get_chunker',
    'list_chunkers',
    'get_chunking_framework',
    'create_chunking_optimizer',
    'create_chunking_config',
    
    # Registry
    'CHUNKER_REGISTRY',
]