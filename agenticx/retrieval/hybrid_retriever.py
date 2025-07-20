"""
Hybrid Retriever Implementation

Implements hybrid retrieval combining vector and BM25 strategies.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError, RetrievalType
from .vector_retriever import VectorRetriever
from .bm25_retriever import BM25Retriever


@dataclass
class HybridConfig:
    """Configuration for hybrid retrieval."""
    vector_weight: float = 0.6
    bm25_weight: float = 0.4
    deduplication_threshold: float = 0.8
    min_combined_score: float = 0.1


class HybridRetriever(BaseRetriever):
    """
    Hybrid retriever combining vector and BM25 strategies.
    
    Combines semantic similarity with keyword matching for better results.
    """
    
    def __init__(
        self,
        vector_retriever: VectorRetriever,
        bm25_retriever: BM25Retriever,
        config: Optional[HybridConfig] = None,
        **kwargs
    ):
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(vector_retriever.tenant_id, **filtered_kwargs)
        self.vector_retriever = vector_retriever
        self.bm25_retriever = bm25_retriever
        self.config = config or HybridConfig()
    
    async def _initialize(self):
        """Initialize both retrievers."""
        await self.vector_retriever.initialize()
        await self.bm25_retriever.initialize()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using hybrid strategy."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Execute both retrievers
            vector_results = await self.vector_retriever.retrieve(retrieval_query, **kwargs)
            bm25_results = await self.bm25_retriever.retrieve(retrieval_query, **kwargs)
            
            # Combine results
            combined_results = await self._combine_results(vector_results, bm25_results)
            
            # Apply minimum score filter
            filtered_results = [
                result for result in combined_results
                if result.score >= retrieval_query.min_score
            ]
            
            return filtered_results[:retrieval_query.limit]
            
        except Exception as e:
            raise RetrievalError(f"Hybrid retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to both retrievers."""
        
        await self.initialize()
        
        try:
            # Add to both retrievers
            vector_ids = await self.vector_retriever.add_documents(documents, **kwargs)
            bm25_ids = await self.bm25_retriever.add_documents(documents, **kwargs)
            
            # Return vector IDs as primary
            return vector_ids
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from both retrievers."""
        
        try:
            # Remove from both retrievers
            vector_success = await self.vector_retriever.remove_documents(document_ids, **kwargs)
            bm25_success = await self.bm25_retriever.remove_documents(document_ids, **kwargs)
            
            return vector_success and bm25_success
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get hybrid retriever statistics."""
        
        try:
            vector_stats = await self.vector_retriever.get_stats()
            bm25_stats = await self.bm25_retriever.get_stats()
            
            return {
                "retriever_type": "hybrid",
                "vector_stats": vector_stats,
                "bm25_stats": bm25_stats,
                "config": {
                    "vector_weight": self.config.vector_weight,
                    "bm25_weight": self.config.bm25_weight,
                    "deduplication_threshold": self.config.deduplication_threshold
                },
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "hybrid",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    async def _combine_results(
        self,
        vector_results: List[RetrievalResult],
        bm25_results: List[RetrievalResult]
    ) -> List[RetrievalResult]:
        """Combine results from both retrievers."""
        
        # Create document ID to result mapping
        vector_map = {result.chunk_id: result for result in vector_results}
        bm25_map = {result.chunk_id: result for result in bm25_results}
        
        # Get all unique document IDs
        all_doc_ids = set(vector_map.keys()) | set(bm25_map.keys())
        
        combined_results = []
        
        for doc_id in all_doc_ids:
            vector_result = vector_map.get(doc_id)
            bm25_result = bm25_map.get(doc_id)
            
            # Calculate hybrid score
            hybrid_score = self._calculate_hybrid_score(
                vector_result.score if vector_result else 0.0,
                bm25_result.score if bm25_result else 0.0
            )
            
            # Use the result with more complete information
            base_result = vector_result if vector_result else bm25_result
            
            if base_result:
                # Create combined result
                combined_result = RetrievalResult(
                    content=base_result.content,
                    score=hybrid_score,
                    metadata=base_result.metadata,
                    source=base_result.source,
                    chunk_id=base_result.chunk_id,
                    vector_score=vector_result.score if vector_result else None,
                    bm25_score=bm25_result.score if bm25_result else None,
                    hybrid_score=hybrid_score
                )
                combined_results.append(combined_result)
        
        # Sort by hybrid score
        combined_results.sort(key=lambda x: x.score, reverse=True)
        
        # Apply deduplication
        deduplicated_results = self._deduplicate_results(combined_results)
        
        return deduplicated_results
    
    def _calculate_hybrid_score(self, vector_score: float, bm25_score: float) -> float:
        """Calculate hybrid score from vector and BM25 scores."""
        
        # Normalize scores to 0-1 range (assuming they might be in different ranges)
        normalized_vector = min(1.0, vector_score)
        normalized_bm25 = min(1.0, bm25_score)
        
        # Weighted combination
        hybrid_score = (
            self.config.vector_weight * normalized_vector +
            self.config.bm25_weight * normalized_bm25
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