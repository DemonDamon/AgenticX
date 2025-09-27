"""Advanced Chunking Framework for AgenticX Knowledge Management System

This module provides a comprehensive chunking framework with intelligent strategies,
quality evaluation, and optimization capabilities.
"""

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Type, Union, Callable
from datetime import datetime, timezone

from ..base import BaseChunker, ChunkingConfig
from ..document import Document, DocumentMetadata

logger = logging.getLogger(__name__)


class ChunkingStrategy(Enum):
    """Available chunking strategies"""
    FIXED_SIZE = "fixed_size"
    RECURSIVE = "recursive"
    SEMANTIC = "semantic"
    AGENTIC = "agentic"
    DOCUMENT = "document"
    CSV_ROW = "csv_row"
    SLIDING_WINDOW = "sliding_window"
    PARAGRAPH = "paragraph"
    SENTENCE = "sentence"


class ChunkQuality(Enum):
    """Chunk quality levels"""
    EXCELLENT = "excellent"  # 90-100%
    GOOD = "good"           # 70-89%
    FAIR = "fair"           # 50-69%
    POOR = "poor"           # 0-49%


@dataclass
class ChunkMetrics:
    """Metrics for chunk quality evaluation"""
    coherence_score: float = 0.0        # 语义连贯性
    completeness_score: float = 0.0     # 信息完整性
    size_score: float = 0.0             # 大小适中性
    overlap_score: float = 0.0          # 重叠合理性
    boundary_score: float = 0.0         # 边界自然性
    overall_score: float = 0.0          # 总体质量分数
    
    def calculate_overall_score(self):
        """Calculate overall quality score"""
        weights = {
            'coherence': 0.3,
            'completeness': 0.25,
            'size': 0.2,
            'overlap': 0.15,
            'boundary': 0.1
        }
        
        self.overall_score = (
            self.coherence_score * weights['coherence'] +
            self.completeness_score * weights['completeness'] +
            self.size_score * weights['size'] +
            self.overlap_score * weights['overlap'] +
            self.boundary_score * weights['boundary']
        )
        
        return self.overall_score
    
    def get_quality_level(self) -> ChunkQuality:
        """Get quality level based on overall score"""
        if self.overall_score >= 0.9:
            return ChunkQuality.EXCELLENT
        elif self.overall_score >= 0.7:
            return ChunkQuality.GOOD
        elif self.overall_score >= 0.5:
            return ChunkQuality.FAIR
        else:
            return ChunkQuality.POOR


@dataclass
class ChunkingResult:
    """Result of chunking operation"""
    chunks: List[Document] = field(default_factory=list)
    strategy_used: Optional[str] = None
    processing_time: float = 0.0
    metrics: Optional[ChunkMetrics] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    success: bool = True
    error: Optional[str] = None
    
    @property
    def chunk_count(self) -> int:
        """Number of chunks created"""
        return len(self.chunks)
    
    @property
    def total_size(self) -> int:
        """Total size of all chunks"""
        return sum(len(chunk.content) for chunk in self.chunks)
    
    @property
    def average_chunk_size(self) -> float:
        """Average chunk size"""
        return self.total_size / self.chunk_count if self.chunk_count > 0 else 0


