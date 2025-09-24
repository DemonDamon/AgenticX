"""Core Knowledge implementation for AgenticX Knowledge Management System"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Union, AsyncIterator
from pathlib import Path

from .base import BaseKnowledge, BaseReader, BaseChunker, ChunkingConfig
from .document import Document, DocumentMetadata
from .readers import get_reader
from .chunkers import get_chunker
from ..embeddings.base import BaseEmbeddingProvider
from ..storage.base import BaseVectorStorage

logger = logging.getLogger(__name__)


class Knowledge(BaseKnowledge):
    """Core Knowledge implementation with vector storage and embedding support"""
    
    def __init__(
        self,
        vector_store: BaseVectorStorage,
        embedding_model: Optional[BaseEmbeddingProvider] = None,
        chunking_config: Optional[ChunkingConfig] = None,
        auto_embed: bool = True,
        **kwargs
    ):
        """
        Initialize Knowledge instance
        
        Args:
            vector_store: Vector storage backend
            embedding_model: Embedding model for vectorization
            chunking_config: Default chunking configuration
            auto_embed: Whether to automatically embed documents
            **kwargs: Additional configuration
        """
        self.vector_store = vector_store
        self.embedding_model = embedding_model
        self.chunking_config = chunking_config or ChunkingConfig()
        self.auto_embed = auto_embed
        self.config = kwargs
        
        # Document cache
        self._document_cache: Dict[str, Document] = {}
        
        logger.info(f"Initialized Knowledge with {type(vector_store).__name__} vector store")
    
    async def add_document(
        self,
        document: Document,
        embed: Optional[bool] = None,
        **kwargs
    ) -> str:
        """Add a single document to the knowledge base"""
        
        embed = embed if embed is not None else self.auto_embed
        
        # Generate embedding if needed
        if embed and self.embedding_model and not document.embedding:
            try:
                document.embedding = await self.embedding_model.embed_text(document.content)
                document.metadata.embedding_model = self.embedding_model.model_name
            except Exception as e:
                logger.warning(f"Failed to embed document {document.id}: {e}")
        
        # Store in vector store
        await self.vector_store.add_documents([document])
        
        # Cache document
        self._document_cache[document.id] = document
        
        logger.debug(f"Added document {document.id} to knowledge base")
        return document.id
    
    async def add_documents(
        self,
        documents: List[Document],
        embed: Optional[bool] = None,
        batch_size: int = 100,
        **kwargs
    ) -> List[str]:
        """Add multiple documents to the knowledge base"""
        
        embed = embed if embed is not None else self.auto_embed
        document_ids = []
        
        # Process in batches
        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            
            # Generate embeddings for batch if needed
            if embed and self.embedding_model:
                texts = [doc.content for doc in batch if not doc.embedding]
                if texts:
                    try:
                        embeddings = await self.embedding_model.embed_texts(texts)
                        embedding_idx = 0
                        for doc in batch:
                            if not doc.embedding:
                                doc.embedding = embeddings[embedding_idx]
                                doc.metadata.embedding_model = self.embedding_model.model_name
                                embedding_idx += 1
                    except Exception as e:
                        logger.warning(f"Failed to embed batch: {e}")
            
            # Store batch in vector store
            await self.vector_store.add_documents(batch)
            
            # Cache documents
            for doc in batch:
                self._document_cache[doc.id] = doc
                document_ids.append(doc.id)
        
        logger.info(f"Added {len(documents)} documents to knowledge base")
        return document_ids
    
    async def add_text(
        self,
        text: str,
        metadata: Optional[Union[DocumentMetadata, Dict[str, Any]]] = None,
        chunking_config: Optional[ChunkingConfig] = None,
        **kwargs
    ) -> List[str]:
        """Add text content to the knowledge base"""
        
        # Create document
        if isinstance(metadata, dict):
            metadata = DocumentMetadata.from_dict(metadata)
        elif metadata is None:
            metadata = DocumentMetadata(source_type='text')
        
        document = Document(content=text, metadata=metadata)
        
        # Apply chunking if configured
        chunking_config = chunking_config or self.chunking_config
        if chunking_config.enabled:
            chunks = await self._chunk_document(document, chunking_config)
            return await self.add_documents(chunks, **kwargs)
        else:
            return [await self.add_document(document, **kwargs)]
    
    async def add_from_path(
        self,
        path: Union[str, Path],
        reader_name: Optional[str] = None,
        chunking_config: Optional[ChunkingConfig] = None,
        recursive: bool = False,
        **kwargs
    ) -> List[str]:
        """Add content from file or directory path"""
        
        path = Path(path)
        document_ids = []
        
        if path.is_file():
            # Single file
            documents = await self._read_file(path, reader_name)
            for doc in documents:
                ids = await self._process_document(doc, chunking_config, **kwargs)
                document_ids.extend(ids)
        
        elif path.is_dir():
            # Directory
            pattern = "**/*" if recursive else "*"
            for file_path in path.glob(pattern):
                if file_path.is_file():
                    try:
                        documents = await self._read_file(file_path, reader_name)
                        for doc in documents:
                            ids = await self._process_document(doc, chunking_config, **kwargs)
                            document_ids.extend(ids)
                    except Exception as e:
                        logger.warning(f"Failed to process {file_path}: {e}")
        
        else:
            raise FileNotFoundError(f"Path not found: {path}")
        
        logger.info(f"Added {len(document_ids)} documents from {path}")
        return document_ids
    
    async def search(
        self,
        query: str,
        limit: int = 10,
        filters: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> List[Document]:
        """Search for relevant documents"""
        
        # Generate query embedding if embedding model is available
        query_embedding = None
        if self.embedding_model:
            try:
                query_embedding = await self.embedding_model.embed_text(query)
            except Exception as e:
                logger.warning(f"Failed to embed query: {e}")
        
        # Search in vector store
        results = await self.vector_store.search(
            query=query,
            query_embedding=query_embedding,
            limit=limit,
            filters=filters,
            **kwargs
        )
        
        logger.debug(f"Found {len(results)} documents for query: {query[:50]}...")
        return results
    
    async def get_document(self, document_id: str) -> Optional[Document]:
        """Get document by ID"""
        
        # Check cache first
        if document_id in self._document_cache:
            return self._document_cache[document_id]
        
        # Query vector store
        documents = await self.vector_store.get_documents([document_id])
        if documents:
            doc = documents[0]
            self._document_cache[document_id] = doc
            return doc
        
        return None
    
    async def get_documents(self, document_ids: List[str]) -> List[Document]:
        """Get multiple documents by IDs"""
        
        # Check cache first
        cached_docs = []
        missing_ids = []
        
        for doc_id in document_ids:
            if doc_id in self._document_cache:
                cached_docs.append(self._document_cache[doc_id])
            else:
                missing_ids.append(doc_id)
        
        # Query vector store for missing documents
        if missing_ids:
            missing_docs = await self.vector_store.get_documents(missing_ids)
            for doc in missing_docs:
                self._document_cache[doc.id] = doc
            cached_docs.extend(missing_docs)
        
        return cached_docs
    
    async def update_document(
        self,
        document_id: str,
        content: Optional[str] = None,
        metadata: Optional[Union[DocumentMetadata, Dict[str, Any]]] = None,
        **kwargs
    ) -> bool:
        """Update an existing document"""
        
        document = await self.get_document(document_id)
        if not document:
            return False
        
        # Update content
        if content is not None:
            document.content = content
            document.metadata.size = len(content.encode('utf-8'))
            
            # Re-embed if auto_embed is enabled
            if self.auto_embed and self.embedding_model:
                try:
                    document.embedding = await self.embedding_model.embed_text(content)
                except Exception as e:
                    logger.warning(f"Failed to re-embed document {document_id}: {e}")
        
        # Update metadata
        if metadata:
            if isinstance(metadata, dict):
                document.update_metadata(**metadata)
            else:
                document.metadata = metadata
        
        # Update in vector store
        await self.vector_store.update_documents([document])
        
        # Update cache
        self._document_cache[document_id] = document
        
        logger.debug(f"Updated document {document_id}")
        return True
    
    async def delete_document(self, document_id: str) -> bool:
        """Delete a document"""
        
        success = await self.vector_store.delete_documents([document_id])
        
        # Remove from cache
        if document_id in self._document_cache:
            del self._document_cache[document_id]
        
        if success:
            logger.debug(f"Deleted document {document_id}")
        
        return success
    
    async def delete_documents(self, document_ids: List[str]) -> bool:
        """Delete multiple documents"""
        
        success = await self.vector_store.delete_documents(document_ids)
        
        # Remove from cache
        for doc_id in document_ids:
            if doc_id in self._document_cache:
                del self._document_cache[doc_id]
        
        if success:
            logger.info(f"Deleted {len(document_ids)} documents")
        
        return success
    
    async def clear(self) -> bool:
        """Clear all documents from the knowledge base"""
        
        success = await self.vector_store.clear()
        
        # Clear cache
        self._document_cache.clear()
        
        if success:
            logger.info("Cleared knowledge base")
        
        return success
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get knowledge base statistics"""
        
        stats = await self.vector_store.get_stats()
        stats.update({
            'cached_documents': len(self._document_cache),
            'embedding_model': self.embedding_model.model_name if self.embedding_model else None,
            'auto_embed': self.auto_embed,
        })
        
        return stats
    
    # Private helper methods
    
    async def _read_file(
        self,
        file_path: Path,
        reader_name: Optional[str] = None
    ) -> List[Document]:
        """Read file using appropriate reader"""
        
        reader = get_reader(file_path, reader_name)
        documents = await reader.read(file_path)
        
        # Update metadata
        for doc in documents:
            doc.metadata.source = str(file_path)
            doc.metadata.source_type = 'file'
            doc.metadata.reader_name = reader.__class__.__name__
        
        return documents
    
    async def _chunk_document(
        self,
        document: Document,
        chunking_config: ChunkingConfig
    ) -> List[Document]:
        """Chunk a document using configured chunker"""
        
        chunker = get_chunker(chunking_config.strategy)
        chunks = await chunker.chunk(document, chunking_config)
        
        # Update chunk metadata
        for chunk in chunks:
            chunk.metadata.chunker_name = chunker.__class__.__name__
        
        return chunks
    
    async def _process_document(
        self,
        document: Document,
        chunking_config: Optional[ChunkingConfig] = None,
        **kwargs
    ) -> List[str]:
        """Process a document (chunking + adding)"""
        
        chunking_config = chunking_config or self.chunking_config
        
        if chunking_config.enabled:
            chunks = await self._chunk_document(document, chunking_config)
            return await self.add_documents(chunks, **kwargs)
        else:
            return [await self.add_document(document, **kwargs)]
    
    async def __aenter__(self):
        """Async context manager entry"""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        # Cleanup if needed
        pass