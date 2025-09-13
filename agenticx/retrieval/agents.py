"""
Agentic Retrieval Components

Implements intelligent retrieval agents that can make decisions
about retrieval strategies and optimize search results.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass
from datetime import datetime, UTC

from ..core.agent import Agent
from ..core.task import Task
from ..core.tool import BaseTool
from ..llms.base import BaseLLMProvider as BaseLLM
from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalType


@dataclass
class QueryAnalysis:
    """Result of query analysis."""
    
    intent: str
    keywords: List[str]
    entities: List[str]
    query_type: RetrievalType
    suggested_filters: Dict[str, Any]
    confidence: float


class QueryAnalysisAgent(Agent):
    """
    Intelligent agent for analyzing and understanding queries.
    
    Determines the best retrieval strategy based on query characteristics.
    """
    
    def __init__(self, llm: BaseLLM, **kwargs):
        # Extract organization_id to avoid duplicate parameter
        organization_id = kwargs.pop("organization_id", "default")
        super().__init__(
            id="query_analyzer",
            name="Query Analysis Agent",
            role="Query Analysis Specialist",
            goal="Analyze queries to determine optimal retrieval strategies",
            backstory="Expert at understanding query intent and selecting the best search approach",
            llm_config_name="query_analyzer_llm",
            organization_id=organization_id,
            llm=llm,
            query_patterns=self._load_query_patterns(),
            **kwargs
        )
    
    async def analyze_query(self, query: str, context: Optional[Dict[str, Any]] = None) -> QueryAnalysis:
        """Analyze a query to determine the best retrieval strategy."""
        
        # Create analysis task
        task = Task(
            id="query_analysis",
            description=f"Analyze the query: '{query}' and determine the best retrieval strategy",
            agent_id=self.id,
            expected_output="A dictionary containing intent, keywords, entities, query_type, suggested_filters, and confidence",
            output_schema={
                "intent": "string",
                "keywords": ["string"],
                "entities": ["string"], 
                "query_type": "string",
                "suggested_filters": "object",
                "confidence": "number"
            }
        )
        
        # Build context with query patterns
        analysis_context = {
            "query": query,
            "context": context or {},
            "query_patterns": self.query_patterns,
            "available_strategies": [t.value for t in RetrievalType]
        }
        
        # Execute analysis
        result = await self.execute_task(task, context=analysis_context)
        
        # Parse result
        analysis_data = result.get("output", {})
        
        # Safely convert query_type to RetrievalType
        query_type_str = analysis_data.get("query_type", "auto")
        try:
            query_type = RetrievalType(query_type_str)
        except ValueError:
            # Fallback to AUTO if the value is not a valid RetrievalType
            query_type = RetrievalType.AUTO
        
        return QueryAnalysis(
            intent=analysis_data.get("intent", "general"),
            keywords=analysis_data.get("keywords", []),
            entities=analysis_data.get("entities", []),
            query_type=query_type,
            suggested_filters=analysis_data.get("suggested_filters", {}),
            confidence=analysis_data.get("confidence", 0.5)
        )
    
    def _load_query_patterns(self) -> Dict[str, Any]:
        """Load query analysis patterns."""
        return {
            "factual_queries": ["what is", "who is", "when", "where", "how many"],
            "procedural_queries": ["how to", "steps", "process", "procedure"],
            "comparative_queries": ["compare", "difference", "versus", "vs"],
            "analytical_queries": ["analyze", "explain", "why", "cause"],
            "creative_queries": ["generate", "create", "design", "suggest"]
        }


class RetrievalAgent(Agent):
    """
    Intelligent retrieval agent that orchestrates different retrieval strategies.
    
    Can choose between different retrievers and optimize search results.
    """
    
    def __init__(
        self,
        retrievers: Dict[RetrievalType, BaseRetriever],
        query_analyzer: QueryAnalysisAgent,
        **kwargs
    ):
        # Extract organization_id to avoid duplicate parameter
        organization_id = kwargs.pop("organization_id", "default")
        # Convert retrievers to a dictionary with string keys for compatibility
        retrievers_dict = {str(k): v for k, v in retrievers.items()}
        super().__init__(
            id="retrieval_agent",
            name="Intelligent Retrieval Agent", 
            role="Retrieval Specialist",
            goal="Retrieve the most relevant information using optimal strategies",
            backstory="Expert at finding information using multiple retrieval approaches",
            organization_id=organization_id,
            retrievers=retrievers_dict,
            retrieval_history=[],
            query_analyzer=query_analyzer,
            **kwargs
        )
    
    async def retrieve(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> List[RetrievalResult]:
        """Intelligent retrieval with strategy selection."""
        
        # 1. Analyze query
        if self.query_analyzer is not None:
            analysis = await self.query_analyzer.analyze_query(query, context)
        else:
            # Fallback analysis if query_analyzer is not available
            analysis = QueryAnalysis(
                intent="general",
                keywords=[],
                entities=[],
                query_type=RetrievalType.AUTO,
                suggested_filters={},
                confidence=0.5
            )
        
        # 2. Select retrieval strategy
        strategy = await self._select_retrieval_strategy(analysis, context)
        
        # 3. Execute retrieval
        results = await self._execute_retrieval(query, strategy, analysis, **kwargs)
        
        # 4. Post-process results
        processed_results = await self._post_process_results(results, analysis)
        
        # 5. Update history
        self._update_retrieval_history(query, analysis, strategy, len(processed_results))
        
        return processed_results
    
    async def _select_retrieval_strategy(
        self,
        analysis: QueryAnalysis,
        context: Optional[Dict[str, Any]]
    ) -> RetrievalType:
        """Select the best retrieval strategy based on analysis."""
        
        # Use analysis confidence to determine strategy
        if analysis.confidence > 0.8:
            return analysis.query_type
        
        # Fallback to first available strategy for uncertain queries
        if self.retrievers:
            first_key = next(iter(self.retrievers.keys()))
            # Ensure we return a RetrievalType enum value
            if isinstance(first_key, RetrievalType):
                return first_key
            else:
                # If key is not RetrievalType, try to convert it
                try:
                    return RetrievalType(str(first_key))
                except ValueError:
                    pass
        
        return RetrievalType.VECTOR
    
    async def _execute_retrieval(
        self,
        query: str,
        strategy: RetrievalType,
        analysis: QueryAnalysis,
        **kwargs
    ) -> List[RetrievalResult]:
        """Execute retrieval using selected strategy."""
        
        # Get appropriate retriever
        retriever = None
        if self.retrievers:
            # Try to get retriever with string representation of strategy
            strategy_key = str(strategy)
            if strategy_key in self.retrievers:
                retriever = self.retrievers[strategy_key]
            else:
                # Fallback: try to find a matching retriever
                for key, value in self.retrievers.items():
                    if key == strategy_key:
                        retriever = value
                        break
        
        if not retriever:
            # Fallback to first available retriever
            if self.retrievers:
                retriever = next(iter(self.retrievers.values()))
            else:
                # Return empty list if no retrievers available
                return []
        
        # Build retrieval query
        retrieval_query = RetrievalQuery(
            text=query,
            query_type=strategy,
            filters=analysis.suggested_filters,
            metadata=analysis.__dict__
        )
        
        # Execute retrieval
        results = await retriever.retrieve(retrieval_query, **kwargs)
        
        return results
    
    async def _post_process_results(
        self,
        results: List[RetrievalResult],
        analysis: QueryAnalysis
    ) -> List[RetrievalResult]:
        """Post-process retrieval results."""
        
        # Apply relevance filtering based on analysis
        filtered_results = []
        for result in results:
            # Check if result matches query intent
            if self._matches_intent(result, analysis):
                filtered_results.append(result)
        
        # Sort by relevance and analysis confidence
        filtered_results.sort(
            key=lambda r: r.score * analysis.confidence,
            reverse=True
        )
        
        return filtered_results
    
    def _matches_intent(self, result: RetrievalResult, analysis: QueryAnalysis) -> bool:
        """Check if result matches the query intent."""
        # Simple keyword matching - can be enhanced with semantic matching
        result_text = result.content.lower()
        for keyword in analysis.keywords:
            if keyword.lower() in result_text:
                return True
        return True  # Default to include all results
    
    def _update_retrieval_history(
        self,
        query: str,
        analysis: QueryAnalysis,
        strategy: RetrievalType,
        result_count: int
    ):
        """Update retrieval history for learning."""
        if self.retrieval_history is not None:
            self.retrieval_history.append({
                "query": query,
                "analysis": analysis,
                "strategy": strategy,
                "result_count": result_count,
                "timestamp": datetime.now(UTC)
            })


class RerankingAgent(Agent):
    """
    Intelligent reranking agent that optimizes search result ordering.
    
    Uses multiple factors to improve result relevance and diversity.
    """
    
    def __init__(self, llm: BaseLLM, **kwargs):
        # Extract organization_id to avoid duplicate parameter
        organization_id = kwargs.pop("organization_id", "default")
        super().__init__(
            id="reranking_agent",
            name="Result Reranking Agent",
            role="Result Optimization Specialist", 
            goal="Optimize search result ordering for maximum relevance and diversity",
            backstory="Expert at understanding result quality and user preferences",
            llm_config_name="reranker_llm",
            organization_id=organization_id,
            llm=llm,
            **kwargs
        )
    
    async def rerank(
        self,
        results: List[RetrievalResult],
        query: str,
        context: Optional[Dict[str, Any]] = None
    ) -> List[RetrievalResult]:
        """Intelligent reranking of search results."""
        
        if not results:
            return results
        
        # Create reranking task
        task = Task(
            id="result_reranking",
            description=f"Rerank {len(results)} search results for query: '{query}'",
            agent_id=self.id,
            expected_output="A dictionary containing reranked_indices and reasoning",
            output_schema={
                "reranked_indices": ["number"],
                "reasoning": "string"
            }
        )
        
        # Build context with results
        reranking_context = {
            "query": query,
            "results": [r.__dict__ for r in results],
            "context": context or {},
            "result_count": len(results)
        }
        
        # Execute reranking
        result = await self.execute_task(task, context=reranking_context)
        
        # Parse result
        reranking_data = result.get("output", {})
        reranked_indices = reranking_data.get("reranked_indices", list(range(len(results))))
        
        # Apply reranking
        reranked_results = [results[i] for i in reranked_indices if i < len(results)]
        
        return reranked_results


class IndexingAgent(Agent):
    """
    Intelligent indexing agent that optimizes document processing and indexing.
    
    Can choose optimal chunking strategies and indexing approaches.
    """
    
    def __init__(self, llm: BaseLLM, **kwargs):
        # Extract organization_id to avoid duplicate parameter
        organization_id = kwargs.pop("organization_id", "default")
        super().__init__(
            id="indexing_agent",
            name="Document Indexing Agent",
            role="Indexing Optimization Specialist",
            goal="Optimize document processing and indexing for better retrieval",
            backstory="Expert at understanding document structure and content",
            llm_config_name="indexer_llm",
            organization_id=organization_id,
            llm=llm,
            **kwargs
        )
    
    async def index_documents(
        self,
        documents: List[Dict[str, Any]],
        retriever: BaseRetriever,
        **kwargs
    ) -> List[str]:
        """Intelligent document indexing."""
        
        # Analyze documents to determine optimal indexing strategy
        indexing_strategy = await self._analyze_documents(documents)
        
        # Process documents according to strategy
        processed_documents = await self._process_documents(documents, indexing_strategy)
        
        # Index documents
        document_ids = await retriever.add_documents(processed_documents, **kwargs)
        
        return document_ids
    
    async def _analyze_documents(self, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze documents to determine indexing strategy."""
        
        # Create analysis task
        task = Task(
            id="document_analysis",
            description=f"Analyze {len(documents)} documents for optimal indexing",
            agent_id=self.id,
            expected_output="A dictionary containing chunking_strategy, indexing_priority, and metadata_extraction",
            output_schema={
                "chunking_strategy": "string",
                "indexing_priority": "string",
                "metadata_extraction": "object"
            }
        )
        
        # Execute analysis
        result = await self.execute_task(task, context={"documents": documents})
        
        return result.get("output", {})
    
    async def _process_documents(
        self,
        documents: List[Dict[str, Any]],
        strategy: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Process documents according to indexing strategy."""
        
        processed_documents = []
        
        for doc in documents:
            # Apply strategy-based processing
            processed_doc = await self._apply_indexing_strategy(doc, strategy)
            processed_documents.append(processed_doc)
        
        return processed_documents
    
    async def _apply_indexing_strategy(
        self,
        document: Dict[str, Any],
        strategy: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Apply indexing strategy to a single document."""
        
        # This is a simplified implementation
        # In practice, this would involve sophisticated document processing
        
        processed_doc = document.copy()
        
        # Add strategy-based metadata
        processed_doc["indexing_strategy"] = strategy.get("chunking_strategy", "default")
        processed_doc["indexing_priority"] = strategy.get("indexing_priority", "normal")
        
        return processed_doc 