class AdvancedBaseChunker(BaseChunker):
    """Enhanced base chunker with advanced capabilities"""
    
    def __init__(self, config: Optional[ChunkingConfig] = None, **kwargs):
        super().__init__(config)
        self.strategy_name = kwargs.get('strategy_name', self.__class__.__name__)
        self.quality_threshold = kwargs.get('quality_threshold', 0.7)
        self.adaptive_sizing = kwargs.get('adaptive_sizing', False)
        self.preserve_structure = kwargs.get('preserve_structure', True)
        self.embedding_model = kwargs.get('embedding_model')  # 添加嵌入模型支持
    
    @abstractmethod
    async def chunk_document_async(self, document: Document) -> ChunkingResult:
        """Asynchronously chunk document with detailed results
        
        Args:
            document: Document to chunk
            
        Returns:
            ChunkingResult with chunks and metrics
        """
        pass
    
    def chunk_document(self, document: Document) -> List[Document]:
        """Synchronous wrapper for chunk_document_async"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(self.chunk_document_async(document))
            return result.chunks
        finally:
            loop.close()
    
    def estimate_chunk_count(self, document: Document) -> int:
        """Estimate number of chunks that will be created"""
        content_length = len(document.content)
        estimated_count = max(1, content_length // self.config.chunk_size)
        return estimated_count
    
    def validate_chunks(self, chunks: List[Document]) -> bool:
        """Validate chunk quality"""
        if not chunks:
            return False
        
        # Check for empty chunks
        if any(not chunk.content.strip() for chunk in chunks):
            return False
        
        # Check size constraints
        max_size = self.config.chunk_size * 1.5  # Allow 50% variance
        if any(len(chunk.content) > max_size for chunk in chunks):
            return False
        
        return True


class ChunkingFramework:
    """Advanced chunking framework with strategy management and optimization"""
    
    def __init__(self):
        self._chunkers: Dict[str, Type[AdvancedBaseChunker]] = {}
        self._strategy_performance: Dict[str, List[float]] = {}
        self._default_strategy = ChunkingStrategy.RECURSIVE.value
        
        logger.info("Initialized ChunkingFramework")
    
    def register_chunker(self, strategy: str, chunker_class: Type[AdvancedBaseChunker]) -> None:
        """Register a chunker strategy
        
        Args:
            strategy: Strategy name
            chunker_class: Chunker class
        """
        if not issubclass(chunker_class, AdvancedBaseChunker):
            raise ValueError(f"Chunker class must inherit from AdvancedBaseChunker")
        
        self._chunkers[strategy] = chunker_class
        self._strategy_performance[strategy] = []
        
        logger.info(f"Registered chunker strategy: {strategy}")
    
    def unregister_chunker(self, strategy: str) -> None:
        """Unregister a chunker strategy
        
        Args:
            strategy: Strategy name to remove
        """
        if strategy in self._chunkers:
            del self._chunkers[strategy]
            if strategy in self._strategy_performance:
                del self._strategy_performance[strategy]
            logger.info(f"Unregistered chunker strategy: {strategy}")
    
    def list_strategies(self) -> List[str]:
        """List all registered strategies
        
        Returns:
            List of strategy names
        """
        return list(self._chunkers.keys())
    
    def get_chunker(self, strategy: str, config: Optional[ChunkingConfig] = None, **kwargs) -> AdvancedBaseChunker:
        """Get chunker instance by strategy
        
        Args:
            strategy: Strategy name
            config: Chunking configuration
            **kwargs: Additional arguments
            
        Returns:
            Chunker instance
        """
        if strategy not in self._chunkers:
            raise ValueError(f"Unknown strategy: {strategy}. Available: {self.list_strategies()}")
        
        chunker_class = self._chunkers[strategy]
        return chunker_class(config=config, strategy_name=strategy, **kwargs)
    
    async def chunk_document(
        self,
        document: Document,
        strategy: Optional[str] = None,
        config: Optional[ChunkingConfig] = None,
        **kwargs
    ) -> ChunkingResult:
        """Chunk document using specified or optimal strategy
        
        Args:
            document: Document to chunk
            strategy: Strategy to use (auto-select if None)
            config: Chunking configuration
            **kwargs: Additional arguments
            
        Returns:
            ChunkingResult with chunks and metrics
        """
        start_time = time.time()
        
        try:
            # Auto-select strategy if not specified
            if strategy is None:
                strategy = await self._select_optimal_strategy(document)
            
            # Get chunker and process document
            chunker = self.get_chunker(strategy, config, **kwargs)
            result = await chunker.chunk_document_async(document)
            
            # Record performance
            processing_time = time.time() - start_time
            result.processing_time = processing_time
            result.strategy_used = strategy
            
            # Update strategy performance tracking
            if result.metrics:
                self._strategy_performance[strategy].append(result.metrics.overall_score)
                # Keep only last 100 scores
                if len(self._strategy_performance[strategy]) > 100:
                    self._strategy_performance[strategy] = self._strategy_performance[strategy][-100:]
            
            logger.debug(f"Chunked document using {strategy}: {result.chunk_count} chunks in {processing_time:.3f}s")
            return result
            
        except Exception as e:
            processing_time = time.time() - start_time
            logger.error(f"Chunking failed with strategy {strategy}: {e}")
            
            return ChunkingResult(
                strategy_used=strategy,
                processing_time=processing_time,
                success=False,
                error=str(e)
            )
    
    async def _select_optimal_strategy(self, document: Document) -> str:
        """Select optimal chunking strategy for document
        
        Args:
            document: Document to analyze
            
        Returns:
            Optimal strategy name
        """
        # Simple heuristics for strategy selection
        content_length = len(document.content)
        content_type = document.metadata.content_type or ""
        
        # CSV files
        if "csv" in content_type.lower() or document.metadata.source and document.metadata.source.endswith('.csv'):
            return ChunkingStrategy.CSV_ROW.value
        
        # Large documents benefit from semantic chunking
        if content_length > 10000:
            if ChunkingStrategy.SEMANTIC.value in self._chunkers:
                return ChunkingStrategy.SEMANTIC.value
        
        # Structured documents
        if any(marker in document.content for marker in ['#', '##', '###', '<h1>', '<h2>']):
            return ChunkingStrategy.DOCUMENT.value
        
        # Default to recursive for most cases
        return self._default_strategy
    
    def get_strategy_performance(self, strategy: str) -> Dict[str, float]:
        """Get performance statistics for strategy
        
        Args:
            strategy: Strategy name
            
        Returns:
            Performance statistics
        """
        if strategy not in self._strategy_performance:
            return {}
        
        scores = self._strategy_performance[strategy]
        if not scores:
            return {}
        
        return {
            'average_score': sum(scores) / len(scores),
            'min_score': min(scores),
            'max_score': max(scores),
            'sample_count': len(scores),
            'recent_average': sum(scores[-10:]) / min(10, len(scores))
        }
    
    def get_all_performance_stats(self) -> Dict[str, Dict[str, float]]:
        """Get performance statistics for all strategies
        
        Returns:
            Performance statistics by strategy
        """
        return {
            strategy: self.get_strategy_performance(strategy)
            for strategy in self._chunkers.keys()
        }


class ChunkingOptimizer:
    """Optimizer for chunking strategies and parameters"""
    
    def __init__(self, framework: ChunkingFramework):
        self.framework = framework
        self.optimization_history: List[Dict[str, Any]] = []
    
    async def optimize_chunking_strategy(self, document: Document) -> str:
        """Optimize chunking strategy for specific document
        
        Args:
            document: Document to optimize for
            
        Returns:
            Optimal strategy name
        """
        # Test multiple strategies and compare results
        strategies_to_test = self.framework.list_strategies()
        if not strategies_to_test:
            raise ValueError("No chunking strategies available")
        
        best_strategy = None
        best_score = 0.0
        results = {}
        
        for strategy in strategies_to_test:
            try:
                result = await self.framework.chunk_document(document, strategy=strategy)
                if result.success and result.metrics:
                    score = result.metrics.overall_score
                    results[strategy] = {
                        'score': score,
                        'chunk_count': result.chunk_count,
                        'processing_time': result.processing_time
                    }
                    
                    if score > best_score:
                        best_score = score
                        best_strategy = strategy
                        
            except Exception as e:
                logger.warning(f"Strategy {strategy} failed during optimization: {e}")
                results[strategy] = {'error': str(e)}
        
        # Record optimization result
        self.optimization_history.append({
            'document_id': document.metadata.document_id,
            'document_size': len(document.content),
            'results': results,
            'best_strategy': best_strategy,
            'best_score': best_score,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
        return best_strategy or self.framework._default_strategy
    
    async def evaluate_chunk_quality(self, chunks: List[Document]) -> ChunkMetrics:
        """Evaluate quality of chunks
        
        Args:
            chunks: List of chunks to evaluate
            
        Returns:
            ChunkMetrics with quality scores
        """
        if not chunks:
            return ChunkMetrics()
        
        metrics = ChunkMetrics()
        
        # Size score - prefer chunks close to target size
        target_size = 1000  # Default target
        size_scores = []
        for chunk in chunks:
            size = len(chunk.content)
            # Score based on how close to target size
            if size == 0:
                size_scores.append(0.0)
            else:
                ratio = min(size, target_size) / max(size, target_size)
                size_scores.append(ratio)
        
        metrics.size_score = sum(size_scores) / len(size_scores)
        
        # Completeness score - check for truncated sentences
        completeness_scores = []
        for chunk in chunks:
            content = chunk.content.strip()
            if not content:
                completeness_scores.append(0.0)
                continue
            
            # Check if chunk ends with sentence-ending punctuation
            ends_properly = content[-1] in '.!?'
            # Check if chunk starts with capital letter or continuation
            starts_properly = content[0].isupper() or content.startswith(('and ', 'but ', 'or ', 'so '))
            
            score = 0.5 * ends_properly + 0.5 * starts_properly
            completeness_scores.append(score)
        
        metrics.completeness_score = sum(completeness_scores) / len(completeness_scores)
        
        # Overlap score - check for reasonable overlap
        if len(chunks) > 1:
            overlap_scores = []
            for i in range(len(chunks) - 1):
                current_chunk = chunks[i].content
                next_chunk = chunks[i + 1].content
                
                # Simple overlap detection
                overlap_found = False
                for j in range(min(100, len(current_chunk))):
                    suffix = current_chunk[-j-1:]
                    if suffix in next_chunk[:100]:
                        overlap_found = True
                        break
                
                overlap_scores.append(1.0 if overlap_found else 0.5)
            
            metrics.overlap_score = sum(overlap_scores) / len(overlap_scores)
        else:
            metrics.overlap_score = 1.0  # Single chunk doesn't need overlap
        
        # Coherence score - simple heuristic based on content
        coherence_scores = []
        for chunk in chunks:
            content = chunk.content.strip()
            if not content:
                coherence_scores.append(0.0)
                continue
            
            # Check for coherence indicators
            sentences = content.split('.')
            if len(sentences) < 2:
                coherence_scores.append(0.7)  # Short chunks are often coherent
            else:
                # Check for transition words and consistent topics
                transition_words = ['however', 'therefore', 'furthermore', 'moreover', 'additionally']
                has_transitions = any(word in content.lower() for word in transition_words)
                coherence_scores.append(0.8 if has_transitions else 0.6)
        
        metrics.coherence_score = sum(coherence_scores) / len(coherence_scores)
        
        # Boundary score - check for natural boundaries
        boundary_scores = []
        for chunk in chunks:
            content = chunk.content.strip()
            if not content:
                boundary_scores.append(0.0)
                continue
            
            # Check if chunk starts and ends at natural boundaries
            starts_at_boundary = (
                content[0].isupper() or 
                content.startswith(('# ', '## ', '### ')) or
                content.startswith(('- ', '* ', '1. '))
            )
            
            ends_at_boundary = (
                content.endswith(('.', '!', '?')) or
                content.endswith('\n') or
                content.endswith((':', ';'))
            )
            
            score = 0.5 * starts_at_boundary + 0.5 * ends_at_boundary
            boundary_scores.append(score)
        
        metrics.boundary_score = sum(boundary_scores) / len(boundary_scores)
        
        # Calculate overall score
        metrics.calculate_overall_score()
        
        return metrics
    
    def get_optimization_recommendations(self, document: Document) -> Dict[str, Any]:
        """Get optimization recommendations for document
        
        Args:
            document: Document to analyze
            
        Returns:
            Optimization recommendations
        """
        content_length = len(document.content)
        content_type = document.metadata.content_type or ""
        
        recommendations = {
            'suggested_strategies': [],
            'suggested_chunk_size': 1000,
            'suggested_overlap': 200,
            'reasoning': []
        }
        
        # Strategy recommendations based on content analysis
        if "csv" in content_type.lower():
            recommendations['suggested_strategies'].append(ChunkingStrategy.CSV_ROW.value)
            recommendations['reasoning'].append("CSV content detected - row-based chunking recommended")
        
        if content_length > 20000:
            recommendations['suggested_strategies'].append(ChunkingStrategy.SEMANTIC.value)
            recommendations['suggested_chunk_size'] = 1500
            recommendations['reasoning'].append("Large document - semantic chunking with larger chunks recommended")
        
        if any(marker in document.content for marker in ['#', '##', '###']):
            recommendations['suggested_strategies'].append(ChunkingStrategy.DOCUMENT.value)
            recommendations['reasoning'].append("Structured content with headings - document-aware chunking recommended")
        
        if not recommendations['suggested_strategies']:
            recommendations['suggested_strategies'].append(ChunkingStrategy.RECURSIVE.value)
            recommendations['reasoning'].append("Default recursive chunking recommended")
        
        return recommendations


# Global framework instance
_global_framework = ChunkingFramework()

def get_chunking_framework() -> ChunkingFramework:
    """Get global chunking framework instance"""
    return _global_framework

def register_chunker(strategy: str, chunker_class: Type[AdvancedBaseChunker]) -> None:
    """Register chunker in global framework"""
    _global_framework.register_chunker(strategy, chunker_class)

def get_chunker(strategy: str, config: Optional[ChunkingConfig] = None, **kwargs) -> AdvancedBaseChunker:
    """Get chunker from global framework"""
    return _global_framework.get_chunker(strategy, config, **kwargs)