# Knowledge & RAG

## Overview

AgenticX provides a complete document intelligence pipeline — from ingestion and chunking to hybrid retrieval and GraphRAG.

## Document Ingestion

```python
from agenticx.knowledge import KnowledgeBase

kb = KnowledgeBase(name="my-docs")

# Add documents
kb.add_file("report.pdf")
kb.add_url("https://example.com/article")
kb.add_text("AgenticX is a multi-agent framework...", source="manual")

# Process (chunk, embed, index)
kb.build()
```

## Retrieval

```python
# Vector retrieval
results = kb.search("What are the key features?", top_k=5)

# Hybrid retrieval (vector + BM25)
results = kb.search("key features", mode="hybrid", top_k=10)

# With reranking
results = kb.search("key features", mode="hybrid", rerank=True, top_k=5)
```

## GraphRAG

For complex documents with rich relationships, use GraphRAG:

```python
from agenticx.knowledge import GraphKnowledgeBase

gkb = GraphKnowledgeBase(
    name="research-papers",
    graph_backend="neo4j",  # or "nebula"
    neo4j_uri="bolt://localhost:7687"
)

gkb.add_file("research_paper.pdf")
gkb.build()  # Extracts entities and relationships

# Graph-aware retrieval
results = gkb.search("relationship between agent memory and performance")
```

## Giving a Knowledge Base to an Agent

```python
from agenticx.tools import KnowledgeBaseTool

kb_tool = KnowledgeBaseTool(knowledge_base=kb)

executor = AgentExecutor(
    agent=agent,
    llm=llm,
    tools=[kb_tool]
)
```

## Supported Document Formats

| Format | Reader |
|--------|--------|
| PDF | MinerU / PyMuPDF |
| Word (.docx) | python-docx |
| PowerPoint (.pptx) | python-pptx |
| Markdown | Native |
| HTML | BeautifulSoup |
| CSV / Excel | Pandas |
| Plain text | Native |

## Embeddings

Configure the embedding model:

```python
from agenticx.embeddings import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
kb = KnowledgeBase(name="my-docs", embeddings=embeddings)
```

Supported embedding providers: OpenAI, Bailian, SiliconFlow, LiteLLM.

## Vector Stores

| Store | Notes |
|-------|-------|
| **Faiss** | Local, fast, no server required |
| **Chroma** | Local or server mode |
| **Qdrant** | Production-grade, cloud available |
| **Milvus** | High-scale enterprise |
| **PgVector** | PostgreSQL extension |
| **Pinecone** | Managed cloud |
| **Weaviate** | Managed cloud with GraphQL |
