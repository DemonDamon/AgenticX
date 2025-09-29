"""
Hybrid Retriever Implementation

Implements three-way hybrid retrieval combining graph, vector and BM25 strategies.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError, RetrievalType
from .vector_retriever import VectorRetriever
from .bm25_retriever import BM25Retriever
from .graph_retriever import GraphRetriever


@dataclass
class HybridConfig:
    """Configuration for three-way hybrid retrieval."""
    graph_weight: float = 0.4      # 图检索权重
    vector_weight: float = 0.4     # 向量检索权重  
    bm25_weight: float = 0.2       # BM25检索权重
    deduplication_threshold: float = 0.8
    min_combined_score: float = 0.1
    enable_graph_retrieval: bool = True  # 是否启用图检索


class HybridRetriever(BaseRetriever):
    """
    Three-way hybrid retriever combining graph, vector and BM25 strategies.
    
    Combines graph structure, semantic similarity and keyword matching for optimal results.
    """
    
    def __init__(
        self,
        vector_retriever: VectorRetriever,
        bm25_retriever: BM25Retriever,
        graph_retriever: Optional[GraphRetriever] = None,
        config: Optional[HybridConfig] = None,
        **kwargs
    ):
        # Filter out organization_id and tenant_id from kwargs to avoid conflicts
        tenant_id = vector_retriever.tenant_id
        filtered_kwargs = {k: v for k, v in kwargs.items() if k not in ['organization_id', 'tenant_id']}
        super().__init__(tenant_id=tenant_id, **filtered_kwargs)
        
        self.vector_retriever = vector_retriever
        self.bm25_retriever = bm25_retriever
        self.graph_retriever = graph_retriever
        self.config = config or HybridConfig()
        
        # 如果没有提供图检索器，禁用图检索
        if self.graph_retriever is None:
            self.config.enable_graph_retrieval = False
    
    async def _initialize(self):
        """Initialize all retrievers."""
        await self.vector_retriever.initialize()
        await self.bm25_retriever.initialize()
        
        if self.config.enable_graph_retrieval and self.graph_retriever:
            await self.graph_retriever.initialize()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using three-way hybrid strategy."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Execute all retrievers
            vector_results = await self.vector_retriever.retrieve(retrieval_query, **kwargs)
            bm25_results = await self.bm25_retriever.retrieve(retrieval_query, **kwargs)
            
            graph_results = []
            if self.config.enable_graph_retrieval and self.graph_retriever:
                try:
                    graph_results = await self.graph_retriever.retrieve(retrieval_query, **kwargs)
                except Exception as e:
                    # 图检索失败不影响整体检索
                    print(f"Warning: Graph retrieval failed: {e}")
            
            # Combine results from all three paths
            combined_results = await self._combine_three_way_results(
                graph_results, vector_results, bm25_results
            )
            
            # Apply minimum score filter
            filtered_results = [
                result for result in combined_results
                if result.score >= retrieval_query.min_score
            ]
            
            return filtered_results[:retrieval_query.limit]
            
        except Exception as e:
            raise RetrievalError(f"Three-way hybrid retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to all retrievers."""
        
        await self.initialize()
        
        try:
            # Add to vector and BM25 retrievers
            vector_ids = await self.vector_retriever.add_documents(documents, **kwargs)
            bm25_ids = await self.bm25_retriever.add_documents(documents, **kwargs)
            
            # Add to graph retriever if enabled
            if self.config.enable_graph_retrieval and self.graph_retriever:
                try:
                    await self.graph_retriever.add_documents(documents, **kwargs)
                except Exception as e:
                    print(f"Warning: Failed to add documents to graph retriever: {e}")
            
            # Return vector IDs as primary
            return vector_ids
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from all retrievers."""
        
        try:
            vector_success = await self.vector_retriever.remove_documents(document_ids, **kwargs)
            bm25_success = await self.bm25_retriever.remove_documents(document_ids, **kwargs)
            
            graph_success = True
            if self.config.enable_graph_retrieval and self.graph_retriever:
                try:
                    graph_success = await self.graph_retriever.remove_documents(document_ids, **kwargs)
                except Exception as e:
                    print(f"Warning: Failed to remove documents from graph retriever: {e}")
                    graph_success = False
            
            return vector_success and bm25_success and graph_success
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get statistics from all retrievers."""
        
        try:
            vector_stats = await self.vector_retriever.get_stats()
            bm25_stats = await self.bm25_retriever.get_stats()
            
            graph_stats = {}
            if self.config.enable_graph_retrieval and self.graph_retriever:
                try:
                    graph_stats = await self.graph_retriever.get_stats()
                except Exception as e:
                    graph_stats = {"error": str(e)}
            
            return {
                "retriever_type": "three_way_hybrid",
                "config": {
                    "graph_weight": self.config.graph_weight,
                    "vector_weight": self.config.vector_weight,
                    "bm25_weight": self.config.bm25_weight,
                    "enable_graph_retrieval": self.config.enable_graph_retrieval,
                    "deduplication_threshold": self.config.deduplication_threshold,
                    "min_combined_score": self.config.min_combined_score
                },
                "graph_stats": graph_stats,
                "vector_stats": vector_stats,
                "bm25_stats": bm25_stats,
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "three_way_hybrid",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    async def _combine_three_way_results(
        self,
        graph_results: List[RetrievalResult],
        vector_results: List[RetrievalResult],
        bm25_results: List[RetrievalResult]
    ) -> List[RetrievalResult]:
        """Combine results from all three retrieval paths."""
        
        # Create a mapping of content to results for deduplication
        content_to_results = {}
        
        # Process graph results
        for result in graph_results:
            content_key = result.content.strip().lower()
            if content_key not in content_to_results:
                content_to_results[content_key] = {
                    'graph_score': result.score,
                    'vector_score': 0.0,
                    'bm25_score': 0.0,
                    'result': result
                }
            else:
                content_to_results[content_key]['graph_score'] = max(
                    content_to_results[content_key]['graph_score'], result.score
                )
        
        # Process vector results
        for result in vector_results:
            content_key = result.content.strip().lower()
            if content_key not in content_to_results:
                content_to_results[content_key] = {
                    'graph_score': 0.0,
                    'vector_score': result.score,
                    'bm25_score': 0.0,
                    'result': result
                }
            else:
                content_to_results[content_key]['vector_score'] = max(
                    content_to_results[content_key]['vector_score'], result.score
                )
                # 如果图检索没有这个结果，使用向量检索的结果
                if content_to_results[content_key]['graph_score'] == 0.0:
                    content_to_results[content_key]['result'] = result
        
        # Process BM25 results
        for result in bm25_results:
            content_key = result.content.strip().lower()
            if content_key not in content_to_results:
                content_to_results[content_key] = {
                    'graph_score': 0.0,
                    'vector_score': 0.0,
                    'bm25_score': result.score,
                    'result': result
                }
            else:
                content_to_results[content_key]['bm25_score'] = max(
                    content_to_results[content_key]['bm25_score'], result.score
                )
                # 如果前面的检索都没有这个结果，使用BM25检索的结果
                if (content_to_results[content_key]['graph_score'] == 0.0 and 
                    content_to_results[content_key]['vector_score'] == 0.0):
                    content_to_results[content_key]['result'] = result
        
        # Calculate combined scores and create final results
        combined_results = []
        for content_key, scores in content_to_results.items():
            combined_score = self._calculate_three_way_score(
                scores['graph_score'],
                scores['vector_score'], 
                scores['bm25_score']
            )
            
            # Update the result with combined score
            result = scores['result']
            result.score = combined_score
            
            # Add metadata about score sources
            if not hasattr(result, 'metadata') or result.metadata is None:
                result.metadata = {}
            result.metadata.update({
                'graph_score': scores['graph_score'],
                'vector_score': scores['vector_score'],
                'bm25_score': scores['bm25_score'],
                'combined_score': combined_score,
                'retrieval_method': 'three_way_hybrid'
            })
            
            combined_results.append(result)
        
        # Sort by combined score
        combined_results.sort(key=lambda x: x.score, reverse=True)
        
        return combined_results
    
    async def _combine_results(
        self,
        vector_results: List[RetrievalResult],
        bm25_results: List[RetrievalResult]
    ) -> List[RetrievalResult]:
        """Legacy method for backward compatibility."""
        return await self._combine_three_way_results([], vector_results, bm25_results)
    
    def _calculate_three_way_score(self, graph_score: float, vector_score: float, bm25_score: float) -> float:
        """Calculate combined score from all three retrieval paths."""
        
        # Normalize scores to 0-1 range
        normalized_graph = min(1.0, max(0.0, graph_score))
        normalized_vector = min(1.0, max(0.0, vector_score))
        normalized_bm25 = min(1.0, max(0.0, bm25_score))
        
        # Weighted combination
        combined_score = (
            self.config.graph_weight * normalized_graph +
            self.config.vector_weight * normalized_vector +
            self.config.bm25_weight * normalized_bm25
        )
        
        return combined_score
    
    def _calculate_hybrid_score(self, vector_score: float, bm25_score: float) -> float:
        """Calculate hybrid score from vector and BM25 scores (legacy method)."""
        
        # Normalize scores to 0-1 range
        normalized_vector = min(1.0, max(0.0, vector_score))
        normalized_bm25 = min(1.0, max(0.0, bm25_score))
        
        # For two-way retrieval, normalize weights to sum to 1.0
        total_weight = self.config.vector_weight + self.config.bm25_weight
        if total_weight > 0:
            vector_weight = self.config.vector_weight / total_weight
            bm25_weight = self.config.bm25_weight / total_weight
        else:
            vector_weight = 0.6  # Default fallback
            bm25_weight = 0.4
        
        # Weighted combination
        hybrid_score = (
            vector_weight * normalized_vector +
            bm25_weight * normalized_bm25
        )
        
        return hybrid_score
    
    def _deduplicate_results(
        self,
        results: List[RetrievalResult]
    ) -> List[RetrievalResult]:
        """Remove duplicate results based on content similarity."""
        
        if not results:
            return results
        
        deduplicated = [results[0]]
        
        for result in results[1:]:
            # Check if this result is too similar to any existing result
            is_duplicate = False
            
            for existing_result in deduplicated:
                similarity = self._calculate_content_similarity(
                    result.content,
                    existing_result.content
                )
                
                if similarity >= self.config.deduplication_threshold:
                    is_duplicate = True
                    break
            
            if not is_duplicate:
                deduplicated.append(result)
        
        return deduplicated
    
    def _calculate_content_similarity(self, content1: str, content2: str) -> float:
        """Calculate similarity between two content strings."""
        
        # Simple Jaccard similarity on words
        words1 = set(content1.lower().split())
        words2 = set(content2.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0