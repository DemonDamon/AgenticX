"""
M15 Retrieval System Demo

Demonstrates the complete M15 retrieval system functionality.
"""

import sys
import asyncio
from pathlib import Path
from typing import List, Dict, Any

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.retrieval import (
    # Core components
    VectorRetriever, BM25Retriever, HybridRetriever, GraphRetriever, AutoRetriever,
    QueryAnalysisAgent, RetrievalAgent, RerankingAgent, IndexingAgent,
    Reranker, HybridConfig, RerankingConfig,
    
    # Tools
    DocumentIndexingTool, RetrievalTool, RerankingTool, QueryModificationTool,
    AnswerGenerationTool, CanAnswerTool,
    
    # Data models
    RetrievalQuery, RetrievalResult, RetrievalType
)


class MockComponents:
    """Mock components for demonstration."""
    
    class MockEmbeddingProvider:
        async def aembed(self, texts: List[str]) -> List[List[float]]:
            return [[0.1, 0.2, 0.3] for _ in texts]
    
    class MockVectorStorage:
        def __init__(self):
            self.vectors = {}
            self.vector_count = 0
        
        async def initialize(self):
            pass
        
        async def add(self, records):
            record_id = f"vec_{self.vector_count}"
            # Handle both single record and list of records
            if isinstance(records, list):
                record = records[0]  # Take first record for demo
            else:
                record = records
            
            self.vectors[record_id] = {
                "vector": record.vector,
                "payload": record.payload
            }
            self.vector_count += 1
            return record_id
        
        async def query(self, query):
            from dataclasses import dataclass
            
            @dataclass
            class MockSearchResult:
                record: Any
                score: float
            
            results = []
            for record_id, data in self.vectors.items():
                results.append(MockSearchResult(
                    record=type('Record', (), {'id': record_id, 'payload': data['payload']})(),
                    score=0.8
                ))
            
            return results[:query.top_k]
        
        async def delete(self, record_id):
            if record_id in self.vectors:
                del self.vectors[record_id]
        
        async def status(self):
            return type('Status', (), {'vector_dim': 3, 'vector_count': self.vector_count})()
    
    class MockLLM:
        async def agenerate(self, prompts):
            from dataclasses import dataclass
            
            @dataclass
            class MockGeneration:
                text: str
            
            @dataclass
            class MockResponse:
                generations: List[List[MockGeneration]]
            
            return MockResponse(generations=[[MockGeneration(text="0.85") for _ in prompts]])
    
    class MockGraphStorage:
        def __init__(self):
            self.nodes = {}
            self.relationships = {}
        
        async def initialize(self):
            pass
        
        async def add_node(self, node_id, properties):
            self.nodes[node_id] = {
                "label": properties.get("label", "Node"),
                "properties": properties,
                "content": properties.get("content", "")
            }
            return node_id
        
        async def add_edge(self, from_node, to_node, edge_type, properties):
            rel_id = f"rel_{len(self.relationships)}"
            self.relationships[rel_id] = {
                "source_id": from_node,
                "target_id": to_node,
                "type": edge_type,
                "properties": properties
            }
            return rel_id
        
        async def query(self, query):
            # Simple mock implementation that returns nodes and relationships
            results = []
            
            # Return nodes
            for node_id, node_data in self.nodes.items():
                results.append({
                    "n": {
                        "id": node_id,
                        "content": node_data["content"],
                        "label": node_data.get("label", "Node"),
                        "properties": node_data.get("properties", {})
                    }
                })
            
            # Return relationships
            for rel_id, rel_data in self.relationships.items():
                results.append({
                    "a": {"id": rel_data["source_id"], "content": "source"},
                    "r": {"id": rel_id, "type": rel_data["type"], "properties": rel_data["properties"]},
                    "b": {"id": rel_data["target_id"], "content": "target"}
                })
            
            return results[:10]  # Limit to 10 results
        
        async def get_node(self, node_id):
            return self.nodes.get(node_id, {})
        
        async def delete_node(self, node_id):
            if node_id in self.nodes:
                del self.nodes[node_id]
        
        async def delete_edge(self, from_node, to_node, edge_type):
            # Remove relationships that match the criteria
            to_remove = []
            for rel_id, rel_data in self.relationships.items():
                if (rel_data["source_id"] == from_node and 
                    rel_data["target_id"] == to_node and 
                    rel_data["type"] == edge_type):
                    to_remove.append(rel_id)
            
            for rel_id in to_remove:
                del self.relationships[rel_id]
        
        async def get_stats(self):
            return {"node_count": len(self.nodes), "relationship_count": len(self.relationships)}
        
        async def get_all_nodes(self):
            return [{"id": k, **v} for k, v in self.nodes.items()]
        
        async def get_all_relationships(self):
            return [{"id": k, **v} for k, v in self.relationships.items()]
        
        async def get_neighbors(self, node_id):
            neighbors = []
            for rel_id, rel_data in self.relationships.items():
                if rel_data["source_id"] == node_id:
                    neighbors.append({"id": rel_data["target_id"]})
                elif rel_data["target_id"] == node_id:
                    neighbors.append({"id": rel_data["source_id"]})
            return neighbors
        
        async def get_path(self, from_node, to_node, max_depth=3):
            # Simple path finding implementation
            if from_node == to_node:
                return [{"id": from_node}]
            
            # Check direct connection
            for rel_id, rel_data in self.relationships.items():
                if (rel_data["source_id"] == from_node and rel_data["target_id"] == to_node):
                    return [{"id": from_node}, {"id": to_node}]
            
            return []
        
        async def clear(self):
            self.nodes.clear()
            self.relationships.clear()
        
        async def close(self):
            # No cleanup needed for mock
            pass
        
        @property
        def get_client(self):
            return self
        
        @property
        def get_schema(self):
            return "mock_schema"
        
        @property
        def get_structured_schema(self):
            return {"nodes": [], "relationships": []}
        
        def refresh_schema(self):
            pass
        
        def add_triplet(self, subj, obj, rel):
            self.add_edge(subj, obj, rel)
        
        def delete_triplet(self, subj, obj, rel):
            self.delete_edge(subj, obj, rel)


