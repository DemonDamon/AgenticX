"""
RAG Workflow Tools

Implements RAG workflow as a collection of tools that can be used
by agents or directly in workflows.
"""

from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

from ..core.tool import BaseTool
from pydantic import BaseModel, Field
from .base import BaseRetriever, RetrievalQuery, RetrievalResult
from .agents import RetrievalAgent, RerankingAgent, IndexingAgent, QueryAnalysisAgent


class DocumentIndexingTool(BaseTool):
    """
    Tool for indexing documents into the retrieval system.
    
    Similar to AutoAgent's save_raw_docs_to_vector_db tool.
    """
    
    indexing_agent: IndexingAgent = Field(description="The indexing agent to use")
    retriever: BaseRetriever = Field(description="The retriever to use")
    
    def __init__(self, indexing_agent: IndexingAgent, retriever: BaseRetriever):
        super().__init__(
            name="document_indexing",
            description="Index documents into the retrieval system for later search",
            args_schema=DocumentIndexingArgs
        )
        self.indexing_agent = indexing_agent
        self.retriever = retriever
    
    def execute(self, **kwargs) -> str:
        """Execute document indexing synchronously."""
        # For now, return a simple message since this is primarily async
        return "Document indexing is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Index documents using the indexing agent."""
        args = DocumentIndexingArgs(**kwargs)
        
        try:
            # Use indexing agent to intelligently index documents
            document_ids = await self.indexing_agent.index_documents(
                documents=args.documents,
                retriever=self.retriever,
                collection_name=args.collection_name,
                overwrite=args.overwrite
            )
            
            return f"Successfully indexed {len(document_ids)} documents into collection '{args.collection_name}'"
            
        except Exception as e:
            return f"Failed to index documents: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)


class RetrievalTool(BaseTool):
    """
    Tool for retrieving information from the knowledge base.
    
    Similar to AutoAgent's query_db tool.
    """
    
    retrieval_agent: RetrievalAgent = Field(description="The retrieval agent to use")
    
    def __init__(self, retrieval_agent: RetrievalAgent):
        super().__init__(
            name="retrieval",
            description="Retrieve relevant information from the knowledge base",
            args_schema=RetrievalArgs
        )
        self.retrieval_agent = retrieval_agent
    
    def execute(self, **kwargs) -> str:
        """Execute retrieval synchronously."""
        # For now, return a simple message since this is primarily async
        return "Retrieval is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Retrieve information using the retrieval agent."""
        args = RetrievalArgs(**kwargs)
        
        try:
            # Use retrieval agent for intelligent search
            results = await self.retrieval_agent.retrieve(
                query=args.query_text,
                context=args.context,
                limit=args.n_results,
                min_score=args.min_score
            )
            
            # Format results
            if not results:
                return "No relevant information found."
            
            formatted_results = []
            for i, result in enumerate(results, 1):
                formatted_results.append(
                    f"{i}. Score: {result.score:.3f}\n"
                    f"   Content: {result.content[:200]}...\n"
                    f"   Source: {result.source or 'Unknown'}\n"
                )
            
            return "\n".join(formatted_results)
            
        except Exception as e:
            return f"Failed to retrieve information: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)


class RerankingTool(BaseTool):
    """
    Tool for reranking search results.
    
    Provides intelligent result reordering based on query context.
    """
    
    reranking_agent: RerankingAgent = Field(description="The reranking agent to use")
    
    def __init__(self, reranking_agent: RerankingAgent):
        super().__init__(
            name="reranking",
            description="Rerank search results for better relevance",
            args_schema=RerankingArgs
        )
        self.reranking_agent = reranking_agent
    
    def execute(self, **kwargs) -> str:
        """Execute reranking synchronously."""
        # For now, return a simple message since this is primarily async
        return "Reranking is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Rerank results using the reranking agent."""
        args = RerankingArgs(**kwargs)
        
        try:
            # Use reranking agent for intelligent reordering
            reranked_results = await self.reranking_agent.rerank(
                results=args.results,
                query=args.query,
                context=args.context
            )
            
            # Format reranked results
            formatted_results = []
            for i, result in enumerate(reranked_results, 1):
                formatted_results.append(
                    f"{i}. Score: {result.score:.3f}\n"
                    f"   Content: {result.content[:200]}...\n"
                )
            
            return "\n".join(formatted_results)
            
        except Exception as e:
            return f"Failed to rerank results: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)


