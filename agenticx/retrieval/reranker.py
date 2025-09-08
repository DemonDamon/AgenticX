"""
Reranker Implementation

Implements intelligent result reranking using LLM-based scoring.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import RetrievalResult, RetrievalError
from ..llms.base import BaseLLMProvider as BaseLLM


@dataclass
class RerankingConfig:
    """Configuration for reranking."""
    relevance_weight: float = 0.7
    diversity_weight: float = 0.3
    max_results: int = 10
    min_score_threshold: float = 0.1


class Reranker:
    """
    Intelligent result reranker using LLM-based scoring.
    
    Combines relevance scoring with diversity optimization.
    """
    
    def __init__(
        self,
        llm: BaseLLM,
        config: Optional[RerankingConfig] = None,
        **kwargs
    ):
        self.llm = llm
        self.config = config or RerankingConfig()
    
    async def rerank(
        self,
        results: List[RetrievalResult],
        query: str,
        **kwargs
    ) -> List[RetrievalResult]:
        """Rerank retrieval results using intelligent scoring."""
        
        if not results:
            return results
        
        try:
            # Calculate relevance scores
            relevance_scores = await self._calculate_relevance_scores(results, query)
            
            # Calculate diversity scores
            diversity_scores = await self._calculate_diversity_scores(results)
            
            # Combine scores
            combined_results = []
            for i, result in enumerate(results):
                relevance_score = relevance_scores[i]
                diversity_score = diversity_scores[i]
                
                # Calculate combined score
                combined_score = (
                    self.config.relevance_weight * relevance_score +
                    self.config.diversity_weight * diversity_score
                )
                
                # Create new result with updated score
                reranked_result = RetrievalResult(
                    content=result.content,
                    score=combined_score,
                    metadata={
                        **result.metadata,
                        "original_score": result.score,
                        "relevance_score": relevance_score,
                        "diversity_score": diversity_score,
                        "reranked": True
                    },
                    source=result.source,
                    chunk_id=result.chunk_id,
                    created_at=result.created_at
                )
                
                combined_results.append(reranked_result)
            
            # Sort by combined score
            combined_results.sort(key=lambda x: x.score, reverse=True)
            
            # Apply minimum score threshold
            filtered_results = [
                result for result in combined_results
                if result.score >= self.config.min_score_threshold
            ]
            
            return filtered_results[:self.config.max_results]
            
        except Exception as e:
            raise RetrievalError(f"Reranking failed: {str(e)}") from e
    
    async def _calculate_relevance_scores(
        self,
        results: List[RetrievalResult],
        query: str
    ) -> List[float]:
        """Calculate relevance scores using LLM."""
        
        scores = []
        
        for result in results:
            try:
                # Build relevance scoring prompt
                prompt = self._build_relevance_prompt(query, result.content)
                
                # Get LLM response
                response = await self.llm.ainvoke(prompt)
                
                # Parse score from response
                score = self._parse_relevance_score(response.content)
                scores.append(score)
                
            except Exception as e:
                # Fallback to original score
                scores.append(min(1.0, result.score))
        
        return scores
    
    async def _calculate_diversity_scores(
        self,
        results: List[RetrievalResult]
    ) -> List[float]:
        """Calculate diversity scores to avoid redundancy."""
        
        scores = []
        
        for i, result in enumerate(results):
            try:
                # Calculate diversity based on content similarity with previous results
                diversity_score = 1.0  # Default high diversity
                
                for j in range(i):
                    similarity = self._calculate_content_similarity(
                        result.content,
                        results[j].content
                    )
                    # Reduce diversity score if too similar
                    diversity_score = min(diversity_score, 1.0 - similarity)
                
                scores.append(diversity_score)
                
            except Exception as e:
                # Fallback to high diversity
                scores.append(1.0)
        
        return scores
    
    def _build_relevance_prompt(self, query: str, content: str) -> str:
        """Build prompt for relevance scoring."""
        
        return f"""
        Task: Score the relevance of a document to a query on a scale of 0.0 to 1.0.
        
        Query: "{query}"
        
        Document Content: "{content[:500]}..."
        
        Instructions:
        - Score 1.0 if the document directly answers the query
        - Score 0.8-0.9 if the document is highly relevant
        - Score 0.6-0.7 if the document is moderately relevant
        - Score 0.4-0.5 if the document is somewhat relevant
        - Score 0.0-0.3 if the document is not relevant
        
        Respond with only the numerical score (e.g., 0.85):
        """
    
    def _parse_relevance_score(self, response: str) -> float:
        """Parse relevance score from LLM response."""
        
        try:
            # Extract numerical score from response
            import re
            score_match = re.search(r'0\.\d+', response)
            if score_match:
                score = float(score_match.group())
                return max(0.0, min(1.0, score))
            
            # Fallback parsing
            if "highly relevant" in response.lower():
                return 0.9
            elif "relevant" in response.lower():
                return 0.7
            elif "somewhat" in response.lower():
                return 0.5
            else:
                return 0.3
                
        except Exception:
            return 0.5  # Default score
    
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
    
    async def rerank_with_context(
        self,
        results: List[RetrievalResult],
        query: str,
        context: Dict[str, Any],
        **kwargs
    ) -> List[RetrievalResult]:
        """Rerank results with additional context."""
        
        # Add context to query for better scoring
        contextualized_query = f"{query} (Context: {context.get('user_context', '')})"
        
        return await self.rerank(results, contextualized_query, **kwargs)
    
    async def rerank_for_diversity(
        self,
        results: List[RetrievalResult],
        query: str,
        diversity_weight: float = 0.5,
        **kwargs
    ) -> List[RetrievalResult]:
        """Rerank results with emphasis on diversity."""
        
        # Temporarily adjust diversity weight
        original_weight = self.config.diversity_weight
        self.config.diversity_weight = diversity_weight
        
        try:
            reranked_results = await self.rerank(results, query, **kwargs)
            return reranked_results
        finally:
            self.config.diversity_weight = original_weight
    
    async def rerank_for_relevance(
        self,
        results: List[RetrievalResult],
        query: str,
        relevance_weight: float = 0.9,
        **kwargs
    ) -> List[RetrievalResult]:
        """Rerank results with emphasis on relevance."""
        
        # Temporarily adjust relevance weight
        original_weight = self.config.relevance_weight
        self.config.relevance_weight = relevance_weight
        
        try:
            reranked_results = await self.rerank(results, query, **kwargs)
            return reranked_results
        finally:
            self.config.relevance_weight = original_weight 