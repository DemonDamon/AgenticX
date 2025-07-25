"""
Vector Retriever Implementation

Implements vector-based semantic search using embeddings.
"""

from typing import List, Dict, Any, Optional, Union
import numpy as np
from dataclasses import dataclass

from .base import BaseRetriever, RetrievalQuery, RetrievalResult, RetrievalError
from ..embeddings.base import BaseEmbeddingProvider
from ..storage.vectordb_storages.base import BaseVectorStorage


class VectorRetriever(BaseRetriever):
    """
    Vector-based semantic retriever using embeddings.
    
    Supports multiple vector databases and embedding providers.
    """
    
    def __init__(
        self,
        tenant_id: str,
        embedding_provider: BaseEmbeddingProvider,
        vector_storage: BaseVectorStorage,
        **kwargs
    ):
        # Filter out organization_id from kwargs to avoid conflicts
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != 'organization_id'}
        super().__init__(tenant_id, **filtered_kwargs)
        self.embedding_provider = embedding_provider
        self.vector_storage = vector_storage
        self._documents: Dict[str, Dict[str, Any]] = {}
    
    async def _initialize(self):
        """Initialize the vector retriever."""
        # Load existing documents if any
        await self._load_existing_documents()
    
    async def retrieve(
        self,
        query: Union[str, RetrievalQuery],
        **kwargs
    ) -> List[RetrievalResult]:
        """Retrieve documents using vector similarity search."""
        
        await self.initialize()
        
        # Convert query to RetrievalQuery if needed
        if isinstance(query, str):
            retrieval_query = RetrievalQuery(text=query)
        else:
            retrieval_query = query
        
        try:
            # Generate query embedding
            query_embedding = await self._generate_embedding(retrieval_query.text)
            
            if query_embedding is None:
                return []
            
            # Search vector storage
            from ..storage.vectordb_storages.base import VectorDBQuery
            query = VectorDBQuery(
                query_vector=query_embedding.tolist(),
                top_k=retrieval_query.limit
            )
            search_results = await self.vector_storage.query(query)
            
            # Convert to RetrievalResult objects
            results = []
            for result in search_results:
                if result.score >= retrieval_query.min_score:
                    retrieval_result = RetrievalResult(
                        content=result.record.payload.get("content", ""),
                        score=result.score,
                        metadata=result.record.payload.get("metadata", {}),
                        source=result.record.payload.get("source"),
                        chunk_id=result.record.id,
                        vector_score=result.score
                    )
                    results.append(retrieval_result)
            
            return results
            
        except Exception as e:
            raise RetrievalError(f"Vector retrieval failed: {str(e)}") from e
    
    async def add_documents(
        self,
        documents: List[Dict[str, Any]],
        **kwargs
    ) -> List[str]:
        """Add documents to the vector index."""
        
        await self.initialize()
        
        try:
            document_ids = []
            
            for doc in documents:
                # Generate document embedding
                content = doc.get("content", "")
                embedding = await self._generate_embedding(content)
                
                if embedding is not None:
                    # Add to vector storage
                    from ..storage.vectordb_storages.base import VectorRecord
                    record = VectorRecord(
                        vector=embedding.tolist(),
                        payload={
                            "content": content,
                            "metadata": doc.get("metadata", {}),
                            "source": doc.get("source"),
                            "tenant_id": self.tenant_id
                        }
                    )
                    record_id = await self.vector_storage.add([record])
                    
                    document_ids.append(record_id)
                    
                    # Store document metadata
                    self._documents[record_id] = doc
            
            return document_ids
            
        except Exception as e:
            raise RetrievalError(f"Failed to add documents: {str(e)}") from e
    
    async def remove_documents(
        self,
        document_ids: List[str],
        **kwargs
    ) -> bool:
        """Remove documents from the vector index."""
        
        try:
            for doc_id in document_ids:
                # Remove from vector storage
                await self.vector_storage.delete(doc_id)
                
                # Remove from local cache
                if doc_id in self._documents:
                    del self._documents[doc_id]
            
            return True
            
        except Exception as e:
            raise RetrievalError(f"Failed to remove documents: {str(e)}") from e
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get vector retriever statistics."""
        
        try:
            storage_stats = await self.vector_storage.status()
            
            return {
                "retriever_type": "vector",
                "total_documents": len(self._documents),
                "vector_dimension": storage_stats.vector_dim,
                "vector_count": storage_stats.vector_count,
                "tenant_id": self.tenant_id
            }
            
        except Exception as e:
            return {
                "retriever_type": "vector",
                "error": str(e),
                "tenant_id": self.tenant_id
            }
    
    async def _generate_embedding(self, text: str) -> Optional[np.ndarray]:
        """Generate embedding for text."""
        
        try:
            embeddings = await self.embedding_provider.aembed([text])
            if embeddings and len(embeddings) > 0:
                return np.array(embeddings[0])
            return None
            
        except Exception as e:
            print(f"Failed to generate embedding: {e}")
            return None
    
    async def _load_existing_documents(self):
        """Load existing documents from vector storage."""
        
        try:
            # This would load existing documents from storage
            # Implementation depends on the specific vector storage
            pass
            
        except Exception as e:
            print(f"Failed to load existing documents: {e}") 