class M15RetrievalDemo:
    """Demonstration of M15 retrieval system."""
    
    def __init__(self):
        self.mock_components = MockComponents()
        self.sample_documents = self._create_sample_documents()
    
    def _create_sample_documents(self) -> List[Dict[str, Any]]:
        """Create sample documents for demonstration."""
        return [
            {
                "id": "doc1",
                "content": "Python is a high-level programming language known for its simplicity and readability. It's widely used in web development, data science, and artificial intelligence.",
                "metadata": {"type": "programming", "topic": "python", "difficulty": "beginner"},
                "source": "programming_guide"
            },
            {
                "id": "doc2",
                "content": "Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.",
                "metadata": {"type": "ai", "topic": "machine_learning", "difficulty": "intermediate"},
                "source": "ai_textbook"
            },
            {
                "id": "doc3",
                "content": "Vector databases store high-dimensional vectors and enable efficient similarity search for applications like recommendation systems and semantic search.",
                "metadata": {"type": "database", "topic": "vector_db", "difficulty": "advanced"},
                "source": "database_guide"
            },
            {
                "id": "doc4",
                "content": "Natural Language Processing (NLP) is a field of AI that focuses on the interaction between computers and human language.",
                "metadata": {"type": "ai", "topic": "nlp", "difficulty": "intermediate"},
                "source": "nlp_textbook"
            },
            {
                "id": "doc5",
                "content": "Docker is a platform for developing, shipping, and running applications in containers, providing consistency across different environments.",
                "metadata": {"type": "devops", "topic": "docker", "difficulty": "intermediate"},
                "source": "devops_guide"
            }
        ]
    
    async def demo_basic_retrievers(self):
        """Demonstrate basic retrievers."""
        print("\n=== Basic Retrievers Demo ===")
        
        # Initialize components
        embedding_provider = self.mock_components.MockEmbeddingProvider()
        vector_storage = self.mock_components.MockVectorStorage()
        llm = self.mock_components.MockLLM()
        
        # 1. BM25 Retriever
        print("\n1. BM25 Retriever:")
        bm25_retriever = BM25Retriever(tenant_id="demo_tenant")
        await bm25_retriever.add_documents(self.sample_documents)
        
        results = await bm25_retriever.retrieve("Python programming language")
        print(f"   Found {len(results)} results")
        for i, result in enumerate(results[:2], 1):
            print(f"   {i}. Score: {result.score:.3f} - {result.content[:50]}...")
        
        # 2. Vector Retriever
        print("\n2. Vector Retriever:")
        vector_retriever = VectorRetriever(
            tenant_id="demo_tenant",
            embedding_provider=embedding_provider,
            vector_storage=vector_storage
        )
        await vector_retriever.add_documents(self.sample_documents)
        
        results = await vector_retriever.retrieve("artificial intelligence")
        print(f"   Found {len(results)} results")
        for i, result in enumerate(results[:2], 1):
            print(f"   {i}. Score: {result.score:.3f} - {result.content[:50]}...")
    
    async def demo_hybrid_retriever(self):
        """Demonstrate hybrid retriever."""
        print("\n=== Hybrid Retriever Demo ===")
        
        # Initialize components
        embedding_provider = self.mock_components.MockEmbeddingProvider()
        vector_storage = self.mock_components.MockVectorStorage()
        
        vector_retriever = VectorRetriever(
            tenant_id="demo_tenant",
            embedding_provider=embedding_provider,
            vector_storage=vector_storage
        )
        bm25_retriever = BM25Retriever(tenant_id="demo_tenant")
        
        # Create hybrid retriever
        hybrid_config = HybridConfig(vector_weight=0.6, bm25_weight=0.4)
        hybrid_retriever = HybridRetriever(
            vector_retriever=vector_retriever,
            bm25_retriever=bm25_retriever,
            config=hybrid_config
        )
        
        # Add documents
        await hybrid_retriever.add_documents(self.sample_documents)
        
        # Search
        results = await hybrid_retriever.retrieve("machine learning AI")
        print(f"Found {len(results)} results using hybrid search")
        
        for i, result in enumerate(results[:3], 1):
            print(f"{i}. Score: {result.score:.3f} - {result.content[:60]}...")
            if hasattr(result, 'vector_score') and result.vector_score:
                print(f"   Vector score: {result.vector_score:.3f}")
            if hasattr(result, 'bm25_score') and result.bm25_score:
                print(f"   BM25 score: {result.bm25_score:.3f}")
    
    async def demo_graph_retriever(self):
        """Demonstrate graph retriever."""
        print("\n=== Graph Retriever Demo ===")
        
        graph_storage = self.mock_components.MockGraphStorage()
        graph_retriever = GraphRetriever(
            tenant_id="demo_tenant",
            graph_storage=graph_storage
        )
        
        # Add documents (this will extract entities and relationships)
        await graph_retriever.add_documents(self.sample_documents)
        
        # Search
        results = await graph_retriever.retrieve("Python")
        print(f"Found {len(results)} results using graph search")
        
        for i, result in enumerate(results[:2], 1):
            print(f"{i}. Score: {result.score:.3f} - {result.content[:50]}...")
    
    async def demo_auto_retriever(self):
        """Demonstrate auto retriever."""
        print("\n=== Auto Retriever Demo ===")
        
        # Initialize components
        embedding_provider = self.mock_components.MockEmbeddingProvider()
        vector_storage = self.mock_components.MockVectorStorage()
        llm = self.mock_components.MockLLM()
        
        vector_retriever = VectorRetriever(
            tenant_id="demo_tenant",
            embedding_provider=embedding_provider,
            vector_storage=vector_storage
        )
        bm25_retriever = BM25Retriever(tenant_id="demo_tenant")
        
        # Create auto retriever
        retrievers = {
            RetrievalType.VECTOR: vector_retriever,
            RetrievalType.BM25: bm25_retriever
        }
        
        query_analyzer = QueryAnalysisAgent(llm=llm, organization_id="demo_tenant")
        auto_retriever = AutoRetriever(retrievers=retrievers, query_analyzer=query_analyzer)
        
        # Add documents
        await auto_retriever.add_documents(self.sample_documents)
        
        # Test different query types
        queries = [
            "What is Python?",
            "machine learning algorithms",
            "vector database similarity search"
        ]
        
        for query in queries:
            results = await auto_retriever.retrieve(query)
            print(f"\nQuery: '{query}'")
            print(f"Found {len(results)} results")
            if results:
                print(f"Top result: {results[0].content[:60]}...")
    
    async def demo_intelligent_agents(self):
        """Demonstrate intelligent agents."""
        print("\n=== Intelligent Agents Demo ===")
        
        llm = self.mock_components.MockLLM()
        embedding_provider = self.mock_components.MockEmbeddingProvider()
        vector_storage = self.mock_components.MockVectorStorage()
        
        # 1. Query Analysis Agent
        print("\n1. Query Analysis Agent:")
        query_analyzer = QueryAnalysisAgent(llm=llm, organization_id="demo_tenant")
        analysis = await query_analyzer.analyze_query("What is machine learning?")
        print(f"   Intent: {analysis.intent}")
        print(f"   Keywords: {analysis.keywords}")
        print(f"   Recommended strategy: {analysis.query_type.value}")
        print(f"   Confidence: {analysis.confidence:.2f}")
        
        # 2. Retrieval Agent
        print("\n2. Retrieval Agent:")
        vector_retriever = VectorRetriever(
            tenant_id="demo_tenant",
            embedding_provider=embedding_provider,
            vector_storage=vector_storage
        )
        await vector_retriever.add_documents(self.sample_documents)
        
        retrieval_agent = RetrievalAgent(
            retrievers={RetrievalType.VECTOR: vector_retriever},
            query_analyzer=query_analyzer,
            organization_id="demo_tenant"
        )
        
        results = await retrieval_agent.retrieve("artificial intelligence")
        print(f"   Found {len(results)} results using intelligent retrieval")
        
        # 3. Reranking Agent
        print("\n3. Reranking Agent:")
        reranking_agent = RerankingAgent(llm=llm, organization_id="demo_tenant")
        reranked_results = await reranking_agent.rerank(results, "artificial intelligence")
        print(f"   Reranked {len(reranked_results)} results")
        
        # 4. Indexing Agent
        print("\n4. Indexing Agent:")
        indexing_agent = IndexingAgent(llm=llm, organization_id="demo_tenant")
        doc_ids = await indexing_agent.index_documents(
            self.sample_documents[:2],
            vector_retriever
        )
        print(f"   Indexed {len(doc_ids)} documents using intelligent indexing")
    
    async def demo_rag_tools(self):
        """Demonstrate RAG workflow tools."""
        print("\n=== RAG Tools Demo ===")
        
        # Initialize components
        llm = self.mock_components.MockLLM()
        embedding_provider = self.mock_components.MockEmbeddingProvider()
        vector_storage = self.mock_components.MockVectorStorage()
        
        vector_retriever = VectorRetriever(
            tenant_id="demo_tenant",
            embedding_provider=embedding_provider,
            vector_storage=vector_storage
        )
        
        query_analyzer = QueryAnalysisAgent(llm=llm, organization_id="demo_tenant")
        retrieval_agent = RetrievalAgent(
            retrievers={RetrievalType.VECTOR: vector_retriever},
            query_analyzer=query_analyzer,
            organization_id="demo_tenant"
        )
        reranking_agent = RerankingAgent(llm=llm, organization_id="demo_tenant")
        indexing_agent = IndexingAgent(llm=llm, organization_id="demo_tenant")
        
        # 1. Document Indexing Tool
        print("\n1. Document Indexing Tool:")
        indexing_tool = DocumentIndexingTool(
            indexing_agent=indexing_agent,
            retriever=vector_retriever
        )
        
        result = await indexing_tool.arun(
            documents=self.sample_documents[:2],
            collection_name="demo_collection"
        )
        print(f"   {result}")
        
        # 2. Retrieval Tool
        print("\n2. Retrieval Tool:")
        retrieval_tool = RetrievalTool(retrieval_agent=retrieval_agent)
        
        result = await retrieval_tool.arun(
            query_text="What is Python?",
            n_results=3
        )
        print(f"   {result[:200]}...")
        
        # 3. Reranking Tool
        print("\n3. Reranking Tool:")
        reranking_tool = RerankingTool(reranking_agent=reranking_agent)
        
        sample_results = [
            RetrievalResult(content="Python is a programming language", score=0.8),
            RetrievalResult(content="Machine learning uses Python", score=0.7)
        ]
        
        result = await reranking_tool.arun(
            results=sample_results,
            query="Python programming"
        )
        print(f"   {result[:200]}...")
        
        # 4. Query Modification Tool
        print("\n4. Query Modification Tool:")
        query_mod_tool = QueryModificationTool(query_analyzer=query_analyzer)
        
        result = await query_mod_tool.arun(
            original_query="What is AI?",
            known_information="AI stands for Artificial Intelligence"
        )
        print(f"   {result}")
        
        # 5. Answer Generation Tool
        print("\n5. Answer Generation Tool:")
        answer_tool = AnswerGenerationTool(llm=llm)
        
        result = await answer_tool.arun(
            original_query="What is machine learning?",
            supporting_docs="Machine learning is a subset of artificial intelligence..."
        )
        print(f"   {result[:200]}...")
        
        # 6. Can Answer Tool
        print("\n6. Can Answer Tool:")
        can_answer_tool = CanAnswerTool(llm=llm)
        
        result = await can_answer_tool.arun(
            user_query="What is machine learning?",
            supporting_docs="Machine learning is a subset of artificial intelligence..."
        )
        print(f"   {result}")
    
    async def demo_reranker(self):
        """Demonstrate reranker functionality."""
        print("\n=== Reranker Demo ===")
        
        llm = self.mock_components.MockLLM()
        
        # Create reranker
        config = RerankingConfig(
            relevance_weight=0.7,
            diversity_weight=0.3,
            max_results=5
        )
        reranker = Reranker(llm=llm, config=config)
        
        # Sample results
        results = [
            RetrievalResult(
                content="Python is a high-level programming language",
                score=0.8,
                metadata={"source": "doc1"}
            ),
            RetrievalResult(
                content="Machine learning uses Python extensively",
                score=0.7,
                metadata={"source": "doc2"}
            ),
            RetrievalResult(
                content="Python is popular for data science",
                score=0.6,
                metadata={"source": "doc3"}
            )
        ]
        
        # Rerank results
        reranked_results = await reranker.rerank(results, "Python programming")
        print(f"Reranked {len(reranked_results)} results")
        
        for i, result in enumerate(reranked_results, 1):
            print(f"{i}. Score: {result.score:.3f} - {result.content}")
            if result.metadata.get("reranked"):
                print(f"   Original score: {result.metadata.get('original_score', 'N/A')}")
                print(f"   Relevance score: {result.metadata.get('relevance_score', 'N/A')}")
                print(f"   Diversity score: {result.metadata.get('diversity_score', 'N/A')}")
    
    async def run_complete_demo(self):
        """Run the complete M15 retrieval system demo."""
        print("🚀 M15 Retrieval System Demo")
        print("=" * 50)
        
        try:
            await self.demo_basic_retrievers()
            await self.demo_hybrid_retriever()
            await self.demo_graph_retriever()
            await self.demo_auto_retriever()
            await self.demo_intelligent_agents()
            await self.demo_rag_tools()
            await self.demo_reranker()
            
            print("\n✅ Demo completed successfully!")
            print("\nM15 Retrieval System Features:")
            print("- ✅ Multiple retrieval strategies (Vector, BM25, Graph, Hybrid)")
            print("- ✅ Automatic strategy selection")
            print("- ✅ Intelligent agents for query analysis and retrieval")
            print("- ✅ LLM-based reranking with diversity optimization")
            print("- ✅ Complete RAG workflow tools")
            print("- ✅ Enterprise-ready with tenant isolation")
            
        except Exception as e:
            print(f"❌ Demo failed: {e}")


async def main():
    """Main demo function."""
    demo = M15RetrievalDemo()
    await demo.run_complete_demo()


if __name__ == "__main__":
    asyncio.run(main()) 