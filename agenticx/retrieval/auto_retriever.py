"""
Auto Retriever Implementation

Implements automatic retrieval strategy selection based on query analysis.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError, RetrievalType
from .agents import QueryAnalysisAgent


@dataclass
class StrategyPerformance:
    """Performance metrics for a retrieval strategy."""
    strategy: RetrievalType
    avg_score: float
    response_time: float
    success_rate: float
    usage_count: int


class AutoRetriever(BaseRetriever):
    """
    Automatic retriever that selects the best strategy based on query analysis.
    
    Uses query analysis to automatically choose between different retrieval strategies.
    """
    
    def __init__(
        self,
        retrievers: Dict[RetrievalType, BaseRetriever],
        query_analyzer: Optional[QueryAnalysisAgent] = None,
        **kwargs
    ):
        # Use the tenant_id from the first retriever
        first_retriever = next(iter(retrievers.values()))
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(first_retriever.tenant_id, **filtered_kwargs)
        
        self.retrievers = retrievers
        self.query_analyzer = query_analyzer
        self._strategy_performance: Dict[RetrievalType, StrategyPerformance] = {}
        self._query_history: List[Dict[str, Any]] = []
    
    async def _initialize(self):
        """Initialize all retrievers."""
        for retriever in self.retrievers.values():
            await retriever.initialize()
        
        # Initialize strategy performance tracking
        for strategy in self.retrievers.keys():
            self._strategy_performance[strategy] = StrategyPerformance(
                strategy=strategy,
                avg_score=0.0,
                response_time=0.0,
                success_rate=1.0,
                usage_count=0
            )
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using automatic strategy selection."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Analyze query to determine best strategy
            selected_strategy = await self._select_retrieval_strategy(retrieval_query)
            
            # Execute retrieval with selected strategy
            results = await self._execute_retrieval(retrieval_query, selected_strategy, **kwargs)
            
            # Update performance metrics
            await self._update_strategy_performance(selected_strategy, results)
            
            return results
            
        except Exception as e:
            raise RetrievalError(f"Auto retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to all retrievers."""
        
        await self.initialize()
        
        try:
            # Add to all retrievers
            all_ids = []
            for retriever in self.retrievers.values():
                ids = await retriever.add_documents(documents, **kwargs)
                all_ids.extend(ids)
            
            # Return unique IDs
            return list(set(all_ids))
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from all retrievers."""
        
        try:
            success = True
            for retriever in self.retrievers.values():
                retriever_success = await retriever.remove_documents(document_ids, **kwargs)
                success = success and retriever_success
            
            return success
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get auto retriever statistics."""
        
        try:
            # Get stats from all retrievers
            retriever_stats = {}
            for strategy, retriever in self.retrievers.items():
                retriever_stats[strategy.value] = await retriever.get_stats()
            
            return {
                "retriever_type": "auto",
                "available_strategies": [s.value for s in self.retrievers.keys()],
                "strategy_performance": {
                    s.value: {
                        "avg_score": p.avg_score,
                        "response_time": p.response_time,
                        "success_rate": p.success_rate,
                        "usage_count": p.usage_count
                    }
                    for s, p in self._strategy_performance.items()
                },
                "retriever_stats": retriever_stats,
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "auto",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    async def _select_retrieval_strategy(self, query: RetrievalQuery) -> RetrievalType:
        """Select the best retrieval strategy for the query."""
        
        # If query specifies a strategy, use it
        if query.query_type != RetrievalType.AUTO:
            if query.query_type in self.retrievers:
                return query.query_type
        
        # Use query analyzer if available
        if self.query_analyzer:
            analysis = await self.query_analyzer.analyze_query(query.text)
            recommended_strategy = analysis.query_type
            
            if recommended_strategy in self.retrievers:
                return recommended_strategy
        
        # Use performance-based selection
        best_strategy = await self._select_by_performance(query.text)
        
        return best_strategy
    
    async def _select_by_performance(self, query_text: str) -> RetrievalType:
        """Select strategy based on historical performance."""
        
        # Analyze query characteristics
        query_intent = await self._analyze_query_intent(query_text)
        
        # Select based on query characteristics and performance
        if query_intent.get("is_factual", False):
            # Factual queries work well with vector search
            if RetrievalType.VECTOR in self.retrievers:
                return RetrievalType.VECTOR
        
        if query_intent.get("is_keyword_based", False):
            # Keyword queries work well with BM25
            if RetrievalType.BM25 in self.retrievers:
                return RetrievalType.BM25
        
        if query_intent.get("is_entity_based", False):
            # Entity queries work well with graph search
            if RetrievalType.GRAPH in self.retrievers:
                return RetrievalType.GRAPH
        
        # Default to hybrid if available
        if RetrievalType.HYBRID in self.retrievers:
            return RetrievalType.HYBRID
        
        # Fallback to first available strategy
        return next(iter(self.retrievers.keys()))
    
    async def _analyze_query_intent(self, query: str) -> Dict[str, Any]:
        """Analyze query intent for strategy selection."""
        
        query_lower = query.lower()
        
        # Check for factual queries
        factual_patterns = ["what is", "who is", "when", "where", "how many"]
        is_factual = any(pattern in query_lower for pattern in factual_patterns)
        
        # Check for keyword-based queries
        keyword_patterns = ["search for", "find", "look for"]
        is_keyword_based = any(pattern in query_lower for pattern in keyword_patterns)
        
        # Check for entity-based queries
        entity_patterns = ["relationship", "connection", "related to"]
        is_entity_based = any(pattern in query_lower for pattern in entity_patterns)
        
        # Check for complex queries
        complex_patterns = ["explain", "analyze", "compare", "why"]
        is_complex = any(pattern in query_lower for pattern in complex_patterns)
        
        return {
            "is_factual": is_factual,
            "is_keyword_based": is_keyword_based,
            "is_entity_based": is_entity_based,
            "is_complex": is_complex,
            "query_length": len(query.split()),
            "has_entities": len([word for word in query.split() if word[0].isupper()]) > 0
        }
    
    async def _execute_retrieval(
        self,
        query: RetrievalQuery,
        strategy: RetrievalType,
        **kwargs
    ) -> List[RetrievalResult]:
        """Execute retrieval with the selected strategy."""
        
        import time
        start_time = time.time()
        
        try:
            retriever = self.retrievers[strategy]
            results = await retriever.retrieve(query, **kwargs)
            
            # Record execution time
            execution_time = time.time() - start_time
            
            # Update performance metrics
            await self._update_execution_metrics(strategy, results, execution_time)
            
            return results
            
        except Exception as e:
            # Record failure
            await self._update_failure_metrics(strategy)
            raise e
    
    async def _update_strategy_performance(
        self,
        strategy: RetrievalType,
        results: List[RetrievalResult]
    ):
        """Update performance metrics for a strategy."""
        
        if strategy not in self._strategy_performance:
            return
        
        perf = self._strategy_performance[strategy]
        
        # Update average score
        if results:
            avg_score = sum(r.score for r in results) / len(results)
            # Avoid division by zero
            if perf.usage_count > 0:
                perf.avg_score = (perf.avg_score * perf.usage_count + avg_score) / (perf.usage_count + 1)
            else:
                perf.avg_score = avg_score
        
        # Update usage count
        perf.usage_count += 1
    
    async def _update_execution_metrics(
        self,
        strategy: RetrievalType,
        results: List[RetrievalResult],
        execution_time: float
    ):
        """Update execution metrics for a strategy."""
        
        if strategy not in self._strategy_performance:
            return
        
        perf = self._strategy_performance[strategy]
        
        # Update response time (avoid division by zero)
        if perf.usage_count > 0:
            perf.response_time = (perf.response_time * (perf.usage_count - 1) + execution_time) / perf.usage_count
        else:
            perf.response_time = execution_time
        
        # Update success rate (avoid division by zero)
        if perf.usage_count > 0:
            perf.success_rate = (perf.success_rate * (perf.usage_count - 1) + 1.0) / perf.usage_count
        else:
            perf.success_rate = 1.0
    
    async def _update_failure_metrics(self, strategy: RetrievalType):
        """Update failure metrics for a strategy."""
        
        if strategy not in self._strategy_performance:
            return
        
        perf = self._strategy_performance[strategy]
        
        # Update success rate (decrease) - avoid division by zero
        if perf.usage_count > 0:
            perf.success_rate = (perf.success_rate * (perf.usage_count - 1) + 0.0) / perf.usage_count
        else:
            perf.success_rate = 0.0 