class QueryModificationTool(BaseTool):
    """
    Tool for modifying queries to improve search results.
    
    Similar to AutoAgent's modify_query tool.
    """
    
    query_analyzer: QueryAnalysisAgent = Field(description="The query analyzer to use")
    
    def __init__(self, query_analyzer: QueryAnalysisAgent):
        super().__init__(
            name="query_modification",
            description="Modify queries to improve search effectiveness",
            args_schema=QueryModificationArgs
        )
        self.query_analyzer = query_analyzer
    
    def execute(self, **kwargs) -> str:
        """Execute query modification synchronously."""
        # For now, return a simple message since this is primarily async
        return "Query modification is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Modify query using the query analyzer."""
        args = QueryModificationArgs(**kwargs)
        
        try:
            # Analyze current knowledge and query
            analysis = await self.query_analyzer.analyze_query(
                query=args.original_query,
                context={"known_information": args.known_information}
            )
            
            # Generate modified query based on analysis
            modified_query = await self._generate_modified_query(
                original_query=args.original_query,
                known_information=args.known_information,
                analysis=analysis
            )
            
            return f"Modified query: {modified_query}"
            
        except Exception as e:
            return f"Failed to modify query: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)
    
    async def _generate_modified_query(
        self,
        original_query: str,
        known_information: str,
        analysis: Any
    ) -> str:
        """Generate a modified query based on analysis."""
        
        # This is a simplified implementation
        # In practice, this would use LLM to generate better queries
        
        # Simple keyword-based modification
        keywords = analysis.keywords if hasattr(analysis, 'keywords') else []
        
        if keywords and known_information:
            # Add context from known information
            modified_query = f"{original_query} (considering: {known_information})"
        else:
            modified_query = original_query
        
        return modified_query


class AnswerGenerationTool(BaseTool):
    """
    Tool for generating answers based on retrieved information.
    
    Similar to AutoAgent's answer_query tool.
    """
    
    llm: Any = Field(description="The LLM to use for answer generation")
    
    def __init__(self, llm):
        super().__init__(
            name="answer_generation",
            description="Generate answers based on retrieved information",
            args_schema=AnswerGenerationArgs
        )
        self.llm = llm
    
    def execute(self, **kwargs) -> str:
        """Execute answer generation synchronously."""
        # For now, return a simple message since this is primarily async
        return "Answer generation is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Generate answer based on retrieved information."""
        args = AnswerGenerationArgs(**kwargs)
        
        try:
            # Generate answer using LLM
            prompt = self._build_answer_prompt(
                query=args.original_query,
                supporting_docs=args.supporting_docs
            )
            
            response = await self.llm.ainvoke(prompt)
            
            return response.content
            
        except Exception as e:
            return f"Failed to generate answer: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)
    
    def _build_answer_prompt(self, query: str, supporting_docs: str) -> str:
        """Build prompt for answer generation."""
        return f"""
        You are a helpful assistant. Answer the user query based on the supporting documents.
        If you have not found the answer, say "Insufficient information."
        
        Original user query: {query}
        Supporting documents: {supporting_docs}
        
        Answer:
        """


class CanAnswerTool(BaseTool):
    """
    Tool for determining if enough information is available to answer a query.
    
    Similar to AutoAgent's can_answer tool.
    """
    
    llm: Any = Field(description="The LLM to use for answerability check")
    
    def __init__(self, llm):
        super().__init__(
            name="can_answer",
            description="Check if enough information is available to answer a query",
            args_schema=CanAnswerArgs
        )
        self.llm = llm
    
    def execute(self, **kwargs) -> str:
        """Execute can answer check synchronously."""
        # For now, return a simple message since this is primarily async
        return "Can answer check is primarily an async operation. Use aexecute() for full functionality."
    
    async def aexecute(self, **kwargs) -> str:
        """Check if query can be answered."""
        args = CanAnswerArgs(**kwargs)
        
        try:
            # Use LLM to determine if query can be answered
            prompt = self._build_can_answer_prompt(
                query=args.user_query,
                supporting_docs=args.supporting_docs
            )
            
            response = await self.llm.ainvoke(prompt)
            
            return response.content
            
        except Exception as e:
            return f"Failed to check answerability: {str(e)}"
    
    async def arun(self, **kwargs) -> str:
        """Alias for aexecute for compatibility."""
        return await self.aexecute(**kwargs)
    
    def _build_can_answer_prompt(self, query: str, supporting_docs: str) -> str:
        """Build prompt for answerability check."""
        return f"""
        You are a helpful assistant. Check if you have enough information to answer the user query.
        The answer should only be "True" or "False".
        
        User query: {query}
        Supporting documents: {supporting_docs}
        
        Answer:
        """


# Argument schemas for tools

class DocumentIndexingArgs(BaseModel):
    documents: List[Dict[str, Any]]
    collection_name: str
    overwrite: bool = False


class RetrievalArgs(BaseModel):
    query_text: str
    n_results: int = 5
    min_score: float = 0.0
    context: Optional[Dict[str, Any]] = None


class RerankingArgs(BaseModel):
    results: List[RetrievalResult]
    query: str
    context: Optional[Dict[str, Any]] = None


class QueryModificationArgs(BaseModel):
    original_query: str
    known_information: str


class AnswerGenerationArgs(BaseModel):
    original_query: str
    supporting_docs: str


class CanAnswerArgs(BaseModel):
    user_query: str
    supporting_docs: str 